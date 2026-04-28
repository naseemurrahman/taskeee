// Service Worker — network-first for HTML, cache-first for immutable assets
const CACHE_VERSION = 'v' + Date.now(); // Updated on each deploy
const STATIC_CACHE = 'taskflow-static-' + CACHE_VERSION;
const ASSET_RE = /\/assets\//;

self.addEventListener('install', (event) => {
  self.skipWaiting(); // Activate immediately
});

self.addEventListener('activate', (event) => {
  // Delete ALL old caches on activation
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(key => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Skip API calls — always network
  if (url.pathname.startsWith('/api/')) return;

  // Immutable hashed assets (e.g. /assets/index-abc123.js) — cache first
  if (ASSET_RE.test(url.pathname)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(res => {
            if (res.ok) cache.put(event.request, res.clone());
            return res;
          });
        })
      )
    );
    return;
  }

  // HTML / navigation — NETWORK FIRST, fallback to cache
  event.respondWith(
    fetch(event.request)
      .then(res => {
        if (res.ok) {
          caches.open(STATIC_CACHE).then(c => c.put(event.request, res.clone()));
        }
        return res;
      })
      .catch(() => caches.match('/index.html'))
  );
});
