import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';
import { initStore } from './lib/store';
import { requestPersistentStorage } from './lib/db';
import { consumePairingHash } from './lib/sync';

const paired = consumePairingHash();
if (paired) sessionStorage.setItem('cgs_paired', '1');

void requestPersistentStorage();
void initStore();
registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
