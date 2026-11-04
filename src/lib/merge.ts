import type { AppState, Entity, Movement, Order, Settings } from './types';
import { DEFAULT_SETTINGS, createInitialState } from './seed';

function newer<T extends Entity>(a: T, b: T): T {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  // Desempate determinista para que todos los dispositivos converjan igual.
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

function mergeEntities<T extends Entity>(a: T[], b: T[]): T[] {
  const map = new Map<string, T>();
  for (const x of a) map.set(x.id, x);
  for (const y of b) {
    const x = map.get(y.id);
    map.set(y.id, x ? newer(x, y) : y);
  }
  return Array.from(map.values());
}

function mergeMovements(a: Movement[], b: Movement[]): Movement[] {
  const map = new Map<string, Movement>();
  for (const m of a) map.set(m.id, m);
  for (const m of b) if (!map.has(m.id)) map.set(m.id, m);
  return Array.from(map.values()).sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : 1));
}

/** Si dos dispositivos crearon el mismo folio sin conexión, reasigna el más reciente. */
function fixFolios(orders: Order[]): Order[] {
  const sorted = [...orders].sort((x, y) => x.createdAt - y.createdAt || (x.id < y.id ? -1 : 1));
  const seen = new Set<number>();
  let max = sorted.reduce((m, o) => Math.max(m, o.folio), 0);
  return sorted.map((o) => {
    if (!seen.has(o.folio)) {
      seen.add(o.folio);
      return o;
    }
    max += 1;
    seen.add(max);
    return { ...o, folio: max };
  });
}

function mergeSettings(a: Settings, b: Settings): Settings {
  const pick = a.updatedAt !== b.updatedAt ? (a.updatedAt > b.updatedAt ? a : b) : JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  return { ...DEFAULT_SETTINGS, ...pick };
}

export function normalize(s: Partial<AppState> | null | undefined): AppState {
  const base = createInitialState();
  if (!s || typeof s !== 'object') return base;
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS, ...(s.settings || {}) },
    brands: mergeEntities(base.brands, Array.isArray(s.brands) ? s.brands : []),
    colors: mergeEntities(base.colors, Array.isArray(s.colors) ? s.colors : []),
    customers: Array.isArray(s.customers) ? s.customers : [],
    orders: Array.isArray(s.orders) ? s.orders : [],
    movements: Array.isArray(s.movements) ? s.movements : [],
    _by: s._by,
    _at: s._at
  };
}

export function mergeStates(local: AppState, remote: AppState): AppState {
  return {
    version: 1,
    settings: mergeSettings(local.settings, remote.settings),
    brands: mergeEntities(local.brands, remote.brands),
    colors: mergeEntities(local.colors, remote.colors),
    customers: mergeEntities(local.customers, remote.customers),
    orders: fixFolios(mergeEntities(local.orders, remote.orders)),
    movements: mergeMovements(local.movements, remote.movements),
    _by: local._by,
    _at: Math.max(local._at || 0, remote._at || 0)
  };
}

/** Firma de contenido (ignora metadatos de escritura y orden de arrays). */
export function contentSignature(s: AppState): string {
  const byId = <T extends { id: string }>(arr: T[]) => [...arr].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return JSON.stringify({
    settings: s.settings,
    brands: byId(s.brands),
    colors: byId(s.colors),
    customers: byId(s.customers),
    orders: byId(s.orders),
    movements: byId(s.movements)
  });
}
