import type { Cents } from './types';

/** Convierte un valor en lempiras (número o texto) a centavos enteros. */
export function toCents(value: number | string | null | undefined): Cents {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/,/g, ''));
  if (!isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Centavos -> número en lempiras (para inputs). */
export function fromCents(c: Cents): number {
  return Math.round(c) / 100;
}

const fmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Formato "L 1,250.00" */
export function money(c: Cents): string {
  const neg = c < 0;
  return `${neg ? '-' : ''}L ${fmt.format(Math.abs(Math.round(c)) / 100)}`;
}

/** Valor plano para inputs: "300.00" -> "300", "195.5" */
export function centsToInput(c: Cents): string {
  const v = Math.round(c) / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}
