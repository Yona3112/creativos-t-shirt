import { useEffect } from 'react';
import type { Section, SyncStatus } from '../lib/types';
import { useSyncStatus } from '../lib/store';
import { chime, requestNotificationPermission } from '../lib/soundNotification';
import { toast } from './ui';

export const SECTIONS: { id: Section; icon: string; label: string; subtitle: string; group: 'operacion' | 'produccion' | 'admin' }[] = [
  { id: 'inicio', icon: '📊', label: 'Inicio', subtitle: 'Resumen diario y actividad', group: 'operacion' },
  { id: 'vender', icon: '🛒', label: 'Nuevo Pedido', subtitle: 'Registrar venta o pedido', group: 'operacion' },
  { id: 'catalogo', icon: '✨', label: 'Catálogo 3D', subtitle: 'Diseños, campañas y WhatsApp', group: 'operacion' },
  { id: 'taller', icon: '🔨', label: 'Cola de Taller', subtitle: 'Impresión y entregas del día', group: 'produccion' },
  { id: 'inventario', icon: '👕', label: 'Inventario y Colores', subtitle: 'Stock, ingresos y cuadre', group: 'produccion' },
  { id: 'pedidos', icon: '📦', label: 'Pedidos y Guías', subtitle: 'Historial, cobros y envíos', group: 'produccion' },
  { id: 'clientes', icon: '👥', label: 'Clientes', subtitle: 'Directorio de compradores', group: 'admin' },
  { id: 'reportes', icon: '📈', label: 'Reportes', subtitle: 'Ventas, costos y ganancias', group: 'admin' },
  { id: 'ajustes', icon: '⚙️', label: 'Ajustes y Respaldo', subtitle: 'Precios, nube y seguridad', group: 'admin' }
];

const STATUS_UI: Record<SyncStatus, { dot: string; text: string }> = {
  local: { dot: 'bg-slate-400', text: 'Local' },
  connecting: { dot: 'bg-amber-400 animate-pulse', text: 'Conectando' },
  syncing: { dot: 'bg-amber-400 animate-pulse', text: 'Sincronizando' },
  live: { dot: 'bg-emerald-500', text: 'En vivo' },
  offline: { dot: 'bg-slate-400', text: 'Sin red' },
  error: { dot: 'bg-red-500', text: 'Error' }
};

export function Header({ section, onMenu, onSell }: { section: Section; onMenu: () => void; onSell: () => void }) {
  const { status } = useSyncStatus();
  const s = STATUS_UI[status];
  const current = SECTIONS.find((x) => x.id === section);
  return (
    <header className="safe-top sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 text-slate-900 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-2.5 px-3">
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200/90 bg-slate-50 text-slate-800 shadow-sm transition hover:bg-slate-100 active:scale-95"
          onClick={onMenu}
          aria-label="Abrir menú"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h11" />
          </svg>
        </button>

        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[15px] font-bold tracking-tight text-slate-900">
            {current?.label || 'Creativos Gift Shop'}
          </div>
          <div className="truncate text-[11px] font-medium text-slate-500">
            Creativos Gift Shop
          </div>
        </div>

        <div
          className="flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-slate-100/80 px-2.5 py-1 text-[11px] font-semibold text-slate-700"
          title={s.text}
        >
          <span className={`h-2 w-2 rounded-full ${s.dot}`} />
          <span className="hidden min-[380px]:inline">{s.text}</span>
        </div>

        <button
          type="button"
          onClick={() => {
            chime.playOrderChime();
            void requestNotificationPermission();
            toast('🔔 Timbre sonoro de alerta emitido', 'ok');
          }}
          className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200/80 bg-slate-50 text-sm text-slate-700 transition hover:bg-slate-100 active:scale-95"
          title="Probar sonido y timbre de pedidos"
        >
          🔔
        </button>

        <button
          type="button"
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 active:scale-95"
          onClick={onSell}
        >
          <span>+ Pedido</span>
        </button>
      </div>
    </header>
  );
}

const GROUPS: { key: 'operacion' | 'produccion' | 'admin'; title: string }[] = [
  { key: 'operacion', title: 'Ventas y Catálogo' },
  { key: 'produccion', title: 'Taller e Inventario' },
  { key: 'admin', title: 'Administración' }
];

export function Drawer({
  open,
  section,
  onClose,
  onNavigate,
  badges
}: {
  open: boolean;
  section: Section;
  onClose: () => void;
  onNavigate: (s: Section) => void;
  badges: Partial<Record<Section, number>>;
}) {
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
  }, [open]);

  return (
    <>
      <div
        className={`fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[2px] transition-opacity duration-200 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
      />
      <nav
        className={`fixed inset-y-0 left-0 z-50 flex w-[86%] max-w-[320px] flex-col bg-[#F5F5F7] shadow-2xl transition-transform duration-200 ease-out ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Menú principal"
      >
        {/* Cabecera limpia estilo iOS / macOS */}
        <div className="safe-top border-b border-slate-200/80 bg-white px-4 py-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-base font-bold text-white shadow-sm">
                CG
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-bold tracking-tight text-slate-900">
                  Creativos Gift Shop
                </div>
                <div className="truncate text-[11px] font-medium text-slate-500">
                  Panel de Control
                </div>
              </div>
            </div>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-600 transition hover:bg-slate-200"
              onClick={onClose}
              aria-label="Cerrar menú"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Lista agrupada en tarjetas estilo Apple Settings */}
        <div className="safe-bottom flex-1 space-y-4 overflow-y-auto px-3 py-4">
          {GROUPS.map((g) => {
            const items = SECTIONS.filter((s) => s.group === g.key);
            return (
              <div key={g.key} className="space-y-1.5">
                <div className="px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  {g.title}
                </div>
                <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm divide-y divide-slate-100">
                  {items.map((s) => {
                    const active = section === s.id;
                    const badge = badges[s.id];
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => onNavigate(s.id)}
                        className={`flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition ${
                          active
                            ? 'bg-slate-900 text-white'
                            : 'bg-white text-slate-800 hover:bg-slate-50'
                        }`}
                      >
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-base ${
                            active ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {s.icon}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold leading-snug">
                            {s.label}
                          </div>
                          <div
                            className={`truncate text-[11px] ${
                              active ? 'text-white/70' : 'text-slate-400'
                            }`}
                          >
                            {s.subtitle}
                          </div>
                        </div>
                        {!!badge && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                              active
                                ? 'bg-white text-slate-900'
                                : 'bg-rose-500 text-white'
                            }`}
                          >
                            {badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </nav>
    </>
  );
}
