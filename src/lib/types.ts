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
}

export interface Movement {
  id: string;
  key: string; // brandId|colorId|size
  delta: number;
  reason: MovementReason;
  orderId?: string;
  note?: string;
  at: number;
}

export interface Settings {
  updatedAt: number;
  storeName: string;
  storePhone: string;
  storeAddress: string;
  storeCity: string;
  sizes: string[];
  priceNormal: Cents;
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
}

export interface AppState {
  version: 1;
  settings: Settings;
  brands: Brand[];
  colors: Color[];
  customers: Customer[];
  orders: Order[];
  movements: Movement[];
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
}

export type SyncStatus = 'local' | 'connecting' | 'live' | 'syncing' | 'offline' | 'error';

export type Section =
  | 'inicio'
  | 'vender'
  | 'taller'
  | 'inventario'
  | 'marcas'
  | 'pedidos'
  | 'clientes'
  | 'reportes'
  | 'ajustes';
