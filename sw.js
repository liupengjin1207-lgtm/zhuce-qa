/* 最小 Service Worker：让页面达到"可安装"标准 */
const CACHE = 'zhuce-qa-v1';
const CORE = ['./index.html','./knowledge.js','./engine.js','./manifest.json','./icon-192.png','./icon-512.png'];
self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', e=>{
  e.respondWith(
    caches.match(e.request).then(hit=>hit || fetch(e.request).then(resp=>{
      if (e.request.method==='GET' && resp.ok && new URL(e.request.url).origin===location.origin){
        const clone = resp.clone();
        caches.open(CACHE).then(c=>c.put(e.request, clone));
      }
      return resp;
    }).catch(()=>caches.match('./index.html')))
  );
});
