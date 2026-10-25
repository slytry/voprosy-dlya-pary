const CACHE = 'vdp-static-v2';
const CORE = ['./', './index.html', './css/app.css', './js/app.js', './js/crypto.js', './js/merge.js', './js/game.js', './js/storage.js', './js/sync.js', './js/suits.js', './decks/index.json'];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE);
    const registry = await (await cache.match('./decks/index.json')).json();
    await cache.addAll(registry.map(deck => `./decks/${deck.file}`));
    await cache.addAll(registry.filter(deck => deck.source.image).map(deck => `./decks/${deck.source.image}`));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('vdp-static-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const base = new URL('./', self.location.href);
  if (event.request.method !== 'GET' || url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return;
  const path = url.pathname.slice(base.pathname.length);
  // Cache only public app assets. Never intercept private files or GitHub requests.
  if (!(path === '' || path === 'index.html' || /^(css|js|decks)\/[a-z0-9.-]+\.(css|js|json)$/.test(path) || /^decks\/[a-z0-9.-]+\.jpg$/.test(path))) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    } catch {
      const cached = await cache.match(event.request);
      return cached || Response.error();
    }
  })());
});
