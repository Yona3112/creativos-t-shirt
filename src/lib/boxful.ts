/**
 * Integración con Boxful (Honduras / El Salvador) — https://api.goboxful.com
 *
 * Seguridad: Las credenciales / tokens de Boxful se guardan EXCLUSIVAMENTE en el
 * dispositivo local del administrador (localStorage `cgs_boxful_v1`) y NUNCA se
 * suben a la nube ni al catálogo público.
 */
import type { Order, Settings } from './types';
import { fromCents } from './money';
import { folioLabel } from './ids';

export interface BoxfulConfig {
  env: 'prod' | 'dev';
  email: string;
  password?: string;
  accessToken?: string;
  courierId?: string;
}

const LS_BOXFUL = 'cgs_boxful_v1';

export function getBoxfulConfig(): BoxfulConfig | null {
  try {
    const raw = localStorage.getItem(LS_BOXFUL);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BoxfulConfig;
    if (parsed && (parsed.email || parsed.accessToken)) return parsed;
  } catch {
    /* ignorar */
  }
  return null;
}

export function saveBoxfulConfig(cfg: BoxfulConfig | null): void {
  if (!cfg) {
    localStorage.removeItem(LS_BOXFUL);
    return;
  }
  localStorage.setItem(LS_BOXFUL, JSON.stringify(cfg));
}

function baseUrl(env: 'prod' | 'dev'): string {
  return env === 'dev' ? 'https://devapi.goboxful.com' : 'https://api.goboxful.com';
}

export async function authenticateBoxful(cfg: BoxfulConfig): Promise<string> {
  if (cfg.accessToken && cfg.accessToken.trim() && !cfg.password) {
    return cfg.accessToken.trim();
  }
  const res = await fetch(`${baseUrl(cfg.env)}/auth/v2/client`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: cfg.email.trim(),
      password: cfg.password || ''
    })
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Boxful Auth (${res.status}): ${txt || 'Verifica tu correo y contraseña de Boxful'}`);
  }
  const data = (await res.json()) as { accessToken?: string; token?: string; data?: { accessToken?: string } };
  const token = data.accessToken || data.token || data.data?.accessToken;
  if (!token) {
    throw new Error('Boxful no devolvió un accessToken válido');
  }
  // Guardar token actualizado sin persistir la contraseña en texto plano si se desea
  saveBoxfulConfig({ ...cfg, accessToken: token });
  return token;
}

export interface BoxfulShipmentResult {
  trackingNumber: string;
  trackingUrl: string;
  carrier: string;
}

/**
 * Crea un envío en Boxful vía API REST (`POST /shipment`).
 */
export async function createBoxfulShipment(
  order: Order,
  settings: Settings
): Promise<BoxfulShipmentResult> {
  const cfg = getBoxfulConfig();
  if (!cfg) {
    throw new Error('Configura tu cuenta de Boxful en Ajustes para generar guías automáticas con 1 clic');
  }
  const token = await authenticateBoxful(cfg);
  const totalUnits = order.items.reduce((s, i) => s + i.qty, 0);
  const codAmount = order.balance > 0 ? fromCents(order.balance) : 0;

  const body: Record<string, unknown> = {
    reference: folioLabel(order.folio),
    description: `Pedido ${folioLabel(order.folio)} - ${totalUnits} camisa(s) (${order.workType})`,
    cod: codAmount > 0,
    codAmount,
    currency: 'HNL',
    sender: {
      name: settings.storeName,
      phone: settings.storePhone,
      address: `${settings.storeAddress}, ${settings.storeCity}`,
      country: 'HN'
    },
    recipient: {
      name: order.shipTo.name || 'Cliente',
      phone: order.shipTo.phone || '',
      address: order.shipTo.address || 'Honduras',
      country: 'HN'
    },
    parcels: [
      {
        weight: Math.max(1, Math.ceil(totalUnits * 0.25)),
        quantity: 1
      }
    ]
  };
  if (cfg.courierId?.trim()) {
    body.courierId = cfg.courierId.trim();
  }

  const res = await fetch(`${baseUrl(cfg.env)}/shipment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Boxful Shipment (${res.status}): ${txt || 'No se pudo crear la guía automáticamente'}`);
  }

  const data = (await res.json()) as {
    shipmentNumber?: string;
    trackingNumber?: string;
    guideNumber?: string;
    trackingUrl?: string;
    id?: string;
    data?: {
      shipmentNumber?: string;
      trackingNumber?: string;
      trackingUrl?: string;
      id?: string;
    };
  };

  const trackingNumber =
    data.shipmentNumber ||
    data.trackingNumber ||
    data.guideNumber ||
    data.data?.shipmentNumber ||
    data.data?.trackingNumber ||
    data.id ||
    data.data?.id ||
    `BX-${order.folio}`;

  const trackingUrl =
    data.trackingUrl ||
    data.data?.trackingUrl ||
    `https://goboxful.com/tracking/${encodeURIComponent(trackingNumber)}`;

  return {
    carrier: 'Boxful',
    trackingNumber: String(trackingNumber),
    trackingUrl: String(trackingUrl)
  };
}

/**
 * Resume los datos del destinatario listos para pegar en el panel de Boxful si se usa modo asistido.
 */
export function buildBoxfulClipboardSummary(order: Order): string {
  const cod = order.balance > 0 ? `L ${fromCents(order.balance).toFixed(2)}` : 'L 0.00 (Pagado)';
  return [
    `Pedido: ${folioLabel(order.folio)}`,
    `Destinatario: ${order.shipTo.name || 'Cliente'}`,
    `Teléfono: ${order.shipTo.phone || ''}`,
    `Dirección: ${order.shipTo.address || ''}`,
    `Cobro contra entrega (COD): ${cod}`
  ].join('\n');
}
