import type { AppState, Order, Settings, StockEntry } from './types';
import { activeBrands, brandColors, computeStock, lowColorStockList, parseVKey, vkey } from './inventory';
import { money } from './money';
import { folioLabel } from './ids';
import { dayKey, fmtDateTime } from './time';
import { STATUS_LABEL } from './actions';
import { db } from './db';
import { getState } from './store';
import { fetchSharedPhoto } from './sync';
import { toast } from '../components/ui';

function esc(s: string | number | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPrintHtml(title: string, bodyHtml: string, extraCss = ''): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${esc(title)}</title>
  <style>
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 18px;
      font-size: 12px;
      line-height: 1.4;
    }
    .no-print {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      background: #0f172a;
      color: #ffffff;
      padding: 10px 16px;
      border-radius: 12px;
      margin-bottom: 16px;
    }
    .no-print button {
      background: #2563eb;
      color: #ffffff;
      border: none;
      padding: 8px 16px;
      border-radius: 8px;
      font-weight: 800;
      font-size: 13px;
      cursor: pointer;
    }
    .no-print button.close-btn {
      background: #334155;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 10px;
      margin-bottom: 14px;
    }
    .header h1 {
      margin: 0;
      font-size: 20px;
      font-weight: 900;
      letter-spacing: -0.02em;
    }
    .header .sub {
      font-size: 11px;
      color: #475569;
      margin-top: 2px;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 14px;
    }
    .kpi {
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      padding: 8px 12px;
      background: #f8fafc;
    }
    .kpi .lbl {
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      color: #64748b;
    }
    .kpi .val {
      font-size: 16px;
      font-weight: 900;
      color: #0f172a;
      margin-top: 2px;
    }
    h2 {
      font-size: 13px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      margin: 14px 0 6px 0;
      color: #1e293b;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 14px;
      font-size: 11.5px;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 6px 8px;
      text-align: left;
      vertical-align: top;
    }
    th {
      background: #f1f5f9;
      font-weight: 800;
      font-size: 10.5px;
      text-transform: uppercase;
      color: #334155;
    }
    .center { text-align: center; }
    .right { text-align: right; }
    .bold { font-weight: 800; }
    .swatch {
      display: inline-block;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      border: 1px solid rgba(0,0,0,0.25);
      vertical-align: middle;
      margin-right: 5px;
    }
    .badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 6px;
      font-size: 10px;
      font-weight: 800;
    }
    .badge-paid {
      background: #dcfce7;
      color: #166534;
      border: 1px solid #86efac;
    }
    .badge-unpaid {
      background: #fee2e2;
      color: #991b1b;
      border: 1px solid #fca5a5;
    }
    .badge-pending-store {
      background: #fef3c7;
      color: #92400e;
      border: 1px solid #fcd34d;
    }
    .badge-low {
      background: #fef3c7;
      color: #92400e;
      border: 1px solid #fcd34d;
    }
    .badge-size {
      display: inline-block;
      background: #0f172a;
      color: #ffffff;
      padding: 2px 7px;
      border-radius: 5px;
      font-weight: 900;
      font-size: 11px;
      margin: 1px 2px;
    }
    ${extraCss}
    @media print {
      body { padding: 0; }
      .no-print { display: none !important; }
      tr, .order-card { page-break-inside: avoid; break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="no-print">
    <div><strong>Vista Previa de Impresión</strong> · ${esc(title)}</div>
    <div style="display:flex;gap:8px;">
      <button onclick="window.print()">🖨️ Imprimir ahora / Guardar PDF</button>
      <button class="close-btn" onclick="window.close()">Cerrar</button>
    </div>
  </div>
  ${bodyHtml}
  <script>
    (function() {
      function triggerPrint() {
        setTimeout(function() { window.print(); }, 180);
      }
      window.addEventListener('load', function() {
        var imgs = Array.prototype.slice.call(document.images || []);
        var pending = imgs.filter(function(img) { return !img.complete; });
        if (pending.length === 0) {
          triggerPrint();
          return;
        }
        var done = 0;
        var fired = false;
        function check() {
          if (fired) return;
          done += 1;
          if (done >= pending.length) {
            fired = true;
            triggerPrint();
          }
        }
        pending.forEach(function(img) {
          img.addEventListener('load', check);
          img.addEventListener('error', check);
        });
        setTimeout(function() {
          if (!fired) {
            fired = true;
            triggerPrint();
          }
        }, 900);
      });
    })();
  </script>
</body>
</html>`;
}

function openPrintDocument(title: string, bodyHtml: string): void {
  const html = buildPrintHtml(title, bodyHtml);
  const win = window.open('', '_blank');
  if (!win) {
    toast('Permite las ventanas emergentes en tu navegador para imprimir', 'error');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

/**
 * Imprime el reporte completo de Inventario (Matriz por Marca, Color y Talla + Alertas 1–10 uds + Ya Estampadas).
 */
export function printInventoryReport(
  state: AppState,
  options?: { brandFilter?: string; colorFilter?: string }
): void {
  const info = computeStock(state);
  const { stock } = info;
  const { settings } = state;
  const brands = activeBrands(state).filter((b) =>
    !options?.brandFilter || options.brandFilter === 'all' ? true : b.id === options.brandFilter
  );
  const sizes = settings.sizes;
  const threshold = settings.lowStock || 10;

  let grandTotal = 0;
  const sizeTotals = new Map<string, number>();
  sizes.forEach((sz) => sizeTotals.set(sz, 0));

  const matrixRowsHtml: string[] = [];

  for (const brand of brands) {
    const colors = brandColors(state, brand.id).filter((c) =>
      !options?.colorFilter || options.colorFilter === 'all' ? true : c.name === options.colorFilter
    );
    for (const color of colors) {
      let rowTotal = 0;
      const sizeCells: string[] = [];
      for (const sz of sizes) {
        const val = stock.get(vkey(brand.id, color.id, sz)) || 0;
        rowTotal += val;
        sizeTotals.set(sz, (sizeTotals.get(sz) || 0) + val);
        sizeCells.push(
          `<td class="center ${val > 0 ? 'bold' : ''}" style="${
            val === 0 ? 'color:#94a3b8;' : val <= threshold ? 'background:#fffbeb;color:#92400e;' : ''
          }">${val}</td>`
        );
      }
      grandTotal += rowTotal;

      const statusBadge =
        rowTotal >= 1 && rowTotal <= threshold
          ? `<span class="badge badge-low">⚠️ Quedan ${rowTotal} uds (1–${threshold})</span>`
          : rowTotal > threshold
          ? `<span class="badge badge-paid">✓ En stock (${rowTotal})</span>`
          : `<span style="color:#94a3b8;font-size:10px;">0 uds</span>`;

      matrixRowsHtml.push(`
        <tr>
          <td class="bold">${esc(brand.name)}</td>
          <td>
            <span class="swatch" style="background:${esc(color.hex)}"></span>
            <span class="bold">${esc(color.name)}</span>
            <span style="color:#64748b;font-family:monospace;font-size:10px;"> (${esc(color.code)})</span>
          </td>
          ${sizeCells.join('')}
          <td class="right bold" style="font-size:13px;">${rowTotal}</td>
          <td class="center">${statusBadge}</td>
        </tr>
      `);
    }
  }

  const lowColors = lowColorStockList(state, info);
  const readyMade = (state.readyMadeStock || []).filter((r) => !r.deleted && r.qty > 0);
  const readyMadeTotal = readyMade.reduce((s, r) => s + r.qty, 0);

  const lowColorsHtml =
    lowColors.length > 0
      ? `
    <h2>⚠️ Colores por Agotarse (Entre 1 y ${threshold} unidades · Excluye colores en 0)</h2>
    <table>
      <thead>
        <tr>
          <th>Marca</th>
          <th>Color</th>
          <th>Desglose por Tallas Disponibles</th>
          <th class="right">Total Restante</th>
        </tr>
      </thead>
      <tbody>
        ${lowColors
          .map(
            (lc) => `
          <tr>
            <td class="bold">${esc(lc.brand.name)}</td>
            <td>
              <span class="swatch" style="background:${esc(lc.color.hex)}"></span>
              <span class="bold">${esc(lc.color.name)}</span>
            </td>
            <td>${lc.sizesBreakdown.map((sb) => `<span class="badge-size">${esc(sb.size)}: ${sb.qty}</span>`).join(' ')}</td>
            <td class="right bold"><span class="badge badge-low">⚠️ ${lc.totalStock} uds</span></td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `
      : '';

  const readyMadeHtml =
    readyMade.length > 0
      ? `
    <h2>⚡ Prendas Ya Estampadas (Listas para Entrega Inmediata)</h2>
    <table>
      <thead>
        <tr>
          <th>Marca · Color</th>
          <th class="center">Talla</th>
          <th>Diseño Estampado</th>
          <th>Notas</th>
          <th class="right">Precio</th>
          <th class="right">Cantidad</th>
        </tr>
      </thead>
      <tbody>
        ${readyMade
          .map(
            (r) => `
          <tr>
            <td>
              <span class="swatch" style="background:${esc(r.colorHex)}"></span>
              <span class="bold">${esc(r.brandName)} · ${esc(r.colorName)}</span>
            </td>
            <td class="center"><span class="badge-size">${esc(r.size)}</span></td>
            <td class="bold">${esc(r.designName)}</td>
            <td>${esc(r.notes || '—')}</td>
            <td class="right">${esc(money(r.price))}</td>
            <td class="right bold">${r.qty}</td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `
      : '';

  const bodyHtml = `
    <div class="header">
      <div>
        <h1>${esc(settings.storeName || 'Creativos Gift Shop')} · Reporte de Inventario</h1>
        <div class="sub">${esc([settings.storeAddress, settings.storeCity, settings.storePhone].filter(Boolean).join(' · '))}</div>
      </div>
      <div class="right">
        <div class="bold">Fecha de Impresión</div>
        <div class="sub">${esc(fmtDateTime(Date.now()))}</div>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi">
        <div class="lbl">Total Camisas en Blanco</div>
        <div class="val">${grandTotal} uds</div>
      </div>
      <div class="kpi">
        <div class="lbl">Colores en Alerta (1–${threshold} uds)</div>
        <div class="val" style="color:#b45309;">${lowColors.length} colores</div>
      </div>
      <div class="kpi">
        <div class="lbl">Prendas Ya Estampadas</div>
        <div class="val" style="color:#4338ca;">${readyMadeTotal} uds</div>
      </div>
      <div class="kpi">
        <div class="lbl">Marcas Activas</div>
        <div class="val">${brands.length}</div>
      </div>
    </div>

    ${lowColorsHtml}

    <h2>👕 Matriz de Inventario por Marca, Color y Talla</h2>
    <table>
      <thead>
        <tr>
          <th>Marca</th>
          <th>Color</th>
          ${sizes.map((sz) => `<th class="center">${esc(sz)}</th>`).join('')}
          <th class="right">Total Color</th>
          <th class="center">Estado</th>
        </tr>
      </thead>
      <tbody>
        ${matrixRowsHtml.join('')}
      </tbody>
      <tfoot>
        <tr style="background:#f1f5f9;font-weight:900;">
          <td colspan="2" class="bold">TOTAL POR TALLA</td>
          ${sizes.map((sz) => `<td class="center bold">${sizeTotals.get(sz) || 0}</td>`).join('')}
          <td class="right bold" style="font-size:14px;">${grandTotal}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>

    ${readyMadeHtml}
  `;

  openPrintDocument(`Inventario - ${settings.storeName}`, bodyHtml);
}

/**
 * Resuelve la fuente de imagen de un diseño (desde IndexedDB local o Firestore compartido)
 * usando primero `photoId` del ítem, luego fallback en catálogo por id/código/nombre y por último `order.photoId`.
 */
async function resolveOrderPhotosMap(orders: Order[]): Promise<Map<string, string>> {
  const photoMap = new Map<string, string>();
  const designs = getState().catalogDesigns || [];
  const findFallbackPhotoId = (
    designId?: string | null,
    designCode?: string | null,
    designName?: string | null
  ): string | null => {
    const match = designs.find(
      (d) =>
        !d.deleted &&
        d.photoId &&
        ((designId && d.id === designId) ||
          (designCode && d.code && d.code.toLowerCase() === designCode.toLowerCase()) ||
          (designName && d.name.toLowerCase() === designName.toLowerCase()))
    );
    return match?.photoId || null;
  };

  const wantedIds = new Set<string>();
  for (const o of orders) {
    if (o.photoId) wantedIds.add(o.photoId);
    const orderFb = findFallbackPhotoId(o.designId, o.designCode, o.designName);
    if (orderFb) wantedIds.add(orderFb);
    for (const it of o.items) {
      if (it.photoId) wantedIds.add(it.photoId);
      const itFb = findFallbackPhotoId(it.designId, it.designCode, it.designName);
      if (itFb) wantedIds.add(itFb);
    }
  }

  const idList = Array.from(wantedIds);
  if (idList.length === 0) return photoMap;

  try {
    const localRows = await db.photos.where('id').anyOf(idList).toArray();
    for (const row of localRows) {
      if (row?.data) photoMap.set(row.id, row.data);
    }
  } catch {
    /* continuar con fetchSharedPhoto */
  }

  const missing = idList.filter((id) => !photoMap.has(id));
  if (missing.length > 0) {
    await Promise.all(
      missing.map(async (id) => {
        try {
          const data = await fetchSharedPhoto(id);
          if (data) photoMap.set(id, data);
        } catch {
          /* ignorar fallo de red */
        }
      })
    );
  }
  return photoMap;
}

/**
 * Imprime los Pedidos del Día (o lista filtrada) en diseño minimalista estilo Apple,
 * mostrando miniatura de cada diseño sobre el color de camisa para que Taller entienda al instante.
 */
export function printDailyOrdersReport(
  orders: Order[],
  settings: Settings,
  periodLabel = 'Pedidos del Día'
): void {
  const win = window.open('', '_blank');
  if (!win) {
    toast('Permite las ventanas emergentes en tu navegador para imprimir', 'error');
    return;
  }

  // Pantalla de carga instantánea mientras se obtienen las miniaturas del diseño
  win.document.open();
  win.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${esc(periodLabel)}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;align-items:center;justify-content:center;min-height:90vh;color:#334155;background:#f8fafc;margin:0;}.box{background:#fff;padding:24px 32px;border-radius:16px;border:1px solid #e2e8f0;text-align:center;box-shadow:0 4px 20px rgba(15,23,42,0.06);}</style></head><body><div class="box"><div style="font-size:15px;font-weight:700;color:#0f172a;">Preparando ordenes e imágenes de diseño...</div><div style="font-size:12px;color:#64748b;margin-top:6px;">Un momento por favor</div></div></body></html>`);
  win.document.close();

  const activeOrders = orders.filter((o) => !o.deleted && o.status !== 'cancelado');

  void (async () => {
    const photoMap = await resolveOrderPhotosMap(activeOrders);
    const catalogDesigns = getState().catalogDesigns || [];
    const lookupPhotoSrc = (opts: {
      photoId?: string | null;
      photoUrl?: string | null;
      designId?: string | null;
      designCode?: string | null;
      designName?: string | null;
      orderPhotoId?: string | null;
    }): string | null => {
      if (opts.photoId && photoMap.has(opts.photoId)) return photoMap.get(opts.photoId) || null;
      if (opts.photoUrl && opts.photoUrl.startsWith('data:')) return opts.photoUrl;
      const match = catalogDesigns.find(
        (d) =>
          !d.deleted &&
          d.photoId &&
          ((opts.designId && d.id === opts.designId) ||
            (opts.designCode && d.code && d.code.toLowerCase() === opts.designCode.toLowerCase()) ||
            (opts.designName && d.name.toLowerCase() === opts.designName.toLowerCase()))
      );
      if (match?.photoId && photoMap.has(match.photoId)) return photoMap.get(match.photoId) || null;
      if (opts.orderPhotoId && photoMap.has(opts.orderPhotoId)) {
        return photoMap.get(opts.orderPhotoId) || null;
      }
      return null;
    };

    let totalRevenue = 0;
    let totalPaid = 0;
    let totalPending = 0;
    let totalUnits = 0;

    // Agrupación para picking/taller por Marca + Color + Talla + Diseño + Imagen
    const pickingMap = new Map<
      string,
      {
        brandName: string;
        colorName: string;
        colorHex: string;
        size: string;
        designLabel: string;
        workType: string;
        placementLabel: string;
        thumbSrc: string | null;
        qty: number;
      }
    >();

    for (const o of activeOrders) {
      totalRevenue += o.total;
      totalPaid += o.deposit;
      totalPending += o.balance;
      const fallbackOrderDesign = o.designName
        ? `${o.designCode ? `[${o.designCode}] ` : ''}${o.designName}`
        : o.photoId
        ? 'Diseño Personalizado'
        : 'Camisa Lisa';

      for (const it of o.items) {
        totalUnits += it.qty;
        const itemDesign = it.designName
          ? `${it.designCode ? `[${it.designCode}] ` : ''}${it.designName}`
          : fallbackOrderDesign;
        const itemPlace = it.placement || o.placement;
        const placementLabel =
          it.designName || it.photoId || o.photoId
            ? itemPlace === 'back'
              ? 'Espalda'
              : itemPlace === 'pocket'
              ? 'Bolsillo'
              : 'Frente'
            : 'Lisa';
        const thumbSrc = lookupPhotoSrc({
          photoId: it.photoId,
          photoUrl: it.photoUrl,
          designId: it.designId || o.designId,
          designCode: it.designCode || o.designCode,
          designName: it.designName || o.designName,
          orderPhotoId: it.designName || it.photoId ? o.photoId : null
        });

        const pKey = `${it.brandName}|${it.colorName}|${it.size}|${itemDesign}|${placementLabel}`;
        const prev = pickingMap.get(pKey);
        if (prev) {
          prev.qty += it.qty;
          if (!prev.thumbSrc && thumbSrc) prev.thumbSrc = thumbSrc;
        } else {
          pickingMap.set(pKey, {
            brandName: it.brandName,
            colorName: it.colorName,
            colorHex: it.colorHex,
            size: it.size,
            designLabel: itemDesign,
            workType: o.workType,
            placementLabel,
            thumbSrc,
            qty: it.qty
          });
        }
      }
    }

    const pickingList = Array.from(pickingMap.values()).sort(
      (a, b) =>
        a.brandName.localeCompare(b.brandName) ||
        a.colorName.localeCompare(b.colorName) ||
        a.size.localeCompare(b.size)
    );

    const ordersCardsHtml = activeOrders.map((o) => {
      const isPaid = o.balance <= 0;
      const isPendingStore = o.balance > 0 && o.deposit <= 0;

      const orderFallbackImg = lookupPhotoSrc({
        photoId: o.photoId,
        designId: o.designId,
        designCode: o.designCode,
        designName: o.designName
      });

      const itemsHtml = o.items
        .map((it) => {
          const itemImg = lookupPhotoSrc({
            photoId: it.photoId,
            photoUrl: it.photoUrl,
            designId: it.designId || o.designId,
            designCode: it.designCode || o.designCode,
            designName: it.designName || o.designName,
            orderPhotoId: o.photoId
          }) || (o.photoId || o.designName ? orderFallbackImg : null);

          const hasPrint = Boolean(it.designName || it.photoId || (o.designName && !o.workType.toLowerCase().includes('lisa')) || o.photoId);
          const itemDesignLabel = it.designName
            ? `${it.designCode ? `[${it.designCode}] ` : ''}${it.designName}`
            : hasPrint
            ? o.designName
              ? `${o.designCode ? `[${o.designCode}] ` : ''}${o.designName}`
              : 'Diseño Personalizado'
            : 'Camisa Lisa (Sin estampado)';
          const rawPlace = it.placement || o.placement;
          const placeLabel = hasPrint
            ? rawPlace === 'back'
              ? 'Espalda'
              : rawPlace === 'pocket'
              ? 'Bolsillo'
              : 'Frente'
            : 'Sin diseño';

          const thumbHtml = itemImg
            ? `<div class="thumb-frame" style="background:${esc(it.colorHex || '#f1f5f9')}"><img src="${esc(itemImg)}" alt="${esc(itemDesignLabel)}" /></div>`
            : `<div class="thumb-frame thumb-plain" style="background:${esc(it.colorHex || '#f1f5f9')}"><span>${hasPrint ? '🎨' : '👕'}</span></div>`;

          return `
            <div class="item-row">
              ${thumbHtml}
              <div class="item-meta">
                <div class="item-top">
                  <span class="badge-size">${esc(it.size)} × ${it.qty}</span>
                  <span class="swatch" style="background:${esc(it.colorHex)}"></span>
                  <strong>${esc(it.colorName)}</strong>
                  <span class="muted">(${esc(it.brandName)})</span>
                </div>
                <div class="item-design">
                  <strong>${esc(itemDesignLabel)}</strong>
                  <span class="pill-side">${esc(placeLabel)}</span>
                </div>
              </div>
            </div>
          `;
        })
        .join('');

      const paymentBadge = isPaid
        ? `<span class="badge badge-paid">✅ PAGADO 100%</span>`
        : isPendingStore
        ? `<span class="badge badge-pending-store">⏳ PAGO PENDIENTE EN TIENDA · ${esc(money(o.balance))}</span>`
        : `<span class="badge badge-unpaid">⚠️ SALDO PENDIENTE · ${esc(money(o.balance))}</span>`;

      const paymentSub = isPaid
        ? `Total: <strong>${esc(money(o.total))}</strong> · ${esc(o.paymentMethod)}`
        : isPendingStore
        ? `Total por cobrar: <strong>${esc(money(o.total))}</strong> · ${esc(o.paymentMethod)}`
        : `Total: <strong>${esc(money(o.total))}</strong> · Abonó: ${esc(money(o.deposit))} · ${esc(o.paymentMethod)}`;

      const addressText = o.shipTo.address?.trim()
        ? `📍 ${esc(o.shipTo.address.trim())}`
        : '🏪 Entrega / Recoge en tienda';

      return `
        <article class="order-card">
          <div class="order-head">
            <div class="order-head-left">
              <span class="folio">${esc(folioLabel(o.folio))}</span>
              <span class="pill-status">${esc(STATUS_LABEL[o.status])}</span>
              <span class="pill-work">${esc(o.workType)}</span>
              <span class="muted">${esc(fmtDateTime(o.createdAt))}</span>
            </div>
            <div class="order-head-right">
              <div>${paymentBadge}</div>
              <div class="pay-sub">${paymentSub}</div>
            </div>
          </div>

          <div class="order-grid">
            <div class="order-client">
              <div class="section-cap">Cliente y Entrega</div>
              <div class="client-name">${esc(o.shipTo.name || 'Cliente Mostrador')}</div>
              ${o.shipTo.phone ? `<div class="client-line">📞 ${esc(o.shipTo.phone)}</div>` : ''}
              <div class="client-addr">${addressText}</div>
              ${
                o.carrier || o.trackingNumber
                  ? `<div class="client-ship">🚚 ${esc(o.carrier || 'Envío')}${
                      o.trackingNumber ? ` · Guía: <strong>${esc(o.trackingNumber)}</strong>` : ''
                    }</div>`
                  : ''
              }
              ${
                o.notes
                  ? `<div class="note-box">📝 ${esc(o.notes)}</div>`
                  : ''
              }
            </div>

            <div class="order-items">
              <div class="section-cap">Prendas y Diseños (${o.items.reduce((s, x) => s + x.qty, 0)} uds)</div>
              ${itemsHtml}
            </div>
          </div>
        </article>
      `;
    });

    const pickingHtml =
      pickingList.length > 0
        ? `
      <h2>📋 Hoja Rápida de Taller y Preparación (${totalUnits} prendas)</h2>
      <table>
        <thead>
          <tr>
            <th class="center" style="width:60px;">Diseño</th>
            <th class="center" style="width:60px;">Talla</th>
            <th>Color de Camisa</th>
            <th>Marca</th>
            <th>Diseño / Ubicación</th>
            <th class="right">Cantidad</th>
          </tr>
        </thead>
        <tbody>
          ${pickingList
            .map(
              (p) => `
            <tr>
              <td class="center">
                ${
                  p.thumbSrc
                    ? `<div class="thumb-mini" style="background:${esc(p.colorHex || '#f1f5f9')}"><img src="${esc(p.thumbSrc)}" alt="${esc(p.designLabel)}" /></div>`
                    : `<div class="thumb-mini thumb-plain" style="background:${esc(p.colorHex || '#f1f5f9')}">👕</div>`
                }
              </td>
              <td class="center"><span class="badge-size">${esc(p.size)}</span></td>
              <td>
                <span class="swatch" style="background:${esc(p.colorHex)}"></span>
                <span class="bold">${esc(p.colorName)}</span>
              </td>
              <td>${esc(p.brandName)}</td>
              <td>
                <div class="bold">${esc(p.designLabel)}</div>
                <div style="font-size:10px;color:#475569;">${esc(p.placementLabel)} · ${esc(p.workType)}</div>
              </td>
              <td class="right bold" style="font-size:13px;">${p.qty} uds</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    `
        : '';

    const appleCardsCss = `
      .order-card {
        border: 1px solid #d1d5db;
        border-radius: 14px;
        background: #ffffff;
        margin-bottom: 12px;
        overflow: hidden;
      }
      .order-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        background: #f5f5f7;
        border-bottom: 1px solid #e5e7eb;
        padding: 9px 14px;
      }
      .order-head-left {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
      }
      .order-head-right {
        text-align: right;
      }
      .folio {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 13px;
        font-weight: 900;
        color: #0f172a;
      }
      .pill-status {
        display: inline-block;
        background: #ffffff;
        border: 1px solid #cbd5e1;
        color: #1e293b;
        border-radius: 999px;
        padding: 2px 8px;
        font-size: 10px;
        font-weight: 800;
      }
      .pill-work {
        display: inline-block;
        background: #0f172a;
        color: #ffffff;
        border-radius: 999px;
        padding: 2px 8px;
        font-size: 10px;
        font-weight: 700;
      }
      .pay-sub {
        font-size: 10px;
        color: #475569;
        margin-top: 2px;
      }
      .order-grid {
        display: grid;
        grid-template-columns: 34% 66%;
        gap: 0;
      }
      .order-client {
        padding: 11px 14px;
        border-right: 1px solid #e5e7eb;
        background: #fafafa;
      }
      .order-items {
        padding: 11px 14px;
      }
      .section-cap {
        font-size: 9.5px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #64748b;
        margin-bottom: 6px;
      }
      .client-name {
        font-size: 13px;
        font-weight: 800;
        color: #0f172a;
      }
      .client-line {
        font-size: 11px;
        color: #334155;
        margin-top: 2px;
      }
      .client-addr {
        font-size: 11px;
        font-weight: 600;
        color: #1e293b;
        white-space: pre-line;
        margin-top: 4px;
      }
      .client-ship {
        font-size: 10.5px;
        color: #0369a1;
        margin-top: 4px;
      }
      .note-box {
        margin-top: 7px;
        font-size: 10.5px;
        background: #fef3c7;
        border: 1px solid #fde68a;
        color: #92400e;
        padding: 5px 8px;
        border-radius: 8px;
      }
      .item-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 0;
        border-bottom: 1px solid #f1f5f9;
      }
      .item-row:last-child {
        border-bottom: none;
        padding-bottom: 0;
      }
      .thumb-frame {
        width: 50px;
        height: 50px;
        flex-shrink: 0;
        border-radius: 10px;
        border: 1px solid rgba(15, 23, 42, 0.16);
        padding: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }
      .thumb-frame img, .thumb-mini img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        display: block;
      }
      .thumb-mini {
        width: 38px;
        height: 38px;
        margin: 0 auto;
        border-radius: 8px;
        border: 1px solid rgba(15, 23, 42, 0.16);
        padding: 3px;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }
      .thumb-plain {
        font-size: 18px;
      }
      .item-meta {
        flex: 1;
        min-width: 0;
      }
      .item-top {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 5px;
      }
      .item-design {
        margin-top: 3px;
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        font-size: 11px;
        color: #1e293b;
      }
      .pill-side {
        display: inline-block;
        background: #f1f5f9;
        border: 1px solid #cbd5e1;
        border-radius: 999px;
        padding: 1px 7px;
        font-size: 9.5px;
        font-weight: 700;
        color: #334155;
      }
      .muted {
        color: #64748b;
        font-size: 10.5px;
      }
    `;

    const bodyHtml = `
      <div class="header">
        <div>
          <h1>${esc(settings.storeName || 'Creativos Gift Shop')} · ${esc(periodLabel)}</h1>
          <div class="sub">Guía Visual de Taller y Pedidos · Imagen de diseño, color, talla, entrega y pago</div>
        </div>
        <div class="right">
          <div class="bold">Impreso el</div>
          <div class="sub">${esc(fmtDateTime(Date.now()))}</div>
        </div>
      </div>

      <div class="kpi-grid">
        <div class="kpi">
          <div class="lbl">Pedidos Activos</div>
          <div class="val">${activeOrders.length} pedidos (${totalUnits} camisas)</div>
        </div>
        <div class="kpi">
          <div class="lbl">Total Vendido</div>
          <div class="val">${esc(money(totalRevenue))}</div>
        </div>
        <div class="kpi">
          <div class="lbl">Ya Pagado / Cobrado</div>
          <div class="val" style="color:#15803d;">${esc(money(totalPaid))}</div>
        </div>
        <div class="kpi">
          <div class="lbl">Pendiente por Cobrar</div>
          <div class="val" style="color:#dc2626;">${esc(money(totalPending))}</div>
        </div>
      </div>

      <h2>📦 Detalle Visual de Pedidos (${activeOrders.length})</h2>
      ${
        ordersCardsHtml.length > 0
          ? ordersCardsHtml.join('')
          : `<div style="border:1px dashed #cbd5e1;border-radius:12px;padding:18px;text-align:center;color:#64748b;">No hay pedidos para mostrar en esta selección</div>`
      }

      ${pickingHtml}
    `;

    const fullHtml = buildPrintHtml(`${periodLabel} - ${settings.storeName}`, bodyHtml, appleCardsCss);
    win.document.open();
    win.document.write(fullHtml);
    win.document.close();
  })();
}

/**
 * Imprime el comprobante detallado de un Lote de Ingreso (ING-XXXX) o Cuadre Físico (CUA-XXXX)
 * mostrando qué había antes, cuánto ingresó o se ajustó ese día, y cuánto quedó en sistema.
 */
export function printStockEntryReport(state: AppState, entry: StockEntry): void {
  const { settings } = state;
  const code = entry.folio;
  const entryDay = dayKey(entry.createdAt);
  const totalUnits = entry.lines.reduce((s, l) => s + l.qty, 0);
  const isCuadre = entry.kind === 'cuadre';

  const brandMap = new Map(state.brands.map((b) => [b.id, b]));
  const colorMap = new Map(state.colors.map((c) => [c.id, c]));

  const rowsHtml = entry.lines
    .map((ln) => {
      const { brandId, colorId, size } = parseVKey(ln.key);
      const brand = brandMap.get(brandId);
      const color = colorMap.get(colorId);
      const diffLabel = ln.qty > 0 ? `+${ln.qty}` : `${ln.qty}`;
      const diffStyle =
        ln.qty > 0
          ? 'color:#15803d;font-weight:900;'
          : ln.qty < 0
          ? 'color:#dc2626;font-weight:900;'
          : 'color:#64748b;';

      return `
        <tr>
          <td class="bold">${esc(brand?.name || brandId)}</td>
          <td>
            <span class="swatch" style="background:${esc(color?.hex || '#111111')}"></span>
            <span class="bold">${esc(color?.name || colorId)}</span>
          </td>
          <td class="center"><span class="badge-size">${esc(size)}</span></td>
          <td class="right">${ln.before}</td>
          <td class="right" style="${diffStyle}">${esc(diffLabel)}</td>
          <td class="right bold" style="font-size:13px;">${ln.after}</td>
        </tr>
      `;
    })
    .join('');

  const bodyHtml = `
    <div class="header">
      <div>
        <h1>${esc(settings.storeName || 'Creativos Gift Shop')} · ${
    isCuadre ? 'Acta de Cuadre Físico' : 'Comprobante de Ingreso de Inventario'
  }</h1>
        <div class="sub">Folio: <strong>${esc(code)}</strong> · Fecha: ${esc(entryDay)} · Nota: ${esc(entry.note || '—')}</div>
      </div>
      <div class="right">
        <div class="bold">Registrado el</div>
        <div class="sub">${esc(fmtDateTime(entry.createdAt))}</div>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi">
        <div class="lbl">Folio</div>
        <div class="val">${esc(code)}</div>
      </div>
      <div class="kpi">
        <div class="lbl">Fecha del Día</div>
        <div class="val">${esc(entryDay)}</div>
      </div>
      <div class="kpi">
        <div class="lbl">${isCuadre ? 'Diferencia Neta' : 'Unidades Ingresadas'}</div>
        <div class="val" style="color:#15803d;">${totalUnits > 0 ? `+${totalUnits}` : totalUnits} uds</div>
      </div>
      <div class="kpi">
        <div class="lbl">Tallas / Variantes</div>
        <div class="val">${entry.lines.length}</div>
      </div>
    </div>

    <h2>📋 Comparación: Lo que Había vs ${isCuadre ? 'Ajuste de Cuadre' : 'Lo que Ingresó'} vs Lo que Quedó</h2>
    <table>
      <thead>
        <tr>
          <th>Marca</th>
          <th>Color</th>
          <th class="center">Talla</th>
          <th class="right">Había (Antes)</th>
          <th class="right">${isCuadre ? 'Diferencia' : 'Ingresó (+)'}</th>
          <th class="right">Quedó (Hay)</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  `;

  openPrintDocument(`${code} - ${settings.storeName}`, bodyHtml);
}

