import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker,{nextReminder,validateConfig,MealReminders,reminderPreferences,notificationPayload} from './worker.mjs';
const config={zone:'Europe/Paris',date:'2026-09-29',done:[],meals:[{id:'lunch',name:'Déjeuner',time:'13:00'}],subscription:{endpoint:'https://web.push.apple.com/device',keys:{p256dh:'a'.repeat(87),auth:'b'.repeat(22)}}};
test('Horaire de Paris, repas validé, jour suivant et dédoublonnage',()=>{
  const now=Date.parse('2026-09-29T10:00:00Z');
  assert.equal(nextReminder(config,{},now).at,Date.parse('2026-09-29T11:00:00Z'));
  assert.equal(nextReminder({...config,done:['lunch']},{},now).date,'2026-09-30');
  assert.equal(nextReminder(config,{'2026-09-29:lunch':true},now).date,'2026-09-30');
});
test('Passage été/hiver, heure absente ou répétée',()=>{
  const cfg={...config,date:'2026-03-29',meals:[{id:'lunch',name:'Test',time:'02:30'}]};
  assert.equal(nextReminder(cfg,{},Date.parse('2026-03-29T00:00:00Z')).date,'2026-03-30');
  cfg.date='2026-10-25';
  assert.equal(nextReminder(cfg,{},Date.parse('2026-10-25T00:00:00Z')).at,Date.parse('2026-10-25T00:30:00Z'));
  assert.equal(nextReminder(cfg,{'2026-10-25:lunch':true},Date.parse('2026-10-25T00:40:00Z')).date,'2026-10-26');
});
test('Validation stricte et protection contre les destinations externes',()=>{
  assert.deepEqual(validateConfig({...config,weight:71}),{...config,doneDays:{},preferences:reminderPreferences()});
  for(const endpoint of ['https://example.com/push','http://web.push.apple.com/push','https://web.push.apple.com:444/push','https://web.push.apple.com@evil.com/push'])assert.throws(()=>validateConfig({...config,subscription:{...config.subscription,endpoint}}));
  assert.throws(()=>validateConfig({...config,meals:[{...config.meals[0],time:'25:00'}]}));
  assert.throws(()=>validateConfig({...config,done:['unknown']}));
});
test('Origine et code privé exigés',async()=>{
  const env={APP_ORIGIN:'https://rakosjunior-create.github.io',PAIRING_TOKEN:'a'.repeat(64),VAPID_PUBLIC_KEY:'x',VAPID_PRIVATE_KEY:'y'};
  assert.equal((await worker.fetch(new Request('https://service/config'),env)).status,403);
  const headers={Origin:env.APP_ORIGIN};
  assert.equal((await worker.fetch(new Request('https://service/config',{headers}),env)).status,401);
  headers.Authorization='Bearer '+env.PAIRING_TOKEN;
  assert.equal((await worker.fetch(new Request('https://service/config',{headers}),env)).status,200);
});
test('Alarme : repas validé ignoré, autres envoyés une seule fois, suppression du service',async()=>{
  const values=new Map([['config',config]]),storage={get:async k=>values.get(k),put:async(k,v)=>values.set(k,v),delete:async k=>values.delete(k),setAlarm:async v=>values.set('alarm',v),deleteAlarm:async()=>values.delete('alarm')};
  const obj=new MealReminders({storage},{}),realNow=Date.now;Date.now=()=>Date.parse('2026-09-29T11:00:00Z');let sends=0;obj.send=async()=>{sends++;return true;};
  try{
    values.set('config',{...config,done:['lunch']});await obj.alarm();assert.equal(sends,0);
    values.set('config',config);await obj.alarm();await obj.alarm();assert.equal(sends,1);
    assert.equal((await obj.fetch(new Request('https://service/sync',{method:'DELETE'}))).status,200);assert.equal(values.has('config'),false);assert.equal(values.has('alarm'),false);
  }finally{Date.now=realNow;}
});
test('Personnalisation du texte et refus des réglages invalides',()=>{
 const prefs=reminderPreferences({name:'Iosif',title:'{repas} à {heure}',body:'{prenom}, complète {repas}.'});
 assert.deepEqual(notificationPayload({...config,preferences:prefs},config.meals[0]),{title:'Déjeuner à 13:00',body:'Iosif, complète Déjeuner.'});
 assert.equal(notificationPayload({...config,preferences:prefs},config.meals[0],true).body,'Rappel : Iosif, complète Déjeuner.');
 for(const input of [{delay:-1},{delay:181},{delay:1.5},{followup:10},{days:[7]},{days:[1,1]},{body:''},{quiet:true,quietStart:'22:00',quietEnd:'22:00'}])assert.throws(()=>reminderPreferences(input));
});
test('Décalage, jours actifs et heures silencieuses sans report',()=>{
 const now=Date.parse('2026-09-29T10:00:00Z');
 assert.equal(nextReminder({...config,preferences:{delay:15}},{},now).at,Date.parse('2026-09-29T11:15:00Z'));
 assert.equal(nextReminder({...config,preferences:{days:[1]}},{},now).date,'2026-10-05');
 assert.equal(nextReminder({...config,preferences:{days:[]}},{},now),null);
 assert.equal(nextReminder({...config,preferences:{quiet:true,quietStart:'12:00',quietEnd:'14:00'}},{},now),null);
 const dinner={...config,meals:[{id:'dinner',name:'Dîner',time:'22:30'}],preferences:{quiet:true,quietStart:'22:00',quietEnd:'06:00'}};
 assert.equal(nextReminder(dinner,{},now),null);
});
test('Second rappel conditionnel, changement de jour et validation d’hier',()=>{
 const cfg={...config,preferences:{followup:30}},sent={'2026-09-29:lunch':true},now=Date.parse('2026-09-29T11:10:00Z');
 const followup=nextReminder(cfg,sent,now);assert.equal(followup.followup,true);assert.equal(followup.at,Date.parse('2026-09-29T11:30:00Z'));
 assert.equal(nextReminder({...cfg,done:['lunch']},sent,now).date,'2026-09-30');
 assert.equal(nextReminder(cfg,{},now).date,'2026-09-30');
 const midnight={...config,date:'2026-09-30',meals:[{id:'dinner',name:'Dîner',time:'23:50'}],preferences:{delay:20}};
 assert.equal(nextReminder(midnight,{},Date.parse('2026-09-29T22:00:00Z')).at,Date.parse('2026-09-29T22:10:00Z'));
 assert.equal(nextReminder({...midnight,doneDays:{'2026-09-29':['dinner']}},{},Date.parse('2026-09-29T22:00:00Z')).date,'2026-09-30');
});
