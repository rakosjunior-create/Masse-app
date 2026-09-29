const CACHE='masse-v3';
const ASSETS=['./','./index.html','./manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()])));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
  const key=event.request.mode==='navigate'?'./index.html':event.request;
  event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(c=>c.put(key,copy));}return response;}).catch(()=>caches.match(key)));
});
self.addEventListener('push',event=>{
  let payload={};try{payload=event.data?.json()||{};}catch{}
  event.waitUntil(self.registration.showNotification(payload.title||'Masse · Rappel repas',{body:payload.body||'Pense à compléter ton menu du jour.',tag:payload.tag||'masse-meal',data:{url:new URL('./',self.location.href).href}}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();const url=new URL('./',self.location.href).href;
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{const open=clients.find(c=>c.url.startsWith(url));if(open){await open.navigate(url);return open.focus();}return self.clients.openWindow(url);}));
});
