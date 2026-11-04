import { useMemo, useState } from 'react';
import type { Order, OrderStatus, Settings } from '../lib/types';
import { useAppState } from '../lib/store';
import { folioLabel } from '../lib/ids';
import { money } from '../lib/money';
import { fmtDateTime } from '../lib/time';
import { markPaid, patchOrder, setOrderStatus, STATUS_FLOW, STATUS_LABEL } from '../lib/actions';
import { shareLabel } from '../lib/pdf';
import { fillTemplate, whatsappUrl } from '../lib/whatsapp';
import { ColorDot, Confirm, Empty, PhotoViewer, toast, usePhoto } from '../components/ui';

const STATUS_STYLE: Record<OrderStatus, string> = {
  borrador: 'bg-slate-200 text-slate-800',
  en_produccion: 'bg-amber-100 text-amber-900',
  enviado: 'bg-sky-100 text-sky-900',
  entregado: 'bg-emerald-100 text-emerald-900',
  cancelado: 'bg-red-100 text-red-800'
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-extrabold ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export default function Orders() {
  const state = useAppState();
  const { settings } = state;

  const [filter, setFilter] = useState<'all' | OrderStatus>('all');
  const [query, setQuery] = useState('');
  const [viewer, setViewer] = useState<string | null>(null);
  const [cancelOrder, setCancelOrder] = useState<Order | null>(null);

  const orders = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.orders
      .filter((o) => !o.deleted)
      .filter((o) => (filter === 'all' ? true : o.status === filter))
      .filter((o) => {
        if (!q) return true;
        return (
          folioLabel(o.folio).toLowerCase().includes(q) ||
          String(o.folio).includes(q) ||
          o.shipTo.name.toLowerCase().includes(q) ||
          o.shipTo.phone.toLowerCase().includes(q) ||
          o.trackingNumber.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.folio - a.folio);
  }, [state.orders, filter, query]);

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <input
          className="input"
          placeholder="Buscar por folio, cliente, teléfono o guía..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex flex-wrap gap-1.5">
          {(['all', ...STATUS_FLOW, 'cancelado'] as const).map((st) => (
            <button
              key={st}
              className={`chip px-3 text-sm ${filter === st ? 'chip-on' : 'chip-off'}`}
              onClick={() => setFilter(st)}
            >
              {st === 'all' ? 'Todos' : STATUS_LABEL[st]}
            </button>
          ))}
        </div>
      </div>

      {orders.length === 0 ? (
        <Empty icon="📦" text="Sin pedidos" />
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <OrderCard
              key={o.id}
              order={o}
              settings={settings}
              onZoom={setViewer}
              onAskCancel={() => setCancelOrder(o)}
            />
          ))}
        </div>
      )}

      <PhotoViewer src={viewer} onClose={() => setViewer(null)} />

      <Confirm
        open={!!cancelOrder}
        onClose={() => setCancelOrder(null)}
        title="Cancelar pedido"
        text={
          cancelOrder
            ? `¿Cancelar ${folioLabel(cancelOrder.folio)}? Se devolverá automáticamente el stock descontado.`
            : ''
        }
        confirmLabel="Sí, cancelar"
        danger
        onConfirm={() => {
          if (!cancelOrder) return;
          const err = setOrderStatus(cancelOrder.id, 'cancelado');
          if (err) toast(err, 'error');
          else toast(`${folioLabel(cancelOrder.folio)} cancelado`);
        }}
      />
    </div>
  );
}

function OrderCard({
  order,
  settings,
  onZoom,
  onAskCancel
}: {
  order: Order;
  settings: Settings;
  onZoom: (src: string) => void;
  onAskCancel: () => void;
}) {
  const photo = usePhoto(order.photoId);
  const [carrier, setCarrier] = useState(order.carrier || settings.carriers[0] || '');
  const [tracking, setTracking] = useState(order.trackingNumber || '');
  const [trackingUrl, setTrackingUrl] = useState(order.trackingUrl || '');
  const [busyPdf, setBusyPdf] = useState(false);

  const saveTracking = (nextCarrier = carrier, nextTracking = tracking, nextUrl = trackingUrl) => {
    patchOrder(order.id, {
      carrier: nextCarrier,
      trackingNumber: nextTracking.trim(),
      trackingUrl: nextUrl.trim()
    });
  };

  const changeStatus = (nextStatus: OrderStatus) => {
    saveTracking();
    if (nextStatus === 'entregado' && !tracking.trim()) {
      return toast('Candado: registra el número de guía antes de marcar como entregado', 'error');
    }
    const err = setOrderStatus(order.id, nextStatus);
    if (err) return toast(err, 'error');
    toast(`${folioLabel(order.folio)} → ${STATUS_LABEL[nextStatus]}`);
  };

  const handlePdf = async () => {
    saveTracking();
    setBusyPdf(true);
    try {
      const updated: Order = {
        ...order,
        carrier,
        trackingNumber: tracking.trim(),
        trackingUrl: trackingUrl.trim()
      };
      const res = await shareLabel(updated, settings);
      toast(res === 'shared' ? 'Guía lista para compartir' : `Descargada guia-${String(order.folio).padStart(8, '0')}.pdf`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusyPdf(false);
    }
  };

  const updatedOrder: Order = {
    ...order,
    carrier,
    trackingNumber: tracking.trim(),
    trackingUrl: trackingUrl.trim()
  };
  const waTpl =
    order.status === 'enviado' || tracking.trim() ? settings.waShipped : settings.waReady;
  const waHref = whatsappUrl(
    order.shipTo.phone,
    fillTemplate(waTpl, updatedOrder, settings)
  );

  return (
    <article className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-lg font-extrabold text-brand-900">{folioLabel(order.folio)}</span>
          <StatusBadge status={order.status} />
          <span className="rounded-lg bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700">
            {order.workType}
          </span>
        </div>
        <span className="text-xs font-semibold text-slate-500">{fmtDateTime(order.createdAt)}</span>
      </div>

      {/* Totales y Saldo pendiente resaltado en rojo */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3">
        <div>
          <div className="text-xs font-semibold text-slate-500">{order.paymentMethod}</div>
          <div className="text-lg font-extrabold text-slate-900">Total: {money(order.total)}</div>
        </div>
        {order.balance > 0 && order.status !== 'cancelado' ? (
          <div className="flex items-center gap-2">
            <span className="rounded-xl bg-red-600 px-3 py-1.5 text-sm font-extrabold text-white">
              Saldo pendiente: {money(order.balance)}
            </span>
            <button
              className="btn-ghost min-h-[44px] px-3 text-xs font-bold text-emerald-700"
              onClick={() => {
                markPaid(order.id);
                toast('Saldo marcado como pagado');
              }}
            >
              ✓ Liquidar
            </button>
          </div>
        ) : (
          <span className="rounded-xl bg-emerald-100 px-3 py-1 text-sm font-extrabold text-emerald-800">
            ✓ Pagado 100%
          </span>
        )}
      </div>

      {/* Destinatario */}
      {(order.shipTo.name || order.shipTo.phone || order.shipTo.address) && (
        <div className="rounded-xl border border-slate-200 p-3 text-sm">
          <div className="font-bold text-slate-900">
            {order.shipTo.name || 'Cliente'}{' '}
            {order.shipTo.phone && <span className="font-normal text-slate-600">· {order.shipTo.phone}</span>}
          </div>
          {order.shipTo.address && (
            <div className="mt-1 whitespace-pre-line text-slate-600">{order.shipTo.address}</div>
          )}
        </div>
      )}

      {/* Foto + Prendas */}
      <div className="flex flex-col gap-3 sm:flex-row">
        {photo && (
          <button
            className="h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-slate-200"
            onClick={() => onZoom(photo)}
          >
            <img src={photo} alt="Diseño" className="h-full w-full object-cover" />
          </button>
        )}
        <ul className="flex-1 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {order.items.map((it) => (
            <li key={it.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <ColorDot hex={it.colorHex} size={18} />
                <span className="font-semibold">
                  {it.brandName} · {it.colorName} · {it.size}
                </span>
              </div>
              <span className="font-bold">
                {it.qty} × {money(it.unitPrice)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Transportista y Guía */}
      {order.status !== 'cancelado' && (
        <div className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:grid-cols-3">
          <div>
            <label className="label">Transportista</label>
            <select
              className="input"
              value={carrier}
              onChange={(e) => {
                setCarrier(e.target.value);
                saveTracking(e.target.value, tracking, trackingUrl);
              }}
            >
              {settings.carriers.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Número de guía</label>
            <input
              className="input"
              placeholder="Ej. CE-998877"
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
              onBlur={() => saveTracking(carrier, tracking, trackingUrl)}
            />
          </div>
          <div>
            <label className="label">URL de rastreo (opcional)</label>
            <input
              className="input"
              placeholder="https://..."
              value={trackingUrl}
              onChange={(e) => setTrackingUrl(e.target.value)}
              onBlur={() => saveTracking(carrier, tracking, trackingUrl)}
            />
          </div>
        </div>
      )}

      {/* Avance de estados con candado obligatorio */}
      {order.status !== 'cancelado' && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {STATUS_FLOW.map((st) => {
            const locked = st === 'entregado' && !tracking.trim();
            const active = order.status === st;
            return (
              <button
                key={st}
                type="button"
                className={`chip text-sm ${active ? 'chip-on' : 'chip-off'} ${
                  locked ? 'border-amber-300 text-slate-400' : ''
                }`}
                onClick={() => changeStatus(st)}
                title={locked ? 'Requiere número de guía' : STATUS_LABEL[st]}
              >
                {locked ? '🔒 ' : ''}
                {STATUS_LABEL[st]}
              </button>
            );
          })}
          <button type="button" className="btn-ghost text-sm text-red-600" onClick={onAskCancel}>
            Cancelar
          </button>
        </div>
      )}

      {/* Acciones de etiqueta PDF y WhatsApp */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button className="btn-soft" onClick={handlePdf} disabled={busyPdf}>
          📄 {busyPdf ? 'Generando PDF...' : `Etiqueta PDF (guia-${String(order.folio).padStart(8, '0')}.pdf)`}
        </button>
        <a
          className="btn bg-[#25D366] text-white hover:bg-[#1ebe5b]"
          href={waHref}
          target="_blank"
          rel="noreferrer"
          onClick={() => patchOrder(order.id, { whatsappSentAt: Date.now() })}
        >
          💬 Enviar Guía por WhatsApp
        </a>
      </div>
    </article>
  );
}
