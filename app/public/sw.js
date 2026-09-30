/* DARA service worker：プッシュ通知を受け取って表示する（画面のキャッシュはしない） */
self.addEventListener('install', function(){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function(e){
  var d = {};
  try{ d = e.data ? e.data.json() : {}; }catch(err){ d = {t:'DARA', b:e.data ? e.data.text() : ''}; }
  e.waitUntil(self.registration.showNotification(d.t || 'DARA', {
    body:d.b || '',
    icon:'/assets/icon-192.png',
    badge:'/assets/icon-64.png',
    tag:d.g || undefined,
    renotify:!!d.g,
    data:{url:d.u || '/'}
  }));
});

self.addEventListener('notificationclick', function(e){
  e.notification.close();
  var url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil((async function(){
    var list = await self.clients.matchAll({type:'window', includeUncontrolled:true});
    for(var i = 0; i < list.length; i++){
      if(list[i].url.indexOf(self.location.origin) === 0){
        await list[i].focus();
        list[i].postMessage({type:'go', url:url});
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
