import type { AppState, CatalogDesign, Color, Entity, Movement, Order, Settings } from './types';
import { DEFAULT_SETTINGS, LEGACY_COLOR_HEX, createInitialState } from './seed';

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
  const settings = upgradeSettings({ ...DEFAULT_SETTINGS, ...(s.settings || {}) });
  return {
    version: 1,
    settings,
    brands: mergeEntities(base.brands, Array.isArray(s.brands) ? s.brands : []),
    colors: upgradeColors(mergeEntities(base.colors, Array.isArray(s.colors) ? s.colors : [])),
    customers: Array.isArray(s.customers) ? s.customers : [],
    orders: Array.isArray(s.orders) ? s.orders : [],
    movements: Array.isArray(s.movements) ? s.movements : [],
    catalogDesigns: assignDesignCodes(Array.isArray(s.catalogDesigns) ? s.catalogDesigns : []),
    _by: s._by,
    _at: s._at
  };
}

/** Reemplaza los tonos genéricos anteriores por colores reales de tela (determinista). */
function upgradeColors(colors: Color[]): Color[] {
  return colors.map((c) => {
    const next = LEGACY_COLOR_HEX[(c.hex || '').toUpperCase()];
    return next ? { ...c, hex: next } : c;
  });
}

/** Asegura opciones nuevas sin borrar las personalizadas del usuario. */
function upgradeSettings(st: Settings): Settings {
  let workTypes = Array.isArray(st.workTypes) ? st.workTypes : DEFAULT_SETTINGS.workTypes;
  if (!workTypes.some((w) => w.trim().toLowerCase() === 'dtf espalda')) workTypes = ['DTF Espalda', ...workTypes];
  let carriers = Array.isArray(st.carriers) ? st.carriers : DEFAULT_SETTINGS.carriers;
  if (!carriers.some((c) => c.trim().toLowerCase() === 'boxful')) carriers = ['Boxful', ...carriers];
  return { ...st, workTypes, carriers, storeTheme: st.storeTheme || 'ranchero' };
}

/** Asigna códigos D-001, D-002… a los diseños que aún no tienen (orden estable por fecha). */
function assignDesignCodes(list: CatalogDesign[]): CatalogDesign[] {
  if (list.every((d) => d.code)) return list;
  const used = new Set(list.map((d) => d.code).filter(Boolean) as string[]);
  let n = 0;
  const nextCode = () => {
    let code = '';
    do {
      n += 1;
      code = `D-${String(n).padStart(3, '0')}`;
    } while (used.has(code));
    used.add(code);
    return code;
  };
  const order = [...list].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  const codes = new Map<string, string>();
  for (const d of order) if (!d.code) codes.set(d.id, nextCode());
  return list.map((d) => (d.code ? d : { ...d, code: codes.get(d.id) }));
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
    catalogDesigns: mergeEntities(local.catalogDesigns || [], remote.catalogDesigns || []),
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
    movements: byId(s.movements),
    catalogDesigns: byId(s.catalogDesigns || [])
  });
}
