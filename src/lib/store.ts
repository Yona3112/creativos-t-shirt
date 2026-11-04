import { useMemo, useSyncExternalStore } from 'react';
import type { AppState, SyncStatus } from './types';
import { createInitialState } from './seed';
import { normalize } from './merge';
import { loadState, saveState } from './db';
import { SyncEngine, getConfig, isPublicStorefrontHash } from './sync';
import { FirebaseSyncEngine, getFirebaseConfig } from './firebaseSync';
import { computeStock } from './inventory';
import { getDeviceId } from './ids';

type Listener = () => void;

let state: AppState = createInitialState();
let ready = false;
const listeners = new Set<Listener>();
let saveTimer: number | null = null;

let syncStatus: SyncStatus = 'local';
let syncDetail = '';
const syncListeners = new Set<Listener>();

let photoVersion = 0;
const photoListeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

function persistSoon() {
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void saveState(state);
  }, 150);
}

export const engine = new SyncEngine({
  getState: () => state,
  applyRemote: (s) => {
    state = { ...s, _by: getDeviceId(), _at: Date.now() };
    persistSoon();
    emit();
  },
  onStatus: (s, d) => {
    syncStatus = s;
    syncDetail = d || '';
    syncListeners.forEach((l) => l());
  },
  onPhotos: () => {
    photoVersion++;
    photoListeners.forEach((l) => l());
  }
});

export const firebaseEngine = new FirebaseSyncEngine({
  getState: () => state,
  applyRemote: (s) => {
    state = { ...s, _by: getDeviceId(), _at: Date.now() };
    persistSoon();
    emit();
  },
  onStatus: (s, d) => {
    syncStatus = s;
    syncDetail = d || '';
    syncListeners.forEach((l) => l());
  },
  onPhotos: () => {
    photoVersion++;
    photoListeners.forEach((l) => l());
  }
});

export async function initStore(): Promise<void> {
  if (isPublicStorefrontHash()) {
    // Seguridad: en la Tienda 3D del cliente (#tienda) NO cargamos ni sincronizamos
    // la base de datos privada de pedidos, clientes, teléfonos ni costos.
    state = createInitialState();
    ready = true;
    emit();
    return;
  }
  const saved = await loadState();
  state = normalize(saved);
  ready = true;
  emit();
  const fbCfg = getFirebaseConfig();
  if (fbCfg) {
    void firebaseEngine.start(fbCfg);
  } else {
    const cfg = getConfig();
    if (cfg) void engine.start(cfg);
  }
}

export function getState(): AppState {
  return state;
}

/** Aplica un cambio local: guarda en IndexedDB + localStorage y sincroniza con la nube. */
export function update(fn: (s: AppState) => AppState): void {
  const next = fn(state);
  if (next === state) return;
  state = { ...next, _by: getDeviceId(), _at: Date.now() };
  persistSoon();
  emit();
  if (firebaseEngine.connected) firebaseEngine.schedulePush();
  else engine.schedulePush();
}

/** Reemplaza todo el estado (restaurar respaldo). */
export function replaceState(s: AppState): void {
  state = { ...normalize(s), _by: getDeviceId(), _at: Date.now() };
  void saveState(state);
  emit();
  if (firebaseEngine.connected) firebaseEngine.schedulePush();
  else engine.schedulePush();
}

export function notifyPhotos(): void {
  photoVersion++;
  photoListeners.forEach((l) => l());
}

const subscribe = (l: Listener) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, () => state);
}

export function useReady(): boolean {
  return useSyncExternalStore(subscribe, () => ready);
}

export function useStock() {
  const s = useAppState();
  return useMemo(() => computeStock(s), [s.movements]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function useSyncStatus(): { status: SyncStatus; detail: string } {
  const status = useSyncExternalStore(
    (l) => {
      syncListeners.add(l);
      return () => syncListeners.delete(l);
    },
    () => syncStatus
  );
  return { status, detail: syncDetail };
}

export function usePhotoVersion(): number {
  return useSyncExternalStore(
    (l) => {
      photoListeners.add(l);
      return () => photoListeners.delete(l);
    },
    () => photoVersion
  );
}
