import type { Order, Settings } from './types';
import { money } from './money';
import { folioLabel } from './ids';
import { dayKey, fmtDate, fmtDateTime } from './time';
import { downloadBlob } from './csv';
import { STATUS_LABEL } from './actions';
import { getState } from './store';
import { lookupOrderDesignThumb, resolveOrderPhotosMap } from './printReports';

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

/** Carga una imagen de diseño de forma segura (sin ensuciar el canvas por CORS). */
async function loadImageSafe(src: string): Promise<HTMLImageElement | null> {
  if (!src) return null;
  let objectUrl: string | null = null;
  try {
    let resolvedSrc = src;
    if (src.startsWith('http://') || src.startsWith('https://')) {
      const resp = await fetch(src, { mode: 'cors' });
      if (!resp.ok) return null;
      const blob = await resp.blob();
      objectUrl = URL.createObjectURL(blob);
      resolvedSrc = objectUrl;
    }
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('image_load_error'));
      i.src = resolvedSrc;
    });
  } catch {
    return null;
  } finally {
    if (objectUrl) {
      setTimeout(() => URL.revokeObjectURL(objectUrl!), 3000);
    }
  }
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export async function sharePdfFileNative(
  file: File,
  opts: { title: string; text?: string }
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof nav.share === 'function') {
    const canFiles = typeof nav.canShare === 'function' ? nav.canShare({ files: [file] }) : true;
    if (canFiles) {
      try {
        await nav.share({ files: [file], title: opts.title, text: opts.text || opts.title });
        return 'shared';
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return 'cancelled';
      }
    }
  }
  downloadBlob(file.name, file);
  return 'downloaded';
}

export async function shareLabel(o: Order, settings: Settings): Promise<'shared' | 'downloaded'> {
  const file = await buildLabel(o, settings);
  const res = await sharePdfFileNative(file, {
    title: file.name,
    text: `Guía ${folioLabel(o.folio)}`
  });
  return res === 'downloaded' ? 'downloaded' : 'shared';
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
    const img = await loadImageSafe(input.designUrl);
    if (img) {
      const pad = 28;
      const availW = boxW - pad * 2;
      const availH = boxH - pad * 2;
      const scale = Math.min(availW / (img.naturalWidth || 1), availH / (img.naturalHeight || 1));
      const dw = (img.naturalWidth || 1) * scale;
      const dh = (img.naturalHeight || 1) * scale;
      const dx = boxX + (boxW - dw) / 2;
      const dy = boxY + (boxH - dh) / 2;
      ctx.drawImage(img, dx, dy, dw, dh);
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

/** Empaqueta uno o varios lienzos HTMLCanvasElement dentro de un archivo PDF 1.4 multipágina real. */
export function packCanvasesToPdfFile(
  canvases: HTMLCanvasElement[],
  filename: string,
  pageW = 595,
  pageH = 842
): File {
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

  const n = Math.max(1, canvases.length);
  const pageObjNums: number[] = [];
  for (let i = 0; i < n; i++) {
    pageObjNums.push(3 + i * 3);
  }

  // Obj 1: Catalog
  offsets.push(pos);
  pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // Obj 2: Pages
  offsets.push(pos);
  pushStr(
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjNums.map((id) => `${id} 0 R`).join(' ')}] /Count ${n} >>\nendobj\n`
  );

  for (let i = 0; i < n; i++) {
    const canvas = canvases[i];
    const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.9);
    const b64 = jpegDataUrl.split(',')[1] || '';
    const binStr = atob(b64);
    const imgBytes = new Uint8Array(binStr.length);
    for (let j = 0; j < binStr.length; j++) {
      imgBytes[j] = binStr.charCodeAt(j);
    }

    const pageObj = 3 + i * 3;
    const imgObj = pageObj + 1;
    const contObj = pageObj + 2;
    const contentStream = `q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im1 Do\nQ`;

    // Page object
    offsets.push(pos);
    pushStr(
      `${pageObj} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im1 ${imgObj} 0 R >> >> /Contents ${contObj} 0 R >>\nendobj\n`
    );

    // Image XObject (JPEG DCTDecode)
    offsets.push(pos);
    pushStr(
      `${imgObj} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgBytes.length} >>\nstream\n`
    );
    pushBytes(imgBytes);
    pushStr('\nendstream\nendobj\n');

    // Content stream
    offsets.push(pos);
    pushStr(
      `${contObj} 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream\nendobj\n`
    );
  }

  const totalObjs = 2 + n * 3;
  const xrefPos = pos;
  pushStr(`xref\n0 ${totalObjs + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= totalObjs; i++) {
    pushStr(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  pushStr(`trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`);

  const blob = new Blob(chunks, { type: 'application/pdf' });
  return new File([blob], filename, { type: 'application/pdf' });
}

/**
 * Empaqueta el lienzo visual (con la fotito del diseño, color, talla y cliente)
 * dentro de un archivo PDF 1.4 real listo para enviar por WhatsApp o descargar.
 */
export async function buildCatalogOrderPdfFile(input: CatalogOrderCardInput): Promise<File> {
  const canvas = await renderCatalogOrderCardCanvas(input);
  const shortId = input.orderId.slice(0, 6).toUpperCase();
  return packCanvasesToPdfFile([canvas], `Pedido-${shortId}.pdf`, 360, 460);
}

function wrapCanvasTextByWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of (text || '').split(/\r?\n/)) {
    const words = para.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    let cur = words[0];
    for (let i = 1; i < words.length; i++) {
      const candidate = `${cur} ${words[i]}`;
      if (ctx.measureText(candidate).width <= maxWidth) {
        cur = candidate;
      } else {
        lines.push(cur);
        cur = words[i];
      }
    }
    lines.push(cur);
  }
  return lines;
}

/**
 * Genera el PDF multipágina de Orden de Taller / Pedidos del Día con miniaturas
 * de los diseños sobre el color de camisa, tallas, notas de producción y saldo.
 * Funciona 100% offline/PWA sin depender de window.open ni de diálogos del navegador.
 */
export async function buildWorkshopOrdersPdfFile(
  rawOrders: Order[],
  settings: Settings,
  title = 'Orden de Taller'
): Promise<{ file: File; previewUrls: string[] }> {
  const orders = rawOrders.filter((o) => !o.deleted && o.status !== 'cancelado');
  const targetOrders = orders.length > 0 ? orders : rawOrders.filter((o) => !o.deleted);
  const photoMap = await resolveOrderPhotosMap(targetOrders);
  const catalogDesigns = getState().catalogDesigns || [];

  // Precargar HTMLImageElements únicos por src para no decodificar repetido
  const decodedCache = new Map<string, HTMLImageElement | null>();
  const getDecoded = async (src: string | null): Promise<HTMLImageElement | null> => {
    if (!src) return null;
    if (decodedCache.has(src)) return decodedCache.get(src) || null;
    const img = await loadImageSafe(src);
    decodedCache.set(src, img);
    return img;
  };

  const W = 900;
  const H = 1272;
  const M = 36;
  const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif';

  const pages: HTMLCanvasElement[] = [];

  const createPage = (pageNum: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; y: number } => {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#F5F5F7';
    ctx.fillRect(0, 0, W, H);

    // Cabecera superior tipo Apple
    ctx.fillStyle = '#0F172A';
    drawRoundedRect(ctx, M, M, W - M * 2, pageNum === 1 ? 86 : 58, 18);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = `800 ${pageNum === 1 ? 22 : 17}px ${FONT}`;
    ctx.fillText(settings.storeName || 'Creativos Gift Shop', M + 20, M + (pageNum === 1 ? 36 : 36));

    if (pageNum === 1) {
      ctx.fillStyle = '#94A3B8';
      ctx.font = `600 13px ${FONT}`;
      ctx.fillText(title, M + 20, M + 62);
    }

    ctx.textAlign = 'right';
    ctx.fillStyle = '#38BDF8';
    ctx.font = `700 13px ${FONT}`;
    ctx.fillText(fmtDateTime(Date.now()), W - M - 20, M + (pageNum === 1 ? 36 : 36));
    if (pageNum === 1) {
      ctx.fillStyle = '#E2E8F0';
      const units = targetOrders.reduce((s, o) => s + o.items.reduce((a, b) => a + b.qty, 0), 0);
      ctx.fillText(`${targetOrders.length} pedido(s) · ${units} prenda(s)`, W - M - 20, M + 62);
    }
    ctx.textAlign = 'left';

    pages.push(canvas);
    return { canvas, ctx, y: M + (pageNum === 1 ? 104 : 74) };
  };

  let cur = createPage(1);

  if (targetOrders.length === 0) {
    cur.ctx.fillStyle = '#FFFFFF';
    drawRoundedRect(cur.ctx, M, cur.y, W - M * 2, 120, 20);
    cur.ctx.fill();
    cur.ctx.fillStyle = '#64748B';
    cur.ctx.font = `700 16px ${FONT}`;
    cur.ctx.textAlign = 'center';
    cur.ctx.fillText('No hay pedidos activos para exportar', W / 2, cur.y + 66);
    cur.ctx.textAlign = 'left';
  }

  for (const o of targetOrders) {
    // Calcular dimensiones estimadas de la tarjeta del pedido
    const measureCtx = cur.ctx;
    measureCtx.font = `600 13px ${FONT}`;
    const noteLines = o.notes ? wrapCanvasTextByWidth(measureCtx, `Nota taller: ${o.notes}`, W - M * 2 - 44).slice(0, 4) : [];
    const addrLine = o.shipTo.address?.trim() ? `Entrega: ${o.shipTo.address.trim()}` : 'Entrega / Recoge en tienda';
    const addrLines = wrapCanvasTextByWidth(measureCtx, addrLine, W - M * 2 - 44).slice(0, 2);

    const headH = 54;
    const clientH = 52 + addrLines.length * 18 + (noteLines.length > 0 ? 18 + noteLines.length * 18 : 0);
    const rowH = 88;
    const totalCardH = headH + clientH + o.items.length * rowH + 22;

    if (cur.y + Math.min(totalCardH, headH + clientH + rowH + 24) > H - M - 28) {
      cur = createPage(pages.length + 1);
    }

    const drawOrderHeaderAndClient = (ctx: CanvasRenderingContext2D, startY: number, isCont = false): number => {
      const cardW = W - M * 2;
      // Fondo cabecera
      ctx.fillStyle = '#FFFFFF';
      drawRoundedRect(ctx, M, startY, cardW, headH + (isCont ? 0 : clientH), 18);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#CBD5E1';
      ctx.stroke();

      ctx.save();
      drawRoundedRect(ctx, M, startY, cardW, headH, 18);
      ctx.clip();
      ctx.fillStyle = '#F8FAFC';
      ctx.fillRect(M, startY, cardW, headH);
      ctx.restore();

      ctx.beginPath();
      ctx.moveTo(M, startY + headH);
      ctx.lineTo(M + cardW, startY + headH);
      ctx.strokeStyle = '#E2E8F0';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Folio y Trabajo
      ctx.fillStyle = '#0F172A';
      ctx.font = `900 18px ${FONT}`;
      ctx.fillText(folioLabel(o.folio) + (isCont ? ' (cont.)' : ''), M + 18, startY + 33);

      ctx.fillStyle = '#E2E8F0';
      const workTxt = o.workType || 'DTF';
      ctx.font = `700 12px ${FONT}`;
      const workW = Math.min(200, ctx.measureText(workTxt).width + 22);
      drawRoundedRect(ctx, M + 148, startY + 14, workW, 26, 13);
      ctx.fill();
      ctx.fillStyle = '#1E293B';
      ctx.fillText(workTxt, M + 159, startY + 31);

      ctx.fillStyle = '#64748B';
      ctx.font = `600 11px ${FONT}`;
      ctx.fillText(STATUS_LABEL[o.status] || o.status, M + 158 + workW, startY + 31);

      // Estado de pago derecha
      const isPaid = o.balance <= 0;
      const isPendingStore = o.balance > 0 && o.deposit <= 0;
      const payLabel = isPaid
        ? `PAGADO 100% · ${money(o.total)}`
        : isPendingStore
        ? `PAGO PENDIENTE TIENDA · ${money(o.balance)}`
        : `SALDO PENDIENTE · ${money(o.balance)}`;
      ctx.font = `800 12px ${FONT}`;
      const payW = ctx.measureText(payLabel).width + 22;
      ctx.fillStyle = isPaid ? '#DCFCE7' : isPendingStore ? '#FEF3C7' : '#FEE2E2';
      drawRoundedRect(ctx, M + cardW - payW - 14, startY + 13, payW, 28, 10);
      ctx.fill();
      ctx.fillStyle = isPaid ? '#166534' : isPendingStore ? '#92400E' : '#991B1B';
      ctx.textAlign = 'right';
      ctx.fillText(payLabel, M + cardW - 25, startY + 31);
      ctx.textAlign = 'left';

      if (isCont) return startY + headH + 8;

      let cy = startY + headH + 22;
      ctx.fillStyle = '#0F172A';
      ctx.font = `800 15px ${FONT}`;
      const clientTitle = `Cliente: ${o.shipTo.name || 'Consumidor Final'}${o.shipTo.phone ? `   ·   Tel: ${o.shipTo.phone}` : ''}`;
      ctx.fillText(clientTitle.slice(0, 74), M + 18, cy);

      cy += 20;
      ctx.fillStyle = '#334155';
      ctx.font = `600 13px ${FONT}`;
      for (const ln of addrLines) {
        ctx.fillText(ln, M + 18, cy);
        cy += 18;
      }

      if (noteLines.length > 0) {
        cy += 4;
        const nBoxH = noteLines.length * 18 + 14;
        ctx.fillStyle = '#FEF3C7';
        drawRoundedRect(ctx, M + 14, cy - 12, cardW - 28, nBoxH, 10);
        ctx.fill();
        ctx.fillStyle = '#92400E';
        ctx.font = `700 12.5px ${FONT}`;
        for (const nln of noteLines) {
          ctx.fillText(nln, M + 24, cy + 4);
          cy += 18;
        }
        cy += 4;
      }

      return startY + headH + clientH;
    };

    let y = drawOrderHeaderAndClient(cur.ctx, cur.y, false);

    // Pre-cargar miniaturas de las prendas del pedido
    const orderFallbackImg = lookupOrderDesignThumb(
      { photoId: o.photoId, designId: o.designId, designCode: o.designCode, designName: o.designName },
      photoMap,
      catalogDesigns
    );

    for (let idx = 0; idx < o.items.length; idx++) {
      const it = o.items[idx];
      if (y + rowH > H - M - 26) {
        cur = createPage(pages.length + 1);
        y = drawOrderHeaderAndClient(cur.ctx, cur.y, true);
      }

      const ctx = cur.ctx;
      const cardW = W - M * 2;
      ctx.fillStyle = '#FFFFFF';
      drawRoundedRect(ctx, M, y, cardW, rowH - 6, 14);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#E2E8F0';
      ctx.stroke();

      // Recuadro miniatura del diseño sobre color de camisa
      const thumbSize = 68;
      const tx = M + 14;
      const ty = y + 7;
      ctx.fillStyle = it.colorHex || '#1A1A1C';
      drawRoundedRect(ctx, tx, ty, thumbSize, thumbSize, 12);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(15,23,42,0.18)';
      ctx.stroke();

      const itemImgSrc =
        lookupOrderDesignThumb(
          {
            photoId: it.photoId,
            photoUrl: it.photoUrl,
            designId: it.designId || o.designId,
            designCode: it.designCode || o.designCode,
            designName: it.designName || o.designName,
            orderPhotoId: o.photoId
          },
          photoMap,
          catalogDesigns
        ) || (o.photoId || o.designName ? orderFallbackImg : null);

      const loadedImg = await getDecoded(itemImgSrc);
      const hasPrint = Boolean(
        it.designName || it.photoId || (o.designName && !o.workType.toLowerCase().includes('lisa')) || o.photoId
      );

      if (loadedImg) {
        const pad = 6;
        const avail = thumbSize - pad * 2;
        const sc = Math.min(avail / (loadedImg.naturalWidth || 1), avail / (loadedImg.naturalHeight || 1));
        const dw = (loadedImg.naturalWidth || 1) * sc;
        const dh = (loadedImg.naturalHeight || 1) * sc;
        ctx.drawImage(loadedImg, tx + (thumbSize - dw) / 2, ty + (thumbSize - dh) / 2, dw, dh);
      } else {
        ctx.fillStyle = '#94A3B8';
        ctx.font = `700 10px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(hasPrint ? 'DISEÑO' : 'LISA', tx + thumbSize / 2, ty + thumbSize / 2 + 4);
        ctx.textAlign = 'left';
      }

      // Meta de prenda
      const mx = tx + thumbSize + 16;
      ctx.beginPath();
      ctx.arc(mx + 7, y + 25, 7, 0, Math.PI * 2);
      ctx.fillStyle = it.colorHex || '#111827';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#64748B';
      ctx.stroke();

      ctx.fillStyle = '#0F172A';
      ctx.font = `800 15px ${FONT}`;
      ctx.fillText(`${it.brandName} · ${it.colorName}`, mx + 20, y + 30);

      const designTitle = it.designName
        ? `${it.designCode ? `[${it.designCode}] ` : ''}${it.designName}`
        : hasPrint
        ? o.designName
          ? `${o.designCode ? `[${o.designCode}] ` : ''}${o.designName}`
          : 'Diseño Personalizado'
        : 'Camisa Lisa (Sin estampado)';
      const rawPlace = it.placement || o.placement;
      const sideLabel = hasPrint
        ? rawPlace === 'back'
          ? 'ESPALDA'
          : rawPlace === 'pocket'
          ? 'BOLSILLO'
          : 'FRENTE'
        : 'LISA';

      ctx.fillStyle = '#334155';
      ctx.font = `700 13.5px ${FONT}`;
      const designShort = designTitle.length > 42 ? `${designTitle.slice(0, 41)}…` : designTitle;
      ctx.fillText(designShort, mx, y + 54);

      const dWidth = ctx.measureText(designShort).width;
      ctx.fillStyle = hasPrint ? '#EFF6FF' : '#F1F5F9';
      drawRoundedRect(ctx, mx + dWidth + 10, y + 39, 82, 20, 10);
      ctx.fill();
      ctx.fillStyle = hasPrint ? '#1D4ED8' : '#475569';
      ctx.font = `800 10.5px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(sideLabel, mx + dWidth + 51, y + 53);
      ctx.textAlign = 'left';

      // Talla x Cantidad grande a la derecha
      const badgeW = 128;
      const badgeH = 44;
      ctx.fillStyle = '#0F172A';
      drawRoundedRect(ctx, M + cardW - badgeW - 14, y + 19, badgeW, badgeH, 12);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `900 18px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(`${it.size} × ${it.qty}`, M + cardW - 14 - badgeW / 2, y + 47);
      ctx.textAlign = 'left';

      y += rowH;
    }

    cur.y = y + 14;
  }

  // Numeración de pie de página
  pages.forEach((canvas, idx) => {
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#64748B';
    ctx.font = `600 11px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(`Página ${idx + 1} de ${pages.length} · ${settings.storeName}`, W / 2, H - 14);
    ctx.textAlign = 'left';
  });

  const filename =
    targetOrders.length === 1
      ? `Taller-${String(targetOrders[0].folio).padStart(8, '0')}.pdf`
      : `Cola-Taller-${dayKey()}.pdf`;
  const file = packCanvasesToPdfFile(pages, filename, 595, 842);
  const previewUrls = pages.map((c) => c.toDataURL('image/jpeg', 0.85));
  return { file, previewUrls };
}

