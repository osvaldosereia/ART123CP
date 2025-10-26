const VER='v2';
const SHELL=['index.html','assets/css/styles.css','assets/js/app.js'];

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(VER).then(c=>c.addAll(SHELL)));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==VER).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);
  if(url.origin!==location.origin) return;
  // Shell: cache-first
  if(SHELL.some(p=>url.pathname.endsWith(p))){
    e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
    return;
  }
  // Data: stale-while-revalidate
  if(url.pathname.includes('/data/')){
    e.respondWith((async()=>{
      const cache=await caches.open(VER);
      const cached=await cache.match(e.request);
      const fresh=fetch(e.request).then(resp=>{cache.put(e.request,resp.clone());return resp;}).catch(()=>cached);
      return cached||fresh;
    })());
  }
});
