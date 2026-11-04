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

  // Encabezado morado
  rectFill(0, 0, W, 52, 76, 29, 149);
  drawText(settings.storeName, M, 24, 14, true, [255, 255, 255]);
  const sub = [settings.storeAddress, settings.storeCity, settings.storePhone].filter(Boolean).join(' · ');
  drawText(sub, M, 40, 8, false, [221, 214, 254]);
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
