// HarvestChain service worker (readable source; build stamps the cache version and minifies into ../sw.js).
// Cache-first for the shell, network fallback, old caches dropped on activate.
const V = 'hc-%V%';
const FILES = ['./', 'index.html', 'game.wasm'];
self.oninstall = (e) => e.waitUntil(
  caches.open(V)
    .then((c) => c.addAll(FILES.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
self.onactivate = (e) => e.waitUntil(
  caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
self.onfetch = (e) => {
  if (e.request.method === 'GET') {
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request)));
  }
};
