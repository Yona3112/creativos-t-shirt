export function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function slug(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Código corto de color para el SKU: "Azul Marino" -> "AZM", "Negro" -> "NEG" */
export function colorCode(name: string, taken: string[] = []): string {
  const clean = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .trim();
  const words = clean.split(/\s+/).filter(Boolean);
  let base =
    words.length > 1 ? (words[0].slice(0, 2) + words[1].slice(0, 1)) : (words[0] || 'COL').slice(0, 3);
  base = base.padEnd(3, 'X');
  let code = base;
  let i = 2;
  while (taken.includes(code)) {
    code = `${base}${i++}`;
  }
  return code;
}

export function folioLabel(folio: number): string {
  return `#${String(folio).padStart(8, '0')}`;
}

export function getDeviceId(): string {
  const k = 'cgs_device_id';
  let id = localStorage.getItem(k);
  if (!id) {
    id = uid();
    localStorage.setItem(k, id);
  }
  return id;
}
