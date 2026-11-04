import type { Order, Settings } from './types';
import { money } from './money';
import { folioLabel } from './ids';

export function normalizePhone(phone: string): string {
  let d = (phone || '').replace(/\D/g, '');
  if (d.length === 8) d = '504' + d;
  return d;
}

export function fillTemplate(tpl: string, o: Order, settings: Settings): string {
  const vars: Record<string, string> = {
    cliente: o.shipTo.name || 'cliente',
    folio: folioLabel(o.folio),
    tienda: settings.storeName,
    transportista: o.carrier || '—',
    guia: o.trackingNumber || '—',
    rastreo: o.trackingUrl ? `Rastreo: ${o.trackingUrl}` : '',
    total: money(o.total),
    saldo: money(o.balance),
    unidades: String(o.items.reduce((s, i) => s + i.qty, 0))
  };
  return tpl
    .replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function whatsappUrl(phone: string, text: string): string {
  const p = normalizePhone(phone);
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}
