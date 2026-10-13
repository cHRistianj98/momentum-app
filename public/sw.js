/* Momentum offline cache — app shell + assets odwiedzone podczas pracy online. */
const CACHE_VERSION = 'momentum-pwa-1';
const APP_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('momentum-pwa-') && ![APP_CACHE, RUNTIME_CACHE].includes(key)).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) (await caches.open(APP_CACHE)).put('/index.html', response.clone());
        return response;
      } catch {
        return (await caches.match('/index.html')) || Response.error();
      }
    })());
    return;
  }

  const isStatic = url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') ||
    /\.(?:js|css|png|jpg|jpeg|webp|svg|woff2?|ico|webmanifest)$/i.test(url.pathname);
  if (!isStatic) return;
  event.respondWith((async () => {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  })());
});

// Pierwsza instalacja: dołóż podstawowe zasoby buildu załadowane przed przejęciem strony przez SW.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'CACHE_ASSETS' || !Array.isArray(event.data.paths)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(RUNTIME_CACHE);
    for (const raw of event.data.paths.slice(0, 120)) {
      try {
        const url = new URL(raw, self.location.origin);
        if (url.origin !== self.location.origin || !/\.(js|css|png|svg|webp|woff2?|ico)$/i.test(url.pathname)) continue;
        const response = await fetch(url.href);
        if (response.ok) await cache.put(url.href, response);
      } catch { /* Zasoby niedostępne online pozostaną do pobrania przy kolejnym otwarciu. */ }
    }
  })());
});
