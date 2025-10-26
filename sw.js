// meujus service worker — cache shell, revalidate data
const VER = 'v1';
const SHELL = [
'/',
'/index.html',
'/assets/css/styles.css',
'/assets/js/app.js'
];
self.addEventListener('install', e => {
e.waitUntil(caches.open(VER).then(c => c.addAll(SHELL)));
});
self.addEventListener('activate', e => {
e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k!==VER).map(k => caches.delete(k)))));
self.clients.claim();
});
self.addEventListener('fetch', e => {
const url = new URL(e.request.url);
// Only handle same-origin
if (url.origin !== location.origin) return;
// Cache-first for shell
if (SHELL.includes(url.pathname)) {
e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
return;
}
// Stale-while-revalidate for data/*.txt and index.json
if (url.pathname.startsWith('/data/')) {
e.respondWith((async () => {
const cache = await caches.open(VER);
const cached = await cache.match(e.request);
const fetchPromise = fetch(e.request).then(resp => { cache.put(e.request, resp.clone()); return resp; }).catch(()=>cached);
return cached || fetchPromise;
})());
return;
}
});
