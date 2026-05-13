// Service Worker — network-first for HTML, cache-first for immutable assets, push notifications
const CACHE_VERSION = 'v' + Date.now();
const STATIC_CACHE = 'taskee-static-' + CACHE_VERSION;
const ASSET_RE = /\/assets\//;

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;

  if (ASSET_RE.test(url.pathname)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(res => {
            if (res.ok) cache.put(event.request, res.clone()).catch(() => {});
            return res;
          });
        })
      )
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(res => {
        if (res.ok) caches.open(STATIC_CACHE).then(c => c.put(event.request, res.clone())).catch(() => {});
        return res;
      })
      .catch(() => caches.match('/index.html'))
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'TASKEE notification', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'TASKEE notification';
  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.notificationId || payload.type || 'taskee-notification',
    renotify: false,
    data: {
      url: payload.url || payload.data?.url || '/app/dashboard',
      ...(payload.data || {}),
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/app/dashboard';
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if ('focus' in client) {
        client.navigate(targetUrl);
        return client.focus();
      }
    }
    return clients.openWindow(targetUrl);
  })());
});
