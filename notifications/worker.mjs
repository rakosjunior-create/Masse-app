import {sendPushNotification} from '@mmmike/web-push/send';

export function clock(ms, zone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms)).map(p=>[p.type,p.value]));
  return {date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}`};
}
export function reminderPreferences(input={}) {
  const defaults={name:'Iosif',title:'Masse · {repas}',body:'{prenom}, c’est l’heure de {repas} 🍽️ Pense à renseigner ce que tu as mangé.',delay:0,followup:0,days:[0,1,2,3,4,5,6],quiet:false,quietStart:'23:00',quietEnd:'06:30'};
  const p={...defaults,...input};
  for(const [key,max] of [['name',40],['title',100],['body',350]])if(typeof p[key]!=='string'||p[key].length>max||(key!=='name'&&!p[key].trim()))throw Error('Texte de notification invalide');
  if(!Number.isInteger(p.delay)||p.delay<0||p.delay>180||![0,15,30,60,120].includes(p.followup)||!Array.isArray(p.days)||p.days.length>7||p.days.some(d=>!Number.isInteger(d)||d<0||d>6)||new Set(p.days).size!==p.days.length||typeof p.quiet!=='boolean')throw Error('Règles de rappel invalides');
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.quietStart)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.quietEnd)||(p.quiet&&p.quietStart===p.quietEnd))throw Error('Heures silencieuses invalides');
  return Object.fromEntries(Object.keys(defaults).map(k=>[k,p[k]]));
}
function done(config,date,id){return (config.date===date&&config.done.includes(id))||config.doneDays?.[date]?.includes(id);}
function silent(p,time){return p.quiet&&(p.quietStart<p.quietEnd?time>=p.quietStart&&time<p.quietEnd:time>=p.quietStart||time<p.quietEnd);}
export function notificationPayload(config,meal,followup=false) {
 const p=reminderPreferences(config.preferences),replace=text=>text.replace(/\{(prenom|repas|heure)\}/g,(_,key)=>({prenom:p.name||'Bonjour',repas:meal.name,heure:meal.time})[key]);
 return {title:replace(p.title),body:(followup?'Rappel : ':'')+replace(p.body)};
}
// Resolve real instants around local meal dates, including DST and midnight offsets.
export function reminderEvents(config,sent,now){
  const p=reminderPreferences(config.preferences);
  const offsets=new Set(),first=Math.floor(now/60000)*60000;
  for(const hours of [-24,0,24,48,96,168,240]){const ms=first+hours*3600000,local=clock(ms,config.zone);offsets.add(Date.parse(`${local.date}T${local.time}:00Z`)-ms);}
  const today=clock(now,config.zone).date,candidates=[];
  for(let day=-1;day<9;day++) {
    const date=new Date(Date.parse(today+'T12:00:00Z')+day*86400000).toISOString().slice(0,10);
    if(!p.days.includes(new Date(date+'T12:00:00Z').getUTCDay()))continue;
    for(const meal of config.meals) {
      if(done(config,date,meal.id))continue;
      for(const followup of [false,...(p.followup?[true]:[])]){
        const primary=`${date}:${meal.id}`,key=primary+(followup?':followup':'');if(sent[key])continue;
        const nominal=new Date(Date.parse(`${date}T${meal.time}:00Z`)+(p.delay+(followup?p.followup:0))*60000).toISOString(),targetDate=nominal.slice(0,10),time=nominal.slice(11,16);
        if(silent(p,time))continue;
        for(const offset of offsets){const at=Date.parse(nominal)-offset,local=clock(at,config.zone);if(local.date===targetDate&&local.time===time)candidates.push({at,date,meal,key,primary,followup});}
      }
    }
  }
  return candidates.sort((a,b)=>a.at-b.at);
}
export function nextReminder(config,sent,now){
 const first=Math.floor(now/60000)*60000,events=reminderEvents(config,sent,now);
 const event=events.find(e=>e.at>=first&&(!e.followup||sent[e.primary]||events.some(primary=>primary.key===e.primary&&primary.at>=first)));
 return event?{...event,at:Math.max(now+1000,event.at)}:null;
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
  const doneDays={};if(input.doneDays!==undefined){if(!input.doneDays||typeof input.doneDays!=='object'||Array.isArray(input.doneDays)||Object.keys(input.doneDays).length>3)throw Error('Dates invalides');for(const [date,ids] of Object.entries(input.doneDays)){if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Array.isArray(ids)||ids.length>20||ids.some(id=>!meals.some(m=>m.id===id)))throw Error('Statuts invalides');doneDays[date]=ids;}}
  return {zone:input.zone,date:input.date,done:input.done,doneDays,preferences:reminderPreferences(input.preferences),meals,subscription:{endpoint:sub.endpoint,keys:{p256dh:sub.keys.p256dh,auth:sub.keys.auth}}};
}
function reply(data,status=200,origin) {
  return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...(origin?{'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS'}:{})}});
}
export default {
  async fetch(request,env) {
    const origin=request.headers.get('Origin');
    if(origin!==env.APP_ORIGIN) return reply({error:'Origine refusée'},403);
    if(request.method==='OPTIONS') return reply({},200,origin);
    if(new URL(request.url).pathname==='/health'&&request.method==='GET')return reply({service:'Masse rappels',version:'custom-reminders-v1'},200,origin);
    const expected=env.PAIRING_TOKEN;
    if(!expected || expected.length<32 || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return reply({error:'Service non configuré'},503,origin);
    if(request.headers.get('Authorization')!==`Bearer ${expected}`) return reply({error:'Code de connexion incorrect'},401,origin);
    if(new URL(request.url).pathname==='/config' && request.method==='GET') return reply({publicKey:env.VAPID_PUBLIC_KEY,features:['custom-reminders-v1']},200,origin);
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
      try{return (await this.send(config,{...notificationPayload(config,config.meals[0]),tag:'masse-test'}))?reply({ok:true}):reply({error:'Abonnement expiré : reconnecte cet appareil'},410);}
      catch{return reply({error:'Échec de l’envoi : vérifie la configuration du service'},502);}
    }
    return reply({error:'Introuvable'},404);
  }
  async alarm() {
    const config=await this.ctx.storage.get('config');if(!config)return;
    const now=Date.now(),sent=await this.ctx.storage.get('sent')||{};
    for(const event of reminderEvents(config,sent,now)) {
      const {meal,key,followup,primary}=event;
      if(event.at>now||now-event.at>10*60000||sent[key]||(followup&&!sent[primary]))continue;
      // Record before sending: prevent duplicate notifications on alarm retries.
      sent[key]=true;await this.ctx.storage.put('sent',sent);
      try {if(!await this.send(config,{...notificationPayload(config,meal,followup),tag:`masse-${key}`})) return;}
      catch{await this.ctx.storage.put('lastSendError',new Date().toISOString());}
    }
    const recent=Object.fromEntries(Object.entries(sent).filter(([key])=>key.slice(0,10)>=clock(now-3*86400000,config.zone).date));
    await this.ctx.storage.put('sent',recent);await this.schedule();
  }
}
