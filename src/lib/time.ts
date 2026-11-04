export const TZ = 'America/Tegucigalpa';

const dayKeyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

/** Clave de día local de Honduras: "2026-11-03" (corte a medianoche local). */
export function dayKey(ts: number | Date = Date.now()): string {
  return dayKeyFmt.format(typeof ts === 'number' ? new Date(ts) : ts);
}

/** Honduras no usa horario de verano: UTC-6 fijo. */
const OFFSET_MS = 6 * 60 * 60 * 1000;

/** Timestamp UTC de la medianoche local (Honduras) del día dado "YYYY-MM-DD". */
export function startOfDayTs(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d) + OFFSET_MS;
}

export function addDays(key: string, days: number): string {
  return dayKey(startOfDayTs(key) + days * 86400000 + 3600000);
}

const dateTimeFmt = new Intl.DateTimeFormat('es-HN', {
  timeZone: TZ,
  day: '2-digit',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit'
});

const dateFmt = new Intl.DateTimeFormat('es-HN', {
  timeZone: TZ,
  day: '2-digit',
  month: 'short',
  year: 'numeric'
});

export function fmtDateTime(ts: number): string {
  return dateTimeFmt.format(new Date(ts));
}

export function fmtDate(ts: number): string {
  return dateFmt.format(new Date(ts));
}
