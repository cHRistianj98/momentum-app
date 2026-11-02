import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initializeOfflineDatabase } from './lib/offlineDatabase';
import { applyFeatureFlagParams, isFeatureEnabled } from './lib/featureFlags';
import { syncBeforeRender } from './lib/cloudSync';
import './styles.css';
import './styles-v06.css';

applyFeatureFlagParams();

void initializeOfflineDatabase()
  // Beta: przy włączonej synchronizacji nowsze dane z chmury wczytujemy przed renderem (maks. ~2 s; offline od razu dalej).
  .then(() => (isFeatureEnabled('cloudSync') ? syncBeforeRender() : undefined))
  .catch(error => console.warn('[Momentum] Startup step skipped:', error))
  .finally(() => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode><App /></React.StrictMode>,
    );
  });
