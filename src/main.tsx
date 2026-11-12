import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initializeOfflineDatabase, readMomentumKey } from './lib/offlineDatabase';
import { syncBeforeRender } from './lib/cloudSync';
import { applyLanguage, detectLanguage, isLanguage, subscribeLanguage, tr } from './lib/i18n';
import './styles.css';
import './styles-v06.css';

/** Język z zapisanych danych jeszcze przed renderem (komunikaty synchronizacji, baner aktualizacji). */
function applyStoredLanguage(): void {
  const raw = readMomentumKey('momentum.v1');
  if (!raw) { applyLanguage(detectLanguage()); return; }
  try {
    const stored: unknown = JSON.parse(raw);
    const language = stored && typeof stored === 'object' ? (stored as { language?: unknown }).language : undefined;
    applyLanguage(isLanguage(language) ? language : 'pl');
  } catch {
    applyLanguage('pl');
  }
}

// Tytuł karty i okna aplikacji podąża za wybranym językiem.
subscribeLanguage(() => { document.title = tr('Momentum — Twój dzień. Twój progres.', 'Momentum — Your day. Your progress.'); });

void initializeOfflineDatabase()
  // Gdy synchronizacja jest włączona, nowsze dane z chmury wczytujemy przed renderem (maks. ~2 s; offline od razu dalej).
  .then(() => { applyStoredLanguage(); return syncBeforeRender(); })
  .catch(error => console.warn('[Momentum] Startup step skipped:', error))
  .finally(() => {
    applyStoredLanguage();
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode><App /></React.StrictMode>,
    );
  });
