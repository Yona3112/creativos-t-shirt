import { useEffect } from 'react';
import type { Section, SyncStatus } from '../lib/types';
import { useSyncStatus } from '../lib/store';

export const SECTIONS: { id: Section; icon: string; label: string }[] = [
  { id: 'inicio', icon: '📊', label: 'Inicio' },
  { id: 'vender', icon: '🛒', label: 'Nuevo Pedido' },
  { id: 'catalogo', icon: '✨', label: 'Catálogo 3D Interactivo' },
  { id: 'taller', icon: '🔨', label: 'Cola de Taller' },
  { id: 'inventario', icon: '👕', label: 'Inventario y Matriz' },
  { id: 'marcas', icon: '🎨', label: 'Marcas, Colores y Stock' },
  { id: 'pedidos', icon: '📦', label: 'Pedidos y Guías' },
  { id: 'clientes', icon: '👥', label: 'Clientes' },
  { id: 'reportes', icon: '📈', label: 'Reportes' },
  { id: 'ajustes', icon: '⚙️', label: 'Ajustes y Respaldo' }
];

const STATUS_UI: Record<SyncStatus, { dot: string; text: string }> = {
  local: { dot: 'bg-slate-400', text: 'Local' },
  connecting: { dot: 'bg-amber-400 animate-pulse', text: 'Conectando' },
  syncing: { dot: 'bg-amber-400 animate-pulse', text: 'Sincronizando' },
  live: { dot: 'bg-emerald-400', text: 'En vivo' },
  offline: { dot: 'bg-slate-400', text: 'Sin internet' },
  error: { dot: 'bg-red-500', text: 'Error' }
};

export function Header({ section, onMenu, onSell }: { section: Section; onMenu: () => void; onSell: () => void }) {
  const { status } = useSyncStatus();
  const s = STATUS_UI[status];
  const current = SECTIONS.find((x) => x.id === section);
  return (
    <header className="safe-top sticky top-0 z-40 bg-brand-900 text-white shadow-md">
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-2 px-2">
        <button className="btn-icon text-2xl text-white hover:bg-white/10" onClick={onMenu} aria-label="Abrir menú">
          ☰
        </button>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-base font-extrabold">Creativos Gift Shop</div>
          <div className="truncate text-xs font-medium text-brand-200">{current?.label}</div>
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold" title={s.text}>
          <span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} />
          <span className="hidden min-[380px]:inline">{s.text}</span>
        </div>
        <button className="btn min-h-[44px] bg-white px-3 text-brand-900 hover:bg-brand-50" onClick={onSell}>
          🛒 Vender
        </button>
      </div>
    </header>
  );
}

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
        className={`fixed inset-0 z-50 bg-black/50 transition-opacity ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={onClose}
      />
      <nav
        className={`fixed inset-y-0 left-0 z-50 flex w-[84%] max-w-xs flex-col bg-white shadow-2xl transition-transform duration-200 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Menú principal"
      >
        <div className="safe-top bg-brand-900 px-4 pb-4 text-white">
          <div className="flex h-16 items-center justify-between">
            <span className="text-lg font-extrabold">Creativos Gift Shop</span>
            <button className="btn-icon text-white hover:bg-white/10" onClick={onClose} aria-label="Cerrar menú">
              ✕
            </button>
          </div>
        </div>
        <ul className="safe-bottom flex-1 overflow-y-auto p-2">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <button
                className={`flex min-h-[52px] w-full items-center gap-3 rounded-xl px-3 text-left text-base font-semibold ${
                  section === s.id ? 'bg-brand-100 text-brand-900' : 'text-slate-700 hover:bg-slate-50'
                }`}
                onClick={() => onNavigate(s.id)}
              >
                <span className="w-7 text-center text-xl">{s.icon}</span>
                <span className="flex-1">{s.label}</span>
                {!!badges[s.id] && (
                  <span className="rounded-full bg-brand-700 px-2 py-0.5 text-xs font-bold text-white">{badges[s.id]}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
