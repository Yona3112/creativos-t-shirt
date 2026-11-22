import { useMemo, useState } from 'react';
import type { Order, Section } from '../lib/types';
import { useAppState, useStock } from '../lib/store';
import { dayKey, fmtDateTime } from '../lib/time';
import { money } from '../lib/money';
import { lowColorStockList, negativeStockList, orderUnits } from '../lib/inventory';
import { printInventoryReport } from '../lib/printReports';
import { folioLabel } from '../lib/ids';
import { ColorDot, Empty, StatusBadge, toast } from '../components/ui';
import { WorkshopPdfModal } from '../components/WorkshopPdfModal';

export default function Home({ navigate }: { navigate: (s: Section) => void }) {
  const state = useAppState();
  const info = useStock();
  const today = dayKey();
  const [pdfModal, setPdfModal] = useState<{ orders: Order[]; title: string } | null>(null);

  const todaysOrders = useMemo(
    () =>
      state.orders
        .filter((o) => !o.deleted && o.status !== 'cancelado' && o.status !== 'borrador' && dayKey(o.createdAt) === today)
        .sort((a, b) => a.folio - b.folio),
    [state.orders, today]
  );

  const kpi = useMemo(() => {
    const live = state.orders.filter((o) => !o.deleted && o.status !== 'cancelado');
    const receivableOrders = live.filter((o) => o.status !== 'borrador' && o.balance > 0);
    return {
      sold: todaysOrders.reduce((s, o) => s + o.total, 0),
      units: todaysOrders.reduce((s, o) => s + orderUnits(o), 0),
      production: live.filter((o) => o.status === 'en_produccion').length,
      shipped: live.filter((o) => o.status === 'enviado').length,
      receivableCount: receivableOrders.length,
      receivableTotal: receivableOrders.reduce((s, o) => s + o.balance, 0)
    };
  }, [state.orders, todaysOrders]);

  const recent = useMemo(
    () => state.orders.filter((o) => !o.deleted).sort((a, b) => b.createdAt - a.createdAt).slice(0, 6),
    [state.orders]
  );
  const lowColors = useMemo(() => lowColorStockList(state, info), [state, info]);
  const negativeVariants = useMemo(() => negativeStockList(state, info), [state, info]);
  const negativeUnits = useMemo(() => negativeVariants.reduce((s, v) => s + v.needed, 0), [negativeVariants]);
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

      {/* Accesos directos de Impresión y Catálogo */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <button
          type="button"
          className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-slate-300"
          onClick={() => {
            if (todaysOrders.length === 0) {
              return toast('Sin pedidos hoy para exportar', 'info');
            }
            setPdfModal({ orders: todaysOrders, title: `Pedidos de Hoy (${today})` });
          }}
        >
          <span className="text-xs font-bold text-slate-900">
            📄 Pedidos de Hoy ({todaysOrders.length})
          </span>
          <span className="text-xs font-bold text-slate-500">PDF →</span>
        </button>

        <button
          type="button"
          className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-slate-300"
          onClick={() => printInventoryReport(state)}
        >
          <span className="text-xs font-bold text-slate-900">🖨️ Imprimir Inventario</span>
          <span className="text-xs font-bold text-slate-500">PDF →</span>
        </button>

        <button
          type="button"
          className="flex items-center justify-between rounded-2xl bg-slate-900 px-4 py-3 text-left text-white shadow-sm transition hover:bg-slate-800"
          onClick={() => navigate('catalogo')}
        >
          <span className="text-xs font-bold">✨ Catálogo 3D</span>
          <span className="text-xs font-bold text-slate-300">Abrir →</span>
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Vendido Hoy" value={money(kpi.sold)} tone="text-emerald-700" />
        <Kpi label="Unidades Vendidas Hoy" value={String(kpi.units)} tone="text-brand-800" />
        <Kpi label="Pedidos en Producción" value={String(kpi.production)} tone="text-amber-600" onClick={() => navigate('taller')} />
        <Kpi label="Enviados" value={String(kpi.shipped)} tone="text-sky-700" onClick={() => navigate('pedidos')} />
      </div>

      {kpi.receivableCount > 0 && (
        <button
          type="button"
          onClick={() => {
            sessionStorage.setItem('cgs_orders_filter', 'por_cobrar');
            navigate('pedidos');
          }}
          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50/90 px-4 py-3 text-left shadow-sm transition hover:bg-rose-100/80"
        >
          <div>
            <div className="text-xs font-extrabold uppercase tracking-wide text-rose-800">
              💸 Cuentas por Cobrar ({kpi.receivableCount} pedido{kpi.receivableCount === 1 ? '' : 's'})
            </div>
            <div className="text-xs font-semibold text-rose-700">
              Toca para ver pedidos con saldo pendiente o contra entrega
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-black text-rose-700">{money(kpi.receivableTotal)}</span>
            <span className="text-xs font-bold text-rose-600">Ver →</span>
          </div>
        </button>
      )}

      {negativeUnits > 0 && (
        <button
          type="button"
          onClick={() => navigate('inventario')}
          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50/75 px-4 py-3 text-left shadow-sm transition hover:bg-rose-100/75"
        >
          <div>
            <div className="text-xs font-extrabold uppercase tracking-wide text-rose-900">
              📦 Camisas por Cubrir (−{negativeUnits} ud{negativeUnits === 1 ? '' : 's'} en negativo)
            </div>
            <div className="text-xs font-semibold text-rose-700">
              Pedidos facturados sin existencia · se descontarán solos al ingresar inventario
            </div>
          </div>
          <span className="shrink-0 text-xs font-extrabold text-rose-700">Ingresar →</span>
        </button>
      )}

      <section>
        <h2 className="section-title">Pedidos Recientes</h2>
        {recent.length === 0 ? (
          <Empty icon="🧾" text="Sin pedidos" />
        ) : (
          <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {recent.map((o) => (
              <button
                key={o.id}
                className="flex min-h-[60px] w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-50"
                onClick={() => {
                  sessionStorage.setItem('cgs_orders_query', folioLabel(o.folio));
                  navigate('pedidos');
                }}
              >
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
              ⚠️ Stock Bajo (1–{lowThreshold} uds)
            </h2>
            <button
              type="button"
              onClick={() => printInventoryReport(state)}
              className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-extrabold text-amber-900 hover:bg-amber-100"
            >
              🖨️ Imprimir
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
                    {item.totalStock} uds
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {pdfModal && (
        <WorkshopPdfModal
          open
          onClose={() => setPdfModal(null)}
          orders={pdfModal.orders}
          settings={state.settings}
          title={pdfModal.title}
        />
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
