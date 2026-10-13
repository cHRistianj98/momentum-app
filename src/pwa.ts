/// <reference types="vite/client" />
/**
 * Service Worker tylko dla buildu produkcyjnego.
 * Dev server (npm run dev, np. localhost:5180) musi pozostać bez cache PWA.
 */
if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then(async () => {
        const registration = await navigator.serviceWorker.ready;
        const paths = performance.getEntriesByType('resource')
          .map(entry => entry.name)
          .filter(name => {
            const url = new URL(name);
            return url.origin === window.location.origin && /\.(js|css|png|svg|webp|woff2?|ico)$/i.test(url.pathname);
          });
        registration.active?.postMessage({ type: 'CACHE_ASSETS', paths });
      }).catch(error => {
        console.warn('[Momentum PWA] Rejestracja offline nie powiodła się:', error);
      });
    });
  } else {
    // Sprzątanie po wcześniejszej instalacji PWA na porcie developerskim.
    // Nie czyścimy localStorage ani nie dotykamy obcych scope'ów.
    void navigator.serviceWorker.getRegistrations().then(registrations => {
      const origin = window.location.origin;
      registrations.forEach(registration => {
        if (registration.scope === `${origin}/`) void registration.unregister();
      });
    });
  }
}
