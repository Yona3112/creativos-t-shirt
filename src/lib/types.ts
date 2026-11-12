export type Cents = number;

export type OrderStatus = 'borrador' | 'en_produccion' | 'enviado' | 'entregado' | 'cancelado';

export type MovementReason = 'compra' | 'venta' | 'ajuste' | 'devolucion' | 'cancelacion' | 'merma';

export interface Entity {
  id: string;
  updatedAt: number;
  deleted?: boolean;
}

export interface Brand extends Entity {
  code: string;
  name: string;
  /** Precio normal propio de la marca; null = usa el precio general. */
  priceOverride: Cents | null;
  cost: Cents;
  order: number;
}

export interface Color extends Entity {
  brandId: string;
  name: string;
  hex: string;
  code: string;
  order: number;
}

export interface Address {
  id: string;
  label: string;
  recipient: string;
  line1: string;
  city: string;
  department: string;
  reference: string;
  isDefault: boolean;
}

export interface Customer extends Entity {
  name: string;
  phone: string;
  notes: string;
  addresses: Address[];
  createdAt: number;
}

export interface OrderItem {
  id: string;
  brandId: string;
  colorId: string;
  size: string;
  qty: number;
  unitPrice: Cents;
  manualPrice: boolean;
  /** Unidades que se descontaron del inventario (el resto es bajo pedido). */
  fromStock: number;
  brandName: string;
  colorName: string;
  colorHex: string;
  sku: string;
  /** Diseño individual de este ítem (para pedidos con múltiples diseños) */
  designId?: string | null;
  designName?: string | null;
  designCode?: string | null;
  photoId?: string | null;
  photoUrl?: string | null;
  placement?: 'center' | 'pocket' | 'full' | 'back' | null;
}

export interface ShipTo {
  name: string;
  phone: string;
  address: string;
}

export interface Order extends Entity {
  folio: number;
  status: OrderStatus;
  customerId: string | null;
  addressId: string | null;
  shipTo: ShipTo;
  workType: string;
  photoId: string | null;
  items: OrderItem[];
  subtotal: Cents;
  shipping: Cents;
  total: Cents;
  deposit: Cents;
  balance: Cents;
  paymentMethod: string;
  notes: string;
  carrier: string;
  trackingNumber: string;
  trackingUrl: string;
  whatsappSentAt: number | null;
  createdAt: number;
  history: { status: OrderStatus; at: number }[];
  /** Diseño del catálogo vendido (para reportes de estilos más vendidos) */
  designId?: string | null;
  designName?: string | null;
  designCode?: string | null;
  /** Ubicación del estampado */
  placement?: 'center' | 'pocket' | 'full' | 'back' | null;
  /** Foto / PDF de la guía de envío subida por la tienda */
  guidePhotoId?: string | null;
}

export interface Movement {
  id: string;
  key: string; // brandId|colorId|size
  delta: number;
  reason: MovementReason;
  orderId?: string;
  /** Ingreso o cuadre de inventario al que pertenece (no se compacta) */
  entryId?: string;
  note?: string;
  at: number;
}

export interface StockEntryLine {
  key: string;
  /** Unidades que entraron (ingreso) o diferencia aplicada (cuadre) */
  qty: number;
  /** Existencia en sistema justo antes */
  before: number;
  /** Existencia que quedó después */
  after: number;
}

/** Ingreso de mercadería o cuadre (conteo físico) registrado como lote aparte. */
export interface StockEntry extends Entity {
  folio: string;
  kind: 'ingreso' | 'cuadre';
  createdAt: number;
  note: string;
  lines: StockEntryLine[];
}

export interface Settings {
  updatedAt: number;
  storeName: string;
  storePhone: string;
  storeAddress: string;
  storeCity: string;
  sizes: string[];
  /** Precio camisa lisa / básica (L 300) */
  priceNormal: Cents;
  /** Precio camisa personalizada con diseño estampado (L 350) */
  priceCustom?: Cents;
  priceWholesale: Cents;
  wholesaleMin: number;
  shipping: Cents;
  lowStock: number;
  carriers: string[];
  paymentMethods: string[];
  workTypes: string[];
  waConfirm: string;
  waShipped: string;
  waReady: string;
  /** Fondo de la Tienda 3D que ve el cliente (solo lo cambia el administrador) */
  storeTheme?: 'ranchero' | 'establo' | 'nocturno' | 'arena';
  /** Marca, colores y tallas que se muestran en la Tienda 3D pública */
  storeBrandId?: string;
  storeColorIds?: string[];
  storeSizes?: string[];
  /** Campañas disponibles para agrupar y enviar por WhatsApp (ej. Ranchero, Turístico, Cristiana) */
  campaigns?: string[];
  /** Campaña activa seleccionada para publicar en #tienda */
  activeCampaign?: string;
}

export interface CatalogDesign extends Entity {
  name: string;
  /** Código corto para reportes (ej. D-001) */
  code?: string;
  /** Campaña o colección a la que pertenece (ej. Ranchero, Turístico, Cristiana) */
  campaign?: string;
  /** Destacado manualmente como Más Vendido / Top */
  featured?: boolean;
  photoId: string;
  /** Si es true, el cliente lo ve disponible al editar la camisa 3D */
  clientVisible: boolean;
  /** Ubicación predeterminada ('center' | 'pocket' | 'full' | 'back') */
  placement: 'center' | 'pocket' | 'full' | 'back';
  createdAt: number;
}

export interface ReadyMadeShirt {
  id: string;
  orderId?: string;
  brandId: string;
  brandName: string;
  colorId: string;
  colorName: string;
  colorHex: string;
  size: string;
  designName: string;
  designCode?: string | null;
  photoId?: string | null;
  placement?: string | null;
  price: Cents;
  qty: number;
  createdAt: number;
  updatedAt?: number;
  deleted?: boolean;
  notes?: string;
}

export interface AppState {
  version: 1;
  settings: Settings;
  brands: Brand[];
  colors: Color[];
  customers: Customer[];
  orders: Order[];
  movements: Movement[];
  catalogDesigns?: CatalogDesign[];
  readyMadeStock?: ReadyMadeShirt[];
  stockEntries?: StockEntry[];
  /** dispositivo que hizo la última escritura y cuándo */
  _by?: string;
  _at?: number;
}

export interface CartLine {
  id: string;
  brandId: string;
  colorId: string;
  size: string;
  qty: number;
  unitPrice: Cents;
  manualPrice: boolean;
  /** Diseño individual para esta prenda */
  designId?: string | null;
  designName?: string | null;
  designCode?: string | null;
  photo?: string | null;
  rawPhoto?: string | null;
  photoId?: string | null;
  placement?: 'center' | 'pocket' | 'full' | 'back' | null;
  scale?: number;
  offsetX?: number;
  offsetY?: number;
  workType?: string;
}

export type SyncStatus = 'local' | 'connecting' | 'live' | 'syncing' | 'offline' | 'error';

export type Section =
  | 'inicio'
  | 'vender'
  | 'catalogo'
  | 'taller'
  | 'inventario'
  | 'marcas'
  | 'pedidos'
  | 'clientes'
  | 'reportes'
  | 'ajustes';
