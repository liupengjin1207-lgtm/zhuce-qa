/* Service Worker：PWA 可安装 + 离线可用 */
const CACHE = 'zhuce-qa-v3';
const CORE = ['./index.html','./knowledge.js','./engine.js','./stats.js','./manifest.json','./icon-192.png','./icon-512.png'];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE).catch(()=>{})).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', e=>{
  // 只处理同源 GET 请求；Supabase / Worker 等跨域请求直接放行，不走缓存
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  e.respondWith(
    // 网络优先，失败回退缓存（保证内容始终最新，断网也能用）
    fetch(e.request).then(resp=>{
      if (resp && resp.ok){
        const clone = resp.clone();
        caches.open(CACHE).then(c=>c.put(e.request, clone));
      }
      return resp;
    }).catch(()=>caches.match(e.request).then(hit=>hit || caches.match('./index.html')))
  );
});
