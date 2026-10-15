/* Momentum PWA — bezpieczna aktualizacja statycznych zasobów. Dane użytkownika
 * pozostają WYŁĄCZNIE w IndexedDB/localStorage; service worker ich nie obsługuje. */
const VERSION = 'momentum-pwa-3-__MOMENTUM_BUILD_ID__';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const SHELL_FILES = [
  '/', '/index.html', '/manifest.webmanifest', '/offline-assets.json',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL_FILES);
    const response = await shell.match('/offline-assets.json');
    if (!response) throw new Error('Brak manifestu plików offline Momentum');
    const manifest = await response.json();
    if (!Array.isArray(manifest.paths) || manifest.paths.some(path =>
      typeof path !== 'string' || !/^\/assets\/[a-zA-Z0-9_./-]+$/.test(path))) {
      throw new Error('Niepoprawny manifest plików offline Momentum');
    }
    const assets = await caches.open(ASSET_CACHE);
    await assets.addAll(manifest.paths);
    // Bez skipWaiting(): nowa wersja czeka, aż użytkownik wybierze Zaktualizuj.
    // Na pierwszej instalacji aktywacja następuje standardowo bez pytania.
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
    return;
  }
  if (event.data?.type !== 'CACHE_ASSETS' || !Array.isArray(event.data.paths)) return;
  const paths = [...new Set(event.data.paths)].filter(path =>
    typeof path === 'string' && /^\/(?:assets|icons)\/[a-zA-Z0-9_./-]+\.(?:js|css|png|jpg|jpeg|webp|svg|woff2?|ico)$/i.test(path));
  event.waitUntil((async () => {
    const cache = await caches.open(ASSET_CACHE);
    await Promise.allSettled(paths.slice(0, 250).map(async path => {
      if (await cache.match(path)) return;
      const response = await fetch(path);
      if (response.ok && response.type === 'basic') await cache.put(path, response);
    }));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('momentum-pwa-') &&
      key !== SHELL_CACHE && key !== ASSET_CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || /^\/(api|auth)\//.test(url.pathname)) return;

  if (request.mode === 'navigate') {
    // Index i zasoby JS/CSS pochodzą z tej samej wersji buildu.
    // Nie nadpisuj indeksu nową wersją przed świadomą aktualizacją.
    event.respondWith((async () => {
      const shell = await caches.open(SHELL_CACHE);
      const cached = await shell.match('/index.html');
      if (cached) return cached;
      return fetch(request);
    })());
    return;
  }
  const isStatic = url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') ||
    /\.(?:js|css|png|jpg|jpeg|webp|svg|woff2?|ico|webmanifest)$/i.test(url.pathname);
  if (!isStatic) return;
  event.respondWith((async () => {
    const cache = await caches.open(ASSET_CACHE);
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
    return response;
  })());
});
