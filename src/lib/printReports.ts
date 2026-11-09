import type { AppState, Order, Settings } from './types';
import { activeBrands, brandColors, computeStock, lowColorStockList, vkey } from './inventory';
import { money } from './money';
import { folioLabel } from './ids';
import { fmtDateTime } from './time';
import { STATUS_LABEL } from './actions';
import { toast } from '../components/ui';

function esc(s: string | number | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function openPrintDocument(title: string, bodyHtml: string): void {
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${esc(title)}</title>
  <style>
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
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
    @media print {
      body { padding: 0; }
      .no-print { display: none !important; }
      tr { page-break-inside: avoid; }
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
    window.addEventListener('load', function() {
      setTimeout(function() { window.print(); }, 250);
    });
  </script>
</body>
</html>`;

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
 * Imprime los Pedidos del Día (o lista filtrada) detallando:
 * Talla, Diseño, Color, Nombre del Cliente, Dirección (si tiene), Si ya pagó o cuánto debe, Método de pago y Estado.
 */
export function printDailyOrdersReport(
  orders: Order[],
  settings: Settings,
  periodLabel = 'Pedidos del Día'
): void {
  const activeOrders = orders.filter((o) => !o.deleted && o.status !== 'cancelado');

  let totalRevenue = 0;
  let totalPaid = 0;
  let totalPending = 0;
  let totalUnits = 0;

  // Agrupación para picking/taller por Marca + Color + Talla + Diseño
  const pickingMap = new Map<
    string,
    {
      brandName: string;
      colorName: string;
      colorHex: string;
      size: string;
      designLabel: string;
      workType: string;
      qty: number;
    }
  >();

  for (const o of activeOrders) {
    totalRevenue += o.total;
    totalPaid += o.deposit;
    totalPending += o.balance;
    const designLabel = o.designName
      ? `${o.designCode ? `[${o.designCode}] ` : ''}${o.designName}${
          o.placement ? ` (${o.placement === 'back' ? 'Espalda' : 'Frente'})` : ''
        }`
      : o.workType.toLowerCase().includes('lisa')
      ? 'Camisa Lisa'
      : o.workType;

    for (const it of o.items) {
      totalUnits += it.qty;
      const pKey = `${it.brandName}|${it.colorName}|${it.size}|${designLabel}`;
      const prev = pickingMap.get(pKey);
      if (prev) {
        prev.qty += it.qty;
      } else {
        pickingMap.set(pKey, {
          brandName: it.brandName,
          colorName: it.colorName,
          colorHex: it.colorHex,
          size: it.size,
          designLabel,
          workType: o.workType,
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

  const ordersRowsHtml = activeOrders.map((o) => {
    const isPaid = o.balance <= 0;
    const designLabel = o.designName
      ? `${o.designCode ? `[${o.designCode}] ` : ''}${o.designName}`
      : o.photoId
      ? 'Diseño Personalizado'
      : 'Camisa Lisa';
    const placementLabel = o.photoId || o.designName
      ? o.placement === 'back'
        ? 'Espalda'
        : 'Frente'
      : '—';

    const itemsHtml = o.items
      .map(
        (it) => `
        <div style="margin-bottom:4px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span class="badge-size">${esc(it.size)} × ${it.qty}</span>
          <span>
            <span class="swatch" style="background:${esc(it.colorHex)}"></span>
            <strong>${esc(it.colorName)}</strong>
            <span style="color:#64748b;font-size:10.5px;">(${esc(it.brandName)})</span>
          </span>
        </div>
      `
      )
      .join('');

    const paymentHtml = isPaid
      ? `
        <div><span class="badge badge-paid">✅ YA PAGÓ 100%</span></div>
        <div style="margin-top:3px;font-size:11px;"><strong>Total:</strong> ${esc(money(o.total))}</div>
        <div style="font-size:10px;color:#475569;">Método: ${esc(o.paymentMethod)}</div>
      `
      : `
        <div><span class="badge badge-unpaid">⚠️ PENDIENTE: ${esc(money(o.balance))}</span></div>
        <div style="margin-top:3px;font-size:10.5px;">
          Total: <strong>${esc(money(o.total))}</strong> · Abonó: ${esc(money(o.deposit))}
        </div>
        <div style="font-size:10px;color:#475569;">Método: ${esc(o.paymentMethod)}</div>
      `;

    const addressHtml = o.shipTo.address?.trim()
      ? `<div style="white-space:pre-line;font-weight:600;color:#1e293b;">📍 ${esc(o.shipTo.address.trim())}</div>`
      : `<div style="color:#64748b;font-style:italic;">Entrega en tienda / Sin dirección</div>`;

    return `
      <tr>
        <td>
          <div class="bold" style="font-family:monospace;font-size:12.5px;">${esc(folioLabel(o.folio))}</div>
          <div style="font-size:10px;color:#64748b;">${esc(fmtDateTime(o.createdAt))}</div>
          <div style="margin-top:3px;"><span class="badge" style="background:#e2e8f0;color:#1e293b;">${esc(STATUS_LABEL[o.status])}</span></div>
        </td>
        <td>
          <div class="bold" style="font-size:12.5px;">${esc(o.shipTo.name || 'Cliente Mostrador')}</div>
          ${o.shipTo.phone ? `<div style="font-size:11px;color:#334155;">📞 ${esc(o.shipTo.phone)}</div>` : ''}
        </td>
        <td>
          ${addressHtml}
          ${
            o.carrier || o.trackingNumber
              ? `<div style="margin-top:3px;font-size:10px;color:#0369a1;">🚚 ${esc(o.carrier || 'Envío')} ${
                  o.trackingNumber ? `· Guía: <strong>${esc(o.trackingNumber)}</strong>` : ''
                }</div>`
              : ''
          }
        </td>
        <td>${itemsHtml}</td>
        <td>
          <div class="bold" style="color:#1e293b;">🎨 ${esc(designLabel)}</div>
          <div style="font-size:10.5px;color:#475569;">Trabajo: <strong>${esc(o.workType)}</strong> · Lado: <strong>${esc(placementLabel)}</strong></div>
          ${o.notes ? `<div style="margin-top:3px;font-size:10.5px;background:#fef3c7;padding:2px 5px;border-radius:4px;color:#92400e;">📝 ${esc(o.notes)}</div>` : ''}
        </td>
        <td>${paymentHtml}</td>
      </tr>
    `;
  });

  const pickingHtml =
    pickingList.length > 0
      ? `
    <h2>📋 Resumen de Camisas por Talla, Color y Diseño (Para Sacar de Inventario / Taller)</h2>
    <table>
      <thead>
        <tr>
          <th class="center">Talla</th>
          <th>Color de Camisa</th>
          <th>Marca</th>
          <th>Diseño / Trabajo</th>
          <th class="right">Cantidad</th>
        </tr>
      </thead>
      <tbody>
        ${pickingList
          .map(
            (p) => `
          <tr>
            <td class="center"><span class="badge-size">${esc(p.size)}</span></td>
            <td>
              <span class="swatch" style="background:${esc(p.colorHex)}"></span>
              <span class="bold">${esc(p.colorName)}</span>
            </td>
            <td>${esc(p.brandName)}</td>
            <td class="bold">${esc(p.designLabel)}</td>
            <td class="right bold" style="font-size:13px;">${p.qty} uds</td>
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
        <h1>${esc(settings.storeName || 'Creativos Gift Shop')} · ${esc(periodLabel)}</h1>
        <div class="sub">Reporte por Talla, Diseño, Color, Cliente, Dirección y Estado de Pago</div>
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

    <h2>📦 Detalle de Pedidos (Cliente, Dirección, Talla, Color, Diseño y Pago)</h2>
    <table>
      <thead>
        <tr>
          <th style="width:11%;">Folio / Estado</th>
          <th style="width:16%;">Cliente / Teléfono</th>
          <th style="width:22%;">Dirección de Entrega</th>
          <th style="width:20%;">Talla · Color · Marca</th>
          <th style="width:17%;">Diseño / Trabajo / Notas</th>
          <th style="width:14%;">¿Ya Pagó? / Cobro</th>
        </tr>
      </thead>
      <tbody>
        ${
          ordersRowsHtml.length > 0
            ? ordersRowsHtml.join('')
            : `<tr><td colspan="6" class="center" style="padding:18px;color:#64748b;">No hay pedidos para mostrar en esta selección</td></tr>`
        }
      </tbody>
    </table>

    ${pickingHtml}
  `;

  openPrintDocument(`${periodLabel} - ${settings.storeName}`, bodyHtml);
}
