/* Momentum PWA — bezpieczna aktualizacja statycznych zasobów. Dane użytkownika
 * pozostają WYŁĄCZNIE w IndexedDB/localStorage; service worker ich nie obsługuje. */
const VERSION = 'momentum-pwa-4-__MOMENTUM_BUILD_ID__';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const SHELL_FILES = [
  '/', '/index.html', '/manifest.webmanifest', '/offline-assets.json',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png',
];

// Cache only the exact assets from the same build. A failed or misrouted
// /assets/*.js request can otherwise cache HTML and break every offline launch.
function isValidAsset(path, response) {
  if (!response.ok || response.type !== 'basic') return false;
  const type = (response.headers.get('Content-Type') || '').toLowerCase();
  if (/\.js$/i.test(path)) return /javascript|ecmascript/.test(type);
  if (/\.css$/i.test(path)) return type.includes('text/css');
  if (/\.(?:png|jpe?g|webp|svg|ico)$/i.test(path)) return type.startsWith('image/');
  if (/\.woff2?$/i.test(path)) return type.includes('font/') || type.includes('application/font');
  return false;
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    // No browser HTTP cache: install each build with its own matching HTML.
    for (const path of SHELL_FILES) {
      const response = await fetch(new Request(path, { cache: 'no-store' }));
      if (!response.ok) throw new Error(`Nie można pobrać pliku PWA ${path}: ${response.status}`);
      const type = (response.headers.get('Content-Type') || '').toLowerCase();
      if (path === '/' || path === '/index.html') {
        if (!type.includes('text/html')) throw new Error(`Niepoprawny HTML PWA: ${path}`);
      } else if (path === '/offline-assets.json') {
        if (!type.includes('json')) throw new Error('Niepoprawny manifest offline Momentum');
      } else if (path.endsWith('.png') && !type.startsWith('image/')) {
        throw new Error(`Niepoprawna ikona PWA: ${path}`);
      }
      await shell.put(path, response);
    }
    const response = await shell.match('/offline-assets.json');
    if (!response) throw new Error('Brak manifestu plików offline Momentum');
    const manifest = await response.json();
    if (!Array.isArray(manifest.paths) || manifest.paths.some(path =>
      typeof path !== 'string' || !/^\/assets\/[a-zA-Z0-9_./-]+$/.test(path))) {
      throw new Error('Niepoprawny manifest plików offline Momentum');
    }
    const assets = await caches.open(ASSET_CACHE);
    for (const path of manifest.paths) {
      const result = await fetch(new Request(path, { cache: 'no-store' }));
      if (!isValidAsset(path, result)) {
        throw new Error(`Niepoprawny lub brakujący zasób wydania: ${path}`);
      }
      await assets.put(path, result);
    }
    // Do not skipWaiting automatically. The user decides when to activate.
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
      if (isValidAsset(path, response)) await cache.put(path, response);
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
    // Online: ALWAYS obtain fresh HTML from the server. Cache-first here
    // caused the hard-reload/normal-reload mismatch seen on iOS and desktop.
    // Offline: fall back to the HTML precached with THIS version's assets.
    event.respondWith((async () => {
      try {
        const response = await fetch(new Request(request, { cache: 'no-store' }));
        if (response.ok) return response;
        if (response.status < 500) return response;
      } catch { /* offline: use matching shell */ }
      const shell = await caches.open(SHELL_CACHE);
      const fallback = await shell.match('/index.html');
      if (fallback) return fallback;
      return new Response('Momentum jest offline i nie ma zapisanej wersji aplikacji.', {
        status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    })());
    return;
  }

  const isStatic = url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') ||
    /\.(?:js|css|png|jpg|jpeg|webp|svg|woff2?|ico|webmanifest)$/i.test(url.pathname);
  if (!isStatic) return;
  event.respondWith((async () => {
    // Never search across ALL CacheStorage versions: old bundles may contain
    // a stale file or even an HTML fallback saved under a JS/CSS pathname.
    const cache = await caches.open(ASSET_CACHE);
    const shell = await caches.open(SHELL_CACHE);
    const cached = await cache.match(request) || await shell.match(request);
    if (cached && (url.pathname.startsWith('/icons/') || isValidAsset(url.pathname, cached) ||
      url.pathname.endsWith('.webmanifest'))) return cached;

    const response = await fetch(request);
    if (isValidAsset(url.pathname, response)) {
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
