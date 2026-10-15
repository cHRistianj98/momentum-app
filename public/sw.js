/* Momentum PWA — cache statycznej aplikacji, bez cache'owania danych użytkownika. */
const VERSION = 'momentum-pwa-2';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const SHELL_FILES = ['/', '/index.html', '/manifest.webmanifest', '/offline-assets.json', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL_FILES);
    const manifest = await (await shell.match('/offline-assets.json')).json();
    if (!Array.isArray(manifest.paths) || manifest.paths.some(path => typeof path !== 'string' || !path.startsWith('/assets/'))) {
      throw new Error('Niepoprawny manifest offline Momentum');
    }
    const assets = await caches.open(ASSET_CACHE);
    // Gdy brakuje zasobu, instalacja nie jest uznawana za gotową offline.
    for (const path of manifest.paths) await assets.add(path);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('momentum-pwa-') && key !== SHELL_CACHE && key !== ASSET_CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        if (fresh.ok) (await caches.open(SHELL_CACHE)).put('/index.html', fresh.clone());
        return fresh;
      } catch {
        return (await caches.match('/index.html')) || Response.error();
      }
    })());
    return;
  }
  const staticResource = url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') ||
    /\.(?:js|css|png|jpg|jpeg|webp|svg|woff2?|ico|webmanifest)$/i.test(url.pathname);
  if (!staticResource) return;
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) (await caches.open(ASSET_CACHE)).put(request, response.clone());
    return response;
  })());
});
