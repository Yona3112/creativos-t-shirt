import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  collection,
  documentId,
  query,
  where,
  getDocs,
  type Firestore,
  type Unsubscribe
} from 'firebase/firestore';
import type { AppState, SyncStatus } from './types';
import { contentSignature, mergeStates, normalize } from './merge';
import { db } from './db';
import { getDeviceId } from './ids';
import { buildPublicCatalog, LIVE_CATALOG_KEY, WEB_ORDER_LATEST_KEY } from './publicCatalog';

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
}

const LS_FB_CFG = 'cgs_firebase';

export const DEFAULT_FIREBASE_CONFIG: FirebaseConfig = {
  apiKey: "AIzaSyDvEMiRNipixAZboMKxUYkKu_lGq9nzkcM",
  authDomain: "creativos-t-shirt.firebaseapp.com",
  projectId: "creativos-t-shirt",
  storageBucket: "creativos-t-shirt.firebasestorage.app",
  messagingSenderId: "1065069374241",
  appId: "1:1065069374241:web:cc9d56b971738ba316ac60"
};

export function getFirebaseConfig(): FirebaseConfig | null {
  try {
    const raw = localStorage.getItem(LS_FB_CFG);
    if (raw === 'off') return null;
    if (raw) {
      const c = JSON.parse(raw) as FirebaseConfig;
      if (c.apiKey && c.projectId) return c;
    }
  } catch {
    /* ignorar */
  }
  const envKey = import.meta.env.VITE_FIREBASE_API_KEY as string | undefined;
  const envProject = import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined;
  if (envKey && envProject) {
    return {
      apiKey: envKey,
      authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string) || `${envProject}.firebaseapp.com`,
      projectId: envProject,
      storageBucket: (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string) || `${envProject}.appspot.com`,
      messagingSenderId: (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string) || '',
      appId: (import.meta.env.VITE_FIREBASE_APP_ID as string) || ''
    };
  }
  // Default preconfigurado del proyecto del usuario
  return DEFAULT_FIREBASE_CONFIG;
}

export function saveFirebaseConfig(cfg: FirebaseConfig | null): void {
  if (cfg) localStorage.setItem(LS_FB_CFG, JSON.stringify(cfg));
  else localStorage.setItem(LS_FB_CFG, 'off');
}

export function getOrInitFirebase(cfg: FirebaseConfig): { app: FirebaseApp; fs: Firestore } {
  const existing = getApps();
  const app = existing.length > 0 ? getApp() : initializeApp(cfg);
  const fs = getFirestore(app);
  return { app, fs };
}

interface EngineOptions {
  getState: () => AppState;
  applyRemote: (s: AppState) => void;
  onStatus: (s: SyncStatus, detail?: string) => void;
  onPhotos: () => void;
}

export class FirebaseSyncEngine {
  private fs: Firestore | null = null;
  private unsubLive: Unsubscribe | null = null;
  private timer: number | null = null;
  private chain: Promise<void> = Promise.resolve();
  private readonly device = getDeviceId();
  private opts: EngineOptions;
  private lastRemoteSig: string | null = null;
  private verifiedRemotePhotos = new Set<string>();
  lastSeenAt: number | null = null;
  status: SyncStatus = 'local';

  constructor(opts: EngineOptions) {
    this.opts = opts;
    window.addEventListener('online', () => {
      if (this.fs) this.enqueue(() => this.pull());
    });
    window.addEventListener('offline', () => {
      if (this.fs) this.setStatus('offline');
    });
  }

  get connected(): boolean {
    return !!this.fs;
  }

  private setStatus(s: SyncStatus, detail?: string) {
    this.status = s;
    this.opts.onStatus(s, detail);
  }

  private enqueue(job: () => Promise<void>) {
    this.chain = this.chain.then(job).catch((e) => {
      console.warn('[firebase-sync]', e);
      this.setStatus(navigator.onLine ? 'error' : 'offline', String(e?.message || e));
    });
    return this.chain;
  }

  async start(cfg: FirebaseConfig): Promise<void> {
    await this.stop();
    const { fs } = getOrInitFirebase(cfg);
    this.fs = fs;
    this.setStatus(navigator.onLine ? 'connecting' : 'offline');

    const syncDocRef = doc(fs, 'cgs_sync', 'app_state');
    this.unsubLive = onSnapshot(
      syncDocRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          this.enqueue(() => this.push());
          return;
        }
        const data = snapshot.data() as { payload?: AppState; updated_at?: string };
        const remote = data.payload;
        if (remote && remote._by === this.device) {
          return;
        }
        if (remote && remote.version === 1) {
          this.enqueue(() => this.absorb(remote, data.updated_at || null));
        } else {
          this.enqueue(() => this.pull());
        }
      },
      (err) => {
        console.warn('[firebase realtime]', err);
        this.setStatus(navigator.onLine ? 'error' : 'offline', err.message);
      }
    );

    this.enqueue(() => this.pull());
  }

  async stop(): Promise<void> {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = null;
    if (this.unsubLive) {
      this.unsubLive();
      this.unsubLive = null;
    }
    this.fs = null;
    this.lastSeenAt = null;
    this.lastRemoteSig = null;
    this.verifiedRemotePhotos.clear();
    this.setStatus('local');
  }

  schedulePush(): void {
    if (!this.fs) return;
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.enqueue(() => this.push());
    }, 600);
  }

  async testConnection(cfg: FirebaseConfig): Promise<string | null> {
    try {
      const { fs } = getOrInitFirebase(cfg);
      const testDoc = doc(fs, 'cgs_sync', 'ping');
      await setDoc(testDoc, { ping: Date.now() }, { merge: true });
      return null;
    } catch (e) {
      return String((e as Error).message || e);
    }
  }

  private async absorb(remoteRaw: AppState, remoteAt: string | null) {
    const local = this.opts.getState();
    const remote = normalize(remoteRaw);
    this.lastRemoteSig = contentSignature(remote);
    const merged = mergeStates(local, remote);
    if (remoteAt) {
      const parsed = Date.parse(remoteAt);
      if (!isNaN(parsed)) this.lastSeenAt = parsed;
    }
    if (contentSignature(merged) !== contentSignature(local)) {
      this.opts.applyRemote(merged);
    }
    if (contentSignature(merged) !== this.lastRemoteSig) {
      await this.write(merged);
    } else {
      this.setStatus('live');
    }
    await this.fetchMissingPhotos(merged);
  }

  private async pull() {
    if (!this.fs) return;
    if (!navigator.onLine) return this.setStatus('offline');
    this.setStatus('syncing');
    const syncDocRef = doc(this.fs, 'cgs_sync', 'app_state');
    const snap = await getDoc(syncDocRef);
    if (!snap.exists()) {
      await this.write(this.opts.getState());
      await this.uploadPendingPhotos();
      return;
    }
    const data = snap.data() as { payload?: AppState; updated_at?: string };
    const payload = data?.payload;
    if (!payload || payload.version !== 1) {
      await this.write(this.opts.getState());
      await this.uploadPendingPhotos();
      return;
    }
    await this.absorb(payload, data.updated_at || null);
    await this.uploadPendingPhotos();
  }

  private async push() {
    if (!this.fs) return;
    if (!navigator.onLine) return this.setStatus('offline');
    this.setStatus('syncing');
    let stateToWrite = this.opts.getState();
    try {
      const syncDocRef = doc(this.fs, 'cgs_sync', 'app_state');
      const snap = await getDoc(syncDocRef);
      if (snap.exists()) {
        const data = snap.data() as { payload?: AppState };
        const rawRemote = data?.payload;
        if (rawRemote && rawRemote.version === 1 && rawRemote._by !== this.device) {
          const remote = normalize(rawRemote);
          const remoteSig = contentSignature(remote);
          if (remoteSig !== this.lastRemoteSig) {
            this.lastRemoteSig = remoteSig;
            const merged = mergeStates(stateToWrite, remote);
            if (contentSignature(merged) !== contentSignature(stateToWrite)) {
              this.opts.applyRemote(merged);
            }
            stateToWrite = merged;
            await this.fetchMissingPhotos(merged);
          }
        }
      }
    } catch (err) {
      console.warn('[firebase-sync] pre-push check', err);
    }
    await this.write(stateToWrite);
    await this.uploadPendingPhotos();
  }

  private async write(state: AppState) {
    if (!this.fs) return;
    const now = new Date().toISOString();
    // Asegurar que nunca viajen imágenes base64 incrustadas dentro de app_state (límite 1 MiB de Firestore)
    const sanitized = normalize(state);
    const rawPayload: AppState = { ...sanitized, _by: this.device, _at: Date.now() };
    // Firestore rechaza propiedades con valor `undefined`; serializamos para limpiarlas de forma segura
    const payload: AppState = JSON.parse(JSON.stringify(rawPayload));
    const syncDocRef = doc(this.fs, 'cgs_sync', 'app_state');
    await setDoc(syncDocRef, { payload, updated_at: now });
    this.lastRemoteSig = contentSignature(sanitized);

    // Publicar vitrina pública para el cliente (#tienda)
    try {
      const publicSnap = JSON.stringify(buildPublicCatalog(sanitized));
      if (publicSnap.length <= 920000) {
        const pubDoc = doc(this.fs, 'cgs_photos', LIVE_CATALOG_KEY);
        await setDoc(pubDoc, { data: publicSnap });
      }
    } catch {
      /* ignorar */
    }

    this.lastSeenAt = Date.now();
    this.setStatus('live');
  }

  async uploadPendingPhotos() {
    if (!this.fs || !navigator.onLine) return;
    const pending = await db.photos.where('synced').equals(0).toArray();
    for (const p of pending) {
      if (!p?.data) continue;
      const ok = await uploadPhotoNowFirebase(p.id, p.data);
      if (ok) this.verifiedRemotePhotos.add(p.id);
    }
    // Verificar una vez por sesión que los diseños del catálogo y pedidos recientes existan en la nube
    await this.syncAllCatalogPhotos();
  }

  async syncAllCatalogPhotos() {
    if (!this.fs || !navigator.onLine) return;
    const state = this.opts.getState();
    const catalogPhotoIds = (state.catalogDesigns || [])
      .filter((d) => !d.deleted && d.photoId)
      .map((d) => d.photoId);
    const orderPhotoIds = (state.orders || [])
      .filter((o) => !o.deleted)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 60)
      .flatMap((o) => [
        o.photoId,
        o.guidePhotoId,
        ...(o.items || []).map((it) => it.photoId)
      ])
      .filter((id): id is string => Boolean(id));

    const candidateIds = Array.from(new Set([...catalogPhotoIds, ...orderPhotoIds])).filter(
      (id) => !this.verifiedRemotePhotos.has(id)
    );
    if (!candidateIds.length) return;

    // Comprobar en lotes cuáles faltan realmente en Firestore (evita resubir megabytes en cada clic)
    const remoteExists = new Set<string>();
    const photosCol = collection(this.fs, 'cgs_photos');
    for (let i = 0; i < candidateIds.length; i += 30) {
      const batch = candidateIds.slice(i, i + 30);
      try {
        const res = await getDocs(query(photosCol, where(documentId(), 'in', batch)));
        for (const d of res.docs) {
          const docData = d.data();
          if (typeof docData?.data === 'string' || (typeof docData?.chunks === 'number' && docData.chunks >= 1)) {
            remoteExists.add(d.id);
            this.verifiedRemotePhotos.add(d.id);
          }
        }
      } catch (err) {
        console.warn('[firebase-sync] check remote photos', err);
      }
    }

    const toUpload = candidateIds.filter((id) => !remoteExists.has(id));
    for (const id of toUpload) {
      try {
        const local = await db.photos.get(id);
        if (local?.data) {
          const ok = await uploadPhotoNowFirebase(id, local.data);
          if (ok) this.verifiedRemotePhotos.add(id);
        }
      } catch (err) {
        console.warn('[firebase-sync] syncAllCatalogPhotos', id, err);
      }
    }
  }

  private async fetchMissingPhotos(state: AppState) {
    if (!this.fs || !navigator.onLine) return;
    const orderPhotos = state.orders
      .filter((o) => !o.deleted)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 100)
      .flatMap((o) => [
        o.photoId,
        o.guidePhotoId,
        ...(o.items || []).map((it) => it.photoId)
      ])
      .filter((id): id is string => Boolean(id));
    const catalogPhotos = (state.catalogDesigns || [])
      .filter((d) => d.photoId && !d.deleted)
      .map((d) => d.photoId);
    const wanted = Array.from(new Set([...catalogPhotos, ...orderPhotos]));
    if (!wanted.length) return;

    const existingRows = await db.photos.where('id').anyOf(wanted).toArray();
    const have = new Set(existingRows.filter((r) => Boolean(r?.data)).map((r) => r.id));
    const missing = wanted.filter((id) => !have.has(id));
    if (!missing.length) return;

    // Firestore `in` query supports up to 30 items per batch
    const chunks: string[][] = [];
    for (let i = 0; i < missing.length; i += 30) {
      chunks.push(missing.slice(i, i + 30));
    }
    let anyLoaded = false;
    const chunkedIds: string[] = [];
    for (const chunk of chunks) {
      try {
        const photosCol = collection(this.fs, 'cgs_photos');
        const q = query(photosCol, where(documentId(), 'in', chunk));
        const res = await getDocs(q);
        if (!res.empty) {
          const rows: { id: string; data: string; synced: 1; createdAt: number }[] = [];
          for (const d of res.docs) {
            const docData = d.data();
            if (docData?.chunks && Number(docData.chunks) > 1) {
              chunkedIds.push(d.id);
            } else if (typeof docData?.data === 'string' && docData.data.length > 0) {
              rows.push({
                id: d.id,
                data: docData.data,
                synced: 1 as const,
                createdAt: Date.now()
              });
              this.verifiedRemotePhotos.add(d.id);
            }
          }
          if (rows.length > 0) {
            await db.photos.bulkPut(rows);
            anyLoaded = true;
          }
        }
      } catch (e) {
        console.warn('[firebase-sync] missing photos', e);
      }
    }

    // Descargar fotos grandes divididas en múltiples fragmentos
    for (const id of chunkedIds) {
      const assembled = await fetchSharedPhotoFirebase(id);
      if (assembled) {
        this.verifiedRemotePhotos.add(id);
        anyLoaded = true;
      }
    }

    if (anyLoaded) {
      this.opts.onPhotos();
    }
  }
}

const CHUNK_SIZE = 650000;

export async function uploadPhotoNowFirebase(id: string, data: string): Promise<boolean> {
  const cfg = getFirebaseConfig();
  if (!cfg || !navigator.onLine) return false;
  try {
    const { fs } = getOrInitFirebase(cfg);
    if (data.length <= CHUNK_SIZE) {
      const photoDoc = doc(fs, 'cgs_photos', id);
      await setDoc(photoDoc, { data, chunks: 1, updatedAt: Date.now() });
    } else {
      const totalChunks = Math.ceil(data.length / CHUNK_SIZE);
      const mainDoc = doc(fs, 'cgs_photos', id);
      await setDoc(mainDoc, { chunks: totalChunks, updatedAt: Date.now() });
      const chunkPromises: Promise<unknown>[] = [];
      for (let i = 0; i < totalChunks; i++) {
        const slice = data.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const chunkDoc = doc(fs, 'cgs_photos', `${id}__c${i}`);
        chunkPromises.push(setDoc(chunkDoc, { data: slice }));
      }
      await Promise.all(chunkPromises);
    }
    try {
      const updated = await db.photos.update(id, { synced: 1 });
      if (!updated) {
        await db.photos.put({ id, data, synced: 1, createdAt: Date.now() });
      }
    } catch {
      /* ignorar fallo menor en IndexedDB local */
    }
    return true;
  } catch (err) {
    console.warn('[firebase-sync] Error subiendo foto:', id, err);
    return false;
  }
}

export async function fetchSharedPhotoFirebase(id: string): Promise<string | null> {
  // Para llaves mutables como LIVE_CATALOG_KEY, no leer caché viejo de Dexie si hay red
  if (id !== LIVE_CATALOG_KEY) {
    const local = await db.photos.get(id);
    if (local?.data) return local.data;
  }
  const cfg = getFirebaseConfig();
  if (!cfg || !navigator.onLine) {
    // Si estamos offline y es LIVE_CATALOG_KEY, usar fallback local
    if (id === LIVE_CATALOG_KEY) {
      const fallbackLocal = await db.photos.get(id);
      return fallbackLocal?.data || null;
    }
    return null;
  }
  try {
    const { fs } = getOrInitFirebase(cfg);
    const photoDoc = doc(fs, 'cgs_photos', id);
    const snap = await getDoc(photoDoc);
    if (!snap.exists()) {
      // Fallback a Dexie si no existe aún en Firestore
      if (id === LIVE_CATALOG_KEY) {
        const fallbackLocal = await db.photos.get(id);
        return fallbackLocal?.data || null;
      }
      return null;
    }
    const snapData = snap.data();
    if (snapData.chunks && snapData.chunks > 1) {
      const total = snapData.chunks as number;
      const promises: Promise<string>[] = [];
      for (let i = 0; i < total; i++) {
        promises.push(
          getDoc(doc(fs, 'cgs_photos', `${id}__c${i}`)).then((s) =>
            s.exists() ? (s.data().data as string) : ''
          )
        );
      }
      const parts = await Promise.all(promises);
      const fullData = parts.join('');
      if (fullData) {
        try {
          await db.photos.put({ id, data: fullData, synced: 1, createdAt: Date.now() });
        } catch {}
        return fullData;
      }
    } else if (snapData.data) {
      const dataStr = snapData.data as string;
      try {
        await db.photos.put({ id, data: dataStr, synced: 1, createdAt: Date.now() });
      } catch {}
      return dataStr;
    }
  } catch (err) {
    console.warn('[firebase-sync] fetchSharedPhotoFirebase error:', id, err);
    if (id === LIVE_CATALOG_KEY) {
      const fallbackLocal = await db.photos.get(id);
      return fallbackLocal?.data || null;
    }
  }
  return null;
}

/** Suscripción en tiempo real a la vitrina pública del catálogo oficial */
export function subscribeLiveCatalogFirebase(
  onCatalog: (cat: import('./publicCatalog').SharedCatalogPayload) => void
): () => void {
  const cfg = getFirebaseConfig();
  if (!cfg) return () => {};
  try {
    const { fs } = getOrInitFirebase(cfg);
    const pubDoc = doc(fs, 'cgs_photos', LIVE_CATALOG_KEY);
    return onSnapshot(
      pubDoc,
      (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        const raw = d?.data as string | undefined;
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw) as import('./publicCatalog').SharedCatalogPayload;
          if (parsed && Array.isArray(parsed.colors) && parsed.colors.length > 0) {
            onCatalog(parsed);
          }
        } catch {
          /* ignorar JSON inválido */
        }
      },
      (err) => {
        console.warn('[firebase live catalog subscription]', err);
      }
    );
  } catch (err) {
    console.warn('[subscribeLiveCatalogFirebase] error:', err);
    return () => {};
  }
}

/** Suscripción en tiempo real a pedidos que llegan desde la tienda pública (#tienda) */
export function subscribeLatestWebOrderFirebase(
  onOrder: (order: import('./publicCatalog').CustomerWebOrderPayload) => void
): () => void {
  const cfg = getFirebaseConfig();
  if (!cfg) return () => {};
  try {
    const { fs } = getOrInitFirebase(cfg);
    const orderDoc = doc(fs, 'cgs_photos', WEB_ORDER_LATEST_KEY);
    return onSnapshot(
      orderDoc,
      (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        const raw = d?.data as string | undefined;
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw) as import('./publicCatalog').CustomerWebOrderPayload;
          if (parsed && parsed.id && parsed.customerName) {
            onOrder(parsed);
          }
        } catch {}
      },
      (err) => {
        console.warn('[firebase latest order subscription]', err);
      }
    );
  } catch (err) {
    console.warn('[subscribeLatestWebOrderFirebase] error:', err);
    return () => {};
  }
}
