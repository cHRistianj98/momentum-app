/// <reference types="vite/client" />
import { flushOfflineWrites } from './lib/offlineDatabase';

/**
 * Instalacja i aktualizacje PWA bez automatycznego przeładowywania.
 * Uruchamiamy tylko na produkcyjnym HTTPS. Dane lokalne pozostają poza cache SW.
 */
if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      void setupMomentumPwa().catch(error => {
        console.warn('[Momentum PWA] Nie udało się uruchomić aktualizacji:', error);
      });
    });
  } else {
    // Stara rejestracja PWA nie może przechwytywać żądań na porcie developerskim.
    // Nie czyścimy localStorage, IndexedDB ani cache innych aplikacji / scope'ów.
    void navigator.serviceWorker.getRegistrations().then(registrations => {
      const origin = window.location.origin;
      registrations.forEach(registration => {
        if (registration.scope === `${origin}/`) void registration.unregister();
      });
    }).catch(() => undefined);
  }
}

let dismissedWorker: ServiceWorker | null = null;
let updateNotice: HTMLElement | null = null;
let installingUpdate = false;

function removeNotice(): void {
  updateNotice?.remove();
  updateNotice = null;
}

function displayUpdate(worker: ServiceWorker): void {
  if (dismissedWorker === worker || installingUpdate || updateNotice) return;

  const notice = document.createElement('aside');
  notice.className = 'momentum-update-notice';
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-label', 'Nowa wersja Momentum');

  const info = document.createElement('div');
  info.className = 'momentum-update-info';
  const heading = document.createElement('strong');
  heading.textContent = 'Nowa wersja Momentum';
  const explanation = document.createElement('small');
  explanation.textContent = 'Gotowa do instalacji. Twoje zadania i rutyny pozostaną zapisane.';
  info.append(heading, explanation);

  const controls = document.createElement('div');
  controls.className = 'momentum-update-actions';
  const postpone = document.createElement('button');
  postpone.type = 'button';
  postpone.className = 'momentum-update-later';
  postpone.textContent = 'Później';
  postpone.addEventListener('click', () => {
    dismissedWorker = worker;
    removeNotice();
  });

  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'momentum-update-apply';
  apply.textContent = 'Zaktualizuj';
  apply.addEventListener('click', () => {
    if (installingUpdate) return;
    installingUpdate = true;
    apply.disabled = true;
    postpone.disabled = true;
    apply.textContent = 'Zapisywanie…';
    void flushOfflineWrites().then(() => {
      // Nowy SW musi już czekać. Aktywacja i przeładowanie dopiero po decyzji użytkownika.
      if (worker.state !== 'installed') throw new Error('Aktualizacja nie jest już gotowa.');
      worker.postMessage({ type: 'SKIP_WAITING' });
    }).catch(error => {
      installingUpdate = false;
      apply.disabled = false;
      postpone.disabled = false;
      apply.textContent = 'Zaktualizuj';
      explanation.textContent = 'Aktualizacja nie powiodła się. Spróbuj ponownie po zapisaniu kopii JSON.';
      console.warn('[Momentum PWA] Nie udało się zastosować aktualizacji:', error);
    });
  });

  controls.append(postpone, apply);
  notice.append(info, controls);
  document.body.append(notice);
  updateNotice = notice;
}

function cacheCurrentAssets(registration: ServiceWorkerRegistration): void {
  const paths = performance.getEntriesByType('resource').flatMap(entry => {
    try {
      const url = new URL(entry.name);
      if (url.origin !== window.location.origin) return [];
      if (!/\.(?:js|css|png|svg|webp|woff2?|ico)$/i.test(url.pathname)) return [];
      return [url.pathname];
    } catch { return []; }
  });
  if (paths.length) registration.active?.postMessage({ type: 'CACHE_ASSETS', paths });
}

async function setupMomentumPwa(): Promise<void> {
  const registration = await navigator.serviceWorker.register('/sw.js');
  let lastUpdateCheck = 0;

  const checkWaiting = () => {
    if (registration.waiting && navigator.serviceWorker.controller) {
      displayUpdate(registration.waiting);
    }
  };

  // Safari/iOS może wracać z uśpienia po kilku godzinach; sprawdź nową wersję
  // po powrocie do aplikacji, maksymalnie raz na 10 minut.
  const checkForUpdates = () => {
    if (document.visibilityState !== 'visible' || !navigator.onLine) return;
    if (Date.now() - lastUpdateCheck < 10 * 60_000) return;
    lastUpdateCheck = Date.now();
    void registration.update().catch(error => {
      console.warn('[Momentum PWA] Sprawdzenie aktualizacji nie powiodło się:', error);
    });
  };

  checkWaiting();
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') checkWaiting();
    });
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Na pierwszej instalacji nie odświeżamy otwartej aplikacji.
    // Przy aktualizacji użytkownik wyraził zgodę, a zapisy IndexedDB zostały opróżnione.
    if (installingUpdate) window.location.reload();
  });
  document.addEventListener('visibilitychange', checkForUpdates);
  window.addEventListener('online', checkForUpdates);

  void navigator.serviceWorker.ready.then(ready => cacheCurrentAssets(ready)).catch(() => undefined);
  checkForUpdates();
}
