import esbuild from 'esbuild';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = path.join(root, 'node_modules', '.cache');
fs.mkdirSync(cacheDir, { recursive: true });
const outFile = path.join(cacheDir, 'system-audit.test.mjs');

const mockDbCode = `
const kvMap = new Map();
const photoMap = new Map();
export const db = {
  kv: {
    async get(k) { return kvMap.get(k); },
    async put(v) { kvMap.set(v.key, v); }
  },
  photos: {
    async get(id) { return photoMap.get(id); },
    async put(row) { photoMap.set(row.id, row); },
    async update(id, patch) {
      const prev = photoMap.get(id);
      if (!prev) return 0;
      photoMap.set(id, { ...prev, ...patch });
      return 1;
    },
    async bulkPut(rows) { for (const r of rows) photoMap.set(r.id, r); },
    where() {
      return {
        equals() { return { async toArray() { return Array.from(photoMap.values()); } }; },
        anyOf(ids) { return { async toArray() { return ids.map((id) => photoMap.get(id)).filter(Boolean); } }; }
      };
    }
  }
};
export async function requestPersistentStorage() { return false; }
export async function loadState() { return kvMap.get('state')?.value ?? null; }
export async function saveState(state) { kvMap.set('state', { key: 'state', value: state }); }
export async function savePhoto(id, data, synced = 0) { photoMap.set(id, { id, data, synced, createdAt: Date.now() }); }
export async function getPhoto(id) { return photoMap.get(id)?.data ?? null; }
`;

const mockSyncCode = `
export function isPublicStorefrontHash() { return false; }
export function getConfig() { return null; }
export function saveConfig() {}
export function pairingLink() { return ''; }
export function firebasePairingLink() { return ''; }
export function consumePairingHash() { return false; }
export async function uploadPhotoNow() {}
export async function fetchSharedPhoto() { return null; }
export class SyncEngine {
  connected = false;
  constructor() {}
  async start() {}
  async stop() {}
  schedulePush() {}
}
`;

const mockFirebaseSyncCode = `
export function getFirebaseConfig() { return null; }
export function saveFirebaseConfig() {}
export async function uploadPhotoNowFirebase() { return true; }
export async function fetchSharedPhotoFirebase() { return null; }
export function subscribeLiveCatalogFirebase() { return () => {}; }
export function subscribeLatestWebOrderFirebase() { return () => {}; }
export class FirebaseSyncEngine {
  connected = false;
  constructor() {}
  async start() {}
  async stop() {}
  schedulePush() {}
}
`;

const browserShimBanner = `
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(String(k), String(v)); },
    removeItem(k) { store.delete(String(k)); },
    clear() { store.clear(); }
  };
}
if (typeof globalThis.sessionStorage === 'undefined') {
  const sstore = new Map();
  globalThis.sessionStorage = {
    getItem(k) { return sstore.has(k) ? sstore.get(k) : null; },
    setItem(k, v) { sstore.set(String(k), String(v)); },
    removeItem(k) { sstore.delete(String(k)); },
    clear() { sstore.clear(); }
  };
}
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    setTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {}
  };
}
if (typeof globalThis.location === 'undefined') {
  globalThis.location = { hash: '', origin: 'https://creativos-t-shirt.web.app', pathname: '/', search: '' };
}
if (typeof globalThis.navigator === 'undefined') {
  globalThis.navigator = { onLine: true };
}
`;

await esbuild.build({
  entryPoints: [path.join(root, 'tests', 'system-audit.test.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: outFile,
  banner: { js: browserShimBanner },
  plugins: [
    {
      name: 'mock-browser-modules',
      setup(build) {
        build.onResolve({ filter: /(^|\/)db(\.ts)?$/ }, () => ({
          path: 'virtual-db',
          namespace: 'mock-mod'
        }));
        build.onResolve({ filter: /(^|\/)sync(\.ts)?$/ }, () => ({
          path: 'virtual-sync',
          namespace: 'mock-mod'
        }));
        build.onResolve({ filter: /(^|\/)firebaseSync(\.ts)?$/ }, () => ({
          path: 'virtual-firebaseSync',
          namespace: 'mock-mod'
        }));
        build.onResolve({ filter: /components\/Shirt(\.tsx)?$/ }, () => ({
          path: 'virtual-shirt',
          namespace: 'mock-mod'
        }));
        build.onLoad({ filter: /.*/, namespace: 'mock-mod' }, (args) => {
          if (args.path === 'virtual-db') return { contents: mockDbCode, loader: 'js' };
          if (args.path === 'virtual-sync') return { contents: mockSyncCode, loader: 'js' };
          if (args.path === 'virtual-firebaseSync') return { contents: mockFirebaseSyncCode, loader: 'js' };
          return { contents: 'export {};', loader: 'js' };
        });
      }
    }
  ]
});

execFileSync(process.execPath, ['--test', outFile], { stdio: 'inherit' });
