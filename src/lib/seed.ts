import type { AppState, Brand, Color, Settings } from './types';
import { colorCode, slug } from './ids';

/**
 * Colores reales de tela (referencia Bella+Canvas 3001 / Next Level 3600),
 * en lugar de los tonos genéricos de pantalla.
 */
export const BASE_COLORS: { name: string; hex: string }[] = [
  { name: 'Negro', hex: '#1A1A1C' },
  { name: 'Blanco', hex: '#F4F3EE' },
  { name: 'Azul Marino', hex: '#232B3E' },
  { name: 'Gris Jaspe', hex: '#A3A4A6' },
  { name: 'Rojo', hex: '#B5172E' },
  { name: 'Verde Militar', hex: '#585C3B' },
  { name: 'Beige Arena', hex: '#D9C4A1' },
  { name: 'Vino', hex: '#5A1F2C' }
];

/** Tonos genéricos anteriores → se reemplazan automáticamente por los colores reales. */
export const LEGACY_COLOR_HEX: Record<string, string> = {
  '#111827': '#1A1A1C',
  '#F9FAFB': '#F4F3EE',
  '#1E3A8A': '#232B3E',
  '#6B7280': '#A3A4A6',
  '#DC2626': '#B5172E',
  '#3F6212': '#585C3B',
  '#E5D3B3': '#D9C4A1',
  '#7F1D1D': '#5A1F2C'
};

export const QUICK_PALETTE: { name: string; hex: string }[] = [
  { name: 'Naranja Atardecer', hex: '#E0602A' },
  { name: 'Mostaza', hex: '#C9962E' },
  { name: 'Amarillo Maíz', hex: '#EDC14F' },
  { name: 'Azul Rey', hex: '#1F4C9A' },
  { name: 'Celeste Bebé', hex: '#9CBFDE' },
  { name: 'Turquesa Profundo', hex: '#0E6E73' },
  { name: 'Verde Bosque', hex: '#24402F' },
  { name: 'Verde Olivo', hex: '#6B6B3A' },
  { name: 'Rosa Palo', hex: '#E9B3BF' },
  { name: 'Morado Uva', hex: '#45306E' },
  { name: 'Café Cuero', hex: '#6F4428' },
  { name: 'Chocolate', hex: '#3E2A20' },
  { name: 'Terracota', hex: '#A6513A' },
  { name: 'Hueso / Crema', hex: '#EBE3D0' },
  { name: 'Gris Carbón', hex: '#3C3C3F' }
];

const BASE_BRANDS: { code: string; name: string; cost: number }[] = [
  { code: 'BC', name: 'Bella+Canvas', cost: 15000 },
  { code: 'NX', name: 'Next Apparel', cost: 14500 },
  { code: 'PC', name: 'Pacer', cost: 11500 },
  { code: 'HN', name: 'HN', cost: 9500 }
];

export const DEFAULT_SETTINGS: Settings = {
  updatedAt: 0,
  storeName: 'Creativos Gift Shop',
  storePhone: '',
  storeAddress: 'La Entrada',
  storeCity: 'Copán, Honduras',
  sizes: ['XS', 'S', 'M', 'L', 'XL', '2XL'],
  priceNormal: 30000,
  priceWholesale: 19500,
  wholesaleMin: 24,
  shipping: 11000,
  lowStock: 5,
  carriers: ['Boxful', 'Cargo Expreso', 'C807 Express', 'Forza Delivery', 'Rápido Cargo', '504 Express', 'Entrega Local (Copán)'],
  paymentMethods: ['Transferencia BAC', 'Transferencia Atlántida', 'Transferencia Ficohsa', 'Efectivo', 'Contra Entrega'],
  workTypes: ['DTF Espalda', 'DTF Frontal', 'DTF Frente y Espalda', 'Camisa Lisa', 'Bordado', 'Vinil / Sublimación'],
  storeTheme: 'ranchero',
  waConfirm:
    '¡Hola {cliente}! 👋 Recibimos tu pedido {folio} en {tienda}.\n\nPrendas: {unidades}\nTotal: {total}\nSaldo pendiente: {saldo}\n\n¡Gracias por tu compra! 🙌',
  waShipped:
    '¡Hola {cliente}! 👋 Tu pedido {folio} de {tienda} ya va en camino 🚚\n\nTransportista: {transportista}\nGuía: {guia}\n{rastreo}\nTotal: {total}\nSaldo pendiente: {saldo}\n\n¡Gracias por tu compra! 🙌',
  waReady:
    '¡Hola {cliente}! 👋 Tu pedido {folio} de {tienda} ya está listo ✅\n\nTotal: {total}\nSaldo pendiente: {saldo}\n\n¡Gracias por tu compra! 🙌'
};

export function brandId(code: string): string {
  return `b-${code.toLowerCase()}`;
}

export function seedColorsFor(brand: Brand, list = BASE_COLORS): Color[] {
  const taken: string[] = [];
  return list.map((c, i) => {
    const code = colorCode(c.name, taken);
    taken.push(code);
    return {
      id: `c-${brand.code.toLowerCase()}-${slug(c.name)}`,
      brandId: brand.id,
      name: c.name,
      hex: c.hex,
      code,
      order: i,
      updatedAt: 0
    };
  });
}

export function createInitialState(): AppState {
  const brands: Brand[] = BASE_BRANDS.map((b, i) => ({
    id: brandId(b.code),
    code: b.code,
    name: b.name,
    priceOverride: null,
    cost: b.cost,
    order: i,
    updatedAt: 0
  }));
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    brands,
    colors: brands.flatMap((b) => seedColorsFor(b)),
    customers: [],
    orders: [],
    movements: [],
    catalogDesigns: []
  };
}
