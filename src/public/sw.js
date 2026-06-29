const CACHE = 'dk-v2';
const PRICE_CACHE = 'dk-prices-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE && k !== PRICE_CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;

  // Stale-while-revalidate for /api/prices (market data — show cached, refresh in background)
  if (url.includes('/api/prices')) {
    e.respondWith(
      caches.open(PRICE_CACHE).then(async cache => {
        const cached = await cache.match(e.request);
        const fresh = fetch(e.request).then(res => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        }).catch(() => null);
        return cached || await fresh;
      })
    );
    return;
  }

  // Skip /auth/ — always live
  if (url.includes('/auth/') || url.includes('/api/')) return;

  // Network-first, fallback to cache for static assets
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
