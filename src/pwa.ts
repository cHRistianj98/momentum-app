/// <reference types="vite/client" />
/** Rejestracja PWA tylko na produkcji. Nie ingeruje w localStorage/IndexedDB. */
if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(error => {
        console.warn('[Momentum PWA] Nie udało się zainstalować trybu offline:', error);
      });
    });
  } else {
    void navigator.serviceWorker.getRegistrations().then(registrations => {
      const rootScope = `${window.location.origin}/`;
      registrations.filter(registration => registration.scope === rootScope).forEach(registration => void registration.unregister());
    });
  }
}
