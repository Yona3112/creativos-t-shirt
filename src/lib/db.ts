import Dexie, { type Table } from 'dexie';
import type { AppState } from './types';

interface KV {
  key: string;
  value: unknown;
}

export interface PhotoRow {
  id: string;
  data: string; // dataURL JPEG comprimido
  synced: 0 | 1;
  createdAt: number;
}

class GiftDB extends Dexie {
  kv!: Table<KV, string>;
  photos!: Table<PhotoRow, string>;
  constructor() {
    super('CreativosGiftShopIDB');
    this.version(1).stores({
      kv: 'key',
      photos: 'id, synced'
    });
  }
}

export const db = new GiftDB();

const LS_STATE = 'cgs_state_v1';

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch {
    /* ignorar */
  }
  return false;
}

export async function loadState(): Promise<AppState | null> {
  let fromIdb: AppState | null = null;
  let fromLs: AppState | null = null;
  try {
    const row = await db.kv.get('state');
    fromIdb = (row?.value as AppState) || null;
  } catch {
    /* IndexedDB no disponible */
  }
  try {
    const raw = localStorage.getItem(LS_STATE);
    fromLs = raw ? (JSON.parse(raw) as AppState) : null;
  } catch {
    /* ignorar */
  }
  if (fromIdb && fromLs) return (fromLs._at || 0) > (fromIdb._at || 0) ? fromLs : fromIdb;
  return fromIdb || fromLs;
}

export async function saveState(state: AppState): Promise<void> {
  try {
    localStorage.setItem(LS_STATE, JSON.stringify(state));
  } catch {
    /* cuota llena: IndexedDB sigue siendo la fuente principal */
  }
  try {
    await db.kv.put({ key: 'state', value: state });
  } catch {
    /* ignorar */
  }
}

export async function savePhoto(id: string, data: string, synced: 0 | 1 = 0): Promise<void> {
  await db.photos.put({ id, data, synced, createdAt: Date.now() });
}

export async function getPhoto(id: string): Promise<string | null> {
  const row = await db.photos.get(id);
  return row?.data || null;
}
