import type { Address, AppState, Brand, CartLine, Color, Customer, Movement, MovementReason, Order, OrderStatus, Settings, ShipTo } from './types';
import { getState, update } from './store';
import { uid, colorCode, slug } from './ids';
import { activeBrands, brandColors, computeStock, skuOf, vkey } from './inventory';

const now = () => Date.now();

/* ----------------------------- Inventario ----------------------------- */

export function setStockAbsolute(key: string, target: number, reason: MovementReason = 'ajuste'): void {
  const t = Math.max(0, Math.floor(target || 0));
  update((s) => {
    const current = computeStock(s).stock.get(key) || 0;
    const delta = t - current;
    if (!delta) return s;
    const m: Movement = { id: uid(), key, delta, reason, at: now() };
    return { ...s, movements: [...s.movements, m] };
  });
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
  update((s) => ({ ...s, brands: s.brands.map((b) => (b.id === id ? { ...b, ...patch, updatedAt: now() } : b)) }));
}

export function addBrand(name: string, code: string): string | null {
  const s = getState();
  const c = code.trim().toUpperCase().slice(0, 4) || name.slice(0, 2).toUpperCase();
  if (!name.trim() || s.brands.some((b) => !b.deleted && (b.code === c || b.name.toLowerCase() === name.trim().toLowerCase()))) return null;
  const id = `b-${slug(c)}-${uid().slice(0, 4)}`;
  const brand: Brand = {
    id,
    code: c,
    name: name.trim(),
    priceOverride: null,
    cost: 0,
    order: s.brands.length,
    updatedAt: now()
  };
  update((st) => ({ ...st, brands: [...st.brands, brand] }));
  return id;
}

export function updateSettings(patch: Partial<Settings>): void {
  update((s) => ({ ...s, settings: { ...s.settings, ...patch, updatedAt: now() } }));
}

/* ------------------------------ Colores ------------------------------ */

export function addColor(name: string, hex: string, brandIds: string[]): { added: number; skipped: number } {
  let added = 0;
  let skipped = 0;
  update((s) => {
    const colors = [...s.colors];
    for (const bId of brandIds) {
      const existing = colors.filter((c) => c.brandId === bId && !c.deleted);
      if (existing.some((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase())) {
        skipped++;
        continue;
      }
      const brand = s.brands.find((b) => b.id === bId);
      // reactivar si existía borrado
      const ghost = colors.find((c) => c.brandId === bId && c.deleted && c.name.toLowerCase() === name.trim().toLowerCase());
      if (ghost) {
        const i = colors.indexOf(ghost);
        colors[i] = { ...ghost, deleted: false, hex: hex.toUpperCase(), updatedAt: now() };
        added++;
        continue;
      }
      const c: Color = {
        id: `c-${(brand?.code || 'x').toLowerCase()}-${slug(name)}-${uid().slice(0, 4)}`,
        brandId: bId,
        name: name.trim(),
        hex: hex.toUpperCase(),
        code: colorCode(name, existing.map((e) => e.code)),
        order: existing.reduce((m, e) => Math.max(m, e.order), -1) + 1,
        updatedAt: now()
      };
      colors.push(c);
      added++;
    }
    return added ? { ...s, colors } : s;
  });
  return { added, skipped };
}

export function updateColor(id: string, patch: Partial<Color>): void {
  update((s) => ({ ...s, colors: s.colors.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: now() } : c)) }));
}

/* ------------------------------ Clientes ----------------------------- */

export function saveCustomer(c: Customer): void {
  update((s) => {
    const exists = s.customers.some((x) => x.id === c.id);
    const next = { ...c, updatedAt: now() };
    return { ...s, customers: exists ? s.customers.map((x) => (x.id === c.id ? next : x)) : [...s.customers, next] };
  });
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
      const fromStock = Math.min(avail, l.qty);
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
      history: [{ status: input.status, at: t }]
    };
    return { ...s, orders: [...s.orders, created], movements: [...s.movements, ...movements] };
  });
  return created;
}

export function patchOrder(id: string, patch: Partial<Order>): void {
  update((s) => ({ ...s, orders: s.orders.map((o) => (o.id === id ? { ...o, ...patch, updatedAt: now() } : o)) }));
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
export function setOrderStatus(id: string, status: OrderStatus): string | null {
  const o = getState().orders.find((x) => x.id === id);
  if (!o) return 'Pedido no encontrado';
  if (o.status === 'cancelado') return 'El pedido está cancelado';
  if (status === 'entregado' && !o.trackingNumber.trim()) return 'Registra el número de guía antes de marcar como entregado';
  update((s) => {
    const t = now();
    const movements = [...s.movements];
    if (status === 'cancelado') {
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
    const dedup = Array.from(new Map(movements.map((m) => [m.id, m])).values());
    return {
      ...s,
      movements: dedup,
      orders: s.orders.map((x) =>
        x.id === id ? { ...x, status, updatedAt: t, history: [...(x.history || []), { status, at: t }] } : x
      )
    };
  });
  return null;
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
