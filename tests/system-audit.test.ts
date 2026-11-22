import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  addCatalogDesign,
  createOrder,
  createStockCount,
  createStockEntry,
  deleteOrder,
  markPaid,
  orderStockReturnCount,
  purgeGarbageData,
  reconcileBackorderStock,
  sellReadyMadeShirt,
  setOrderStatus,
  setStockAbsolute,
  updateOrderDetails,
  voidStockEntry
} from '../src/lib/actions';
import {
  computeStock,
  lowColorStockList,
  negativeStockList,
  vkey
} from '../src/lib/inventory';
import { compactMovements, mergeStates, normalize } from '../src/lib/merge';
import {
  buildPublicCatalog,
  buildThemeShareUrl,
  campaignsMatch,
  DEFAULT_CAMPAIGNS,
  parseStorefrontHash,
  resolveCampaignName,
  resolveMockupScene
} from '../src/lib/publicCatalog';
import {
  isWebPreviewPhotoId,
  WEB_PREVIEW_SUFFIX,
  webPreviewPhotoId
} from '../src/lib/image';
import { createInitialState } from '../src/lib/seed';
import { getState, replaceState, update } from '../src/lib/store';
import { dayKey } from '../src/lib/time';
import type { CartLine } from '../src/lib/types';

const BRAND_ID = 'b-bc';
const COLOR_BLACK = 'c-bc-negro';
const COLOR_WHITE = 'c-bc-blanco';
const KEY_M = vkey(BRAND_ID, COLOR_BLACK, 'M');
const KEY_L = vkey(BRAND_ID, COLOR_BLACK, 'L');
const KEY_WHITE_M = vkey(BRAND_ID, COLOR_WHITE, 'M');

function makeCartLine(overrides: Partial<CartLine> = {}): CartLine {
  return {
    id: `line-${Math.random().toString(36).slice(2, 8)}`,
    brandId: BRAND_ID,
    colorId: COLOR_BLACK,
    size: 'M',
    qty: 1,
    unitPrice: 35000,
    manualPrice: false,
    designId: null,
    designName: 'RANCHO',
    designCode: 'D-001',
    photo: null,
    rawPhoto: null,
    placement: 'back',
    scale: 2.0,
    offsetX: 0,
    offsetY: 0,
    workType: 'DTF Espalda',
    ...overrides
  };
}

function stockOf(key: string): number {
  return computeStock(getState()).stock.get(key) || 0;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  replaceState(createInitialState());
});

test('1. Venta con stock suficiente descuenta exacto y conserva existencias', () => {
  setStockAbsolute(KEY_M, 10);
  const o = createOrder({
    lines: [makeCartLine({ qty: 3 })],
    customer: null,
    addressId: null,
    walkIn: { name: 'Consumidor Final', phone: 'Consumidor Final' },
    shipping: 11000,
    deposit: 116000,
    paymentMethod: 'Efectivo',
    workType: 'DTF Espalda',
    notes: '',
    photoId: null,
    status: 'en_produccion'
  });

  assert.equal(o.items[0].fromStock, 3);
  assert.equal(stockOf(KEY_M), 7);
});

test('2. Venta con stock parcial entra en negativo y no contamina alertas positivas', () => {
  setStockAbsolute(KEY_M, 2);
  createOrder({
    lines: [makeCartLine({ qty: 5 })],
    customer: null,
    addressId: null,
    walkIn: { name: 'Juan Pérez', phone: '+504 9999-1111' },
    shipping: 0,
    deposit: 175000,
    paymentMethod: 'Efectivo',
    workType: 'DTF Espalda',
    notes: '',
    photoId: null,
    status: 'en_produccion'
  });

  assert.equal(stockOf(KEY_M), -3);
  const info = computeStock(getState());
  const negs = negativeStockList(getState(), info);
  assert.equal(negs.length, 1);
  assert.equal(negs[0].stock, -3);
  assert.equal(negs[0].needed, 3);

  const lows = lowColorStockList(getState(), info);
  assert.equal(lows.length, 0);
});

test('3. Venta bajo pedido desde 0 (-2) cuadra exactamente tras ingreso posterior (+10 => 8)', () => {
  createOrder({
    lines: [makeCartLine({ qty: 2 })],
    customer: null,
    addressId: null,
    walkIn: { name: 'Cliente Encargo', phone: '+504 8888-7777' },
    shipping: 0,
    deposit: 70000,
    paymentMethod: 'Efectivo',
    workType: 'DTF Espalda',
    notes: '',
    photoId: null,
    status: 'en_produccion'
  });

  assert.equal(stockOf(KEY_M), -2);
  const entry = createStockEntry([{ key: KEY_M, qty: 10 }], 'Lote proveedor');
  assert.ok(entry);
  assert.equal(entry.folio, 'ING-0001');
  assert.equal(entry.lines[0].before, -2);
  assert.equal(entry.lines[0].qty, 10);
  assert.equal(entry.lines[0].after, 8);
  assert.equal(stockOf(KEY_M), 8);
});

test('4. Ingreso con fecha personalizada se sella en el día seleccionado para Había (Antes)', () => {
  const yesterday = Date.now() - 86400000;
  const entry = createStockEntry([{ key: KEY_M, qty: 12 }], 'Ingreso ayer', yesterday);
  assert.ok(entry);
  assert.equal(dayKey(entry.createdAt), dayKey(yesterday));
  const mov = getState().movements.find((m) => m.entryId === entry.id);
  assert.ok(mov);
  assert.equal(dayKey(mov.at), dayKey(yesterday));
  assert.ok(entry.updatedAt >= yesterday);
});

test('5. Cuadre Físico preserva pedidos en negativo (-2) cuando conteo físico es 0 y suma hallazgos reales', () => {
  createOrder({
    lines: [makeCartLine({ qty: 2 })],
    customer: null,
    addressId: null,
    walkIn: { name: 'Pedido Backorder', phone: '+504 9999-2222' },
    shipping: 0,
    deposit: 70000,
    paymentMethod: 'Efectivo',
    workType: 'DTF Espalda',
    notes: '',
    photoId: null,
    status: 'en_produccion'
  });

  // 0 en estante con -2 pedidos => cuadra exacto, no borra deuda de pedidos
  const noop = createStockCount([{ key: KEY_M, counted: 0 }], 'Conteo en estante');
  assert.equal(noop, null);
  assert.equal(stockOf(KEY_M), -2);

  // Llegan 10 camisas luego -> deben quedar 8 disponibles
  createStockEntry([{ key: KEY_M, qty: 10 }], 'Compra proveedor');
  assert.equal(stockOf(KEY_M), 8);

  // Nuevo escenario: si había -2 y sí encuentran 5 camisas físicas en estante -> -2 + 5 = 3
  setStockAbsolute(KEY_L, 0);
  createOrder({
    lines: [makeCartLine({ size: 'L', qty: 2 })],
    customer: null,
    addressId: null,
    walkIn: { name: 'Pedido L', phone: '+504 9999-3333' },
    shipping: 0,
    deposit: 70000,
    paymentMethod: 'Efectivo',
    workType: 'DTF Espalda',
    notes: '',
    photoId: null,
    status: 'en_produccion'
  });
  assert.equal(stockOf(KEY_L), -2);
  const found = createStockCount([{ key: KEY_L, counted: 5 }], 'Aparecieron 5 en estante');
  assert.ok(found);
  assert.equal(found.lines[0].qty, 5);
  assert.equal(found.lines[0].before, -2);
  assert.equal(found.lines[0].after, 3);
  assert.equal(stockOf(KEY_L), 3);
});

test('6. Cuadre Físico con faltante o sobrante registra CUA-XXXX y ajusta stock', () => {
  createStockEntry([{ key: KEY_M, qty: 10 }], 'Ingreso inicial');
  const count = createStockCount([{ key: KEY_M, counted: 8 }], 'Faltaron 2');
  assert.ok(count);
  assert.equal(count.folio, 'CUA-0001');
  assert.equal(count.lines[0].before, 10);
  assert.equal(count.lines[0].qty, -2);
  assert.equal(count.lines[0].after, 8);
  assert.equal(stockOf(KEY_M), 8);

  const exact = createStockCount([{ key: KEY_M, counted: 8 }], 'Sin diferencias');
  assert.equal(exact, null);
});

test('7. Anular ingreso o cuadre revierte unidades en local y al sincronizar con otro dispositivo', () => {
  const ing = createStockEntry([{ key: KEY_M, qty: 10 }], 'Lote 1')!;
  const cua = createStockCount([{ key: KEY_M, counted: 8 }], 'Cuadre 1')!;
  const remoteCopyBeforeVoid = structuredClone(getState());

  voidStockEntry(cua.id);
  assert.equal(stockOf(KEY_M), 10);
  voidStockEntry(ing.id);
  assert.equal(stockOf(KEY_M), 0);

  // Al sincronizar con el dispositivo remoto viejo, los lotes anulados NO deben resucitar
  const mergedA = mergeStates(getState(), remoteCopyBeforeVoid);
  const mergedB = mergeStates(remoteCopyBeforeVoid, getState());
  assert.equal(computeStock(mergedA).stock.get(KEY_M) || 0, 0);
  assert.equal(computeStock(mergedB).stock.get(KEY_M) || 0, 0);
});

test('8. Folios ING-XXXX y CUA-XXXX son monotónicos y nunca colisionan tras anulaciones', () => {
  const i1 = createStockEntry([{ key: KEY_M, qty: 2 }])!;
  const i2 = createStockEntry([{ key: KEY_M, qty: 2 }])!;
  // Simular eliminación directa del primer entry manteniendo solo i2 (ING-0002)
  const st = getState();
  replaceState({ ...st, stockEntries: (st.stockEntries || []).filter((e) => e.id === i2.id) });
  const i3 = createStockEntry([{ key: KEY_M, qty: 2 }])!;
  assert.equal(i1.folio, 'ING-0001');
  assert.equal(i2.folio, 'ING-0002');
  assert.equal(i3.folio, 'ING-0003');
});

test('9. setStockAbsolute conserva lápida en 0 para que sync multi-dispositivo no resucite stock viejo', () => {
  setStockAbsolute(KEY_M, 5);
  assert.equal(stockOf(KEY_M), 5);
  const remoteOldState = structuredClone(getState());

  // Esperar un tick temporal distinto modificando el at del remoto un poco antes
  remoteOldState.movements = remoteOldState.movements.map((m) => ({ ...m, at: Date.now() - 5000 }));

  setStockAbsolute(KEY_M, 0);
  assert.equal(stockOf(KEY_M), 0);

  const mergedLocalFirst = mergeStates(getState(), remoteOldState);
  const mergedRemoteFirst = mergeStates(remoteOldState, getState());
  assert.equal(computeStock(mergedLocalFirst).stock.get(KEY_M) || 0, 0);
  assert.equal(computeStock(mergedRemoteFirst).stock.get(KEY_M) || 0, 0);
});

test('10. compactMovements preserva Había (Antes) histórico por día y suma fragmentos desordenados', () => {
  const yesterday = Date.now() - 86400000;
  const nowTs = Date.now();
  const s = getState();
  replaceState({
    ...s,
    movements: [
      { id: 'raw-y-1', key: KEY_M, delta: 4, reason: 'ajuste', at: yesterday },
      { id: 'raw-y-2', key: KEY_M, delta: 2, reason: 'ajuste', at: yesterday - 1000 }
    ]
  });
  // Saldo de ayer = +6; ajustamos hoy a 4 => debe crear ajuste hoy = -2 y mantener ayer = +6
  setStockAbsolute(KEY_M, 4);
  const movs = compactMovements(getState().movements);
  const yDay = dayKey(yesterday);
  const tDay = dayKey(nowTs);
  const mYesterday = movs.find((m) => dayKey(m.at) === yDay);
  const mToday = movs.find((m) => dayKey(m.at) === tDay);

  assert.equal(mYesterday?.delta, 6);
  assert.equal(mToday?.delta, -2);
  assert.equal(stockOf(KEY_M), 4);
});

test('11. Edición de pedido activo reconcilia aumentos, reducciones, cambios de talla y prendas quitadas', () => {
  setStockAbsolute(KEY_M, 10);
  setStockAbsolute(KEY_L, 5);

  const o = createOrder({
    lines: [
      makeCartLine({ size: 'M', qty: 3 }),
      makeCartLine({ size: 'L', qty: 2 })
    ],
    customer: null,
    addressId: null,
    walkIn: { name: 'Cliente Edición', phone: '+504 9999-4444' },
    shipping: 0,
    deposit: 175000,
    paymentMethod: 'Efectivo',
    workType: 'DTF Espalda',
    notes: '',
    photoId: null,
    status: 'en_produccion'
  });

  assert.equal(stockOf(KEY_M), 7);
  assert.equal(stockOf(KEY_L), 3);

  // Aumentar M de 3->5, cambiar L por Blanco M (qty 1)
  const itemM = { ...o.items[0], qty: 5 };
  const itemSwapped = {
    ...o.items[1],
    colorId: COLOR_WHITE,
    colorName: 'Blanco',
    size: 'M',
    qty: 1
  };
  updateOrderDetails(o.id, { items: [itemM, itemSwapped] });
  assert.equal(stockOf(KEY_M), 5); // tomó 2 adicionales
  assert.equal(stockOf(KEY_L), 5); // devolvió las 2 de talla L
  assert.equal(stockOf(KEY_WHITE_M), -1); // descontó 1 de Blanco M

  // Quitar la segunda prenda y reducir M de 5->2
  updateOrderDetails(o.id, { items: [{ ...itemM, qty: 2 }] });
  assert.equal(stockOf(KEY_M), 8);
  assert.equal(stockOf(KEY_WHITE_M), 0);
});

test('12. Pasar de producción a borrador devuelve stock y reactivar vuelve a descontar', () => {
  setStockAbsolute(KEY_M, 6);
  const o = createOrder({
    lines: [makeCartLine({ qty: 4 })],
    customer: null,
    addressId: null,
    walkIn: { name: 'Consumidor Final' },
    shipping: 0,
    deposit: 140000,
    paymentMethod: 'Efectivo',
    workType: 'DTF Espalda',
    notes: '',
    photoId: null,
    status: 'en_produccion'
  });

  assert.equal(stockOf(KEY_M), 2);
  setOrderStatus(o.id, 'borrador');
  assert.equal(stockOf(KEY_M), 6);
  assert.equal(getState().orders.find((x) => x.id === o.id)?.items[0].fromStock, 0);

  const err = setOrderStatus(o.id, 'en_produccion');
  assert.equal(err, null);
  assert.equal(stockOf(KEY_M), 2);
});

test('13. Cancelación normal devuelve a camisas en blanco vs Devolución estampada conserva descuento sin fantasmas tras vender/borrar', () => {
  setStockAbsolute(KEY_M, 5);
  const o1 = createOrder({
    lines: [makeCartLine({ qty: 2 })],
    customer: null,
    addressId: null,
    walkIn: { name: 'Cancel Normal', phone: '+504 9999-5555' },
    shipping: 0,
    deposit: 70000,
    paymentMethod: 'Efectivo',
    workType: 'DTF Espalda',
    notes: '',
    photoId: null,
    status: 'en_produccion'
  });
  assert.equal(stockOf(KEY_M), 3);
  setOrderStatus(o1.id, 'cancelado', { returnAsReadyMade: false });
  assert.equal(stockOf(KEY_M), 5);

  const o2 = createOrder({
    lines: [makeCartLine({ qty: 1 })],
    customer: null,
    addressId: null,
    walkIn: { name: 'Devolución Estampada', phone: '+504 9999-6666' },
    shipping: 0,
    deposit: 35000,
    paymentMethod: 'Contra Entrega',
    workType: 'DTF Espalda',
    notes: '',
    photoId: null,
    status: 'en_produccion'
  });
  assert.equal(stockOf(KEY_M), 4);
  setOrderStatus(o2.id, 'cancelado', { returnAsReadyMade: true });
  assert.equal(stockOf(KEY_M), 4); // sigue descontada de camisas en blanco

  const rms = (getState().readyMadeStock || []).find((r) => r.orderId === o2.id)!;
  assert.ok(rms);
  assert.equal(rms.qty, 1);

  // Vender la prenda ya estampada (llegando a qty: 0, deleted: true)
  const sale = sellReadyMadeShirt({
    readyMadeId: rms.id,
    qty: 1,
    unitPrice: 35000,
    customerName: 'Consumidor Final',
    paymentMethod: 'Efectivo'
  })!;
  assert.ok(sale);
  assert.equal(stockOf(KEY_M), 4); // no toca camisas en blanco

  // Eliminar el pedido cancelado original NO debe regenerar +1 camisa en blanco fantasma
  deleteOrder(o2.id);
  const synced = mergeStates(getState(), getState());
  assert.equal(computeStock(synced).stock.get(KEY_M) || 0, 4);
});

test('14. Cancelar un borrador con returnAsReadyMade ignorado: nunca crea prendas fantasma', () => {
  setStockAbsolute(KEY_M, 5);
  const draftOrder = createOrder({
    lines: [makeCartLine({ qty: 2 })],
    customer: null,
    addressId: null,
    walkIn: { name: 'Borrador' },
    shipping: 0,
    deposit: 70000,
    paymentMethod: 'Efectivo',
    workType: 'DTF Espalda',
    notes: '',
    photoId: null,
    status: 'borrador'
  });

  setOrderStatus(draftOrder.id, 'cancelado', { returnAsReadyMade: true });
  assert.equal(stockOf(KEY_M), 5);
  assert.equal((getState().readyMadeStock || []).filter((r) => !r.deleted).length, 0);
});

test('15. Prendas Ya Estampadas: editar, pasar estado o reconciliar nunca descuenta camisas en blanco y cancelar devuelve a readyMadeStock', () => {
  setStockAbsolute(KEY_M, 6);
  const oOrig = createOrder({
    lines: [makeCartLine({ qty: 1 })],
    customer: null,
    addressId: null,
    walkIn: { name: 'Original', phone: '+504 9999-7777' },
    shipping: 0,
    deposit: 35000,
    paymentMethod: 'Efectivo',
    workType: 'DTF Espalda',
    notes: '',
    photoId: null,
    status: 'en_produccion'
  });
  setOrderStatus(oOrig.id, 'cancelado', { returnAsReadyMade: true });
  assert.equal(stockOf(KEY_M), 5);

  const rms = (getState().readyMadeStock || []).find((r) => r.orderId === oOrig.id)!;
  const sold = sellReadyMadeShirt({
    readyMadeId: rms.id,
    qty: 1,
    unitPrice: 35000,
    customerName: 'Cliente Estampada',
    paymentMethod: 'Efectivo'
  })!;
  assert.equal(sold.items[0].isReadyMade, true);
  assert.equal(sold.items[0].readyMadeId, rms.id);
  assert.equal(stockOf(KEY_M), 5);

  // Editar pedido vendido, correr reconcileBackorderStock y cambiar estado NO deben tocar stock de camisas en blanco
  updateOrderDetails(sold.id, { items: [...sold.items] });
  const fixed = reconcileBackorderStock();
  assert.equal(fixed, 0);
  assert.equal(stockOf(KEY_M), 5);

  // Cancelar la venta de Prenda Estampada reintegra la prenda a readyMadeStock (qty: 1, deleted: false)
  setOrderStatus(sold.id, 'cancelado');
  const restored = (getState().readyMadeStock || []).find((r) => r.id === rms.id)!;
  assert.equal(restored.deleted, false);
  assert.equal(restored.qty, 1);
  assert.equal(stockOf(KEY_M), 5);
});

test('16. reconcileBackorderStock descuenta unidades bajo pedido pendientes de forma idempotente', () => {
  const s = getState();
  replaceState({
    ...s,
    orders: [
      {
        id: 'legacy-bo-1',
        folio: 11099,
        status: 'en_produccion',
        customerId: null,
        addressId: null,
        shipTo: { name: 'Legacy', phone: '+504 9999-0000', address: '' },
        workType: 'DTF Espalda',
        photoId: null,
        items: [
          {
            id: 'it-legacy-1',
            brandId: BRAND_ID,
            colorId: COLOR_BLACK,
            size: 'M',
            qty: 4,
            unitPrice: 35000,
            manualPrice: false,
            fromStock: 1,
            brandName: 'Bella+Canvas',
            colorName: 'Negro',
            colorHex: '#1A1A1C',
            sku: 'BC-NEG-M'
          }
        ],
        subtotal: 140000,
        shipping: 0,
        total: 140000,
        deposit: 140000,
        balance: 0,
        paymentMethod: 'Efectivo',
        notes: '',
        carrier: '',
        trackingNumber: '',
        trackingUrl: '',
        whatsappSentAt: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        history: [{ status: 'en_produccion', at: Date.now() }]
      }
    ],
    movements: [{ id: 'venta-init', key: KEY_M, delta: -1, reason: 'venta', orderId: 'legacy-bo-1', at: Date.now() }]
  });

  const fixed1 = reconcileBackorderStock();
  assert.equal(fixed1, 3);
  assert.equal(stockOf(KEY_M), -4);
  assert.equal(getState().orders[0].items[0].fromStock, 4);

  const fixed2 = reconcileBackorderStock();
  assert.equal(fixed2, 0);
  assert.equal(stockOf(KEY_M), -4);
});

test('17. Cuadre financiero: Vendido = Cobrado + Por cobrar y markPaid cambia Pago Pendiente en Tienda al método real', () => {
  const oPending = createOrder({
    lines: [makeCartLine({ qty: 2, unitPrice: 35000 })],
    customer: null,
    addressId: null,
    walkIn: { name: 'Cliente Pendiente', phone: '+504 9999-8888' },
    shipping: 11000,
    deposit: 0,
    paymentPending: true,
    paymentMethod: 'Pago Pendiente en Tienda',
    workType: 'DTF Espalda',
    notes: '',
    photoId: null,
    status: 'en_produccion'
  });

  const oPartial = createOrder({
    lines: [makeCartLine({ qty: 1, unitPrice: 35000 })],
    customer: null,
    addressId: null,
    walkIn: { name: 'Cliente Anticipo', phone: '+504 8888-1234' },
    shipping: 0,
    deposit: 15000,
    paymentMethod: 'Efectivo',
    workType: 'DTF Espalda',
    notes: '',
    photoId: null,
    status: 'en_produccion'
  });

  assert.equal(oPending.total, 81000);
  assert.equal(oPending.deposit, 0);
  assert.equal(oPending.balance, 81000);
  assert.equal(oPartial.balance, 20000);

  const allOrders = getState().orders.filter((o) => !o.deleted && o.status !== 'cancelado');
  const sumTotal = allOrders.reduce((s, o) => s + o.total, 0);
  const sumCollected = allOrders.reduce((s, o) => s + o.deposit, 0);
  const sumPending = allOrders.reduce((s, o) => s + o.balance, 0);
  assert.equal(sumCollected + sumPending, sumTotal);

  // Liquidar el pedido pendiente indicando el método real
  markPaid(oPending.id, 'Transferencia BAC');
  const settled = getState().orders.find((o) => o.id === oPending.id)!;
  assert.equal(settled.deposit, settled.total);
  assert.equal(settled.balance, 0);
  assert.equal(settled.paymentMethod, 'Transferencia BAC');
});

test('18. deleteOrder devuelve camisas en blanco descontadas en local y tras sync', () => {
  setStockAbsolute(KEY_M, 5);
  const o = createOrder({
    lines: [makeCartLine({ qty: 3 })],
    customer: null,
    addressId: null,
    walkIn: { name: 'Error', phone: '+504 9999-1212' },
    shipping: 0,
    deposit: 105000,
    paymentMethod: 'Efectivo',
    workType: 'DTF Espalda',
    notes: '',
    photoId: null,
    status: 'en_produccion'
  });
  assert.equal(orderStockReturnCount(o), 3);
  assert.equal(stockOf(KEY_M), 2);

  deleteOrder(o.id);
  assert.equal(stockOf(KEY_M), 5);
  assert.equal(computeStock(mergeStates(getState(), getState())).stock.get(KEY_M) || 0, 5);
});

test('19. purgeGarbageData y normalize deduplican marcas/colores/tallas/diseños/clientes y conservan existencias remapeadas', () => {
  const s = getState();
  const dupBrandId = 'b-bc-dup';
  const dupColorId = 'c-bc-dup-negro';
  const dirty = {
    ...s,
    settings: {
      ...s.settings,
      sizes: ['m', 'M', 'XL', 'xl'],
      storeColorIds: [COLOR_BLACK, dupColorId]
    },
    brands: [
      ...s.brands,
      { id: dupBrandId, code: 'BC', name: 'Bella+Canvas ', priceOverride: null, cost: 15000, order: 1, updatedAt: Date.now() - 1000 }
    ],
    colors: [
      ...s.colors,
      { id: dupColorId, brandId: dupBrandId, name: 'negro', hex: '#1A1A1C', code: 'NEG', order: 0, updatedAt: Date.now() - 1000 }
    ],
    customers: [
      {
        id: 'cust-1',
        name: 'María López',
        phone: '+504 9988-7766',
        notes: '',
        addresses: [{ id: 'a1', label: 'Casa', recipient: 'María', line1: 'Col. Centro', city: 'La Entrada', department: 'Copán', reference: '', isDefault: true }],
        createdAt: 100,
        updatedAt: 100
      },
      {
        id: 'cust-2',
        name: 'Maria Lopez Dup',
        phone: '99887766',
        notes: '',
        addresses: [{ id: 'a2', label: 'Trabajo', recipient: 'María', line1: 'Barrio El Dorado', city: 'La Entrada', department: 'Copán', reference: '', isDefault: true }],
        createdAt: 200,
        updatedAt: 200
      }
    ],
    movements: [
      { id: 'ent-1', key: `${BRAND_ID}|${COLOR_BLACK}|m`, delta: 4, reason: 'compra' as const, entryId: 'e1', at: Date.now() },
      { id: 'ent-2', key: `${dupBrandId}|${dupColorId}|M`, delta: 3, reason: 'compra' as const, entryId: 'e2', at: Date.now() }
    ],
    catalogDesigns: [
      { id: 'd-1', name: 'RANCHO', code: 'D-001', photoId: 'p-1', clientVisible: true, placement: 'back' as const, createdAt: 100, updatedAt: 100 },
      { id: 'd-2', name: 'rancho', code: 'D-001', photoId: 'p-1', clientVisible: true, placement: 'back' as const, createdAt: 200, updatedAt: 200 }
    ]
  };

  // Verificar normalize directamente
  const normDirect = normalize(dirty);
  const normBrand = normDirect.brands[0];
  const normBlack = normDirect.colors.find(
    (c) => !c.deleted && c.brandId === normBrand.id && c.name.toLowerCase() === 'negro'
  )!;
  assert.equal(normDirect.brands.length, 1);
  assert.equal(computeStock(normDirect).stock.get(vkey(normBrand.id, normBlack.id, 'M')) || 0, 7);

  // Inyectar estado sucio directo para probar purgeGarbageData end-to-end
  update(() => dirty);
  const stats = purgeGarbageData();
  const clean = getState();
  const cleanBrand = clean.brands[0];
  const cleanBlack = clean.colors.find(
    (c) => !c.deleted && c.brandId === cleanBrand.id && c.name.toLowerCase() === 'negro'
  )!;
  assert.equal(stats.removedBrands, 1);
  assert.equal(clean.brands.length, 1);
  assert.deepEqual(clean.settings.sizes, ['M', 'XL']);
  // Ambos movimientos (4 y 3) debieron sumarse bajo la clave canónica
  assert.equal(stockOf(vkey(cleanBrand.id, cleanBlack.id, 'M')), 7);
  // Sólo queda 1 diseño activo 'RANCHO' y 1 cliente fusionado con 2 direcciones
  assert.equal((clean.catalogDesigns || []).filter((d) => !d.deleted).length, 1);
  assert.equal(clean.customers.length, 1);
  assert.equal(clean.customers[0].addresses.length, 2);
});

test('20. buildPublicCatalog excluye negativos, protege datos privados y refleja diseño + ventas reales', () => {
  setStockAbsolute(KEY_M, -3);
  setStockAbsolute(KEY_L, 9);
  const design = addCatalogDesign({ name: 'Toro Dorado', photoId: 'photo-toro', clientVisible: true, placement: 'back' });
  createOrder({
    lines: [makeCartLine({ size: 'L', qty: 2, designId: design.id, designName: design.name, designCode: design.code })],
    customer: null,
    addressId: null,
    walkIn: { name: 'Privado', phone: '+504 9999-9999', address: 'Casa Privada' },
    shipping: 0,
    deposit: 70000,
    paymentMethod: 'Efectivo',
    workType: 'DTF Espalda',
    notes: '',
    photoId: design.photoId,
    status: 'en_produccion',
    designId: design.id,
    designName: design.name,
    designCode: design.code
  });

  const pub = buildPublicCatalog(getState());
  assert.equal(pub.stock?.[`${COLOR_BLACK}|M`], undefined); // negativos no aparecen disponibles
  assert.equal(pub.stock?.[`${COLOR_BLACK}|L`], 7);
  assert.equal(pub.designs?.length, 1);
  assert.equal(pub.designs?.[0].soldCount, 2);
  assert.equal('customers' in pub, false);
  assert.equal('orders' in pub, false);
  assert.equal(pub.activeCampaign, 'all');
  assert.deepEqual(pub.campaigns, [...DEFAULT_CAMPAIGNS]);
});

test('21. parseStorefrontHash aísla enlaces públicos por temática y rechaza hashes internos/admin', () => {
  assert.deepEqual(parseStorefrontHash('#tienda'), { isPublic: true, campaign: null, legacyToken: null });
  assert.deepEqual(parseStorefrontHash('#tienda/ranchero'), { isPublic: true, campaign: 'ranchero', legacyToken: null });
  assert.deepEqual(parseStorefrontHash('#tienda/turistico'), { isPublic: true, campaign: 'turistico', legacyToken: null });
  assert.deepEqual(parseStorefrontHash('#tienda/cristiana'), { isPublic: true, campaign: 'cristiana', legacyToken: null });
  assert.deepEqual(parseStorefrontHash('#tienda?camp=Cristiana'), { isPublic: true, campaign: 'Cristiana', legacyToken: null });
  assert.deepEqual(parseStorefrontHash('#catalogo/ranchero'), { isPublic: true, campaign: 'ranchero', legacyToken: null });
  assert.deepEqual(parseStorefrontHash('#catalogo=eyJhIjoxfQ'), { isPublic: true, campaign: null, legacyToken: 'eyJhIjoxfQ' });
  assert.deepEqual(parseStorefrontHash('#tienda/todas'), { isPublic: true, campaign: null, legacyToken: null });

  assert.equal(parseStorefrontHash('').isPublic, false);
  assert.equal(parseStorefrontHash('#pedido=abc123').isPublic, false);
  assert.equal(parseStorefrontHash('#inventario').isPublic, false);
});

test('22. buildThemeShareUrl, campaignsMatch, resolveCampaignName y resolveMockupScene funcionan con o sin tildes', () => {
  const origin = 'https://creativos-t-shirt.web.app/';
  assert.equal(buildThemeShareUrl(origin, 'all'), 'https://creativos-t-shirt.web.app/#tienda');
  assert.equal(buildThemeShareUrl(origin, 'Ranchero'), 'https://creativos-t-shirt.web.app/#tienda/ranchero');
  assert.equal(buildThemeShareUrl(origin, 'Turístico'), 'https://creativos-t-shirt.web.app/#tienda/turistico');
  assert.equal(buildThemeShareUrl(origin, 'Cristiana'), 'https://creativos-t-shirt.web.app/#tienda/cristiana');
  assert.equal(buildThemeShareUrl(origin, 'Día del Padre'), 'https://creativos-t-shirt.web.app/#tienda/dia-del-padre');

  assert.equal(campaignsMatch('turistico', 'Turístico'), true);
  assert.equal(campaignsMatch('CRISTIANA', 'Cristiana'), true);
  assert.equal(campaignsMatch('ranchero', 'Cristiana'), false);

  assert.equal(resolveCampaignName('turistico', DEFAULT_CAMPAIGNS), 'Turístico');
  assert.equal(resolveCampaignName('cristiana', DEFAULT_CAMPAIGNS), 'Cristiana');
  assert.equal(resolveCampaignName('dia-del-padre', DEFAULT_CAMPAIGNS), 'Dia Del Padre');

  assert.equal(resolveMockupScene('Ranchero', null), 'ranchero');
  assert.equal(resolveMockupScene('Cristiana', null), 'cristiana');
  assert.equal(resolveMockupScene('Turístico', null), 'turistico');
  assert.equal(resolveMockupScene('Honduras', null), 'turistico');
  assert.equal(resolveMockupScene('all', 'Cristiana'), 'cristiana');
  assert.equal(resolveMockupScene('all', 'Turístico'), 'turistico');
  assert.equal(resolveMockupScene('all', null, 'ranchero'), 'ranchero');
});

test('23. webPreviewPhotoId es idempotente, no colisiona con maestros y buildPublicCatalog conserva photoId maestro para DTF', () => {
  const masterId = 'photo_rodeo_hd_01';
  const webId = webPreviewPhotoId(masterId);

  assert.equal(webId, `${masterId}${WEB_PREVIEW_SUFFIX}`);
  assert.notEqual(webId, masterId);
  assert.equal(isWebPreviewPhotoId(masterId), false);
  assert.equal(isWebPreviewPhotoId(webId), true);
  // Idempotencia: aplicar webPreviewPhotoId dos veces nunca agrega doble sufijo
  assert.equal(webPreviewPhotoId(webId), webId);
  assert.equal(webPreviewPhotoId(''), '');

  const d = addCatalogDesign({
    name: 'Rodeo HD',
    photoId: masterId,
    clientVisible: true,
    placement: 'back',
    campaign: 'Ranchero'
  });
  const pub = buildPublicCatalog(getState());
  const entry = pub.designs?.find((x) => x.id === d.id);
  assert.ok(entry);
  assert.equal(entry!.photoId, masterId);
  assert.equal(isWebPreviewPhotoId(entry!.photoId), false);
});
