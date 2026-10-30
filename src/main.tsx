import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initializeOfflineDatabase } from './lib/offlineDatabase';
import './styles.css';
import './styles-v06.css';

void initializeOfflineDatabase().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode><App /></React.StrictMode>,
  );
});
