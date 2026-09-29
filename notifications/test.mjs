import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker,{nextReminder,validateConfig,MealReminders} from './worker.mjs';
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
  assert.deepEqual(validateConfig({...config,weight:71}),config);
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
