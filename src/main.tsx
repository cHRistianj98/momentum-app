import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initializeOfflineDatabase } from './lib/offlineDatabase';
import { syncBeforeRender } from './lib/cloudSync';
import './styles.css';
import './styles-v06.css';

void initializeOfflineDatabase()
  // Gdy synchronizacja jest włączona, nowsze dane z chmury wczytujemy przed renderem (maks. ~2 s; offline od razu dalej).
  .then(() => syncBeforeRender())
  .catch(error => console.warn('[Momentum] Startup step skipped:', error))
  .finally(() => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode><App /></React.StrictMode>,
    );
  });
