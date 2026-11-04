import { useMemo } from 'react';
import type { Section } from '../lib/types';
import { useAppState, useStock } from '../lib/store';
import { dayKey, fmtDateTime } from '../lib/time';
import { money } from '../lib/money';
import { lowStockList, orderUnits } from '../lib/inventory';
import { folioLabel } from '../lib/ids';
import { ColorDot, Empty } from '../components/ui';
import { StatusBadge } from './Orders';

export default function Home({ navigate }: { navigate: (s: Section) => void }) {
  const state = useAppState();
  const info = useStock();

  const kpi = useMemo(() => {
    const today = dayKey();
    const live = state.orders.filter((o) => !o.deleted && o.status !== 'cancelado');
    const todays = live.filter((o) => dayKey(o.createdAt) === today);
    return {
      sold: todays.reduce((s, o) => s + o.total, 0),
      units: todays.reduce((s, o) => s + orderUnits(o), 0),
      production: live.filter((o) => o.status === 'en_produccion').length,
      shipped: live.filter((o) => o.status === 'enviado').length
    };
  }, [state.orders]);

  const recent = useMemo(
    () => state.orders.filter((o) => !o.deleted).sort((a, b) => b.createdAt - a.createdAt).slice(0, 6),
    [state.orders]
  );
  const low = useMemo(() => lowStockList(state, info), [state, info]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <button className="btn-primary min-h-[64px] text-lg" onClick={() => navigate('vender')}>
          ➕ Nuevo Pedido
        </button>
        <button className="btn-soft min-h-[64px] text-lg" onClick={() => navigate('inventario')}>
          👕 Matriz de Stock
        </button>
      </div>

      <button
        className="flex min-h-[54px] w-full items-center justify-between rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-900 to-slate-800 px-4 py-3 text-left text-white shadow-sm transition active:scale-[0.99]"
        onClick={() => navigate('catalogo')}
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">✨</span>
          <div>
            <div className="text-sm font-extrabold">Catálogo 3D Interactivo y Probador de Diseño</div>
            <div className="text-xs text-sky-200">Elige colores permitidos, prueba logos en 3D y compártelo por WhatsApp</div>
          </div>
        </div>
        <span className="text-lg font-bold">→</span>
      </button>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Vendido Hoy" value={money(kpi.sold)} tone="text-emerald-700" />
        <Kpi label="Unidades Vendidas Hoy" value={String(kpi.units)} tone="text-brand-800" />
        <Kpi label="Pedidos en Producción" value={String(kpi.production)} tone="text-amber-600" onClick={() => navigate('taller')} />
        <Kpi label="Enviados" value={String(kpi.shipped)} tone="text-sky-700" onClick={() => navigate('pedidos')} />
      </div>

      <section>
        <h2 className="section-title">Pedidos Recientes</h2>
        {recent.length === 0 ? (
          <Empty icon="🧾" text="Sin pedidos" />
        ) : (
          <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {recent.map((o) => (
              <button key={o.id} className="flex min-h-[60px] w-full items-center gap-3 px-4 py-2 text-left" onClick={() => navigate('pedidos')}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold">{folioLabel(o.folio)}</span>
                    <StatusBadge status={o.status} />
                  </div>
                  <div className="truncate text-sm text-slate-500">
                    {o.shipTo.name || 'Mostrador'} · {orderUnits(o)} uds · {fmtDateTime(o.createdAt)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold">{money(o.total)}</div>
                  {o.balance > 0 && o.status !== 'cancelado' && <div className="text-xs font-bold text-red-600">Resta {money(o.balance)}</div>}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {low.length > 0 && (
        <section>
          <h2 className="section-title">Variantes por Reabastecer</h2>
          <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-amber-200 bg-white">
            {low.slice(0, 12).map((v) => (
              <button key={v.key} className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left" onClick={() => navigate('marcas')}>
                <ColorDot hex={v.color.hex} />
                <span className="flex-1 truncate font-medium">
                  {v.brand.name} · {v.color.name} · {v.size}
                </span>
                <span className={`rounded-lg px-2 py-1 text-sm font-bold ${v.stock === 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>
                  {v.stock}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Kpi({ label, value, tone, onClick }: { label: string; value: string; tone: string; onClick?: () => void }) {
  return (
    <button className="card min-h-[88px] text-left disabled:cursor-default" onClick={onClick} disabled={!onClick}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-extrabold ${tone}`}>{value}</div>
    </button>
  );
}
