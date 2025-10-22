// escopo dinâmico
const SCOPE = self.registration ? self.registration.scope : "./";
const toURL = (p) => new URL(p, SCOPE).toString();

const CORE = [
  toURL("./"),
  toURL("index.html"),
  toURL("style.css"),
  toURL("app.js"),
  toURL("favicon.png"),
  toURL("data/index.json")
];
const VERSION = "v2";

self.addEventListener("install", e=>{
  e.waitUntil(caches.open(VERSION).then(c=>c.addAll(CORE)));
});

self.addEventListener("activate", e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==VERSION).map(k=>caches.delete(k))))
  );
});

self.addEventListener("fetch", e=>{
  const req = e.request;
  e.respondWith(
    caches.match(req).then(cached=>{
      const fetchPromise = fetch(req).then(res=>{
        const copy = res.clone();
        caches.open(VERSION).then(c=>c.put(req, copy));
        return res;
      }).catch(_=>cached);
      return cached || fetchPromise;
    })
  );
});
