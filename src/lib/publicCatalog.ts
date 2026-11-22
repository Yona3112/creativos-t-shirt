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
  soldCount?: number;
  featured?: boolean;
  photoId: string;
  placement: DecalPlacement;
  tone?: 'dark' | 'light' | 'mixed';
  allowedColorMode?: 'all' | 'light_fabrics' | 'dark_fabrics' | 'custom';
  allowedColorIds?: string[];
}

export const DEFAULT_CAMPAIGNS = ['Ranchero', 'Turístico', 'Cristiana'] as const;

export type MockupSceneId = 'ranchero' | 'cristiana' | 'turistico';

export function campaignSlug(name: string): string {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function campaignsMatch(a?: string | null, b?: string | null): boolean {
  const sa = campaignSlug(a || '');
  const sb = campaignSlug(b || '');
  return Boolean(sa) && sa === sb;
}

export function resolveCampaignName(
  raw: string | null | undefined,
  knownCampaigns: readonly string[] = DEFAULT_CAMPAIGNS
): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  const pool = [...knownCampaigns, ...DEFAULT_CAMPAIGNS];
  const hit = pool.find((c) => campaignsMatch(c, trimmed));
  if (hit) return hit;
  const slug = campaignSlug(trimmed);
  if (!slug) return trimmed;
  if (/[-\s_]/.test(trimmed) && !/[A-ZÁÉÍÓÚÑ]/.test(trimmed)) {
    return trimmed
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (ch) => ch.toUpperCase());
  }
  return trimmed;
}

function matchSceneKeyword(value?: string | null): MockupSceneId | null {
  const slug = campaignSlug(value || '');
  if (!slug || slug === 'all' || slug === 'todas' || slug === 'todos') return null;
  if (/(cristian|fe|iglesia|dios|biblia|adoracion|evangel)/.test(slug)) return 'cristiana';
  if (/(turist|honduras|playa|roatan|copan|viaj|caribe|catrach|isla)/.test(slug)) return 'turistico';
  if (/(ranch|vaquer|ganad|caball|western|montur|finca)/.test(slug)) return 'ranchero';
  return null;
}

export function resolveMockupScene(
  campaign?: string | null,
  designCampaign?: string | null,
  fallback: MockupSceneId = 'ranchero'
): MockupSceneId {
  const cSlug = campaignSlug(campaign || '');
  const isScoped = Boolean(campaign && cSlug && cSlug !== 'all' && cSlug !== 'todas' && cSlug !== 'todos');
  if (isScoped) {
    return matchSceneKeyword(campaign) || matchSceneKeyword(designCampaign) || fallback;
  }
  return matchSceneKeyword(designCampaign) || fallback;
}

export function parseStorefrontHash(hash: string): {
  isPublic: boolean;
  campaign: string | null;
  legacyToken: string | null;
} {
  const h = (hash || '').replace(/^#\/?/, '').trim();
  if (!h) {
    return { isPublic: false, campaign: null, legacyToken: null };
  }

  const legacyMatch = h.match(/^catalogo=([A-Za-z0-9_-]+)/);
  if (legacyMatch) {
    return { isPublic: true, campaign: null, legacyToken: legacyMatch[1] };
  }

  const isStorefront =
    h === 'tienda' ||
    h.startsWith('tienda/') ||
    h.startsWith('tienda?') ||
    h === 'catalogo' ||
    h.startsWith('catalogo/') ||
    h.startsWith('catalogo?') ||
    h.startsWith('c=');

  if (!isStorefront) {
    return { isPublic: false, campaign: null, legacyToken: null };
  }

  let rawCamp: string | null = null;
  const campQuery = h.match(/[?&]camp=([^&#]+)/);
  if (campQuery && campQuery[1]) {
    try {
      rawCamp = decodeURIComponent(campQuery[1].replace(/\+/g, ' '));
    } catch {
      rawCamp = campQuery[1];
    }
  } else {
    const pathPart = h.split('?')[0];
    const segMatch = pathPart.match(/^(?:tienda|catalogo)\/([^/]+)/i);
    if (segMatch && segMatch[1]) {
      try {
        rawCamp = decodeURIComponent(segMatch[1]);
      } catch {
        rawCamp = segMatch[1];
      }
    }
  }

  const normalizedCamp = rawCamp ? rawCamp.trim() : null;
  const campKey = normalizedCamp ? campaignSlug(normalizedCamp) : '';
  const campaign =
    normalizedCamp && campKey && campKey !== 'all' && campKey !== 'todas' && campKey !== 'todos'
      ? normalizedCamp
      : null;

  return { isPublic: true, campaign, legacyToken: null };
}

export function buildThemeShareUrl(originAndPath: string, campaign?: string | null): string {
  const base = `${originAndPath}#tienda`;
  const slug = campaignSlug(campaign || '');
  if (!campaign || !slug || slug === 'all' || slug === 'todas' || slug === 'todos') {
    return base;
  }
  return `${base}/${slug}`;
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
  /** Lista de campañas/temáticas publicadas */
  campaigns?: string[];
  /** Campaña activa enviada por WhatsApp (ej. 'Ranchero', 'Turístico', 'Cristiana' o 'all') */
  activeCampaign?: string;
  /** True cuando el cliente abrió un link dedicado a una temática específica */
  lockedCampaign?: boolean;
  designs?: SharedCatalogDesignRef[];
  /** Disponibilidad por `${colorId}|${talla}` (solo cantidades, sin costos). */
  stock?: Record<string, number>;
  /** Formas de pago disponibles en el catálogo público */
  paymentMethods?: string[];
  publishedAt?: number;
}

export const DEFAULT_CATALOG_PAYMENT_METHODS: string[] = [
  'Transferencia Bancaria',
  'Efectivo en Tienda',
  'Pago Contra Entrega',
  'Pago Pendiente al Recoger',
  'Tarjeta / Link de Pago'
];

export interface CustomerWebOrderItem {
  id: string;
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
  designThumb?: string | null;
  placement?: DecalPlacement;
  scale?: number;
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
  /** Preferencia de pago cuando encarga desde la tienda pública */
  paymentMethod?: string | null;
  paymentPending?: boolean;
  placement: DecalPlacement;
  scale: number;
  /** Múltiples prendas con sus respectivos diseños cuando el cliente pide más de 1 */
  items?: CustomerWebOrderItem[];
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
  const rawSizes = chosenSizes.length > 0 ? chosenSizes : st.sizes;
  const sizes = Array.from(new Set(rawSizes.map((sz) => (sz || '').trim().toUpperCase()).filter(Boolean)));
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
  // Calcular unidades vendidas por diseño en pedidos reales (prenda por prenda)
  const soldByDesign = new Map<string, number>();
  const activeCatalogDesigns = (state.catalogDesigns || []).filter((d) => !d.deleted);
  const addSoldDesign = (dId?: string | null, dCode?: string | null, dName?: string | null, qty = 1) => {
    if (qty <= 0) return;
    if (dId && activeCatalogDesigns.some((d) => d.id === dId)) {
      soldByDesign.set(dId, (soldByDesign.get(dId) || 0) + qty);
      return;
    }
    if (dCode || dName) {
      const match = activeCatalogDesigns.find(
        (d) =>
          (dCode && d.code && d.code.toLowerCase() === dCode.toLowerCase()) ||
          (dName && d.name.toLowerCase() === dName.toLowerCase())
      );
      if (match) {
        soldByDesign.set(match.id, (soldByDesign.get(match.id) || 0) + qty);
      }
    }
  };

  for (const o of state.orders || []) {
    if (o.deleted || o.status === 'cancelado' || o.status === 'borrador') continue;
    if (o.items && o.items.length > 0) {
      const anyItemHasDesign = o.items.some((x) =>
        Boolean(x.designId || x.designCode || x.designName || x.photoId)
      );
      for (const it of o.items) {
        const itemHasOwnDesign = Boolean(it.designId || it.designCode || it.designName || it.photoId);
        if (anyItemHasDesign && !itemHasOwnDesign) continue; // Prenda lisa dentro de pedido mixto
        addSoldDesign(
          it.designId || (!anyItemHasDesign ? o.designId : null),
          it.designCode || (!anyItemHasDesign ? o.designCode : null),
          it.designName || (!anyItemHasDesign ? o.designName : null),
          it.qty || 1
        );
      }
    } else {
      addSoldDesign(o.designId, o.designCode, o.designName, 1);
    }
  }

  const designs = (state.catalogDesigns || [])
    .filter((d) => !d.deleted && d.clientVisible && d.photoId)
    .map((d) => ({
      id: d.id,
      name: d.name,
      code: d.code,
      campaign: d.campaign,
      soldCount: soldByDesign.get(d.id) || 0,
      featured: Boolean(d.featured),
      photoId: d.photoId,
      placement: (d.placement || 'back') as DecalPlacement,
      tone: d.tone,
      allowedColorMode: d.allowedColorMode,
      allowedColorIds: d.allowedColorIds,
      createdAt: d.createdAt || 0
    }))
    .sort((a, b) => {
      if (a.featured !== b.featured) return a.featured ? -1 : 1;
      if ((b.soldCount || 0) !== (a.soldCount || 0)) return (b.soldCount || 0) - (a.soldCount || 0);
      return b.createdAt - a.createdAt;
    })
    .map(({ createdAt: _c, ...rest }) => rest);

  const mergedPaymentMethods = Array.from(
    new Set([
      ...(st.paymentMethods || []).map((m) => m.trim()).filter(Boolean),
      ...DEFAULT_CATALOG_PAYMENT_METHODS
    ])
  );

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
    campaigns:
      st.campaigns && st.campaigns.length > 0
        ? Array.from(new Set(st.campaigns))
        : [...DEFAULT_CAMPAIGNS],
    activeCampaign: 'all',
    designs,
    stock: stockMap,
    paymentMethods: mergedPaymentMethods
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
  const rawItems = Array.isArray(o.items)
    ? o.items.map((it: unknown) => {
        if (!it || typeof it !== 'object') return null;
        const i = it as Record<string, unknown>;
        const iPlacement = (['center', 'pocket', 'full', 'back'] as const).includes(i.placement as DecalPlacement)
          ? (i.placement as DecalPlacement)
          : placement;
        const iThumb = typeof i.designThumb === 'string' && i.designThumb.startsWith('data:image/')
          ? i.designThumb.slice(0, 350_000)
          : null;
        return {
          id: str(i.id, 40) || String(Math.random()),
          brandId: str(i.brandId, 60) || undefined,
          brandName: str(i.brandName, 60),
          colorId: str(i.colorId, 80) || undefined,
          colorName: str(i.colorName, 60),
          colorHex: /^#[0-9A-Fa-f]{6}$/.test(str(i.colorHex, 7)) ? str(i.colorHex, 7) : '#999999',
          size: str(i.size, 8) || 'M',
          qty: Math.round(num(i.qty, 1, 500, 1)),
          unitPrice: Math.round(num(i.unitPrice, 0, 10_000_000, 0)),
          designId: str(i.designId, 60) || null,
          designName: str(i.designName, 60) || null,
          designCode: str(i.designCode, 20) || null,
          photoId: str(i.photoId, 60) || null,
          designThumb: iThumb,
          placement: iPlacement,
          scale: num(i.scale, 0.3, 4, 2.0)
        } as CustomerWebOrderItem;
      }).filter((x): x is CustomerWebOrderItem => Boolean(x))
    : undefined;

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
    paymentMethod: str(o.paymentMethod, 60) || null,
    paymentPending: Boolean(o.paymentPending),
    placement,
    scale: num(o.scale, 0.3, 4, 2.0),
    items: rawItems && rawItems.length > 0 ? rawItems : undefined
  };
}
