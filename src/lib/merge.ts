import type { AppState, CatalogDesign, Color, Entity, Movement, Order, ReadyMadeShirt, Settings, StockEntry } from './types';
import { DEFAULT_SETTINGS, LEGACY_COLOR_HEX, createInitialState } from './seed';
import { dayKey } from './time';

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
      if (ty !== tx) {
        map.set(y.id, ty > tx ? y : x);
      } else if (Boolean(x.deleted) !== Boolean(y.deleted)) {
        map.set(y.id, x.deleted ? x : y);
      } else {
        map.set(y.id, ty >= tx ? y : x);
      }
    }
  }
  // Conservar lápidas (deleted: true) para que una prenda vendida/eliminada no resucite desde otro dispositivo
  return Array.from(map.values());
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
 * Compacta movimientos manuales (sin pedido ni ingreso) por variante + día (`key@@YYYY-MM-DD`)
 * en un único registro neto `adj-${key}-${day}`.
 * Preserva cierres históricos (`Había (Antes)`) por día y conserva lápidas recientes con `delta === 0`
 * para evitar resurrecciones al sincronizar con otros dispositivos.
 */
export function compactMovements(movements: Movement[], validBrandIds?: Set<string>): Movement[] {
  const orderMovements: Movement[] = [];
  const adjByBucket = new Map<
    string,
    { id: string; key: string; day: string; delta: number; at: number; hasConsolidated: boolean }
  >();

  for (const m of movements) {
    if (!m || !m.key) continue;
    const brandId = m.key.split('|')[0];
    if (validBrandIds && brandId && !validBrandIds.has(brandId)) continue;

    if (isLedgerMovement(m)) {
      orderMovements.push(m);
    } else {
      const mAt = Number(m.at) || 0;
      const day = dayKey(mAt || Date.now());
      const bucketKey = `${m.key}@@${day}`;
      const isConsolidated = m.id.startsWith('adj-');
      const prev = adjByBucket.get(bucketKey);

      if (!prev) {
        adjByBucket.set(bucketKey, {
          id: isConsolidated ? `adj-${m.key}-${day}` : `adj-${m.key}-${day}`,
          key: m.key,
          day,
          delta: Number(m.delta) || 0,
          at: mAt,
          hasConsolidated: isConsolidated
        });
      } else if (isConsolidated && (mAt > prev.at || (mAt === prev.at && !prev.hasConsolidated))) {
        adjByBucket.set(bucketKey, {
          id: `adj-${m.key}-${day}`,
          key: m.key,
          day,
          delta: Number(m.delta) || 0,
          at: mAt,
          hasConsolidated: true
        });
      } else if (prev.hasConsolidated && prev.at > mAt) {
        // Ignorar fragmento viejo anterior a una consolidación del mismo día
        continue;
      } else {
        adjByBucket.set(bucketKey, {
          id: `adj-${m.key}-${day}`,
          key: m.key,
          day,
          delta: prev.delta + (Number(m.delta) || 0),
          at: Math.max(prev.at, mAt),
          hasConsolidated: prev.hasConsolidated || isConsolidated
        });
      }
    }
  }

  const tombstoneCutoff = Date.now() - 30 * 86400000;
  const compactedAdj: Movement[] = [];
  for (const info of adjByBucket.values()) {
    const keepTombstone = info.hasConsolidated && info.delta === 0 && info.at >= tombstoneCutoff;
    if (info.delta !== 0 || keepTombstone) {
      compactedAdj.push({
        id: info.id,
        key: info.key,
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

  // Para ajustes manuales sueltos, fusionar por variante + día priorizando el registro consolidado más reciente
  const adjA = compactMovements(a.filter((m) => !isLedgerMovement(m)));
  const adjB = compactMovements(b.filter((m) => !isLedgerMovement(m)));
  const adjMap = new Map<string, Movement>();
  for (const m of adjA) {
    const bucketKey = `${m.key}@@${dayKey(m.at || Date.now())}`;
    adjMap.set(bucketKey, m);
  }
  for (const m of adjB) {
    const bucketKey = `${m.key}@@${dayKey(m.at || Date.now())}`;
    const prev = adjMap.get(bucketKey);
    if (!prev) {
      adjMap.set(bucketKey, m);
      continue;
    }
    const ma = m.at || 0;
    const pa = prev.at || 0;
    if (
      ma > pa ||
      (ma === pa && (m.id > prev.id || (m.id === prev.id && m.delta < prev.delta)))
    ) {
      adjMap.set(bucketKey, m);
    }
  }

  return [...orderMap.values(), ...adjMap.values()].sort(
    (x, y) => x.at - y.at || (x.id < y.id ? -1 : 1)
  );
}

/** Si dos dispositivos crearon el mismo folio sin conexión, reasigna el más reciente. */
function fixFolios(orders: Order[]): Order[] {
  const sorted = orders.toSorted((x, y) => x.createdAt - y.createdAt || (x.id < y.id ? -1 : 1));
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

const STANDARD_SIZE_ORDER = ['2XS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', 'XXXL', '3XL', '4XL'];

export function deduplicateStrings(list: string[], uppercase = false): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const clean = uppercase ? raw.trim().toUpperCase() : raw.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

export function normalizeSizesList(list: string[]): string[] {
  const deduped = deduplicateStrings(list, true);
  if (deduped.length === 0) return [...DEFAULT_SETTINGS.sizes];
  return deduped.sort((a, b) => {
    const ia = STANDARD_SIZE_ORDER.indexOf(a);
    const ib = STANDARD_SIZE_ORDER.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return 0;
  });
}

function normalizeTextKey(raw: string): string {
  return (raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

export function normalize(s: Partial<AppState> | null | undefined): AppState {
  const base = createInitialState();
  if (!s || typeof s !== 'object') return base;
  let settings = upgradeSettings({ ...DEFAULT_SETTINGS, ...(s.settings || {}) });

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

  // Identificar qué marcas y colores tienen movimientos reales o pedidos
  const usedBrandIds = new Set<string>();
  const usedColorIds = new Set<string>();
  for (const m of rawMovements) {
    if (m?.key && m.delta) {
      const [bId, cId] = m.key.split('|');
      if (bId) usedBrandIds.add(bId);
      if (cId) usedColorIds.add(cId);
    }
  }
  for (const o of rawOrders) {
    if (!o?.deleted) {
      for (const it of o.items || []) {
        if (it.brandId) usedBrandIds.add(it.brandId);
        if (it.colorId) usedColorIds.add(it.colorId);
      }
    }
  }

  const incomingBrands = Array.isArray(s.brands) && s.brands.length > 0 ? s.brands : base.brands;
  const filteredBrands = incomingBrands.filter((b) => {
    if (!b || b.deleted) return false;
    if (UNUSED_SEED_BRAND_IDS.has(b.id) && !usedBrandIds.has(b.id)) return false;
    return true;
  });
  const candidateBrands = filteredBrands.length > 0 ? filteredBrands : base.brands;

  // 1. Deduplicar marcas activas con el mismo nombre normalizado y mapear IDs duplicados al canónico
  const brandRemap = new Map<string, string>();
  const brandByName = new Map<string, typeof candidateBrands[number]>();
  for (const b of candidateBrands) {
    const bKey = normalizeTextKey(b.name);
    const existing = brandByName.get(bKey);
    if (!existing) {
      brandByName.set(bKey, { ...b, name: b.name.trim() });
    } else {
      const existingUsed = usedBrandIds.has(existing.id);
      const currentUsed = usedBrandIds.has(b.id);
      const keepCurrent =
        (currentUsed && !existingUsed) ||
        (currentUsed === existingUsed && (b.updatedAt || 0) > (existing.updatedAt || 0));
      if (keepCurrent) {
        brandRemap.set(existing.id, b.id);
        brandByName.set(bKey, { ...b, name: b.name.trim() });
      } else {
        brandRemap.set(b.id, existing.id);
      }
    }
  }
  const finalBrands = Array.from(brandByName.values());
  const activeBrandIdSet = new Set(finalBrands.map((b) => b.id));
  const resolveBrandId = (id: string) => brandRemap.get(id) || id;

  // 2. Deduplicar colores por (brandId + nombre normalizado) para que no existan colores repetidos
  const incomingColors = Array.isArray(s.colors) && s.colors.length > 0 ? s.colors : base.colors;
  const upgradedColors = upgradeColors(
    incomingColors
      .filter(Boolean)
      .map((c) => ({ ...c, brandId: resolveBrandId(c.brandId), name: (c.name || '').trim() }))
      .filter((c) => activeBrandIdSet.has(c.brandId))
  );

  const colorRemap = new Map<string, string>();
  const activeColorByBrandAndName = new Map<string, Color>();
  const deletedColors: Color[] = [];

  for (const c of upgradedColors) {
    if (c.deleted) {
      deletedColors.push(c);
      continue;
    }
    const cKey = `${c.brandId}|${normalizeTextKey(c.name)}`;
    const existing = activeColorByBrandAndName.get(cKey);
    if (!existing) {
      activeColorByBrandAndName.set(cKey, c);
    } else {
      const existingUsed = usedColorIds.has(existing.id);
      const currentUsed = usedColorIds.has(c.id);
      const keepCurrent =
        (currentUsed && !existingUsed) ||
        (currentUsed === existingUsed && (c.updatedAt || 0) > (existing.updatedAt || 0));
      if (keepCurrent) {
        colorRemap.set(existing.id, c.id);
        activeColorByBrandAndName.set(cKey, c);
      } else {
        colorRemap.set(c.id, existing.id);
      }
    }
  }

  const activeCanonicalColors = Array.from(activeColorByBrandAndName.values());
  const activeColorNameKeys = new Set(
    activeCanonicalColors.map((c) => `${c.brandId}|${normalizeTextKey(c.name)}`)
  );
  // Conservar lápidas solo de colores que no tienen un homónimo activo
  const cleanDeletedColors = deletedColors.filter(
    (c) => !activeColorNameKeys.has(`${c.brandId}|${normalizeTextKey(c.name)}`)
  );
  const cleanColors = [...activeCanonicalColors, ...cleanDeletedColors];
  const resolveColorId = (id: string) => colorRemap.get(id) || id;
  const remapVKey = (key: string): string => {
    const [bId = '', cId = '', sz = ''] = (key || '').split('|');
    return `${resolveBrandId(bId)}|${resolveColorId(cId)}|${sz.trim().toUpperCase()}`;
  };

  // Remapear settings si apuntaban a marcas o colores duplicados
  if (settings.storeBrandId && brandRemap.has(settings.storeBrandId)) {
    settings = { ...settings, storeBrandId: resolveBrandId(settings.storeBrandId) };
  }
  if (Array.isArray(settings.storeColorIds) && settings.storeColorIds.length > 0) {
    settings = {
      ...settings,
      storeColorIds: Array.from(new Set(settings.storeColorIds.map(resolveColorId)))
    };
  }

  // 3. Deduplicar diseños del catálogo con el mismo photoId o el mismo nombre normalizado
  const rawDesigns = Array.isArray(s.catalogDesigns) ? s.catalogDesigns : [];
  const filteredDesigns = rawDesigns
    .filter((d) => d && d.photoId && !ORPHAN_DESIGN_IDS.has(d.id))
    .map((d) => {
      const fixed = d.name === 'RANCGHO' ? { ...d, name: 'RANCHO', code: 'D-001' } : d;
      return {
        ...fixed,
        name: (fixed.name || 'Diseño').trim(),
        allowedColorIds: Array.isArray(fixed.allowedColorIds)
          ? Array.from(new Set(fixed.allowedColorIds.map(resolveColorId)))
          : fixed.allowedColorIds
      };
    });

  const activeDesignByPhoto = new Map<string, CatalogDesign>();
  const deletedDesigns: CatalogDesign[] = [];
  for (const d of filteredDesigns) {
    if (d.deleted) {
      deletedDesigns.push(d);
      continue;
    }
    const pKey = d.photoId;
    const prev = activeDesignByPhoto.get(pKey);
    if (!prev || (d.updatedAt || d.createdAt || 0) >= (prev.updatedAt || prev.createdAt || 0)) {
      activeDesignByPhoto.set(pKey, d);
    }
  }

  // Segunda pasada: deduplicar diseños activos que tengan exactamente el mismo nombre normalizado
  const activeDesignByName = new Map<string, CatalogDesign>();
  for (const d of activeDesignByPhoto.values()) {
    const nKey = `${normalizeTextKey(d.name)}|${d.placement || 'back'}`;
    const prev = activeDesignByName.get(nKey);
    if (!prev) {
      activeDesignByName.set(nKey, d);
    } else {
      const keepCurrent =
        (Boolean(d.featured) && !prev.featured) ||
        (Boolean(d.featured) === Boolean(prev.featured) &&
          (d.updatedAt || d.createdAt || 0) >= (prev.updatedAt || prev.createdAt || 0));
      if (keepCurrent) {
        deletedDesigns.push({ ...prev, deleted: true, updatedAt: Date.now() });
        activeDesignByName.set(nKey, d);
      } else {
        deletedDesigns.push({ ...d, deleted: true, updatedAt: Date.now() });
      }
    }
  }

  const cleanDesigns = assignDesignCodes([
    ...Array.from(activeDesignByName.values()),
    ...deletedDesigns.filter((d) => !activeDesignByPhoto.has(d.photoId))
  ]);

  // 4. Remapear movimientos, lotes de ingreso, pedidos y prendas estampadas con marcas/colores/tallas normalizadas
  const remappedMovements = rawMovements
    .filter(Boolean)
    .map((m) => ({ ...m, key: remapVKey(m.key) }));

  const stockEntries = (Array.isArray(s.stockEntries) ? s.stockEntries : [])
    .filter(Boolean)
    .map((e) => ({
      ...e,
      lines: Array.isArray(e.lines)
        ? e.lines.map((l) => ({ ...l, key: remapVKey(l.key) }))
        : []
    }));

  const rawReadyMade = (Array.isArray(s.readyMadeStock) ? s.readyMadeStock : [])
    .filter(Boolean)
    .map((r) => ({
      ...r,
      brandId: resolveBrandId(r.brandId),
      colorId: resolveColorId(r.colorId),
      size: (r.size || 'M').trim().toUpperCase()
    }));

  const cleanOrders = rawOrders
    .filter(Boolean)
    .map((o) => ({
      ...o,
      items: Array.isArray(o.items)
        ? o.items.map((it) => ({
            ...it,
            brandId: resolveBrandId(it.brandId),
            colorId: resolveColorId(it.colorId),
            size: (it.size || 'M').trim().toUpperCase()
          }))
        : []
    }));

  return {
    version: 1,
    settings,
    brands: finalBrands,
    colors: cleanColors,
    customers: (Array.isArray(s.customers) ? s.customers : []).filter(Boolean),
    orders: cleanOrders,
    movements: dropDeletedOrderMovements(
      dropDeletedEntryMovements(compactMovements(remappedMovements, activeBrandIdSet), stockEntries),
      cleanOrders,
      rawReadyMade
    ),
    catalogDesigns: cleanDesigns,
    readyMadeStock: rawReadyMade,
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

/** Si un pedido fue eliminado (deleted), sus movimientos regresan las camisas descontadas al inventario en todos los dispositivos. */
function dropDeletedOrderMovements(
  movements: Movement[],
  orders: Order[],
  readyMadeStock: ReadyMadeShirt[]
): Movement[] {
  const readyOrderIds = new Set(
    readyMadeStock.filter((r) => Boolean(r.orderId)).map((r) => r.orderId as string)
  );
  const dead = new Set(
    orders.filter((o) => o.deleted && !readyOrderIds.has(o.id)).map((o) => o.id)
  );
  if (!dead.size) return movements;
  return movements.filter((m) => !m.orderId || !dead.has(m.orderId));
}

/** Reemplaza los tonos genéricos anteriores solo en colores sin modificaciones manuales (updatedAt === 0). */
function upgradeColors(colors: Color[]): Color[] {
  return colors.map((c) => {
    if (c.updatedAt && c.updatedAt > 0) return c;
    const next = LEGACY_COLOR_HEX[(c.hex || '').toUpperCase()];
    return next ? { ...c, hex: next } : c;
  });
}

/** Asegura opciones nuevas y deduplica tallas, campañas, métodos de pago y transportistas. */
function upgradeSettings(st: Settings): Settings {
  const sizes = normalizeSizesList(Array.isArray(st.sizes) ? st.sizes : DEFAULT_SETTINGS.sizes);
  const validSizeSet = new Set(sizes);
  const storeSizes = Array.isArray(st.storeSizes)
    ? normalizeSizesList(st.storeSizes).filter((sz) => validSizeSet.has(sz))
    : undefined;

  let workTypes = deduplicateStrings(
    Array.isArray(st.workTypes) ? st.workTypes : DEFAULT_SETTINGS.workTypes
  );
  if (!workTypes.some((w) => w.toLowerCase() === 'dtf espalda')) workTypes = ['DTF Espalda', ...workTypes];

  let carriers = deduplicateStrings(
    Array.isArray(st.carriers) ? st.carriers : DEFAULT_SETTINGS.carriers
  );
  if (!carriers.some((c) => c.toLowerCase() === 'boxful')) carriers = ['Boxful', ...carriers];

  let paymentMethods = deduplicateStrings(
    Array.isArray(st.paymentMethods) ? st.paymentMethods : DEFAULT_SETTINGS.paymentMethods
  );
  if (!paymentMethods.some((p) => p.toLowerCase().includes('pendiente'))) {
    paymentMethods = ['Pago Pendiente en Tienda', ...paymentMethods];
  }

  const campaigns = Array.isArray(st.campaigns) && st.campaigns.length > 0
    ? deduplicateStrings(st.campaigns)
    : st.campaigns;

  const lowStock = !st.lowStock || st.lowStock <= 0 ? 10 : st.lowStock;
  return {
    ...st,
    sizes,
    ...(storeSizes ? { storeSizes } : {}),
    ...(campaigns ? { campaigns } : {}),
    lowStock,
    workTypes,
    carriers,
    paymentMethods,
    storeTheme: st.storeTheme || 'ranchero'
  };
}

/** Asigna códigos únicos D-001, D-002… a los diseños (corrigiendo códigos vacíos o duplicados). */
function assignDesignCodes(list: CatalogDesign[]): CatalogDesign[] {
  const used = new Set<string>();
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
  const order = list.toSorted((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  const codes = new Map<string, string>();
  for (const d of order) {
    const cleanCode = (d.code || '').trim().toUpperCase();
    if (cleanCode && !used.has(cleanCode)) {
      used.add(cleanCode);
      codes.set(d.id, cleanCode);
    } else {
      codes.set(d.id, nextCode());
    }
  }
  return list.map((d) => ({ ...d, code: codes.get(d.id) || d.code }));
}

export function mergeStates(local: AppState, remote: AppState): AppState {
  const stockEntries = mergeEntities(local.stockEntries || [], remote.stockEntries || []);
  const orders = fixFolios(mergeEntities(local.orders, remote.orders));
  const readyMadeStock = mergeReadyMade(local.readyMadeStock || [], remote.readyMadeStock || []);
  return normalize({
    version: 1,
    settings: mergeSettings(local.settings, remote.settings),
    brands: mergeEntities(local.brands, remote.brands),
    colors: mergeEntities(local.colors, remote.colors),
    customers: mergeEntities(local.customers, remote.customers),
    orders,
    movements: dropDeletedOrderMovements(
      dropDeletedEntryMovements(mergeMovements(local.movements, remote.movements), stockEntries),
      orders,
      readyMadeStock
    ),
    catalogDesigns: mergeEntities(local.catalogDesigns || [], remote.catalogDesigns || []),
    readyMadeStock,
    stockEntries,
    _by: local._by,
    _at: Math.max(local._at || 0, remote._at || 0)
  });
}

/** Firma de contenido (ignora metadatos de escritura y orden de arrays). */
export function contentSignature(s: AppState): string {
  const byId = <T extends { id: string }>(arr: T[]) => arr.toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
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
