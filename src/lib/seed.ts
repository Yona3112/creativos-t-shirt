import type { AppState, Brand, Color, Settings } from './types';
import { colorCode, slug } from './ids';

export const BASE_COLORS: { name: string; hex: string }[] = [
  { name: 'Negro', hex: '#111827' },
  { name: 'Blanco', hex: '#F9FAFB' },
  { name: 'Azul Marino', hex: '#1E3A8A' },
  { name: 'Gris Jaspe', hex: '#6B7280' },
  { name: 'Rojo', hex: '#DC2626' },
  { name: 'Verde Militar', hex: '#3F6212' },
  { name: 'Beige Arena', hex: '#E5D3B3' },
  { name: 'Vino', hex: '#7F1D1D' }
];

export const QUICK_PALETTE: { name: string; hex: string }[] = [
  { name: 'Naranja', hex: '#EA580C' },
  { name: 'Rojo', hex: '#DC2626' },
  { name: 'Mostaza', hex: '#CA8A04' },
  { name: 'Amarillo', hex: '#FACC15' },
  { name: 'Azul Rey', hex: '#2563EB' },
  { name: 'Celeste', hex: '#38BDF8' },
  { name: 'Turquesa', hex: '#0D9488' },
  { name: 'Verde Botella', hex: '#064E3B' },
  { name: 'Rosado', hex: '#F472B6' },
  { name: 'Morado', hex: '#7C3AED' },
  { name: 'Café', hex: '#78350F' },
  { name: 'Gris Carbón', hex: '#374151' }
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
  carriers: ['Cargo Expreso', 'C807 Express', 'Forza Delivery', 'Rápido Cargo', '504 Express', 'Entrega Local (Copán)'],
  paymentMethods: ['Transferencia BAC', 'Transferencia Atlántida', 'Transferencia Ficohsa', 'Efectivo', 'Contra Entrega'],
  workTypes: ['DTF Frontal', 'DTF Frente y Espalda', 'Camisa Lisa', 'Bordado', 'Vinil / Sublimación'],
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
