import { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { Section, SyncStatus } from '../lib/types';
import { useSyncStatus } from '../lib/store';
import { chime, requestNotificationPermission } from '../lib/soundNotification';
import { toast } from './ui';

export const SECTIONS: { id: Section; icon: string; label: string; subtitle: string; group: 'operacion' | 'produccion' | 'admin' }[] = [
  { id: 'inicio', icon: 'inicio', label: 'Inicio', subtitle: 'Resumen diario y actividad', group: 'operacion' },
  { id: 'vender', icon: 'vender', label: 'Nuevo Pedido', subtitle: 'Registrar venta o pedido', group: 'operacion' },
  { id: 'catalogo', icon: 'catalogo', label: 'Catálogo 3D', subtitle: 'Diseños, campañas y WhatsApp', group: 'operacion' },
  { id: 'taller', icon: 'taller', label: 'Cola de Taller', subtitle: 'Impresión y entregas del día', group: 'produccion' },
  { id: 'inventario', icon: 'inventario', label: 'Inventario y Colores', subtitle: 'Stock, ingresos y cuadre', group: 'produccion' },
  { id: 'pedidos', icon: 'pedidos', label: 'Pedidos y Guías', subtitle: 'Historial, cobros y envíos', group: 'produccion' },
  { id: 'clientes', icon: 'clientes', label: 'Clientes', subtitle: 'Directorio de compradores', group: 'admin' },
  { id: 'reportes', icon: 'reportes', label: 'Reportes', subtitle: 'Ventas, costos y ganancias', group: 'admin' },
  { id: 'ajustes', icon: 'ajustes', label: 'Ajustes y Respaldo', subtitle: 'Precios, nube y seguridad', group: 'admin' }
];

const SECTION_BADGE_COLOR: Record<Section, string> = {
  inicio: 'bg-[#007AFF]',
  vender: 'bg-[#34C759]',
  catalogo: 'bg-[#5856D6]',
  taller: 'bg-[#FF9500]',
  inventario: 'bg-[#30B0C7]',
  pedidos: 'bg-[#0A84FF]',
  clientes: 'bg-[#AF52DE]',
  marcas: 'bg-[#64748B]',
  reportes: 'bg-[#10B981]',
  ajustes: 'bg-[#636366]'
};

function SectionSvgIcon({ id }: { id: Section }) {
  const props = {
    className: 'h-[18px] w-[18px]',
    fill: 'none',
    viewBox: '0 0 24 24',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const
  };
  switch (id) {
    case 'inicio':
      return (
        <svg {...props}>
          <rect x="3" y="3" width="7" height="7" rx="2" />
          <rect x="14" y="3" width="7" height="7" rx="2" />
          <rect x="3" y="14" width="7" height="7" rx="2" />
          <rect x="14" y="14" width="7" height="7" rx="2" />
        </svg>
      );
    case 'vender':
      return (
        <svg {...props}>
          <circle cx="9" cy="20" r="1.4" />
          <circle cx="17" cy="20" r="1.4" />
          <path d="M3 4h2l2.2 10.5a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.4-1.1L20 8H6" />
        </svg>
      );
    case 'catalogo':
      return (
        <svg {...props}>
          <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
          <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
        </svg>
      );
    case 'taller':
      return (
        <svg {...props}>
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.1-3.1a5.5 5.5 0 0 1-7.4 7.4l-6.3 6.3a1.8 1.8 0 0 1-2.5-2.5l6.3-6.3a5.5 5.5 0 0 1 7.4-7.4l-3.6 3.6z" />
        </svg>
      );
    case 'inventario':
      return (
        <svg {...props}>
          <path d="M16 4l4 3-2.2 3.2-1.8-1V20H8V9.2l-1.8 1L4 7l4-3h8z" />
          <path d="M9.5 4a2.5 2.5 0 0 0 5 0" />
        </svg>
      );
    case 'pedidos':
      return (
        <svg {...props}>
          <path d="M21 8.5L12 3 3 8.5v7L12 21l9-5.5v-7z" />
          <path d="M3.3 8.7L12 13.5l8.7-4.8M12 21v-7.5" />
        </svg>
      );
    case 'clientes':
      return (
        <svg {...props}>
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
          <circle cx="17" cy="9" r="2.3" />
          <path d="M16.5 14.8c2.2.4 4 1.9 4 4.7" />
        </svg>
      );
    case 'reportes':
      return (
        <svg {...props}>
          <path d="M4 19h16" />
          <path d="M7 16V11M12 16V6M17 16V9" />
        </svg>
      );
    case 'ajustes':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      );
    case 'marcas':
    default:
      return (
        <svg {...props}>
          <path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
          <circle cx="7.5" cy="7.5" r="1.5" />
        </svg>
      );
  }
}

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
            toast('Timbre sonoro de alerta emitido', 'ok');
          }}
          className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200/80 bg-slate-50 text-slate-700 transition hover:bg-slate-100 active:scale-95"
          title="Probar sonido y timbre de pedidos"
          aria-label="Probar sonido y timbre de pedidos"
        >
          <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5m6 0v1a3 3 0 1 1-6 0v-1m6 0H9" />
          </svg>
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
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[2px]"
            onClick={onClose}
          />
          <motion.nav
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 400, damping: 36 }}
            className="fixed inset-y-0 left-0 z-50 flex w-[86%] max-w-[320px] flex-col bg-[#F5F5F7] shadow-2xl"
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

            {/* Lista agrupada en tarjetas estilo Apple iOS Settings */}
            <div className="safe-bottom flex-1 space-y-5 overflow-y-auto px-3.5 py-4">
              {GROUPS.map((g) => {
                const items = SECTIONS.filter((s) => s.group === g.key);
                return (
                  <div key={g.key} className="space-y-1.5">
                    <div className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      {g.title}
                    </div>
                    <div className="divide-y divide-slate-100/90 overflow-hidden rounded-[20px] border border-black/[0.06] bg-white shadow-sm">
                      {items.map((s) => {
                        const active = section === s.id;
                        const badge = badges[s.id];
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => onNavigate(s.id)}
                            className={`flex w-full items-center gap-3 px-3.5 py-3 text-left transition active:scale-[0.99] ${
                              active
                                ? 'bg-slate-900 text-white'
                                : 'bg-white text-slate-900 hover:bg-slate-50/80'
                            }`}
                          >
                            <span
                              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] shadow-sm ${
                                active
                                  ? 'bg-white/20 text-white'
                                  : `${SECTION_BADGE_COLOR[s.id]} text-white`
                              }`}
                            >
                              <SectionSvgIcon id={s.id} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[14px] font-semibold leading-snug tracking-tight">
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
                                className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                                  active
                                    ? 'bg-white text-slate-900'
                                    : 'bg-rose-500 text-white'
                                }`}
                              >
                                {badge}
                              </span>
                            )}
                            <svg
                              className={`h-4 w-4 shrink-0 ${
                                active ? 'text-white/60' : 'text-slate-300'
                              }`}
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2.2}
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.nav>
        </>
      )}
    </AnimatePresence>
  );
}
