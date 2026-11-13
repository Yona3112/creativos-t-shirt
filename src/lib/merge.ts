import type { AppState, CatalogDesign, Color, Entity, Movement, Order, ReadyMadeShirt, Settings, StockEntry } from './types';
import { DEFAULT_SETTINGS, LEGACY_COLOR_HEX, createInitialState } from './seed';

function newer<T extends Entity>(a: T, b: T): T {
  const ua = a.updatedAt || 0;
  const ub = b.updatedAt || 0;
  if (ua !== ub) return ua > ub ? a : b;
  // Si uno está marcado como eliminado con el mismo timestamp, gana el eliminado o el modificado
  if (Boolean(a.deleted) !== Boolean(b.deleted)) return a.deleted ? a : b;
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

function mergeReadyMade(a: ReadyMadeShirt[], b: ReadyMadeShirt[]): ReadyMadeShirt[] {
  const map = new Map<string, ReadyMadeShirt>();
  for (const x of a) map.set(x.id, x);
  for (const y of b) {
    const x = map.get(y.id);
    if (!x) {
      map.set(y.id, y);
    } else {
      const tx = x.updatedAt ?? x.createdAt ?? 0;
      const ty = y.updatedAt ?? y.createdAt ?? 0;
      map.set(y.id, ty >= tx ? y : x);
    }
  }
  return Array.from(map.values()).filter((r) => !r.deleted && r.qty > 0);
}

const UNUSED_SEED_BRAND_IDS = new Set(['b-nx', 'b-pc', 'b-hn']);

// IDs de diseños antiguos huérfanos cuyo archivo de imagen nunca se subió a Firestore cgs_photos
const ORPHAN_DESIGN_IDS = new Set([
  'cd-7191860a-f996-42cd-8a6b-0d4a06d0669a',
  'cd-4c23b890-425d-4e01-a574-7f5b8d5f88d2',
  'cd-4c50d5d2-83d0-4291-b016-656bc83552e6',
  'cd-8c04960a-c6fb-4b3d-8adb-d729f4d6605a',
  'cd-0e2f9732-cff8-44c7-a580-93593a9438fd',
  'cd-4de414f8-37f9-4be2-b62d-c9ec8ece3b72',
  'cd-9a263487-3b98-4657-8b64-0e026fe5f8fd',
  'cd-fad83581-c769-4c2d-ae69-c493bb414a37',
  'cd-68484978-24f3-4ff1-8f68-22a064b84f30',
  'cd-83601232-916d-452d-957e-5eaaa94368d3',
  'cd-0a3dbeb8-798a-4b0c-9bc1-40dd5ddc6cff',
  'cd-fb67ee2d-01d2-4b1d-9587-abacd4cb3d3d',
  'cd-4e8e4b62-2d94-48ea-8307-d538bca3b8a9',
  'cd-07420ef9-dcc7-4be6-b82a-df0190d5c77c',
  'cd-83b16446-bd34-4815-8595-5a4745442122',
  'cd-b21f0ea4-5479-44cc-99c8-27a97121ceb7',
  'cd-ff82f556-f008-454f-84a8-3f3fca2624bc',
  'cd-23529a4c-2c1e-403b-b5ac-19b97f735351',
  'cd-df32d856-4a8b-4c05-83ec-1a07fd37a364'
]);

/** Movimientos con historial propio (pedidos, ingresos, cuadres) que nunca se compactan. */
export const isLedgerMovement = (m: Movement) => Boolean(m.orderId || m.entryId);

/**
 * Compacta movimientos manuales (sin pedido ni ingreso) por variante `key` en un único registro neto `adj-${key}`.
 * Elimina decenas de registros redundantes (+1 / -1) y descarta ajustes cuyo neto sea 0.
 */
export function compactMovements(movements: Movement[], validBrandIds?: Set<string>): Movement[] {
  const orderMovements: Movement[] = [];
  const adjByKey = new Map<string, { delta: number; at: number }>();

  for (const m of movements) {
    if (!m || !m.key) continue;
    const brandId = m.key.split('|')[0];
    if (validBrandIds && brandId && !validBrandIds.has(brandId)) continue;

    if (isLedgerMovement(m)) {
      orderMovements.push(m);
    } else {
      const prev = adjByKey.get(m.key);
      // Si es un registro ya consolidado (`adj-...`) más reciente que los fragmentos viejos, o si sumamos fragmentos
      if (m.id === `adj-${m.key}` && prev && m.at > prev.at) {
        adjByKey.set(m.key, { delta: m.delta, at: m.at });
      } else if (prev && prev.at > m.at && m.id !== `adj-${m.key}`) {
        // Ignorar fragmento viejo anterior a una consolidación
        continue;
      } else {
        adjByKey.set(m.key, {
          delta: (prev?.delta || 0) + (Number(m.delta) || 0),
          at: Math.max(prev?.at || 0, m.at || 0)
        });
      }
    }
  }

  const compactedAdj: Movement[] = [];
  for (const [key, info] of adjByKey.entries()) {
    if (info.delta !== 0) {
      compactedAdj.push({
        id: `adj-${key}`,
        key,
        delta: info.delta,
        reason: 'ajuste',
        at: info.at || Date.now()
      });
    }
  }

  return [...orderMovements, ...compactedAdj].sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : 1));
}

function mergeMovements(a: Movement[], b: Movement[]): Movement[] {
  const orderMap = new Map<string, Movement>();
  for (const m of a) if (isLedgerMovement(m)) orderMap.set(m.id, m);
  for (const m of b) if (isLedgerMovement(m) && !orderMap.has(m.id)) orderMap.set(m.id, m);

  // Para ajustes manuales sueltos, consolidar por key priorizando el registro consolidado más reciente
  const adjA = compactMovements(a.filter((m) => !isLedgerMovement(m)));
  const adjB = compactMovements(b.filter((m) => !isLedgerMovement(m)));
  const adjMap = new Map<string, Movement>();
  for (const m of adjA) adjMap.set(m.key, m);
  for (const m of adjB) {
    const prev = adjMap.get(m.key);
    if (!prev || (m.at || 0) >= (prev.at || 0)) {
      adjMap.set(m.key, m);
    }
  }

  return [...orderMap.values(), ...adjMap.values()].sort(
    (x, y) => x.at - y.at || (x.id < y.id ? -1 : 1)
  );
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

  const rawOrders = (Array.isArray(s.orders) ? s.orders : [])
    .filter(Boolean)
    .map((o) => {
      if (!o || !Array.isArray(o.items)) return o;
      let changed = false;
      const cleanItems = o.items.map((it) => {
        if (it && typeof it.photoUrl === 'string' && it.photoUrl.startsWith('data:')) {
          changed = true;
          return { ...it, photoUrl: null };
        }
        return it;
      });
      return changed ? { ...o, items: cleanItems } : o;
    });
  const rawMovements = Array.isArray(s.movements) ? s.movements : [];

  // Identificar qué marcas tienen movimientos reales o pedidos para eliminar las marcas semilla basura (Next Apparel, Pacer, HN)
  const usedBrandIds = new Set<string>();
  for (const m of rawMovements) {
    if (m?.key && m.delta) usedBrandIds.add(m.key.split('|')[0]);
  }
  for (const o of rawOrders) {
    if (!o?.deleted) {
      for (const it of o.items || []) if (it.brandId) usedBrandIds.add(it.brandId);
    }
  }

  const incomingBrands = Array.isArray(s.brands) && s.brands.length > 0 ? s.brands : base.brands;
  const cleanBrands = incomingBrands.filter((b) => {
    if (!b || b.deleted) return false;
    if (UNUSED_SEED_BRAND_IDS.has(b.id) && !usedBrandIds.has(b.id)) return false;
    return true;
  });
  const finalBrands = cleanBrands.length > 0 ? cleanBrands : base.brands;
  const activeBrandIdSet = new Set(finalBrands.map((b) => b.id));

  const incomingColors = Array.isArray(s.colors) && s.colors.length > 0 ? s.colors : base.colors;
  const cleanColors = upgradeColors(
    incomingColors.filter((c) => c && activeBrandIdSet.has(c.brandId))
  );

  const rawDesigns = Array.isArray(s.catalogDesigns) ? s.catalogDesigns : [];
  const cleanDesigns = assignDesignCodes(
    rawDesigns
      .filter((d) => d && d.photoId && !ORPHAN_DESIGN_IDS.has(d.id))
      .map((d) => (d.name === 'RANCGHO' ? { ...d, name: 'RANCHO', code: 'D-001' } : d))
  );

  const stockEntries = (Array.isArray(s.stockEntries) ? s.stockEntries : []).filter(Boolean);

  return {
    version: 1,
    settings,
    brands: finalBrands,
    colors: cleanColors,
    customers: (Array.isArray(s.customers) ? s.customers : []).filter(Boolean),
    orders: rawOrders.filter(Boolean),
    movements: dropDeletedEntryMovements(compactMovements(rawMovements, activeBrandIdSet), stockEntries),
    catalogDesigns: cleanDesigns,
    readyMadeStock: (Array.isArray(s.readyMadeStock) ? s.readyMadeStock : []).filter(
      (r) => r && !r.deleted && r.qty > 0
    ),
    stockEntries,
    _by: s._by,
    _at: s._at
  };
}

/** Si un ingreso/cuadre fue anulado (deleted), sus movimientos dejan de contar en todos los dispositivos. */
function dropDeletedEntryMovements(movements: Movement[], entries: StockEntry[]): Movement[] {
  const dead = new Set(entries.filter((e) => e.deleted).map((e) => e.id));
  if (!dead.size) return movements;
  return movements.filter((m) => !m.entryId || !dead.has(m.entryId));
}

/** Reemplaza los tonos genéricos anteriores solo en colores sin modificaciones manuales (updatedAt === 0). */
function upgradeColors(colors: Color[]): Color[] {
  return colors.map((c) => {
    if (c.updatedAt && c.updatedAt > 0) return c;
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
  let paymentMethods = Array.isArray(st.paymentMethods) ? st.paymentMethods : DEFAULT_SETTINGS.paymentMethods;
  if (!paymentMethods.some((p) => p.toLowerCase().includes('pendiente'))) {
    paymentMethods = ['Pago Pendiente en Tienda', ...paymentMethods];
  }
  const lowStock = !st.lowStock || st.lowStock === 5 ? 10 : st.lowStock;
  return { ...st, lowStock, workTypes, carriers, paymentMethods, storeTheme: st.storeTheme || 'ranchero' };
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
  const stockEntries = mergeEntities(local.stockEntries || [], remote.stockEntries || []);
  return {
    version: 1,
    settings: mergeSettings(local.settings, remote.settings),
    brands: mergeEntities(local.brands, remote.brands),
    colors: mergeEntities(local.colors, remote.colors),
    customers: mergeEntities(local.customers, remote.customers),
    orders: fixFolios(mergeEntities(local.orders, remote.orders)),
    movements: dropDeletedEntryMovements(mergeMovements(local.movements, remote.movements), stockEntries),
    catalogDesigns: mergeEntities(local.catalogDesigns || [], remote.catalogDesigns || []),
    readyMadeStock: mergeReadyMade(local.readyMadeStock || [], remote.readyMadeStock || []),
    stockEntries,
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
    catalogDesigns: byId(s.catalogDesigns || []),
    readyMadeStock: byId(s.readyMadeStock || []),
    stockEntries: byId(s.stockEntries || [])
  });
}
