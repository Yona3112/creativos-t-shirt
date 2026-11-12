import type { Order, Settings } from './types';
import { money } from './money';
import { folioLabel } from './ids';
import { fmtDate } from './time';
import { downloadBlob } from './csv';

const WIN_ANSI_MAP: Record<number, number> = {
  0x2013: 0x96, // –
  0x2014: 0x97, // —
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95, // •
  0x2026: 0x85  // …
};

function pdfHex(text: string): string {
  let hex = '<';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    let byte = 0x3f;
    if (code >= 0x20 && code <= 0xff) {
      byte = code;
    } else if (WIN_ANSI_MAP[code] !== undefined) {
      byte = WIN_ANSI_MAP[code];
    }
    hex += byte.toString(16).padStart(2, '0').toUpperCase();
  }
  return hex + '>';
}

function wrapText(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const rawLine of (text || '').split(/\r?\n/)) {
    const words = rawLine.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    let cur = words[0];
    for (let i = 1; i < words.length; i++) {
      if ((cur + ' ' + words[i]).length <= maxChars) {
        cur += ' ' + words[i];
      } else {
        lines.push(cur);
        cur = words[i];
      }
    }
    lines.push(cur);
  }
  return lines;
}

/** Genera la etiqueta de envío 4x6" (guia-00011001.pdf) en PDF 1.4 nativo sin dependencias externas. */
export async function buildLabel(o: Order, settings: Settings): Promise<File> {
  const W = 288; // 4 in * 72 pt
  const H = 432; // 6 in * 72 pt
  const M = 16;
  const ops: string[] = [];

  const rectFill = (x: number, yTop: number, w: number, h: number, r: number, g: number, b: number) => {
    const y = H - yTop - h;
    ops.push(`${(r / 255).toFixed(3)} ${(g / 255).toFixed(3)} ${(b / 255).toFixed(3)} rg`);
    ops.push(`${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f`);
  };

  const rectStroke = (x: number, yTop: number, w: number, h: number, r: number, g: number, b: number, lw = 1.2) => {
    const y = H - yTop - h;
    ops.push(`${lw.toFixed(1)} w`);
    ops.push(`${(r / 255).toFixed(3)} ${(g / 255).toFixed(3)} ${(b / 255).toFixed(3)} RG`);
    ops.push(`${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re S`);
  };

  const hLine = (yTop: number) => {
    const y = H - yTop;
    ops.push('0.8 w 0.82 0.84 0.88 RG');
    ops.push(`${M} ${y.toFixed(1)} m ${W - M} ${y.toFixed(1)} l S`);
  };

  const drawText = (
    txt: string,
    x: number,
    yTop: number,
    size: number,
    bold = false,
    rgb: [number, number, number] = [17, 24, 39]
  ) => {
    const y = H - yTop;
    const font = bold ? '/F2' : '/F1';
    ops.push('BT');
    ops.push(`${(rgb[0] / 255).toFixed(3)} ${(rgb[1] / 255).toFixed(3)} ${(rgb[2] / 255).toFixed(3)} rg`);
    ops.push(`${font} ${size} Tf`);
    ops.push(`1 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)} Tm`);
    ops.push(`${pdfHex(txt)} Tj`);
    ops.push('ET');
  };

  // Encabezado ejecutivo Slate Navy
  rectFill(0, 0, W, 52, 15, 23, 42);
  drawText(settings.storeName, M, 24, 14, true, [255, 255, 255]);
  const sub = [settings.storeAddress, settings.storeCity, settings.storePhone].filter(Boolean).join(' · ');
  drawText(sub, M, 40, 8, false, [186, 230, 253]);
  drawText(folioLabel(o.folio), W - M - 72, 24, 13, true, [255, 255, 255]);

  let y = 72;
  drawText('DESTINATARIO', M, y, 8, true, [100, 116, 139]);
  y += 18;

  for (const line of wrapText(o.shipTo.name || 'Cliente', 26).slice(0, 2)) {
    drawText(line, M, y, 16, true);
    y += 19;
  }

  if (o.shipTo.phone) {
    drawText(`Tel: ${o.shipTo.phone}`, M, y, 12, true, [51, 65, 85]);
    y += 16;
  }

  for (const line of wrapText(o.shipTo.address || 'Entrega en tienda', 36).slice(0, 5)) {
    drawText(line, M, y, 10, false, [51, 65, 85]);
    y += 13;
  }

  y += 6;
  hLine(y);
  y += 16;

  drawText('TRANSPORTISTA', M, y, 8, true, [100, 116, 139]);
  drawText('NÚMERO DE GUÍA', W / 2, y, 8, true, [100, 116, 139]);
  y += 16;

  drawText((o.carrier || '—').slice(0, 22), M, y, 12, true);
  drawText((o.trackingNumber || '—').slice(0, 22), W / 2, y, 12, true);
  y += 16;

  hLine(y);
  y += 16;

  const units = o.items.reduce((s, i) => s + i.qty, 0);
  drawText(`Prendas: ${units}   ·   Trabajo: ${o.workType}`, M, y, 10, true);
  y += 14;
  drawText(`Fecha: ${fmtDate(o.createdAt)}   ·   Total: ${money(o.total)}`, M, y, 9, false, [71, 85, 105]);
  y += 18;

  if (o.balance > 0) {
    rectFill(M, y, W - 2 * M, 50, 220, 38, 38);
    drawText('COBRAR AL ENTREGAR', M + 12, y + 18, 9, true, [255, 255, 255]);
    drawText(money(o.balance), M + 12, y + 40, 18, true, [255, 255, 255]);
  } else {
    rectStroke(M, y, W - 2 * M, 38, 5, 150, 105, 1.5);
    drawText('PAGADO 100%', M + 12, y + 24, 14, true, [5, 150, 105]);
  }

  const stream = ops.join('\n');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj',
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>\nendobj`,
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj',
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj',
    `6 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj`
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj + '\n';
  }
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

  const bytes = new TextEncoder().encode(pdf);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  return new File([blob], `guia-${String(o.folio).padStart(8, '0')}.pdf`, { type: 'application/pdf' });
}

export async function shareLabel(o: Order, settings: Settings): Promise<'shared' | 'downloaded'> {
  const file = await buildLabel(o, settings);
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: file.name, text: `Guía ${folioLabel(o.folio)}` });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'shared';
    }
  }
  downloadBlob(file.name, file);
  return 'downloaded';
}

export interface CatalogOrderCardInput {
  orderId: string;
  storeName: string;
  brandName: string;
  colorName: string;
  colorHex: string;
  size: string;
  qty: number;
  unitPrice: number;
  total: number;
  designName?: string | null;
  designCode?: string | null;
  designUrl?: string | null;
  placement?: string;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  stockNote?: string;
}

/**
 * Dibuja la Ficha Visual del Pedido (estilo Orden de Taller) con la fotito del diseño,
 * el color de la camisa, talla, cantidad, datos del cliente y precio total.
 */
export async function renderCatalogOrderCardCanvas(
  input: CatalogOrderCardInput
): Promise<HTMLCanvasElement> {
  const W = 720;
  const H = 920;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // Fondo general estilo Apple
  ctx.fillStyle = '#F5F5F7';
  ctx.fillRect(0, 0, W, H);

  // Tarjeta blanca principal
  const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  ctx.fillStyle = '#FFFFFF';
  roundRect(28, 28, W - 56, H - 56, 28);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#E2E8F0';
  ctx.stroke();

  // Cabecera oscura
  ctx.save();
  roundRect(28, 28, W - 56, 108, 28);
  ctx.clip();
  ctx.fillStyle = '#0F172A';
  ctx.fillRect(28, 28, W - 56, 108);
  ctx.restore();

  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 28px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText(input.storeName || 'Creativos Gift Shop', 56, 76);

  ctx.fillStyle = '#94A3B8';
  ctx.font = '600 16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText(`FICHA DE PEDIDO · #${input.orderId.slice(0, 8).toUpperCase()}`, 56, 106);

  ctx.fillStyle = '#38BDF8';
  ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(fmtDate(Date.now()), W - 56, 76);
  ctx.fillStyle = '#E2E8F0';
  ctx.fillText(money(input.unitPrice), W - 56, 106);
  ctx.textAlign = 'left';

  // Sección de Vista Previa (Fotito del Diseño sobre el color de camisa)
  const boxX = 56;
  const boxY = 160;
  const boxW = 280;
  const boxH = 280;

  ctx.fillStyle = input.colorHex || '#1A1A1C';
  roundRect(boxX, boxY, boxW, boxH, 24);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#CBD5E1';
  ctx.stroke();

  if (input.designUrl) {
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.crossOrigin = 'anonymous';
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('err'));
        i.src = input.designUrl!;
      });
      const pad = 28;
      const availW = boxW - pad * 2;
      const availH = boxH - pad * 2;
      const scale = Math.min(availW / (img.naturalWidth || 1), availH / (img.naturalHeight || 1));
      const dw = (img.naturalWidth || 1) * scale;
      const dh = (img.naturalHeight || 1) * scale;
      const dx = boxX + (boxW - dw) / 2;
      const dy = boxY + (boxH - dh) / 2;
      ctx.drawImage(img, dx, dy, dw, dh);
    } catch {
      /* mantener recuadro del color */
    }
  } else {
    ctx.fillStyle = '#94A3B8';
    ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('CAMISA LISA', boxX + boxW / 2, boxY + boxH / 2 + 6);
    ctx.textAlign = 'left';
  }

  // Etiqueta sobre la fotito indicando el lado
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  roundRect(boxX + 14, boxY + boxH - 42, boxW - 28, 30, 10);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  const sideText = input.designUrl
    ? input.placement === 'back'
      ? 'ESPALDA · A3'
      : 'FRENTE · A3'
    : 'SIN DISEÑO';
  ctx.fillText(sideText, boxX + boxW / 2, boxY + boxH - 22);
  ctx.textAlign = 'left';

  // Columna derecha: Especificaciones de Taller (Talla, Color, Cantidad, Diseño)
  const rightX = 364;
  let ry = 182;

  // Píldora gigante de TALLA y CANTIDAD
  ctx.fillStyle = '#0F172A';
  roundRect(rightX, ry - 22, 140, 56, 14);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 24px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`TALLA ${input.size}`, rightX + 70, ry + 14);

  ctx.fillStyle = '#EFF6FF';
  roundRect(rightX + 152, ry - 22, 148, 56, 14);
  ctx.fill();
  ctx.fillStyle = '#1E3A8A';
  ctx.font = 'bold 24px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText(`CANT: ${input.qty}`, rightX + 226, ry + 14);
  ctx.textAlign = 'left';

  ry += 66;
  ctx.fillStyle = '#64748B';
  ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText('COLOR Y MARCA', rightX, ry);

  ry += 26;
  ctx.beginPath();
  ctx.arc(rightX + 12, ry - 7, 11, 0, Math.PI * 2);
  ctx.fillStyle = input.colorHex || '#1A1A1C';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#94A3B8';
  ctx.stroke();

  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText(`${input.colorName}`, rightX + 32, ry);

  ry += 24;
  ctx.fillStyle = '#475569';
  ctx.font = '600 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText(input.brandName, rightX, ry);

  ry += 38;
  ctx.fillStyle = '#64748B';
  ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText('DISEÑO SOLICITADO', rightX, ry);

  ry += 24;
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const designTitle = input.designUrl
    ? `${input.designCode ? `[${input.designCode}] ` : ''}${input.designName || 'Diseño'}`
    : 'L 300.00 (Sin diseño)';
  for (const ln of wrapText(designTitle, 26).slice(0, 2)) {
    ctx.fillText(ln, rightX, ry);
    ry += 22;
  }

  if (input.stockNote) {
    ry += 8;
    ctx.fillStyle = '#059669';
    ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText(input.stockNote.slice(0, 36), rightX, ry);
  }

  // Bloque de Datos del Cliente
  const custY = 472;
  ctx.fillStyle = '#F8FAFC';
  roundRect(56, custY, W - 112, 210, 20);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#E2E8F0';
  ctx.stroke();

  let cy = custY + 36;
  ctx.fillStyle = '#64748B';
  ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText('DATOS DEL CLIENTE Y ENTREGA', 80, cy);

  cy += 34;
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 22px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText(`Cliente: ${input.customerName || 'Mostrador / WhatsApp'}`, 80, cy);

  cy += 32;
  ctx.fillStyle = '#334155';
  ctx.font = '600 18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText(`Teléfono: ${input.customerPhone || '—'}`, 80, cy);

  cy += 30;
  ctx.font = '500 16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  for (const ln of wrapText(`Dirección: ${input.customerAddress || 'Coordinar por WhatsApp'}`, 52).slice(0, 2)) {
    ctx.fillText(ln, 80, cy);
    cy += 22;
  }

  // Barra inferior de Total
  const totY = 712;
  ctx.fillStyle = '#0F172A';
  roundRect(56, totY, W - 112, 136, 22);
  ctx.fill();

  ctx.fillStyle = '#94A3B8';
  ctx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText('RESUMEN DE PAGO', 84, totY + 46);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '600 19px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText(`${input.qty} × ${money(input.unitPrice)}`, 84, totY + 84);

  ctx.fillStyle = '#38BDF8';
  ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('TOTAL DEL PEDIDO', W - 84, totY + 46);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 38px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText(money(input.total), W - 84, totY + 94);
  ctx.textAlign = 'left';

  return canvas;
}

/**
 * Empaqueta el lienzo visual (con la fotito del diseño, color, talla y cliente)
 * dentro de un archivo PDF 1.4 real listo para enviar por WhatsApp o descargar.
 */
export async function buildCatalogOrderPdfFile(input: CatalogOrderCardInput): Promise<File> {
  const canvas = await renderCatalogOrderCardCanvas(input);
  const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.92);
  const b64 = jpegDataUrl.split(',')[1] || '';
  const binStr = atob(b64);
  const imgBytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) {
    imgBytes[i] = binStr.charCodeAt(i);
  }

  const pageW = 360;
  const pageH = 460;
  const contentStream = `q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im1 Do\nQ`;

  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0];
  let pos = 0;

  const pushStr = (s: string) => {
    const b = enc.encode(s);
    chunks.push(b);
    pos += b.length;
  };
  const pushBytes = (b: Uint8Array) => {
    chunks.push(b);
    pos += b.length;
  };

  pushStr('%PDF-1.4\n');

  // Obj 1: Catalog
  offsets.push(pos);
  pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // Obj 2: Pages
  offsets.push(pos);
  pushStr('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  // Obj 3: Page
  offsets.push(pos);
  pushStr(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`
  );

  // Obj 4: Image XObject (JPEG DCTDecode)
  offsets.push(pos);
  pushStr(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgBytes.length} >>\nstream\n`
  );
  pushBytes(imgBytes);
  pushStr('\nendstream\nendobj\n');

  // Obj 5: Content stream
  offsets.push(pos);
  pushStr(
    `5 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream\nendobj\n`
  );

  const xrefPos = pos;
  pushStr(`xref\n0 6\n0000000000 65535 f \n`);
  for (let i = 1; i <= 5; i++) {
    pushStr(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  pushStr(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`);

  const blob = new Blob(chunks, { type: 'application/pdf' });
  const shortId = input.orderId.slice(0, 6).toUpperCase();
  return new File([blob], `Pedido-${shortId}.pdf`, { type: 'application/pdf' });
}

