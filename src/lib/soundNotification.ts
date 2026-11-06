/**
 * Sistema de Notificaciones en Tiempo Real y Timbre Sonoro para Creativos POS
 * Notifica al teléfono / computadora del administrador cuando entra un pedido del catálogo.
 */

// Síntesis de sonido de caja / campanilla usando Web Audio API puro (sin dependencias de archivos externos)
class ChimePlayer {
  private ctx: AudioContext | null = null;

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  playOrderChime() {
    try {
      const ctx = this.getContext();
      if (!ctx) return;

      const now = ctx.currentTime;

      // Tono 1: Campana aguda (1046.5 Hz - C6)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(1046.5, now);
      gain1.gain.setValueAtTime(0, now);
      gain1.gain.linearRampToValueAtTime(0.35, now + 0.02);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.45);

      // Tono 2: Armónico alegre superior (1318.5 Hz - E6)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(1318.5, now + 0.12);
      gain2.gain.setValueAtTime(0, now + 0.12);
      gain2.gain.linearRampToValueAtTime(0.4, now + 0.15);
      gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.12);
      osc2.stop(now + 0.9);
    } catch {
      /* AudioContext restringido antes de interacción del usuario */
    }
  }
}

export const chime = new ChimePlayer();

/** Solicita permiso de notificaciones nativas en el teléfono o navegador */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  try {
    if (Notification.permission === 'granted') return true;
    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    }
  } catch {
    /* ignorar */
  }
  return false;
}

/** Dispara alerta sonora, vibración y notificación nativa al recibir un pedido */
export function notifyIncomingOrder(opts: {
  customerName: string;
  qty: number;
  colorName: string;
  size: string;
  totalText: string;
  isCustom?: boolean;
}) {
  // 1. Sonido de campana
  chime.playOrderChime();

  // 2. Vibración del teléfono móvil (patrón distintivo)
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate([250, 100, 250, 100, 400]);
    } catch {}
  }

  // 3. Notificación nativa en la pantalla del teléfono/PC
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      const title = '🛍️ ¡Nuevo Pedido en la Tienda!';
      const body = `${opts.customerName} acaba de pedir ${opts.qty} camisa(s) ${opts.colorName} (Talla ${opts.size}) · ${opts.totalText}`;
      new Notification(title, {
        body,
        icon: '/favicon.ico',
        tag: 'cgs-web-order'
      });
    } catch {}
  }
}
