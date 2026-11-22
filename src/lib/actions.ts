import type { Address, AppState, Brand, CartLine, CatalogDesign, Color, Customer, Movement, MovementReason, Order, OrderStatus, ReadyMadeShirt, Settings, ShipTo, StockEntry } from './types';
import { getState, update } from './store';
import { uid, colorCode, slug } from './ids';
import { activeBrands, brandColors, computeStock, skuOf, vkey } from './inventory';
import { normalize } from './merge';
import { BASE_COLORS } from './seed';

const now = () => Date.now();

/* ----------------------------- Inventario ----------------------------- */

export function setStockAbsolute(key: string, target: number, reason: MovementReason = 'ajuste'): void {
  const t = Math.floor(Number(target) || 0);
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
    if (lines.every((l) => l.qty === 0)) {
      return s;
    }
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
    const d = Math.trunc(delta);
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
  /** Datos cuando se factura como Consumidor Final o cliente de mostrador sin guardarlo en CRM */
  walkIn?: { name: string; phone?: string; address?: string } | null;
  shipping: number;
  deposit: number;
  /** Si true, el cliente paga después en tienda (anticipo explícito L 0) */
  paymentPending?: boolean;
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
    const t = now();
    const orderId = uid();
    const movements: Movement[] = [];
    const items = input.lines.map((l) => {
      const brand = s.brands.find((b) => b.id === l.brandId);
      const color = s.colors.find((c) => c.id === l.colorId);
      const key = vkey(l.brandId, l.colorId, l.size);
      // Descontar siempre todas las unidades facturadas (aunque quede en negativo por ser "bajo pedido")
      // para que al ingresar nueva mercadería el inventario cuadre automáticamente (-2 + 10 = 8).
      const fromStock = input.status === 'borrador' ? 0 : l.qty;
      const itemId = uid();
      if (fromStock > 0) {
        movements.push({ id: `venta-${orderId}-${itemId}`, key, delta: -fromStock, reason: 'venta', orderId, at: t });
      }
      const itemDesignId = l.designId || (l.photo ? input.designId : null) || null;
      const itemDesignName = l.designName || (l.photo ? input.designName : null) || null;
      const itemDesignCode = l.designCode || (l.photo ? input.designCode : null) || null;
      const itemPhotoId = l.photoId || (l.photo ? input.photoId : null) || null;
      const itemPlacement = l.placement || (l.photo ? input.placement : null) || null;

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
        sku: skuOf(brand, color, l.size),
        designId: itemDesignId,
        designName: itemDesignName,
        designCode: itemDesignCode,
        photoId: itemPhotoId,
        photoUrl: l.photo && !l.photo.startsWith('data:') ? l.photo : null,
        placement: itemPlacement
      };
    });
    const subtotal = items.reduce((sum, i) => sum + i.qty * i.unitPrice, 0);
    const total = subtotal + input.shipping;
    const deposit = input.paymentPending ? 0 : input.deposit > 0 ? Math.min(input.deposit, total) : total;
    const addr = input.customer?.addresses.find((a) => a.id === input.addressId);
    const shipTo: ShipTo = {
      name: addr?.recipient || input.customer?.name || input.walkIn?.name || '',
      phone: input.customer?.phone || input.walkIn?.phone || '',
      address:
        addressText(addr ? { ...addr, recipient: '' } : undefined).replace(/^\n+/, '') ||
        input.walkIn?.address ||
        ''
    };

    const uniqueDesignNames = Array.from(
      new Set(items.map((i) => i.designName?.trim()).filter((x): x is string => Boolean(x)))
    );
    const resolvedDesignName =
      uniqueDesignNames.length > 0
        ? uniqueDesignNames.join(' + ')
        : input.photoId
        ? input.designName?.trim() || 'Diseño personalizado'
        : null;

    const firstItemWithPhoto = items.find((i) => i.photoId);
    const resolvedPhotoId = firstItemWithPhoto?.photoId || input.photoId || null;
    const firstItemWithDesignId = items.find((i) => i.designId);
    const resolvedDesignId = firstItemWithDesignId?.designId || input.designId || null;
    const firstItemWithPlacement = items.find((i) => i.placement);
    const resolvedPlacement = firstItemWithPlacement?.placement || input.placement || (input.photoId ? 'back' : null);

    created = {
      id: orderId,
      folio: nextFolio(s),
      status: input.status,
      customerId: input.customer?.id || null,
      addressId: input.addressId,
      shipTo,
      workType: input.workType,
      photoId: resolvedPhotoId,
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
      designId: resolvedDesignId,
      designName: resolvedDesignName,
      designCode: input.designCode?.trim() || null,
      placement: resolvedPlacement,
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

export function updateOrderDetails(
  id: string,
  patch: Partial<Order> & { items: Order['items'] }
): void {
  const t = now();
  update((s) => {
    const existing = s.orders.find((o) => o.id === id);
    if (!existing) return s;
    const activeStockOrder = existing.status !== 'cancelado' && existing.status !== 'borrador';
    const movements = [...s.movements];
    let reconciledItems = patch.items;

    if (activeStockOrder) {
      // Devolver stock de prendas que fueron eliminadas al editar el pedido
      const nextIds = new Set(patch.items.map((x) => x.id));
      for (const removedIt of existing.items) {
        if (!nextIds.has(removedIt.id) && (removedIt.fromStock || 0) > 0) {
          movements.push({
            id: `edit-rem-${id}-${removedIt.id}-${t}`,
            key: vkey(removedIt.brandId, removedIt.colorId, removedIt.size),
            delta: removedIt.fromStock,
            reason: 'ajuste',
            orderId: id,
            note: 'Prenda quitada al editar pedido',
            at: t
          });
        }
      }

      reconciledItems = patch.items.map((nextIt, idx) => {
        const prevIt = existing.items.find((x) => x.id === nextIt.id);
        const prevFrom = Math.max(0, prevIt?.fromStock || 0);
        const key = vkey(nextIt.brandId, nextIt.colorId, nextIt.size);
        const prevKey = prevIt ? vkey(prevIt.brandId, prevIt.colorId, prevIt.size) : null;

        // Si cambió de color/talla/marca, devolver la variante anterior y tomar de la nueva
        if (prevIt && prevKey && prevKey !== key) {
          if (prevFrom > 0) {
            movements.push({
              id: `edit-swap-ret-${id}-${nextIt.id}-${t}-${idx}`,
              key: prevKey,
              delta: prevFrom,
              reason: 'ajuste',
              orderId: id,
              note: 'Cambio de color/talla al editar pedido',
              at: t
            });
          }
          const take = nextIt.qty;
          if (take > 0) {
            movements.push({
              id: `edit-swap-take-${id}-${nextIt.id}-${t}-${idx}`,
              key,
              delta: -take,
              reason: 'venta',
              orderId: id,
              note: 'Nueva variante al editar pedido',
              at: t
            });
          }
          return { ...nextIt, fromStock: take };
        }

        if (nextIt.qty < prevFrom) {
          const ret = prevFrom - nextIt.qty;
          movements.push({
            id: `edit-ret-${id}-${nextIt.id}-${t}-${idx}`,
            key,
            delta: ret,
            reason: 'ajuste',
            orderId: id,
            note: 'Edición de cantidad en pedido',
            at: t
          });
          return { ...nextIt, fromStock: nextIt.qty };
        }

        if (nextIt.qty > prevFrom) {
          const take = nextIt.qty - prevFrom;
          if (take > 0) {
            movements.push({
              id: `edit-add-${id}-${nextIt.id}-${t}-${idx}`,
              key,
              delta: -take,
              reason: 'venta',
              orderId: id,
              note: prevIt ? 'Aumento de cantidad en pedido' : 'Prenda agregada al editar pedido',
              at: t
            });
          }
          return { ...nextIt, fromStock: prevFrom + take };
        }

        return { ...nextIt, fromStock: prevFrom };
      });
    }

    return {
      ...s,
      movements,
      orders: s.orders.map((o) =>
        o.id === id
          ? { ...o, ...patch, items: reconciledItems, updatedAt: Math.max(t, (o.updatedAt || 0) + 1) }
          : o
      )
    };
  });
}

export function deleteOrder(id: string): void {
  const t = now();
  update((s) => {
    const hasReadyMadeFromOrder = (s.readyMadeStock || []).some(
      (r) => !r.deleted && r.qty > 0 && r.orderId === id
    );
    return {
      ...s,
      movements: hasReadyMadeFromOrder ? s.movements : s.movements.filter((m) => m.orderId !== id),
      orders: s.orders.map((o) =>
        o.id === id ? { ...o, deleted: true, updatedAt: Math.max(t, (o.updatedAt || 0) + 1) } : o
      )
    };
  });
}

export function orderStockReturnCount(order: Order): number {
  if (order.status === 'cancelado' || order.status === 'borrador') return 0;
  return order.items.reduce((sum, it) => sum + Math.max(0, it.fromStock || 0), 0);
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
  if (o.status === 'borrador' && status !== 'borrador' && status !== 'cancelado') {
    const nameStr = (o.shipTo?.name || '').trim();
    const lowerName = nameStr.toLowerCase();
    const isConsumidorFinal = lowerName.includes('consumidor final') || lowerName === 'mostrador';
    const rawDigits = (o.shipTo?.phone || '').replace(/\D/g, '');
    const localDigits = rawDigits.startsWith('504') && rawDigits.length >= 11 ? rawDigits.slice(3) : rawDigits;
    if (!nameStr || (!isConsumidorFinal && localDigits.length < 8)) {
      return 'Candado: edita el pedido y registra nombre + teléfono (mín. 8 dígitos) o "Consumidor Final" antes de pasarlo a producción';
    }
  }
  if (status === 'entregado' && !o.trackingNumber.trim()) return 'Registra el número de guía antes de marcar como entregado';
  update((s) => {
    const t = now();
    const currentOrder = s.orders.find((x) => x.id === id) || o;
    const movements = [...s.movements];
    let readyMadeStock = [...(s.readyMadeStock || [])];
    let items = currentOrder.items;
    if (status === 'cancelado') {
      if (options?.returnAsReadyMade) {
        // La camisa ya fue estampada (ej. devolución contra entrega).
        // NO regresa a camisas en blanco para evitar falsas existencias de camisas lisas.
        // Se añade como Prenda Ya Estampada lista para entrega inmediata.
        const anyItemHasDesign = currentOrder.items.some((x) =>
          Boolean(x.designName || x.photoId || x.designId)
        );
        for (const it of currentOrder.items) {
          const isPlainMixedItem = anyItemHasDesign && !it.designName && !it.photoId && !it.designId;
          const dName = isPlainMixedItem
            ? `${it.brandName} ${it.colorName} (Lisa)`
            : it.designName ||
              currentOrder.designName ||
              `${it.brandName} ${it.colorName}` ||
              'Diseño Personalizado';
          const dCode = isPlainMixedItem ? 'LISA' : it.designCode || currentOrder.designCode || null;
          const pId = isPlainMixedItem ? null : it.photoId || currentOrder.photoId || null;
          const place = isPlainMixedItem ? null : it.placement || currentOrder.placement || 'back';
          readyMadeStock.unshift({
            id: `rms_${t}_${uid().slice(0, 4)}`,
            orderId: currentOrder.id,
            brandId: it.brandId,
            brandName: it.brandName,
            colorId: it.colorId,
            colorName: it.colorName,
            colorHex: it.colorHex,
            size: it.size,
            designName: dName,
            designCode: dCode,
            photoId: pId,
            placement: place,
            price: it.unitPrice,
            qty: it.qty,
            createdAt: t,
            notes: `Devolución contra entrega (Folio #${currentOrder.folio})`
          });
        }
      } else {
        // Camisa lisa o sin estampar: regresa a inventario regular de camisas en blanco
        for (const it of currentOrder.items) {
          if (it.fromStock > 0) {
            movements.push({
              id: `cancel-${currentOrder.id}-${it.id}`,
              key: vkey(it.brandId, it.colorId, it.size),
              delta: it.fromStock,
              reason: 'cancelacion',
              orderId: currentOrder.id,
              at: t
            });
          }
        }
      }
    } else if (status === 'borrador' && currentOrder.status !== 'borrador') {
      // Si un pedido activo se regresa a borrador, devolvemos las camisas reservadas en blanco al inventario
      for (const it of currentOrder.items) {
        if (it.fromStock > 0) {
          movements.push({
            id: `draft-ret-${currentOrder.id}-${it.id}-${t}`,
            key: vkey(it.brandId, it.colorId, it.size),
            delta: it.fromStock,
            reason: 'ajuste',
            orderId: currentOrder.id,
            note: 'Pedido regresado a borrador',
            at: t
          });
        }
      }
      items = currentOrder.items.map((it) => ({ ...it, fromStock: 0 }));
    } else if (status !== 'borrador') {
      // Unidades pendientes de descontar (ej. al pasar de borrador a producción o pedidos previos bajo pedido):
      // se descuentan completas (aunque quede en negativo) para cuadrar automáticamente al ingresar inventario.
      items = currentOrder.items.map((it) => {
        const pending = it.qty - (it.fromStock || 0);
        if (pending <= 0) return it;
        const key = vkey(it.brandId, it.colorId, it.size);
        const take = pending;
        movements.push({
          id: `venta-${currentOrder.id}-${it.id}-extra-${t}`,
          key,
          delta: -take,
          reason: 'venta',
          orderId: currentOrder.id,
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

/**
 * Reconcilia pedidos activos en producción que hayan sido facturados antes sin descontar
 * unidades "bajo pedido" (`fromStock < qty`), dejándolos reflejados en el inventario (en negativo si aplica).
 */
export function reconcileBackorderStock(): number {
  let fixedUnits = 0;
  update((s) => {
    const t = now();
    const movements = [...s.movements];
    const existingIds = new Set(movements.map((m) => m.id));
    let changed = false;

    const orders = s.orders.map((o) => {
      if (o.deleted || o.status !== 'en_produccion') return o;
      let orderChanged = false;
      const items = o.items.map((it) => {
        const pending = it.qty - (it.fromStock || 0);
        if (pending <= 0) return it;
        const movId = `venta-${o.id}-${it.id}-bo`;
        if (!existingIds.has(movId)) {
          movements.push({
            id: movId,
            key: vkey(it.brandId, it.colorId, it.size),
            delta: -pending,
            reason: 'venta',
            orderId: o.id,
            note: `Bajo pedido #${o.folio}`,
            at: o.createdAt || t
          });
          existingIds.add(movId);
        }
        fixedUnits += pending;
        orderChanged = true;
        changed = true;
        return { ...it, fromStock: it.qty };
      });
      if (!orderChanged) return o;
      return { ...o, items, updatedAt: Math.max(t, (o.updatedAt || 0) + 1) };
    });

    if (!changed) return s;
    return { ...s, orders, movements };
  });
  return fixedUnits;
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
    const next = list.map((r) => {
      if (r.id !== id) return r;
      const merged = { ...r, ...patch };
      return {
        ...merged,
        deleted: merged.deleted || merged.qty <= 0,
        updatedAt: Math.max(t, (r.updatedAt || r.createdAt || 0) + 1)
      };
    });
    return { ...s, readyMadeStock: next };
  });
}

export function removeReadyMadeShirt(id: string, qty = 1): void {
  const t = now();
  update((s) => {
    const list = s.readyMadeStock || [];
    const next = list.map((r) => {
      if (r.id !== id) return r;
      const nextQty = Math.max(0, r.qty - qty);
      return {
        ...r,
        qty: nextQty,
        deleted: nextQty <= 0,
        updatedAt: Math.max(t, (r.updatedAt || r.createdAt || 0) + 1)
      };
    });
    return { ...s, readyMadeStock: next };
  });
}

export function sellReadyMadeShirt(input: {
  readyMadeId: string;
  qty: number;
  unitPrice: number;
  customerName: string;
  customerPhone?: string;
  paymentMethod: string;
}): Order | null {
  let created: Order | null = null;
  const t = now();
  update((s) => {
    const list = s.readyMadeStock || [];
    const target = list.find((r) => r.id === input.readyMadeId && !r.deleted && r.qty > 0);
    if (!target) return s;
    const sellQty = Math.max(1, Math.min(target.qty, Math.floor(input.qty || 1)));
    const unitPrice = Math.max(0, input.unitPrice);
    const total = sellQty * unitPrice;
    const brand = s.brands.find((b) => b.id === target.brandId);
    const color = s.colors.find((c) => c.id === target.colorId);
    const orderId = uid();
    const itemId = uid();
    const isPlain = target.designCode === 'LISA';
    const resolvedPlacement = (isPlain ? null : target.placement || 'back') as Order['placement'];

    const newOrder: Order = {
      id: orderId,
      folio: nextFolio(s),
      status: 'entregado',
      customerId: null,
      addressId: null,
      shipTo: {
        name: input.customerName.trim() || 'Consumidor Final',
        phone: (input.customerPhone || '').trim(),
        address: ''
      },
      workType: isPlain ? 'Lisa' : 'Con diseño',
      photoId: target.photoId || null,
      items: [
        {
          id: itemId,
          brandId: target.brandId,
          colorId: target.colorId,
          size: target.size,
          qty: sellQty,
          unitPrice,
          manualPrice: true,
          fromStock: 0,
          brandName: target.brandName || brand?.name || '',
          colorName: target.colorName || color?.name || '',
          colorHex: target.colorHex || color?.hex || '#111827',
          sku: skuOf(brand, color, target.size),
          designId: null,
          designName: isPlain ? null : target.designName,
          designCode: isPlain ? null : target.designCode || null,
          photoId: target.photoId || null,
          photoUrl: null,
          placement: resolvedPlacement
        }
      ],
      subtotal: total,
      shipping: 0,
      total,
      deposit: total,
      balance: 0,
      paymentMethod: input.paymentMethod || s.settings.paymentMethods[0] || 'Efectivo',
      notes: `Venta de Prenda Ya Estampada en stock (${target.designName})`,
      carrier: 'Entrega inmediata',
      trackingNumber: 'TIENDA',
      trackingUrl: '',
      whatsappSentAt: null,
      createdAt: t,
      updatedAt: t,
      history: [{ status: 'entregado', at: t }],
      designId: null,
      designName: isPlain ? null : target.designName,
      designCode: isPlain ? null : target.designCode || null,
      placement: resolvedPlacement,
      guidePhotoId: null
    };
    created = newOrder;

    const nextReady = list.map((r) => {
      if (r.id !== target.id) return r;
      const nextQty = Math.max(0, r.qty - sellQty);
      return {
        ...r,
        qty: nextQty,
        deleted: nextQty <= 0,
        updatedAt: Math.max(t, (r.updatedAt || r.createdAt || 0) + 1)
      };
    });

    return {
      ...s,
      readyMadeStock: nextReady,
      orders: [...s.orders, newOrder]
    };
  });
  return created;
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
  campaign?: string;
  code?: string;
  tone?: CatalogDesign['tone'];
  allowedColorMode?: CatalogDesign['allowedColorMode'];
  allowedColorIds?: string[];
}): CatalogDesign {
  const t = now();
  const existing = getState().catalogDesigns || [];
  // Evitar duplicar el mismo archivo de diseño si ya existe activo con el mismo photoId
  const samePhoto = existing.find((d) => !d.deleted && d.photoId === input.photoId);
  if (samePhoto) {
    const updated: CatalogDesign = {
      ...samePhoto,
      name: input.name.trim() || samePhoto.name,
      clientVisible: input.clientVisible ?? samePhoto.clientVisible,
      placement: input.placement || samePhoto.placement,
      campaign: input.campaign || samePhoto.campaign,
      tone: input.tone ?? samePhoto.tone,
      allowedColorMode: input.allowedColorMode || samePhoto.allowedColorMode || 'all',
      allowedColorIds:
        input.allowedColorIds && input.allowedColorIds.length > 0
          ? input.allowedColorIds
          : samePhoto.allowedColorIds,
      updatedAt: t
    };
    update((s) => ({
      ...s,
      catalogDesigns: (s.catalogDesigns || []).map((d) => (d.id === samePhoto.id ? updated : d))
    }));
    return updated;
  }

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
    campaign: input.campaign || 'all',
    tone: input.tone,
    allowedColorMode: input.allowedColorMode || 'all',
    allowedColorIds: input.allowedColorIds && input.allowedColorIds.length > 0 ? input.allowedColorIds : undefined,
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
 * Purga registros basura, unifica tallas/colores/marcas/diseños/clientes duplicados,
 * remapea sus movimientos/pedidos y compacta movimientos redundantes de inventario.
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
    // 1. Ejecutar normalize(s) que deduplica y remapea marcas, colores, tallas y diseños
    const norm = normalize(s);

    // 2. Deduplicar clientes activos con el mismo teléfono (últimos 8 dígitos) y nombre
    const customerRemap = new Map<string, string>();
    const customerByKey = new Map<string, Customer>();
    const activeCustomers = norm.customers.filter((c) => !c.deleted);
    for (const c of activeCustomers) {
      const digits = (c.phone || '').replace(/\D/g, '').slice(-8);
      const nameKey = (c.name || '').trim().toLowerCase();
      const key = digits.length >= 8 ? `tel:${digits}` : `name:${nameKey}`;
      const prev = customerByKey.get(key);
      if (!prev) {
        customerByKey.set(key, c);
      } else {
        customerRemap.set(c.id, prev.id);
        const mergedAddrs = [...prev.addresses];
        for (const a of c.addresses || []) {
          if (!mergedAddrs.some((x) => x.line1.trim().toLowerCase() === a.line1.trim().toLowerCase())) {
            mergedAddrs.push({ ...a, isDefault: mergedAddrs.length === 0 });
          }
        }
        customerByKey.set(key, {
          ...prev,
          addresses: mergedAddrs,
          updatedAt: Math.max(prev.updatedAt || 0, c.updatedAt || 0)
        });
      }
    }
    const cleanCustomers = Array.from(customerByKey.values());

    const activeColorsOnly = norm.colors.filter((c) => !c.deleted);
    const activeDesignsOnly = (norm.catalogDesigns || []).filter((d) => !d.deleted && !!d.photoId);
    const cleanOrders = norm.orders
      .filter((o) => !o.deleted)
      .map((o) =>
        o.customerId && customerRemap.has(o.customerId)
          ? { ...o, customerId: customerRemap.get(o.customerId)! }
          : o
      );

    stats = {
      removedBrands: Math.max(0, s.brands.filter((b) => !b.deleted).length - norm.brands.length),
      removedColors: Math.max(0, s.colors.filter((c) => !c.deleted).length - activeColorsOnly.length),
      removedDesigns: Math.max(
        0,
        (s.catalogDesigns || []).filter((d) => !d.deleted).length - activeDesignsOnly.length
      ),
      compactedMovements: Math.max(
        0,
        s.movements.length - norm.movements.length + (activeCustomers.length - cleanCustomers.length)
      )
    };

    try {
      sessionStorage.removeItem('cgs_new_order_draft_v1');
    } catch {}

    return {
      ...norm,
      colors: norm.colors,
      customers: cleanCustomers,
      orders: cleanOrders,
      catalogDesigns: norm.catalogDesigns
    };
  });
  return stats;
}
