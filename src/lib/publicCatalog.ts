/**
 * CATÁLOGO PÚBLICO (lo único que ve el cliente en #tienda).
 *
 * Seguridad: el cliente NUNCA descarga el estado completo de la tienda (clientes, pedidos,
 * teléfonos, direcciones, costos). Solo recibe esta "vitrina" con colores, tallas, precios
 * de venta, disponibilidad y los diseños marcados como visibles por el administrador.
 */
import type { AppState } from './types';
import type { BoutiqueTheme, DecalPlacement } from '../components/Shirt';
import { activeBrands, brandColors, computeStock, normalPrice, vkey } from './inventory';

export interface SharedCatalogColor {
  id?: string;
  name: string;
  hex: string;
}

export interface SharedCatalogDesignRef {
  id: string;
  name: string;
  code?: string;
  campaign?: string;
  photoId: string;
  placement: DecalPlacement;
}

export interface SharedCatalogPayload {
  storeName: string;
  storePhone: string;
  brandId?: string;
  brandName: string;
  colors: SharedCatalogColor[];
  sizes: string[];
  /** Precio camisa lisa (sin estampado) en centavos */
  priceNormal: number;
  /** Precio camisa personalizada (con estampado A3) en centavos */
  priceCustom?: number;
  priceWholesale: number;
  wholesaleMin: number;
  photoId: string | null;
  placement: DecalPlacement;
  scale: number;
  offsetX?: number;
  offsetY: number;
  boutiqueTheme?: BoutiqueTheme;
  /** Campaña activa enviada por WhatsApp (ej. 'Ranchero', 'Turístico', 'Cristiana' o 'all') */
  activeCampaign?: string;
  designs?: SharedCatalogDesignRef[];
  /** Disponibilidad por `${colorId}|${talla}` (solo cantidades, sin costos). */
  stock?: Record<string, number>;
  publishedAt?: number;
}

export interface CustomerWebOrderPayload {
  id: string;
  createdAt: number;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  brandId?: string;
  brandName: string;
  colorId?: string;
  colorName: string;
  colorHex: string;
  size: string;
  qty: number;
  unitPrice: number;
  designId?: string | null;
  designName?: string | null;
  designCode?: string | null;
  photoId?: string | null;
  /** Miniatura ligera (DataURL) del diseño para verse al instante en Taller y Pedidos */
  designThumb?: string | null;
  campaign?: string | null;
  placement: DecalPlacement;
  scale: number;
}

export const LIVE_CATALOG_KEY = 'cat_live';
export const WEB_ORDER_LATEST_KEY = 'weborder_latest';

/** Construye la vitrina pública a partir del estado del administrador. */
export function buildPublicCatalog(state: AppState): SharedCatalogPayload {
  const st = state.settings;
  const brands = activeBrands(state);
  const brand = brands.find((b) => b.id === st.storeBrandId) || brands[0];
  const allColors = brand ? brandColors(state, brand.id) : [];
  const chosen = st.storeColorIds && st.storeColorIds.length > 0
    ? allColors.filter((c) => st.storeColorIds!.includes(c.id))
    : allColors;
  const colors = chosen.length > 0 ? chosen : allColors;
  const chosenSizes = st.storeSizes && st.storeSizes.length > 0
    ? st.sizes.filter((sz) => st.storeSizes!.includes(sz))
    : st.sizes;
  const sizes = chosenSizes.length > 0 ? chosenSizes : st.sizes;
  const { stock } = computeStock(state);
  const stockMap: Record<string, number> = {};
  if (brand) {
    for (const c of colors) {
      for (const sz of sizes) {
        const n = stock.get(vkey(brand.id, c.id, sz)) || 0;
        if (n > 0) stockMap[`${c.id}|${sz}`] = n;
      }
    }
  }
  const designs = (state.catalogDesigns || [])
    .filter((d) => !d.deleted && d.clientVisible && d.photoId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((d) => ({
      id: d.id,
      name: d.name,
      code: d.code,
      campaign: d.campaign,
      photoId: d.photoId,
      placement: (d.placement || 'back') as DecalPlacement
    }));

  return {
    storeName: st.storeName,
    storePhone: st.storePhone,
    brandId: brand?.id,
    brandName: brand?.name || 'Camisa',
    colors: colors.length > 0
      ? colors.map((c) => ({ id: c.id, name: c.name, hex: c.hex }))
      : [{ name: 'Negro', hex: '#1A1A1C' }],
    sizes,
    priceNormal: normalPrice(st, brand),
    priceCustom: st.priceCustom || 35000,
    priceWholesale: normalPrice(st, brand),
    wholesaleMin: 999999,
    photoId: null,
    placement: 'back',
    scale: 2.0,
    offsetX: 0,
    offsetY: 0,
    boutiqueTheme: st.storeTheme || 'ranchero',
    activeCampaign: st.activeCampaign || 'all',
    designs,
    stock: stockMap
  };
}

/** Sanea un pedido web recibido (datos escritos por un visitante anónimo). */
export function sanitizeWebOrder(raw: unknown): CustomerWebOrderPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
  const num = (v: unknown, min: number, max: number, def: number) => {
    const n = typeof v === 'number' && isFinite(v) ? v : def;
    return Math.min(max, Math.max(min, n));
  };
  const id = str(o.id, 40);
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(id)) return null;
  const placement = (['center', 'pocket', 'full', 'back'] as const).includes(o.placement as DecalPlacement)
    ? (o.placement as DecalPlacement)
    : 'back';
  const rawThumb = typeof o.designThumb === 'string' && o.designThumb.startsWith('data:image/')
    ? o.designThumb.slice(0, 350_000)
    : null;
  return {
    id,
    createdAt: num(o.createdAt, 0, Date.now() + 86400000, Date.now()),
    customerName: str(o.customerName, 80),
    customerPhone: str(o.customerPhone, 24),
    customerAddress: str(o.customerAddress, 300),
    brandId: str(o.brandId, 60) || undefined,
    brandName: str(o.brandName, 60),
    colorId: str(o.colorId, 80) || undefined,
    colorName: str(o.colorName, 60),
    colorHex: /^#[0-9A-Fa-f]{6}$/.test(str(o.colorHex, 7)) ? str(o.colorHex, 7) : '#999999',
    size: str(o.size, 8),
    qty: Math.round(num(o.qty, 1, 500, 1)),
    unitPrice: Math.round(num(o.unitPrice, 0, 10_000_000, 0)),
    designId: str(o.designId, 60) || null,
    designName: str(o.designName, 60) || null,
    designCode: str(o.designCode, 20) || null,
    photoId: str(o.photoId, 60) || null,
    designThumb: rawThumb,
    campaign: str(o.campaign, 40) || null,
    placement,
    scale: num(o.scale, 0.3, 4, 2.0)
  };
}
