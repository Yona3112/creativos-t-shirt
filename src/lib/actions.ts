import type { Address, AppState, Brand, CartLine, CatalogDesign, Color, Customer, Movement, MovementReason, Order, OrderStatus, ReadyMadeShirt, Settings, ShipTo, StockEntry } from './types';
import { getState, update } from './store';
import { uid, colorCode, slug } from './ids';
import { activeBrands, brandColors, computeStock, skuOf, vkey } from './inventory';
import { compactMovements } from './merge';
import { BASE_COLORS } from './seed';

const now = () => Date.now();

/* ----------------------------- Inventario ----------------------------- */

export function setStockAbsolute(key: string, target: number, reason: MovementReason = 'ajuste'): void {
  const t = Math.max(0, Math.floor(target || 0));
  update((s) => {
    const current = computeStock(s).stock.get(key) || 0;
    const delta = t - current;
    if (!delta) return s;

    // Calcular cuánto proviene de pedidos (`orderId`) y consolidar el ajuste manual en 1 solo registro por variante
    let orderSum = 0;
    const otherMovements: Movement[] = [];
    for (const m of s.movements) {
      if (m.key !== key) {
        otherMovements.push(m);
      } else if (m.orderId || m.entryId) {
        orderSum += m.delta;
        otherMovements.push(m);
      }
    }
    const neededAdj = t - orderSum;
    if (neededAdj !== 0) {
      otherMovements.push({
        id: `adj-${key}`,
        key,
        delta: neededAdj,
        reason,
        at: now()
      });
    }
    return { ...s, movements: otherMovements };
  });
}

/* ------------------------- Ingresos y Cuadres -------------------------- */

function nextEntryFolio(s: AppState, kind: StockEntry['kind']): string {
  const prefix = kind === 'ingreso' ? 'ING' : 'CUA';
  const n = (s.stockEntries || []).filter((e) => e.kind === kind).length + 1;
  return `${prefix}-${String(n).padStart(4, '0')}`;
}

/**
 * Registra un ingreso de mercadería como lote aparte (folio ING-0001).
 * Guarda cuánto había antes de cada variante y cuánto quedó, para poder comparar y cuadrar.
 */
export function createStockEntry(lines: { key: string; qty: number }[], note = ''): StockEntry | null {
  const clean = lines.filter((l) => l.key && Math.floor(l.qty) > 0).map((l) => ({ key: l.key, qty: Math.floor(l.qty) }));
  if (!clean.length) return null;
  let created: StockEntry | null = null;
  update((s) => {
    const { stock } = computeStock(s);
    const t = now();
    const id = uid();
    const entry: StockEntry = {
      id,
      folio: nextEntryFolio(s, 'ingreso'),
      kind: 'ingreso',
      createdAt: t,
      updatedAt: t,
      note: note.trim(),
      lines: clean.map((l) => {
        const before = stock.get(l.key) || 0;
        return { key: l.key, qty: l.qty, before, after: before + l.qty };
      })
    };
    const movs: Movement[] = clean.map((l) => ({
      id: `ent-${id}-${l.key}`,
      key: l.key,
      delta: l.qty,
      reason: 'compra',
      entryId: id,
      note: entry.folio,
      at: t
    }));
    created = entry;
    return { ...s, movements: [...s.movements, ...movs], stockEntries: [...(s.stockEntries || []), entry] };
  });
  return created;
}

/**
 * Cuadre de inventario: se ingresa lo contado físicamente y el sistema ajusta las diferencias.
 * Queda guardado como lote CUA-0001 con lo que decía el sistema vs lo contado.
 */
export function createStockCount(counts: { key: string; counted: number }[], note = ''): StockEntry | null {
  const clean = counts.filter((c) => c.key && Number.isFinite(c.counted) && c.counted >= 0);
  if (!clean.length) return null;
  let created: StockEntry | null = null;
  update((s) => {
    const { stock } = computeStock(s);
    const t = now();
    const id = uid();
    const lines = clean.map((c) => {
      const before = stock.get(c.key) || 0;
      const after = Math.floor(c.counted);
      return { key: c.key, qty: after - before, before, after };
    });
    const entry: StockEntry = {
      id,
      folio: nextEntryFolio(s, 'cuadre'),
      kind: 'cuadre',
      createdAt: t,
      updatedAt: t,
      note: note.trim(),
      lines
    };
    const movs: Movement[] = lines
      .filter((l) => l.qty !== 0)
      .map((l) => ({
        id: `ent-${id}-${l.key}`,
        key: l.key,
        delta: l.qty,
        reason: 'ajuste',
        entryId: id,
        note: entry.folio,
        at: t
      }));
    created = entry;
    return { ...s, movements: [...s.movements, ...movs], stockEntries: [...(s.stockEntries || []), entry] };
  });
  return created;
}

/** Anula un ingreso/cuadre: sus unidades dejan de contar (se sincroniza a todos los dispositivos). */
export function voidStockEntry(id: string): void {
  const t = now();
  update((s) => ({
    ...s,
    movements: s.movements.filter((m) => m.entryId !== id),
    stockEntries: (s.stockEntries || []).map((e) =>
      e.id === id ? { ...e, deleted: true, updatedAt: Math.max(t, e.updatedAt + 1) } : e
    )
  }));
}

export function addStock(key: string, delta: number): void {
  update((s) => {
    const current = computeStock(s).stock.get(key) || 0;
    const d = Math.max(-current, Math.trunc(delta));
    if (!d) return s;
    const m: Movement = { id: uid(), key, delta: d, reason: d > 0 ? 'compra' : 'ajuste', at: now() };
    return { ...s, movements: [...s.movements, m] };
  });
}

/* ------------------------------ Marcas ------------------------------- */

export function updateBrand(id: string, patch: Partial<Brand>): void {
  const t = now();
  update((s) => ({
    ...s,
    brands: s.brands.map((b) => (b.id === id ? { ...b, ...patch, updatedAt: Math.max(t, (b.updatedAt || 0) + 1) } : b))
  }));
}

export function deleteBrand(id: string): void {
  const t = now();
  update((s) => ({
    ...s,
    brands: s.brands.map((b) => (b.id === id ? { ...b, deleted: true, updatedAt: Math.max(t, (b.updatedAt || 0) + 1) } : b))
  }));
}

export function addBrand(name: string, code: string, seedBaseColors = true): string | null {
  const s = getState();
  const c = code.trim().toUpperCase().slice(0, 4) || name.slice(0, 2).toUpperCase();
  if (!name.trim() || s.brands.some((b) => !b.deleted && (b.code === c || b.name.toLowerCase() === name.trim().toLowerCase()))) return null;
  const t = now();
  const id = `b-${slug(c)}-${uid().slice(0, 4)}`;
  const brand: Brand = {
    id,
    code: c,
    name: name.trim(),
    priceOverride: null,
    cost: 0,
    order: s.brands.length,
    updatedAt: t
  };
  const seededColors: Color[] = [];
  if (seedBaseColors) {
    const usedCodes: string[] = [];
    BASE_COLORS.forEach((bc, ci) => {
      const cc = colorCode(bc.name, usedCodes);
      usedCodes.push(cc);
      seededColors.push({
        id: `c-${c.toLowerCase()}-${slug(bc.name)}-${uid().slice(0, 4)}`,
        brandId: id,
        name: bc.name,
        hex: bc.hex.toUpperCase(),
        code: cc,
        order: ci,
        updatedAt: t
      });
    });
  }
  update((st) => ({
    ...st,
    brands: [...st.brands, brand],
    colors: seededColors.length > 0 ? [...st.colors, ...seededColors] : st.colors
  }));
  return id;
}

export function updateSettings(patch: Partial<Settings>): void {
  const t = now();
  update((s) => ({
    ...s,
    settings: { ...s.settings, ...patch, updatedAt: Math.max(t, (s.settings.updatedAt || 0) + 1) }
  }));
}

/* ------------------------------ Colores ------------------------------ */

export function addColor(name: string, hex: string, brandIds: string[]): { added: number; skipped: number } {
  let added = 0;
  let skipped = 0;
  const cleanName = name.trim();
  const cleanHex = (hex || '#1A1A1C').trim().toUpperCase();
  if (!cleanName || brandIds.length === 0) return { added: 0, skipped: 0 };
  update((s) => {
    const t = now();
    const colors = [...s.colors];
    const newIds: string[] = [];
    for (const bId of brandIds) {
      const existing = colors.filter((c) => c.brandId === bId && !c.deleted);
      if (existing.some((c) => c.name.trim().toLowerCase() === cleanName.toLowerCase())) {
        skipped++;
        continue;
      }
      const brand = s.brands.find((b) => b.id === bId);
      // Reactivar si existía borrado
      const ghost = colors.find((c) => c.brandId === bId && c.deleted && c.name.trim().toLowerCase() === cleanName.toLowerCase());
      if (ghost) {
        const i = colors.indexOf(ghost);
        const reactivated: Color = {
          ...ghost,
          name: cleanName,
          deleted: false,
          hex: cleanHex,
          updatedAt: Math.max(t, (ghost.updatedAt || 0) + 1)
        };
        colors[i] = reactivated;
        newIds.push(reactivated.id);
        added++;
        continue;
      }
      const c: Color = {
        id: `c-${(brand?.code || 'x').toLowerCase()}-${slug(cleanName)}-${uid().slice(0, 4)}`,
        brandId: bId,
        name: cleanName,
        hex: cleanHex,
        code: colorCode(cleanName, existing.map((e) => e.code)),
        order: existing.reduce((m, e) => Math.max(m, e.order), -1) + 1,
        updatedAt: t
      };
      colors.push(c);
      newIds.push(c.id);
      added++;
    }
    if (!added) return s;
    const nextSettings = { ...s.settings };
    if (Array.isArray(nextSettings.storeColorIds) && nextSettings.storeColorIds.length > 0) {
      nextSettings.storeColorIds = Array.from(new Set([...nextSettings.storeColorIds, ...newIds]));
      nextSettings.updatedAt = Math.max(t, (nextSettings.updatedAt || 0) + 1);
    }
    return { ...s, colors, settings: nextSettings };
  });
  return { added, skipped };
}

export function updateColor(id: string, patch: Partial<Color>): void {
  const t = now();
  update((s) => ({
    ...s,
    colors: s.colors.map((c) => {
      if (c.id !== id) return c;
      const nextHex = patch.hex ? patch.hex.trim().toUpperCase() : c.hex;
      const nextName = patch.name !== undefined ? patch.name.trim() || c.name : c.name;
      return {
        ...c,
        ...patch,
        name: nextName,
        hex: nextHex,
        deleted: patch.deleted ?? false,
        updatedAt: Math.max(t, (c.updatedAt || 0) + 1)
      };
    })
  }));
}

export function deleteColor(id: string): void {
  const t = now();
  update((s) => {
    const nextSettings: Settings = { ...s.settings };
    if (Array.isArray(nextSettings.storeColorIds)) {
      nextSettings.storeColorIds = nextSettings.storeColorIds.filter((cid) => cid !== id);
      nextSettings.updatedAt = Math.max(t, (nextSettings.updatedAt || 0) + 1);
    } else {
      delete nextSettings.storeColorIds;
    }
    return {
      ...s,
      colors: s.colors.map((c) =>
        c.id === id ? { ...c, deleted: true, updatedAt: Math.max(t, (c.updatedAt || 0) + 1) } : c
      ),
      settings: nextSettings
    };
  });
}

/* ------------------------------ Clientes ----------------------------- */

export function saveCustomer(c: Customer): void {
  const t = now();
  update((s) => {
    const exists = s.customers.some((x) => x.id === c.id);
    const next = { ...c, deleted: false, updatedAt: Math.max(t, (c.updatedAt || 0) + 1) };
    return { ...s, customers: exists ? s.customers.map((x) => (x.id === c.id ? next : x)) : [...s.customers, next] };
  });
}

export function deleteCustomer(id: string): void {
  const t = now();
  update((s) => ({
    ...s,
    customers: s.customers.map((c) =>
      c.id === id ? { ...c, deleted: true, updatedAt: Math.max(t, (c.updatedAt || 0) + 1) } : c
    )
  }));
}

export function quickCustomer(name: string, phone: string, address: string): Customer {
  const addr: Address = {
    id: uid(),
    label: 'Principal',
    recipient: name.trim(),
    line1: address.trim(),
    city: '',
    department: '',
    reference: '',
    isDefault: true
  };
  const c: Customer = {
    id: uid(),
    name: name.trim(),
    phone: phone.trim(),
    notes: '',
    addresses: address.trim() ? [addr] : [],
    createdAt: now(),
    updatedAt: now()
  };
  saveCustomer(c);
  return c;
}

export function addressText(a: Address | undefined, c?: Pick<Customer, 'name' | 'phone'>): string {
  if (!a) return c ? [c.name, c.phone].filter(Boolean).join('\n') : '';
  const cityLine = [a.city, a.department].filter(Boolean).join(', ');
  return [a.recipient || c?.name, c?.phone, a.line1, cityLine, a.reference ? `Ref: ${a.reference}` : '']
    .filter(Boolean)
    .join('\n');
}

export function addressOneLine(a: Address | undefined): string {
  if (!a) return '';
  return [a.line1, a.city, a.department, a.reference ? `Ref: ${a.reference}` : ''].filter(Boolean).join(', ');
}

/* ------------------------------ Pedidos ------------------------------ */

export interface NewOrderInput {
  lines: CartLine[];
  customer: Customer | null;
  addressId: string | null;
  shipping: number;
  deposit: number;
  paymentMethod: string;
  workType: string;
  notes: string;
  photoId: string | null;
  status: OrderStatus;
  designId?: string | null;
  designName?: string | null;
  designCode?: string | null;
  placement?: Order['placement'];
}

export function nextFolio(s: AppState): number {
  return s.orders.reduce((m, o) => Math.max(m, o.folio), 11000) + 1;
}

export function createOrder(input: NewOrderInput): Order {
  let created!: Order;
  update((s) => {
    const { stock } = computeStock(s);
    const used = new Map<string, number>();
    const t = now();
    const orderId = uid();
    const movements: Movement[] = [];
    const items = input.lines.map((l) => {
      const brand = s.brands.find((b) => b.id === l.brandId);
      const color = s.colors.find((c) => c.id === l.colorId);
      const key = vkey(l.brandId, l.colorId, l.size);
      const avail = Math.max(0, (stock.get(key) || 0) - (used.get(key) || 0));
      const fromStock = input.status === 'borrador' ? 0 : Math.min(avail, l.qty);
      used.set(key, (used.get(key) || 0) + fromStock);
      const itemId = uid();
      if (fromStock > 0) {
        movements.push({ id: `venta-${orderId}-${itemId}`, key, delta: -fromStock, reason: 'venta', orderId, at: t });
      }
      return {
        id: itemId,
        brandId: l.brandId,
        colorId: l.colorId,
        size: l.size,
        qty: l.qty,
        unitPrice: l.unitPrice,
        manualPrice: l.manualPrice,
        fromStock,
        brandName: brand?.name || '',
        colorName: color?.name || '',
        colorHex: color?.hex || '#999999',
        sku: skuOf(brand, color, l.size)
      };
    });
    const subtotal = items.reduce((sum, i) => sum + i.qty * i.unitPrice, 0);
    const total = subtotal + input.shipping;
    const deposit = input.deposit > 0 ? Math.min(input.deposit, total) : total;
    const addr = input.customer?.addresses.find((a) => a.id === input.addressId);
    const shipTo: ShipTo = {
      name: addr?.recipient || input.customer?.name || '',
      phone: input.customer?.phone || '',
      address: addressText(addr ? { ...addr, recipient: '' } : undefined).replace(/^\n+/, '')
    };
    created = {
      id: orderId,
      folio: nextFolio(s),
      status: input.status,
      customerId: input.customer?.id || null,
      addressId: input.addressId,
      shipTo,
      workType: input.workType,
      photoId: input.photoId,
      items,
      subtotal,
      shipping: input.shipping,
      total,
      deposit,
      balance: total - deposit,
      paymentMethod: input.paymentMethod,
      notes: input.notes.trim(),
      carrier: '',
      trackingNumber: '',
      trackingUrl: '',
      whatsappSentAt: null,
      createdAt: t,
      updatedAt: t,
      history: [{ status: input.status, at: t }],
      designId: input.designId || null,
      designName: input.photoId ? input.designName?.trim() || 'Diseño personalizado' : null,
      designCode: input.photoId ? input.designCode?.trim() || null : null,
      placement: input.photoId ? input.placement || 'back' : null,
      guidePhotoId: null
    };
    return { ...s, orders: [...s.orders, created], movements: [...s.movements, ...movements] };
  });
  return created;
}

export function patchOrder(id: string, patch: Partial<Order>): void {
  const t = now();
  update((s) => ({
    ...s,
    orders: s.orders.map((o) =>
      o.id === id ? { ...o, ...patch, updatedAt: Math.max(t, (o.updatedAt || 0) + 1) } : o
    )
  }));
}

export function deleteOrder(id: string): void {
  const t = now();
  update((s) => ({
    ...s,
    orders: s.orders.map((o) =>
      o.id === id ? { ...o, deleted: true, updatedAt: Math.max(t, (o.updatedAt || 0) + 1) } : o
    )
  }));
}

export const STATUS_FLOW: OrderStatus[] = ['borrador', 'en_produccion', 'enviado', 'entregado'];

export const STATUS_LABEL: Record<OrderStatus, string> = {
  borrador: 'Borrador',
  en_produccion: 'En producción',
  enviado: 'Enviado',
  entregado: 'Entregado',
  cancelado: 'Cancelado'
};

/** Cambia el estado. Devuelve un mensaje de error si el candado lo impide. */
export function setOrderStatus(
  id: string,
  status: OrderStatus,
  options?: { returnAsReadyMade?: boolean }
): string | null {
  const o = getState().orders.find((x) => x.id === id);
  if (!o) return 'Pedido no encontrado';
  if (o.status === 'cancelado') return 'El pedido está cancelado';
  if (status === 'entregado' && !o.trackingNumber.trim()) return 'Registra el número de guía antes de marcar como entregado';
  update((s) => {
    const t = now();
    const movements = [...s.movements];
    let readyMadeStock = [...(s.readyMadeStock || [])];
    let items = o.items;
    if (status === 'cancelado') {
      if (options?.returnAsReadyMade) {
        // La camisa ya fue estampada (ej. devolución contra entrega).
        // NO regresa a camisas en blanco para evitar falsas existencias de camisas lisas.
        // Se añade como Prenda Ya Estampada lista para entrega inmediata.
        for (const it of o.items) {
          const dName = o.designName || `${it.brandName} ${it.colorName}` || 'Diseño Personalizado';
          const pId = o.photoId || null;
          readyMadeStock.unshift({
            id: `rms_${t}_${uid().slice(0, 4)}`,
            orderId: o.id,
            brandId: it.brandId,
            brandName: it.brandName,
            colorId: it.colorId,
            colorName: it.colorName,
            colorHex: it.colorHex,
            size: it.size,
            designName: dName,
            designCode: o.designCode || null,
            photoId: pId,
            placement: o.placement || 'back',
            price: it.unitPrice,
            qty: it.qty,
            createdAt: t,
            notes: `Devolución contra entrega (Folio #${o.folio})`
          });
        }
      } else {
        // Camisa lisa o sin estampar: regresa a inventario regular de camisas en blanco
        for (const it of o.items) {
          if (it.fromStock > 0) {
            movements.push({
              id: `cancel-${o.id}-${it.id}`,
              key: vkey(it.brandId, it.colorId, it.size),
              delta: it.fromStock,
              reason: 'cancelacion',
              orderId: o.id,
              at: t
            });
          }
        }
      }
    } else if (status !== 'borrador') {
      // Unidades que se vendieron "bajo pedido": al llegar inventario y avanzar el pedido,
      // se descuentan del stock para que el inventario no quede inflado.
      const { stock } = computeStock({ ...s, movements });
      const used = new Map<string, number>();
      items = o.items.map((it) => {
        const pending = it.qty - (it.fromStock || 0);
        if (pending <= 0) return it;
        const key = vkey(it.brandId, it.colorId, it.size);
        const avail = Math.max(0, (stock.get(key) || 0) - (used.get(key) || 0));
        const take = Math.min(avail, pending);
        if (take <= 0) return it;
        used.set(key, (used.get(key) || 0) + take);
        movements.push({
          id: `venta-${o.id}-${it.id}-extra-${t}`,
          key,
          delta: -take,
          reason: 'venta',
          orderId: o.id,
          note: 'Descuento de unidades bajo pedido',
          at: t
        });
        return { ...it, fromStock: (it.fromStock || 0) + take };
      });
    }
    const dedup = Array.from(new Map(movements.map((m) => [m.id, m])).values());
    return {
      ...s,
      movements: dedup,
      readyMadeStock,
      orders: s.orders.map((x) =>
        x.id === id ? { ...x, items, status, updatedAt: t, history: [...(x.history || []), { status, at: t }] } : x
      )
    };
  });
  return null;
}

export function addReadyMadeShirt(item: Omit<ReadyMadeShirt, 'id' | 'createdAt'>): void {
  const t = now();
  update((s) => {
    const list = s.readyMadeStock || [];
    const newItem: ReadyMadeShirt = {
      ...item,
      id: `rms_${t}_${uid().slice(0, 4)}`,
      createdAt: t,
      updatedAt: t,
      deleted: false
    };
    return { ...s, readyMadeStock: [newItem, ...list] };
  });
}

export function updateReadyMadeShirt(id: string, patch: Partial<ReadyMadeShirt>): void {
  const t = now();
  update((s) => {
    const list = s.readyMadeStock || [];
    const next = list
      .map((r) => (r.id === id ? { ...r, ...patch, updatedAt: Math.max(t, (r.updatedAt || r.createdAt || 0) + 1) } : r))
      .filter((r) => !r.deleted && r.qty > 0);
    return { ...s, readyMadeStock: next };
  });
}

export function removeReadyMadeShirt(id: string, qty = 1): void {
  const t = now();
  update((s) => {
    const list = s.readyMadeStock || [];
    const next = list
      .map((r) => {
        if (r.id !== id) return r;
        const nextQty = Math.max(0, r.qty - qty);
        return {
          ...r,
          qty: nextQty,
          deleted: nextQty <= 0,
          updatedAt: Math.max(t, (r.updatedAt || r.createdAt || 0) + 1)
        };
      })
      .filter((r) => !r.deleted && r.qty > 0);
    return { ...s, readyMadeStock: next };
  });
}

export function markPaid(id: string): void {
  const o = getState().orders.find((x) => x.id === id);
  if (!o) return;
  patchOrder(id, { deposit: o.total, balance: 0 });
}

/* --------------------------- Utilidades UI --------------------------- */

export function brandsAndColors(s: AppState) {
  return activeBrands(s).map((b) => ({ brand: b, colors: brandColors(s, b.id) }));
}

/* --------------------- Diseños del Catálogo 3D ---------------------- */

export function addCatalogDesign(input: {
  name: string;
  photoId: string;
  clientVisible?: boolean;
  placement?: CatalogDesign['placement'];
  code?: string;
}): CatalogDesign {
  const t = now();
  const existing = getState().catalogDesigns || [];
  const maxN = existing.reduce((m, d) => {
    const mm = /^D-(\d+)$/.exec(d.code || '');
    return mm ? Math.max(m, Number(mm[1])) : m;
  }, 0);
  const design: CatalogDesign = {
    id: `cd-${uid()}`,
    name: input.name.trim() || 'Diseño',
    code: input.code?.trim().toUpperCase() || `D-${String(maxN + 1).padStart(3, '0')}`,
    photoId: input.photoId,
    clientVisible: input.clientVisible ?? true,
    placement: input.placement || 'back',
    createdAt: t,
    updatedAt: t
  };
  update((s) => ({
    ...s,
    catalogDesigns: [design, ...(s.catalogDesigns || [])]
  }));
  return design;
}

export function updateCatalogDesign(id: string, patch: Partial<CatalogDesign>): void {
  const t = now();
  update((s) => ({
    ...s,
    catalogDesigns: (s.catalogDesigns || []).map((d) =>
      d.id === id ? { ...d, ...patch, updatedAt: t } : d
    )
  }));
}

export function deleteCatalogDesign(id: string): void {
  const t = now();
  update((s) => ({
    ...s,
    catalogDesigns: (s.catalogDesigns || []).map((d) =>
      d.id === id ? { ...d, deleted: true, updatedAt: t } : d
    )
  }));
}

/**
 * Purga registros basura, marcas semilla vacías sin stock, elementos marcados como eliminados (`deleted: true`),
 * diseños huérfanos sin foto y compacta los movimientos redundantes de inventario.
 */
export function purgeGarbageData(): {
  removedBrands: number;
  removedColors: number;
  removedDesigns: number;
  compactedMovements: number;
} {
  let stats = {
    removedBrands: 0,
    removedColors: 0,
    removedDesigns: 0,
    compactedMovements: 0
  };
  update((s) => {
    const stockInfo = computeStock(s);
    const usedBrandIds = new Set<string>();
    for (const [k, qty] of stockInfo.stock.entries()) {
      if (qty > 0) usedBrandIds.add(k.split('|')[0]);
    }
    for (const o of s.orders) {
      if (!o.deleted) {
        for (const it of o.items) usedBrandIds.add(it.brandId);
      }
    }

    const legacyEmptyBrands = new Set(['b-nx', 'b-pc', 'b-hn']);
    const cleanBrands = s.brands.filter((b) => {
      if (b.deleted) return false;
      if (legacyEmptyBrands.has(b.id) && !usedBrandIds.has(b.id)) return false;
      return true;
    });
    const finalBrands = cleanBrands.length > 0 ? cleanBrands : s.brands.filter((b) => !b.deleted).slice(0, 1);
    const activeBrandSet = new Set(finalBrands.map((b) => b.id));

    const cleanColors = s.colors.filter((c) => !c.deleted && activeBrandSet.has(c.brandId));
    const cleanDesigns = (s.catalogDesigns || []).filter((d) => !d.deleted && !!d.photoId);
    const cleanMovements = compactMovements(s.movements, activeBrandSet);

    stats = {
      removedBrands: s.brands.length - finalBrands.length,
      removedColors: s.colors.length - cleanColors.length,
      removedDesigns: (s.catalogDesigns || []).length - cleanDesigns.length,
      compactedMovements: Math.max(0, s.movements.length - cleanMovements.length)
    };

    try {
      sessionStorage.removeItem('cgs_new_order_draft_v1');
    } catch {}

    return {
      ...s,
      brands: finalBrands,
      colors: cleanColors,
      customers: s.customers.filter((c) => !c.deleted),
      orders: s.orders.filter((o) => !o.deleted),
      movements: cleanMovements,
      catalogDesigns: cleanDesigns,
      readyMadeStock: (s.readyMadeStock || []).filter((r) => !r.deleted && r.qty > 0)
    };
  });
  return stats;
}
