import { useMemo, useState } from 'react';
import { useAppState } from '../lib/store';
import { addDays, dayKey, fmtDateTime, startOfDayTs } from '../lib/time';
import { fromCents, money } from '../lib/money';
import { folioLabel } from '../lib/ids';
import { STATUS_LABEL } from '../lib/actions';
import { downloadText, toCSV } from '../lib/csv';
import { ColorDot, Empty, toast } from '../components/ui';

type Preset = 'hoy' | '7d' | '30d' | 'todo' | 'rango';

export default function Reports() {
  const state = useAppState();
  const today = dayKey();
  const [preset, setPreset] = useState<Preset>('hoy');
  const [fromDay, setFromDay] = useState(today);
  const [toDay, setToDay] = useState(today);

  const range = useMemo(() => {
    const endKey = preset === 'rango' ? toDay : today;
    const startKey =
      preset === 'hoy'
        ? today
        : preset === '7d'
        ? addDays(today, -6)
        : preset === '30d'
        ? addDays(today, -29)
        : preset === 'rango'
        ? fromDay
        : '2000-01-01';
    return {
      start: startOfDayTs(startKey),
      end: startOfDayTs(endKey) + 86400000 - 1,
      startKey,
      endKey
    };
  }, [preset, today, fromDay, toDay]);

  const orders = useMemo(
    () =>
      state.orders.filter(
        (o) =>
          !o.deleted &&
          o.status !== 'cancelado' &&
          o.status !== 'borrador' &&
          o.createdAt >= range.start &&
          o.createdAt <= range.end
      ),
    [state.orders, range]
  );

  const summary = useMemo(() => {
    let total = 0;
    let collected = 0;
    let pending = 0;
    let units = 0;
    const bySize = new Map<string, number>();
    const byColor = new Map<string, { name: string; hex: string; qty: number }>();
    const byBrand = new Map<string, number>();

    for (const o of orders) {
      total += o.total;
      collected += o.deposit;
      pending += o.balance;
      for (const it of o.items) {
        units += it.qty;
        bySize.set(it.size, (bySize.get(it.size) || 0) + it.qty);
        byBrand.set(it.brandName, (byBrand.get(it.brandName) || 0) + it.qty);
        const prev = byColor.get(it.colorName);
        byColor.set(it.colorName, {
          name: it.colorName,
          hex: it.colorHex,
          qty: (prev?.qty || 0) + it.qty
        });
      }
    }

    return {
      total,
      collected,
      pending,
      units,
      count: orders.length,
      bySize: Array.from(bySize.entries()),
      byColor: Array.from(byColor.values()).sort((a, b) => b.qty - a.qty),
      byBrand: Array.from(byBrand.entries()).sort((a, b) => b[1] - a[1])
    };
  }, [orders]);

  const exportCsv = () => {
    const rows: (string | number)[][] = [
      [
        'Folio',
        'Fecha',
        'Estado',
        'Cliente',
        'Teléfono',
        'Trabajo',
        'Marca',
        'Color',
        'Talla',
        'Cantidad',
        'Precio Unitario (L)',
        'Subtotal Línea (L)',
        'Envío Pedido (L)',
        'Total Pedido (L)',
        'Anticipo (L)',
        'Saldo Pendiente (L)',
        'Método Pago',
        'Transportista',
        'Guía'
      ]
    ];
    for (const o of orders) {
      for (const it of o.items) {
        rows.push([
          folioLabel(o.folio),
          fmtDateTime(o.createdAt),
          STATUS_LABEL[o.status],
          o.shipTo.name,
          o.shipTo.phone,
          o.workType,
          it.brandName,
          it.colorName,
          it.size,
          it.qty,
          fromCents(it.unitPrice).toFixed(2),
          fromCents(it.qty * it.unitPrice).toFixed(2),
          fromCents(o.shipping).toFixed(2),
          fromCents(o.total).toFixed(2),
          fromCents(o.deposit).toFixed(2),
          fromCents(o.balance).toFixed(2),
          o.paymentMethod,
          o.carrier,
          o.trackingNumber
        ]);
      }
    }
    downloadText(`reporte-${range.startKey}-${range.endKey}.csv`, toCSV(rows));
    toast('Reporte CSV exportado');
  };

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {(
            [
              ['hoy', 'Hoy'],
              ['7d', '7 días'],
              ['30d', '30 días'],
              ['todo', 'Todo'],
              ['rango', 'Fechas']
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={`chip ${preset === id ? 'chip-on' : 'chip-off'}`}
              onClick={() => setPreset(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {preset === 'rango' && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Desde</label>
              <input
                type="date"
                className="input"
                value={fromDay}
                onChange={(e) => setFromDay(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Hasta</label>
              <input
                type="date"
                className="input"
                value={toDay}
                onChange={(e) => setToDay(e.target.value)}
              />
            </div>
          </div>
        )}

        <button className="btn-soft w-full" onClick={exportCsv} disabled={orders.length === 0}>
          📥 Exportar a CSV
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card">
          <div className="text-xs font-bold uppercase text-slate-500">Vendido</div>
          <div className="mt-1 text-2xl font-extrabold text-emerald-700">{money(summary.total)}</div>
        </div>
        <div className="card">
          <div className="text-xs font-bold uppercase text-slate-500">Cobrado</div>
          <div className="mt-1 text-2xl font-extrabold text-brand-800">{money(summary.collected)}</div>
        </div>
        <div className="card">
          <div className="text-xs font-bold uppercase text-slate-500">Por cobrar</div>
          <div className="mt-1 text-2xl font-extrabold text-red-600">{money(summary.pending)}</div>
        </div>
        <div className="card">
          <div className="text-xs font-bold uppercase text-slate-500">Unidades / Pedidos</div>
          <div className="mt-1 text-2xl font-extrabold text-slate-900">
            {summary.units} <span className="text-sm font-semibold text-slate-500">({summary.count})</span>
          </div>
        </div>
      </div>

      {orders.length === 0 ? (
        <Empty icon="📈" text="Sin ventas en este período" />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <section className="card space-y-2">
            <h2 className="section-title">Unidades por Talla</h2>
            <ul className="divide-y divide-slate-100">
              {state.settings.sizes.map((sz) => {
                const qty = summary.bySize.find(([s]) => s === sz)?.[1] || 0;
                return (
                  <li key={sz} className="flex items-center justify-between py-2">
                    <span className="font-bold text-slate-800">{sz}</span>
                    <span className="rounded-lg bg-slate-100 px-3 py-1 font-extrabold text-slate-900">
                      {qty}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="card space-y-2">
            <h2 className="section-title">Unidades por Color</h2>
            <ul className="divide-y divide-slate-100">
              {summary.byColor.map((c) => (
                <li key={c.name} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-2">
                    <ColorDot hex={c.hex} size={18} />
                    <span className="font-bold text-slate-800">{c.name}</span>
                  </div>
                  <span className="rounded-lg bg-slate-100 px-3 py-1 font-extrabold text-slate-900">
                    {c.qty}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card space-y-2">
            <h2 className="section-title">Unidades por Marca</h2>
            <ul className="divide-y divide-slate-100">
              {summary.byBrand.map(([name, qty]) => (
                <li key={name} className="flex items-center justify-between py-2">
                  <span className="font-bold text-slate-800">{name}</span>
                  <span className="rounded-lg bg-slate-100 px-3 py-1 font-extrabold text-slate-900">
                    {qty}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
