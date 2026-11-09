import { useMemo } from 'react';
import type { Section } from '../lib/types';
import { useAppState, useStock } from '../lib/store';
import { dayKey, fmtDateTime } from '../lib/time';
import { money } from '../lib/money';
import { lowColorStockList, orderUnits } from '../lib/inventory';
import { printDailyOrdersReport, printInventoryReport } from '../lib/printReports';
import { folioLabel } from '../lib/ids';
import { ColorDot, Empty, toast } from '../components/ui';
import { StatusBadge } from './Orders';

export default function Home({ navigate }: { navigate: (s: Section) => void }) {
  const state = useAppState();
  const info = useStock();
  const today = dayKey();

  const todaysOrders = useMemo(
    () =>
      state.orders
        .filter((o) => !o.deleted && o.status !== 'cancelado' && dayKey(o.createdAt) === today)
        .sort((a, b) => a.folio - b.folio),
    [state.orders, today]
  );

  const kpi = useMemo(() => {
    const live = state.orders.filter((o) => !o.deleted && o.status !== 'cancelado');
    return {
      sold: todaysOrders.reduce((s, o) => s + o.total, 0),
      units: todaysOrders.reduce((s, o) => s + orderUnits(o), 0),
      production: live.filter((o) => o.status === 'en_produccion').length,
      shipped: live.filter((o) => o.status === 'enviado').length
    };
  }, [state.orders, todaysOrders]);

  const recent = useMemo(
    () => state.orders.filter((o) => !o.deleted).sort((a, b) => b.createdAt - a.createdAt).slice(0, 6),
    [state.orders]
  );
  const lowColors = useMemo(() => lowColorStockList(state, info), [state, info]);
  const lowThreshold = Math.max(1, state.settings.lowStock || 10);

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

      {/* Accesos directos de Impresión de Pedidos del Día e Inventario */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-brand-400 hover:bg-brand-50/40"
          onClick={() => {
            if (todaysOrders.length === 0) {
              return toast('Aún no hay pedidos registrados el día de hoy para imprimir', 'info');
            }
            printDailyOrdersReport(todaysOrders, state.settings, `Pedidos de Hoy (${today})`);
          }}
        >
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🖨️</span>
            <div>
              <div className="text-xs font-extrabold text-slate-900">
                Imprimir Pedidos de Hoy ({todaysOrders.length})
              </div>
              <div className="text-[11px] text-slate-500">
                Por talla, diseño, color, cliente, dirección y estado de pago
              </div>
            </div>
          </div>
          <span className="text-xs font-black text-brand-700">PDF / Imprimir →</span>
        </button>

        <button
          type="button"
          className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-brand-400 hover:bg-brand-50/40"
          onClick={() => printInventoryReport(state)}
        >
          <div className="flex items-center gap-2.5">
            <span className="text-xl">📊</span>
            <div>
              <div className="text-xs font-extrabold text-slate-900">
                Imprimir Inventario y Matriz
              </div>
              <div className="text-[11px] text-slate-500">
                Existencias por marca, color, talla y alertas de stock (1–{lowThreshold} uds)
              </div>
            </div>
          </div>
          <span className="text-xs font-black text-brand-700">PDF / Imprimir →</span>
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

      {lowColors.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="section-title mb-0">
              ⚠️ Colores por Agotarse (1 a {lowThreshold} unidades · excluye en 0)
            </h2>
            <button
              type="button"
              onClick={() => printInventoryReport(state)}
              className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-extrabold text-amber-900 hover:bg-amber-100"
            >
              🖨️ Imprimir Inventario
            </button>
          </div>
          <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-amber-300 bg-white">
            {lowColors.map((item) => {
              const activeSizes = item.sizesBreakdown
                .map((s) => `${s.size}:${s.qty}`)
                .join(' · ');
              return (
                <button
                  key={item.key}
                  className="flex min-h-[54px] w-full items-center gap-3 px-4 py-2 text-left hover:bg-amber-50/40"
                  onClick={() => navigate('inventario')}
                >
                  <ColorDot hex={item.color.hex} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-extrabold text-slate-900">
                      {item.brand.name} · {item.color.name}
                    </div>
                    {activeSizes && (
                      <div className="truncate text-xs font-medium text-slate-500">
                        Tallas disponibles: {activeSizes}
                      </div>
                    )}
                  </div>
                  <span className="rounded-lg bg-amber-100 px-2.5 py-1 text-sm font-black text-amber-900">
                    Quedan {item.totalStock} uds
                  </span>
                </button>
              );
            })}
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
