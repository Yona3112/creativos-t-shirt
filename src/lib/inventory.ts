import type { AppState, Brand, CartLine, Cents, Color, Order, Settings } from './types';

export const vkey = (brandId: string, colorId: string, size: string) => `${brandId}|${colorId}|${size}`;

export interface StockInfo {
  stock: Map<string, number>;
  /** variantes que alguna vez recibieron stock (compra / ajuste positivo) */
  everStocked: Set<string>;
}

export function computeStock(state: AppState): StockInfo {
  const stock = new Map<string, number>();
  const everStocked = new Set<string>();
  for (const m of state.movements) {
    stock.set(m.key, (stock.get(m.key) || 0) + m.delta);
    if (m.delta > 0 && (m.reason === 'compra' || m.reason === 'ajuste')) everStocked.add(m.key);
  }
  for (const [k, v] of stock) if (v < 0) stock.set(k, 0);
  return { stock, everStocked };
}

export function activeBrands(state: AppState): Brand[] {
  return state.brands.filter((b) => !b.deleted).sort((a, b) => a.order - b.order);
}

export function brandColors(state: AppState, brandId: string): Color[] {
  return state.colors.filter((c) => c.brandId === brandId && !c.deleted).sort((a, b) => a.order - b.order);
}

export function skuOf(brand: Brand | undefined, color: Color | undefined, size: string): string {
  return `${brand?.code || 'XX'}-${color?.code || 'XXX'}-${size}`;
}

export function normalPrice(settings: Settings, brand?: Brand): Cents {
  return brand && brand.priceOverride !== null && brand.priceOverride !== undefined
    ? brand.priceOverride
    : (settings.priceNormal || 30000);
}

export function customPrice(settings: Settings): Cents {
  return settings.priceCustom || 35000;
}

export function isWholesale(_settings: Settings, _totalQty: number): boolean {
  // Desactivado descuento automático por volumen a petición del usuario
  return false;
}

export function tierPrice(settings: Settings, brand: Brand | undefined, _totalQty: number): Cents {
  return normalPrice(settings, brand);
}

/** Precios del carrito respetan precio unitario unificado (sin descuento automático por volumen). */
export function repriceCart(lines: CartLine[], settings: Settings, brands: Brand[]): CartLine[] {
  return lines.map((l) => {
    if (l.manualPrice) return l;
    const p = tierPrice(settings, brands.find((b) => b.id === l.brandId), l.qty);
    return p === l.unitPrice ? l : { ...l, unitPrice: p };
  });
}

export function orderUnits(o: Order): number {
  return o.items.reduce((s, i) => s + i.qty, 0);
}

export interface LowVariant {
  key: string;
  brand: Brand;
  color: Color;
  size: string;
  stock: number;
}

export function lowStockList(state: AppState, info: StockInfo): LowVariant[] {
  const out: LowVariant[] = [];
  for (const brand of activeBrands(state)) {
    for (const color of brandColors(state, brand.id)) {
      for (const size of state.settings.sizes) {
        const key = vkey(brand.id, color.id, size);
        if (!info.everStocked.has(key)) continue;
        const stock = info.stock.get(key) || 0;
        if (stock <= state.settings.lowStock) out.push({ key, brand, color, size, stock });
      }
    }
  }
  return out.sort((a, b) => a.stock - b.stock);
}

/** Texto legible (negro/blanco) sobre un color de fondo. */
export function contrastText(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#111827' : '#ffffff';
}
