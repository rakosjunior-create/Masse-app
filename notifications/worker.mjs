import {sendPushNotification} from '@mmmike/web-push/send';

export function clock(ms, zone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms)).map(p=>[p.type,p.value]));
  return {date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}`};
}
// Resolve local dates with nearby UTC offsets; verify candidates across DST changes.
export function nextReminder(config, sent, now) {
  const offsets=new Set(),first=Math.floor(now/60000)*60000;
  for(const hours of [-12,0,12,24,36,48,60]){const ms=first+hours*3600000,p=clock(ms,config.zone);offsets.add(Date.parse(`${p.date}T${p.time}:00Z`)-ms);}
  const today=clock(now,config.zone).date,candidates=[];
  for(let day=0;day<3;day++) {
    const date=new Date(Date.parse(today+'T12:00:00Z')+day*86400000).toISOString().slice(0,10);
    for(const meal of config.meals) {
      const key=`${date}:${meal.id}`;if(sent[key]||(config.date===date&&config.done.includes(meal.id)))continue;
      for(const offset of offsets){const ms=Date.parse(`${date}T${meal.time}:00Z`)-offset;if(ms<first)continue;const local=clock(ms,config.zone);if(local.date===date&&local.time===meal.time)candidates.push({at:Math.max(now+1000,ms),date,meal,key});}
    }
  }
  return candidates.sort((a,b)=>a.at-b.at)[0]||null;
}
export function validateConfig(input) {
  if(!input || !Array.isArray(input.meals) || input.meals.length<1 || input.meals.length>20) throw Error('Menu invalide');
  new Intl.DateTimeFormat('en',{timeZone:input.zone}).format();
  if(typeof input.zone!=='string' || input.zone.length>80 || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw Error('Date invalide');
  const meals=input.meals.map(m=>{
    if(typeof m.id!=='string'||! /^[a-zA-Z0-9_-]{1,80}$/.test(m.id)||typeof m.name!=='string'||!m.name.trim()||m.name.length>120||!/^([01]\d|2[0-3]):[0-5]\d$/.test(m.time)) throw Error('Repas invalide');
    return {id:m.id,name:m.name,time:m.time};
  });
  if(new Set(meals.map(m=>m.id)).size!==meals.length || !Array.isArray(input.done) || input.done.some(id=>!meals.some(m=>m.id===id))) throw Error('Statuts invalides');
  const sub=input.subscription, endpoint=new URL(sub?.endpoint);
  const allowed=endpoint.hostname==='fcm.googleapis.com'||endpoint.hostname==='updates.push.services.mozilla.com'||endpoint.hostname==='web.push.apple.com'||endpoint.hostname.endsWith('.push.apple.com');
  if(endpoint.protocol!=='https:'||endpoint.port||endpoint.username||endpoint.password||!allowed||endpoint.href.length>4096|| !/^[\w-]{87}$/.test(sub?.keys?.p256dh)||! /^[\w-]{22}$/.test(sub?.keys?.auth)) throw Error('Abonnement invalide');
  return {zone:input.zone,date:input.date,done:input.done,meals,subscription:{endpoint:sub.endpoint,keys:{p256dh:sub.keys.p256dh,auth:sub.keys.auth}}};
}
function reply(data,status=200,origin) {
  return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...(origin?{'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS'}:{})}});
}
export default {
  async fetch(request,env) {
    const origin=request.headers.get('Origin');
    if(origin!==env.APP_ORIGIN) return reply({error:'Origine refusée'},403);
    if(request.method==='OPTIONS') return reply({},200,origin);
    const expected=env.PAIRING_TOKEN;
    if(!expected || expected.length<32 || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return reply({error:'Service non configuré'},503,origin);
    if(request.headers.get('Authorization')!==`Bearer ${expected}`) return reply({error:'Code de connexion incorrect'},401,origin);
    if(new URL(request.url).pathname==='/config' && request.method==='GET') return reply({publicKey:env.VAPID_PUBLIC_KEY},200,origin);
    try {
      const result=await env.REMINDERS.get(env.REMINDERS.idFromName('owner')).fetch(request);
      return new Response(result.body,{status:result.status,headers:{...Object.fromEntries(result.headers),'Access-Control-Allow-Origin':origin,'Vary':'Origin'}});
    }catch {return reply({error:'Service temporairement indisponible'},503,origin);}
  }
};
export class MealReminders {
  constructor(ctx,env){this.ctx=ctx;this.env=env;}
  async schedule() {
    const config=await this.ctx.storage.get('config');
    if(!config){await this.ctx.storage.deleteAlarm();return;}
    const next=nextReminder(config,await this.ctx.storage.get('sent')||{},Date.now());
    if(next) await this.ctx.storage.setAlarm(next.at);else await this.ctx.storage.deleteAlarm();
  }
  async send(config,payload) {
    const ok=await sendPushNotification(config.subscription,{...payload,url:this.env.APP_URL},{publicKey:this.env.VAPID_PUBLIC_KEY,privateKey:this.env.VAPID_PRIVATE_KEY,subject:this.env.VAPID_SUBJECT},{ttl:600,urgency:'high'});
    if(!ok){await this.ctx.storage.delete('config');await this.ctx.storage.deleteAlarm();}
    return ok;
  }
  async fetch(request) {
    const path=new URL(request.url).pathname;
    if(path==='/sync' && request.method==='POST') {
      try {
        const raw=await request.text();if(raw.length>16000) return reply({error:'Requête trop volumineuse'},413);
        const config=validateConfig(JSON.parse(raw));
        await this.ctx.storage.put('config',config);await this.schedule();return reply({ok:true});
      }catch{return reply({error:'Vérifie les horaires, le fuseau et l’abonnement'},400);}
    }
    if(path==='/sync' && request.method==='DELETE') {await this.ctx.storage.delete('config');await this.ctx.storage.deleteAlarm();return reply({ok:true});}
    if(path==='/test' && request.method==='POST') {
      const config=await this.ctx.storage.get('config');if(!config) return reply({error:'Aucun appareil connecté'},409);
      try{return (await this.send(config,{title:'Masse · Test',body:'Les notifications sont connectées. Pense à compléter ton menu.',tag:'masse-test'}))?reply({ok:true}):reply({error:'Abonnement expiré : reconnecte cet appareil'},410);}
      catch{return reply({error:'Échec de l’envoi : vérifie la configuration du service'},502);}
    }
    return reply({error:'Introuvable'},404);
  }
  async alarm() {
    const config=await this.ctx.storage.get('config');if(!config)return;
    const now=Date.now(),local=clock(now,config.zone),sent=await this.ctx.storage.get('sent')||{};
    const minute=Number(local.time.slice(0,2))*60+Number(local.time.slice(3));
    for(const meal of config.meals) {
      const planned=Number(meal.time.slice(0,2))*60+Number(meal.time.slice(3)),key=`${local.date}:${meal.id}`;
      if(minute<planned||minute-planned>10||sent[key]||(config.date===local.date&&config.done.includes(meal.id)))continue;
      // Record before sending: prevent duplicate notifications on alarm retries.
      sent[key]=true;await this.ctx.storage.put('sent',sent);
      try {if(!await this.send(config,{title:`Masse · ${meal.name}`,body:'Pense à compléter ce repas dans ton menu du jour.',tag:`masse-${key}`})) return;}
      catch{await this.ctx.storage.put('lastSendError',new Date().toISOString());}
    }
    const recent=Object.fromEntries(Object.entries(sent).filter(([key])=>key.slice(0,10)>=clock(now-3*86400000,config.zone).date));
    await this.ctx.storage.put('sent',recent);await this.schedule();
  }
}
