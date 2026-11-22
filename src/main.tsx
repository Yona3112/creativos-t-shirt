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

let swRefreshing = false;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (swRefreshing) return;
    swRefreshing = true;
    window.location.reload();
  });
}

registerSW({
  immediate: true,
  onNeedRefresh() {
    window.location.reload();
  },
  onRegisteredSW(_swUrl, r) {
    if (!r) return;
    void r.update();
    setInterval(() => {
      void r.update();
    }, 45 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void r.update();
      }
    });
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
