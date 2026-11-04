import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type { AppState, SyncStatus } from './types';
import { contentSignature, mergeStates, normalize } from './merge';
import { db } from './db';
import { getDeviceId } from './ids';
import { buildPublicCatalog, LIVE_CATALOG_KEY } from './publicCatalog';

/**
 * Devuelve true cuando la URL es de la Tienda Pública (#tienda / #catalogo).
 * En modo cliente público NO se descarga ni sincroniza `app_state_sync` para proteger
 * los datos privados de clientes, teléfonos, direcciones, pedidos y costos.
 */
export function isPublicStorefrontHash(): boolean {
  const h = location.hash.replace(/^#\/?/, '').trim();
  if (!h) return false;
  return h === 'tienda' || h === 'catalogo' || h.startsWith('c=') || h.startsWith('catalogo=');
}

export interface SupaConfig {
  url: string;
  key: string;
}

const LS_CFG = 'cgs_supabase';

const DEFAULT_SUPA_URL = 'https://rqegoqmhafndpestywfn.supabase.co';
const DEFAULT_SUPA_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxZWdvcW1oYWZuZHBlc3R5d2ZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM3NTUzMjgsImV4cCI6MjEwOTMzMTMyOH0.pgGwQvnpOE0rDHJ-bUNy_nOBpqebBym8BKiLEuctEHU';

export function getConfig(): SupaConfig | null {
  try {
    const raw = localStorage.getItem(LS_CFG);
    if (raw === 'off') return null;
    if (raw) {
      const c = JSON.parse(raw) as SupaConfig;
      if (c.url && c.key) return c;
    }
  } catch {
    /* ignorar */
  }
  const envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const useEnv = envUrl && envKey && !envUrl.includes('ohhjpodgyewokudnqtjn');
  const url = useEnv ? envUrl : DEFAULT_SUPA_URL;
  const key = useEnv ? envKey : DEFAULT_SUPA_KEY;
  if (url && key) return { url, key };
  return null;
}

export function saveConfig(cfg: SupaConfig | null): void {
  if (cfg) localStorage.setItem(LS_CFG, JSON.stringify({ url: cfg.url.trim().replace(/\/+$/, ''), key: cfg.key.trim() }));
  else localStorage.setItem(LS_CFG, 'off');
}

function b64urlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(text: string): string {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Enlace de emparejamiento: los datos van en el hash (#), que nunca se envía al servidor. */
export function pairingLink(cfg: SupaConfig): string {
  const token = b64urlEncode(JSON.stringify({ u: cfg.url, k: cfg.key }));
  return `${location.origin}${location.pathname}#conectar=${token}`;
}

/** Lee el hash de emparejamiento, guarda la conexión y limpia la URL. */
export function consumePairingHash(): boolean {
  const m = location.hash.match(/conectar=([A-Za-z0-9_-]+)/);
  if (!m) return false;
  try {
    const data = JSON.parse(b64urlDecode(m[1])) as { u: string; k: string };
    if (data.u && data.k && /^https:\/\//.test(data.u)) {
      saveConfig({ url: data.u, key: data.k });
      history.replaceState(null, '', location.pathname + location.search);
      return true;
    }
  } catch {
    /* enlace inválido */
  }
  history.replaceState(null, '', location.pathname + location.search);
  return false;
}

function ts(v: string | null | undefined): number | null {
  if (!v) return null;
  const n = Date.parse(v);
  return isNaN(n) ? null : n;
}

interface EngineOptions {
  getState: () => AppState;
  applyRemote: (s: AppState) => void;
  onStatus: (s: SyncStatus, detail?: string) => void;
  onPhotos: () => void;
}

export class SyncEngine {
  private client: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;
  private timer: number | null = null;
  private chain: Promise<void> = Promise.resolve();
  private lastSeenAt: number | null = null;
  private readonly device = getDeviceId();
  private opts: EngineOptions;
  private live = false;
  status: SyncStatus = 'local';

  constructor(opts: EngineOptions) {
    this.opts = opts;
    window.addEventListener('online', () => {
      if (this.client) this.enqueue(() => this.pull());
    });
    window.addEventListener('offline', () => {
      if (this.client) this.setStatus('offline');
    });
  }

  get connected(): boolean {
    return !!this.client;
  }

  private setStatus(s: SyncStatus, detail?: string) {
    this.status = s;
    this.opts.onStatus(s, detail);
  }

  private enqueue(job: () => Promise<void>) {
    this.chain = this.chain.then(job).catch((e) => {
      console.warn('[sync]', e);
      this.setStatus(navigator.onLine ? 'error' : 'offline', String(e?.message || e));
    });
    return this.chain;
  }

  async start(cfg: SupaConfig): Promise<void> {
    await this.stop();
    this.client = createClient(cfg.url, cfg.key, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 5 } }
    });
    this.setStatus(navigator.onLine ? 'connecting' : 'offline');
    this.channel = this.client
      .channel('app_state_sync_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_state_sync' }, (msg) => {
        const row = (msg.new || {}) as { payload?: AppState; updated_at?: string };
        if (row.payload && row.payload._by === this.device) {
          this.lastSeenAt = ts(row.updated_at) ?? this.lastSeenAt;
          return;
        }
        if (row.payload && row.payload.version === 1) {
          const remote = row.payload;
          const at = row.updated_at || null;
          this.enqueue(() => this.absorb(remote, at));
        } else {
          this.enqueue(() => this.pull());
        }
      })
      .subscribe((st) => {
        if (st === 'SUBSCRIBED') {
          this.live = true;
          this.enqueue(() => this.pull());
        } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') {
          this.live = false;
          this.setStatus(navigator.onLine ? 'error' : 'offline', 'Realtime no disponible');
        } else if (st === 'CLOSED') {
          this.live = false;
        }
      });
    // Primera sincronización aunque Realtime tarde en conectar.
    this.enqueue(() => this.pull());
  }

  async stop(): Promise<void> {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = null;
    if (this.channel && this.client) await this.client.removeChannel(this.channel);
    this.channel = null;
    this.client = null;
    this.live = false;
    this.lastSeenAt = null;
    this.setStatus('local');
  }

  /** Llamar después de cada cambio local. */
  schedulePush(): void {
    if (!this.client) return;
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.enqueue(() => this.push());
    }, 600);
  }

  async testConnection(cfg: SupaConfig): Promise<string | null> {
    try {
      const c = createClient(cfg.url, cfg.key, { auth: { persistSession: false } });
      const { error } = await c.from('app_state_sync').select('id').limit(1);
      if (error) return error.message;
      return null;
    } catch (e) {
      return String((e as Error).message || e);
    }
  }

  private async absorb(remoteRaw: AppState, remoteAt: string | null) {
    const local = this.opts.getState();
    const remote = normalize(remoteRaw);
    const merged = mergeStates(local, remote);
    if (ts(remoteAt) !== null) this.lastSeenAt = ts(remoteAt);
    if (contentSignature(merged) !== contentSignature(local)) this.opts.applyRemote(merged);
    if (contentSignature(merged) !== contentSignature(remote)) {
      await this.write(merged);
    } else {
      this.setStatus(this.live ? 'live' : 'syncing');
    }
    await this.fetchMissingPhotos(merged);
  }

  private async pull() {
    if (!this.client) return;
    if (!navigator.onLine) return this.setStatus('offline');
    this.setStatus('syncing');
    const { data, error } = await this.client.from('app_state_sync').select('payload, updated_at').eq('id', 1).maybeSingle();
    if (error) throw new Error(error.message);
    const payload = data?.payload as AppState | undefined;
    if (!payload || payload.version !== 1) {
      await this.write(this.opts.getState());
      await this.uploadPendingPhotos();
      return;
    }
    await this.absorb(payload, data!.updated_at as string);
    await this.uploadPendingPhotos();
  }

  private async push() {
    if (!this.client) return;
    if (!navigator.onLine) return this.setStatus('offline');
    this.setStatus('syncing');
    // ¿Cambió la nube desde la última vez? (consulta liviana)
    const head = await this.client.from('app_state_sync').select('updated_at').eq('id', 1).maybeSingle();
    if (head.error) throw new Error(head.error.message);
    const remoteAt = (head.data?.updated_at as string) || null;
    if (remoteAt && ts(remoteAt) !== this.lastSeenAt) {
      await this.pull(); // pull ya mezcla y escribe si hace falta
      return;
    }
    await this.write(this.opts.getState());
    await this.uploadPendingPhotos();
  }

  private async write(state: AppState) {
    if (!this.client) return;
    const now = new Date().toISOString();
    const payload: AppState = { ...state, _by: this.device, _at: Date.now() };
    const { error } = await this.client.from('app_state_sync').upsert({ id: 1, payload, updated_at: now });
    if (error) throw new Error(error.message);
    // Publicar vitrina saneada (sin datos de clientes ni pedidos) para la Tienda 3D (#tienda)
    try {
      const publicSnap = JSON.stringify(buildPublicCatalog(state));
      await this.client.from('design_photos').upsert({ id: LIVE_CATALOG_KEY, data: publicSnap });
    } catch {
      /* ignorar si falla vitrina secundaria */
    }
    this.lastSeenAt = ts(now);
    this.setStatus(this.live ? 'live' : 'syncing');
  }

  async uploadPendingPhotos() {
    if (!this.client || !navigator.onLine) return;
    const pending = await db.photos.where('synced').equals(0).toArray();
    for (const p of pending) {
      const { error } = await this.client.from('design_photos').upsert({ id: p.id, data: p.data });
      if (error) {
        console.warn('[sync] foto', error.message);
        break;
      }
      await db.photos.update(p.id, { synced: 1 });
    }
  }

  private async fetchMissingPhotos(state: AppState) {
    if (!this.client || !navigator.onLine) return;
    const orderPhotos = state.orders
      .filter((o) => !o.deleted && (o.photoId || o.guidePhotoId))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 60)
      .flatMap((o) => [o.photoId, o.guidePhotoId].filter(Boolean) as string[]);
    const catalogPhotos = (state.catalogDesigns || [])
      .filter((d) => d.photoId && !d.deleted)
      .map((d) => d.photoId);
    const wanted = Array.from(new Set([...catalogPhotos, ...orderPhotos]));
    if (!wanted.length) return;
    const have = new Set((await db.photos.where('id').anyOf(wanted).primaryKeys()) as string[]);
    const missing = wanted.filter((id) => !have.has(id));
    if (!missing.length) return;
    const { data, error } = await this.client.from('design_photos').select('id, data').in('id', missing);
    if (error) {
      console.warn('[sync] fotos', error.message);
      return;
    }
    if (data?.length) {
      await db.photos.bulkPut(data.map((r) => ({ id: r.id as string, data: r.data as string, synced: 1 as const, createdAt: Date.now() })));
      this.opts.onPhotos();
    }
  }
}

export async function uploadPhotoNow(id: string, data: string): Promise<void> {
  const cfg = getConfig();
  if (!cfg || !navigator.onLine) return;
  try {
    const c = createClient(cfg.url, cfg.key, { auth: { persistSession: false } });
    const { error } = await c.from('design_photos').upsert({ id, data });
    if (!error) await db.photos.update(id, { synced: 1 });
  } catch {
    /* ignorar */
  }
}

export async function fetchSharedPhoto(id: string): Promise<string | null> {
  const local = await db.photos.get(id);
  if (local?.data) return local.data;
  const cfg = getConfig();
  if (!cfg || !navigator.onLine) return null;
  try {
    const c = createClient(cfg.url, cfg.key, { auth: { persistSession: false } });
    const { data } = await c.from('design_photos').select('data').eq('id', id).maybeSingle();
    if (data?.data) {
      await db.photos.put({ id, data: data.data as string, synced: 1, createdAt: Date.now() });
      return data.data as string;
    }
  } catch {
    /* ignorar */
  }
  return null;
}
