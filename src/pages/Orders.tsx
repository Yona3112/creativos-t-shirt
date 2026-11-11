import { useMemo, useRef, useState } from 'react';
import type { Order, OrderStatus, Settings } from '../lib/types';
import { notifyPhotos, useAppState } from '../lib/store';
import { folioLabel, uid } from '../lib/ids';
import { fromCents, money, toCents } from '../lib/money';
import { dayKey, fmtDateTime } from '../lib/time';
import { deleteOrder, markPaid, patchOrder, setOrderStatus, STATUS_FLOW, STATUS_LABEL } from '../lib/actions';
import { printDailyOrdersReport } from '../lib/printReports';
import { shareLabel } from '../lib/pdf';
import { compressImage } from '../lib/image';
import { savePhoto } from '../lib/db';
import { uploadPhotoNow } from '../lib/sync';
import { copyText } from '../lib/csv';
import { buildBoxfulClipboardSummary, createBoxfulShipment, getBoxfulConfig } from '../lib/boxful';
import { fillTemplate, whatsappUrl } from '../lib/whatsapp';
import { ColorDot, Confirm, Empty, Modal, PhotoViewer, toast, usePhoto } from '../components/ui';

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
  const today = dayKey();

  const [filter, setFilter] = useState<'all' | OrderStatus>('all');
  const [query, setQuery] = useState('');
  const [printDate, setPrintDate] = useState(today);
  const [onlySelectedDay, setOnlySelectedDay] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null);
  const [cancelOrder, setCancelOrder] = useState<Order | null>(null);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [confirmDeleteOrder, setConfirmDeleteOrder] = useState<Order | null>(null);

  const dayOrders = useMemo(
    () =>
      state.orders
        .filter((o) => !o.deleted && o.status !== 'cancelado' && dayKey(o.createdAt) === printDate)
        .sort((a, b) => a.folio - b.folio),
    [state.orders, printDate]
  );

  const orders = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.orders
      .filter((o) => !o.deleted)
      .filter((o) => (onlySelectedDay ? dayKey(o.createdAt) === printDate : true))
      .filter((o) => (filter === 'all' ? true : o.status === filter))
      .filter((o) => {
        if (!q) return true;
        return (
          folioLabel(o.folio).toLowerCase().includes(q) ||
          String(o.folio).includes(q) ||
          o.shipTo.name.toLowerCase().includes(q) ||
          o.shipTo.phone.toLowerCase().includes(q) ||
          o.trackingNumber.toLowerCase().includes(q) ||
          (o.designCode || '').toLowerCase().includes(q) ||
          (o.designName || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.folio - a.folio);
  }, [state.orders, onlySelectedDay, printDate, filter, query]);

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        {/* Barra de Impresión de Pedidos */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50/90 p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              className="input h-9 w-auto px-2.5 py-1 text-xs font-bold"
              value={printDate}
              onChange={(e) => setPrintDate(e.target.value || today)}
              aria-label="Fecha"
            />
            <button
              type="button"
              onClick={() => setOnlySelectedDay((v) => !v)}
              className={`rounded-xl border px-2.5 py-1.5 text-xs font-bold transition ${
                onlySelectedDay
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              {onlySelectedDay ? `Solo ${printDate}` : 'Filtrar por fecha'}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-primary px-3 py-2 text-xs"
              onClick={() => {
                if (dayOrders.length === 0) {
                  return toast(`Sin pedidos el ${printDate}`, 'info');
                }
                printDailyOrdersReport(
                  dayOrders,
                  settings,
                  printDate === today ? `Pedidos de Hoy (${printDate})` : `Pedidos del Día (${printDate})`
                );
              }}
            >
              🖨️ Imprimir Día ({dayOrders.length})
            </button>
            <button
              type="button"
              className="btn-soft px-3 py-2 text-xs"
              disabled={orders.length === 0}
              onClick={() =>
                printDailyOrdersReport(
                  orders,
                  settings,
                  `Pedidos (${orders.length})`
                )
              }
            >
              🖨️ Imprimir Lista ({orders.length})
            </button>
          </div>
        </div>

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
              onEdit={() => setEditingOrder(o)}
              onAskDelete={() => setConfirmDeleteOrder(o)}
            />
          ))}
        </div>
      )}

      <PhotoViewer src={viewer} onClose={() => setViewer(null)} />

      {editingOrder && (
        <EditOrderModal
          order={editingOrder}
          settings={settings}
          onClose={() => setEditingOrder(null)}
        />
      )}

      <Confirm
        open={!!confirmDeleteOrder}
        onClose={() => setConfirmDeleteOrder(null)}
        title="Eliminar pedido"
        text={
          confirmDeleteOrder
            ? `¿Eliminar el pedido ${folioLabel(confirmDeleteOrder.folio)} del listado?`
            : ''
        }
        confirmLabel="Sí, eliminar pedido"
        danger
        onConfirm={() => {
          if (confirmDeleteOrder) {
            deleteOrder(confirmDeleteOrder.id);
            toast(`Pedido ${folioLabel(confirmDeleteOrder.folio)} eliminado`);
          }
        }}
      />

      {cancelOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  Cancelar o Devolución · {folioLabel(cancelOrder.folio)}
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Cliente: {cancelOrder.shipTo.name || 'Consumidor'} · {cancelOrder.items.length} prenda(s)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCancelOrder(null)}
                className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="font-bold">¿Cómo deseas reingresar la prenda al inventario?</p>
              <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
                Si el pedido fue <strong>pago contra entrega</strong> y el cliente regresó la camisa ya estampada, guárdala como <strong>Prenda Ya Estampada</strong> para que quede disponible para entrega inmediata en esa talla y diseño, sin mezclarla con camisas lisas vírgenes.
              </p>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  const err = setOrderStatus(cancelOrder.id, 'cancelado', { returnAsReadyMade: true });
                  if (err) toast(err, 'error');
                  else toast(`¡Prenda reingresada como Prenda Ya Estampada (Stock Inmediato)!`, 'ok');
                  setCancelOrder(null);
                }}
                className="flex w-full items-center justify-between rounded-2xl border-2 border-indigo-200 bg-indigo-50/70 p-3 text-left transition hover:border-indigo-600 hover:bg-indigo-50"
              >
                <div>
                  <div className="text-xs font-black text-indigo-950">
                    ⚡ Sí, la prenda ya está estampada
                  </div>
                  <div className="text-[11px] text-indigo-700">
                    Guardar en "Prendas Listas" para venta o entrega inmediata en esa talla
                  </div>
                </div>
                <span className="text-xl">👕</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const err = setOrderStatus(cancelOrder.id, 'cancelado', { returnAsReadyMade: false });
                  if (err) toast(err, 'error');
                  else toast(`Pedido cancelado. Stock devuelto a camisas en blanco.`);
                  setCancelOrder(null);
                }}
                className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-slate-400 hover:bg-white"
              >
                <div>
                  <div className="text-xs font-bold text-slate-800">
                    👕 Era camisa lisa (sin estampar)
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Devolver a inventario regular de camisas vírgenes en blanco
                  </div>
                </div>
                <span className="text-xl">↩️</span>
              </button>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setCancelOrder(null)}
                className="btn-ghost text-xs text-slate-500"
              >
                No cancelar, mantener pedido
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OrderCard({
  order,
  settings,
  onZoom,
  onAskCancel,
  onEdit,
  onAskDelete
}: {
  order: Order;
  settings: Settings;
  onZoom: (src: string) => void;
  onAskCancel: () => void;
  onEdit: () => void;
  onAskDelete: () => void;
}) {
  const photo = usePhoto(order.photoId);
  const guidePhoto = usePhoto(order.guidePhotoId || null);
  const guideInputRef = useRef<HTMLInputElement>(null);
  const [carrier, setCarrier] = useState(order.carrier || settings.carriers[0] || '');
  const [tracking, setTracking] = useState(order.trackingNumber || '');
  const [trackingUrl, setTrackingUrl] = useState(order.trackingUrl || '');
  const [busyPdf, setBusyPdf] = useState(false);
  const [busyBoxful, setBusyBoxful] = useState(false);

  const saveTracking = (nextCarrier = carrier, nextTracking = tracking, nextUrl = trackingUrl) => {
    patchOrder(order.id, {
      carrier: nextCarrier,
      trackingNumber: nextTracking.trim(),
      trackingUrl: nextUrl.trim()
    });
  };

  const handleUploadGuidePhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      const dataUrl = await compressImage(file, 1400, 0.88, true);
      const gId = `guia-${order.id}-${uid().slice(0, 6)}`;
      await savePhoto(gId, dataUrl, 0);
      void uploadPhotoNow(gId, dataUrl);
      notifyPhotos();
      patchOrder(order.id, {
        guidePhotoId: gId,
        carrier: carrier || settings.carriers[0] || 'Boxful',
        trackingNumber: tracking.trim() || `GUIA-${order.folio}`
      });
      if (!tracking.trim()) setTracking(`GUIA-${order.folio}`);
      toast('Foto de guía de envío guardada');
    } catch (e) {
      toast((e as Error).message || 'Error al subir foto de guía', 'error');
    }
  };

  const handleBoxfulAction = async () => {
    setBusyBoxful(true);
    try {
      const cfg = getBoxfulConfig();
      if (cfg && (cfg.email || cfg.accessToken)) {
        const res = await createBoxfulShipment(order, settings);
        setCarrier(res.carrier);
        setTracking(res.trackingNumber);
        setTrackingUrl(res.trackingUrl);
        saveTracking(res.carrier, res.trackingNumber, res.trackingUrl);
        toast(`📦 Guía Boxful generada: ${res.trackingNumber}`);
        return;
      }
      // Modo asistido 1-clic: copia datos del destinatario y abre Boxful
      await copyText(buildBoxfulClipboardSummary(order));
      setCarrier('Boxful');
      saveTracking('Boxful', tracking, trackingUrl);
      toast('Datos copiados para Boxful (pégalos en tu panel o configura tu API en Ajustes)');
      window.open('https://app.goboxful.com', '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusyBoxful(false);
    }
  };

  const handleQuickSendGuideWsp = async () => {
    saveTracking();
    patchOrder(order.id, { whatsappSentAt: Date.now() });
    const msg = fillTemplate(
      order.status === 'enviado' || tracking.trim() || guidePhoto ? settings.waShipped : settings.waReady,
      {
        ...order,
        carrier,
        trackingNumber: tracking.trim() || (guidePhoto ? `Adjunta (${folioLabel(order.folio)})` : ''),
        trackingUrl: trackingUrl.trim()
      },
      settings
    );

    // Si hay foto de la guía subida y el dispositivo soporta compartir archivos nativos (móvil), ofrecer compartir imagen + texto
    if (guidePhoto && navigator.share) {
      try {
        const blob = await (await fetch(guidePhoto)).blob();
        const file = new File([blob], `guia-${order.folio}.jpg`, { type: blob.type || 'image/jpeg' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: `Guía ${folioLabel(order.folio)}`,
            text: msg,
            files: [file]
          });
          return;
        }
      } catch {
        /* fallback a WhatsApp directo */
      }
    }

    const href = whatsappUrl(order.shipTo.phone, msg);
    window.open(href, '_blank', 'noopener,noreferrer');
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
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-lg font-extrabold text-brand-900">{folioLabel(order.folio)}</span>
          <StatusBadge status={order.status} />
          <span className="rounded-lg bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700">
            {order.workType}
          </span>
          {(order.designCode || order.designName) && (
            <span className="inline-flex items-center gap-1 rounded-lg bg-amber-100 px-2 py-0.5 text-xs font-extrabold text-amber-950">
              {order.designCode && (
                <span className="rounded bg-slate-900 px-1 py-px font-mono text-[10px] text-amber-300">
                  {order.designCode}
                </span>
              )}
              <span>{order.designName}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-slate-500">{fmtDateTime(order.createdAt)}</span>
          <button
            type="button"
            onClick={onEdit}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50"
            title="Editar datos del pedido"
          >
            ✏️ Editar
          </button>
          <button
            type="button"
            onClick={onAskDelete}
            className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-bold text-rose-700 hover:bg-rose-100"
            title="Eliminar pedido"
          >
            🗑️
          </button>
        </div>
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
              <div className="flex flex-wrap items-center gap-2">
                <ColorDot hex={it.colorHex} size={18} />
                <span className="font-semibold">
                  {it.brandName} · {it.colorName} · {it.size}
                </span>
                {order.status !== 'cancelado' && (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      it.fromStock >= it.qty
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-amber-50 text-amber-700'
                    }`}
                  >
                    {it.fromStock >= it.qty
                      ? `✓ Stock descontado (${it.fromStock})`
                      : `Stock: ${it.fromStock}/${it.qty} · Bajo pedido: ${it.qty - it.fromStock}`}
                  </span>
                )}
              </div>
              <span className="font-bold">
                {it.qty} × {money(it.unitPrice)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Transportista, Subida de Guía, Boxful y Botón Pequeño Enviar por WSP */}
      {order.status !== 'cancelado' && (
        <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-extrabold uppercase tracking-wider text-slate-600">
              🚚 Guía de Envío y Rastreo
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                ref={guideInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  void handleUploadGuidePhoto(f);
                }}
              />
              <button
                type="button"
                onClick={() => guideInputRef.current?.click()}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-extrabold text-slate-800 shadow-sm transition hover:bg-slate-100"
                title="Subir foto o captura de la guía de envío"
              >
                📷 {guidePhoto ? 'Cambiar foto de guía' : 'Subir guía'}
              </button>
              <button
                type="button"
                disabled={busyBoxful}
                onClick={() => void handleBoxfulAction()}
                className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-extrabold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
                title="Generar guía con Boxful API o copiar datos para Boxful"
              >
                📦 {busyBoxful ? 'Boxful...' : 'Boxful'}
              </button>
              <button
                type="button"
                onClick={() => void handleQuickSendGuideWsp()}
                className="inline-flex items-center gap-1 rounded-lg bg-[#25D366] px-2.5 py-1.5 text-xs font-extrabold text-white shadow-sm transition hover:bg-[#1ebe5b]"
                title="Enviar guía y datos de rastreo al cliente por WhatsApp"
              >
                💬 Enviar por WSP
              </button>
            </div>
          </div>

          {guidePhoto && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-2">
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => onZoom(guidePhoto)}
                  className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-emerald-300 bg-white"
                >
                  <img src={guidePhoto} alt="Guía de envío" className="h-full w-full object-cover" />
                </button>
                <div className="text-xs">
                  <div className="font-extrabold text-emerald-950">✓ Guía de envío adjunta</div>
                  <div className="text-emerald-700">Toca la miniatura para ver en pantalla completa</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleQuickSendGuideWsp()}
                className="rounded-lg bg-[#25D366] px-2.5 py-1.5 text-xs font-extrabold text-white shadow-sm hover:bg-[#1ebe5b]"
              >
                💬 Enviar por WSP
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
                placeholder="Ej. CE-998877 / BX-102"
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

function EditOrderModal({
  order,
  settings,
  onClose
}: {
  order: Order;
  settings: Settings;
  onClose: () => void;
}) {
  const [name, setName] = useState(order.shipTo.name || '');
  const [phone, setPhone] = useState(order.shipTo.phone || '');
  const [address, setAddress] = useState(order.shipTo.address || '');
  const [workType, setWorkType] = useState(order.workType || settings.workTypes[0] || '');
  const [paymentMethod, setPaymentMethod] = useState(order.paymentMethod || settings.paymentMethods[0] || '');
  const [designName, setDesignName] = useState(order.designName || '');
  const [designCode, setDesignCode] = useState(order.designCode || '');
  const [notes, setNotes] = useState(order.notes || '');
  const [shipping, setShipping] = useState(String(fromCents(order.shipping)));
  const [deposit, setDeposit] = useState(String(fromCents(order.deposit)));
  const [items, setItems] = useState(
    order.items.map((it) => ({
      ...it,
      priceInput: String(fromCents(it.unitPrice)),
      qtyInput: String(it.qty)
    }))
  );

  const handleSave = () => {
    const nextItems = items.map((it) => ({
      id: it.id,
      brandId: it.brandId,
      colorId: it.colorId,
      size: it.size,
      qty: Math.max(1, Math.floor(Number(it.qtyInput) || 1)),
      unitPrice: toCents(it.priceInput),
      manualPrice: true,
      fromStock: it.fromStock,
      brandName: it.brandName,
      colorName: it.colorName,
      colorHex: it.colorHex,
      sku: it.sku
    }));
    const subtotal = nextItems.reduce((sum, i) => sum + i.qty * i.unitPrice, 0);
    const shipCents = toCents(shipping);
    const total = subtotal + shipCents;
    const depCents = Math.min(total, Math.max(0, toCents(deposit)));

    patchOrder(order.id, {
      shipTo: {
        name: name.trim(),
        phone: phone.trim(),
        address: address.trim()
      },
      workType,
      paymentMethod,
      designName: designName.trim() || null,
      designCode: designCode.trim().toUpperCase() || null,
      notes: notes.trim(),
      items: nextItems,
      subtotal,
      shipping: shipCents,
      total,
      deposit: depCents,
      balance: Math.max(0, total - depCents)
    });
    toast(`Pedido ${folioLabel(order.folio)} actualizado`, 'ok');
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Editar Pedido · ${folioLabel(order.folio)}`}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn-primary" onClick={handleSave}>
            Guardar cambios
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <label className="label">Destinatario / Cliente</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label">Teléfono</label>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="label">Dirección de entrega</label>
          <textarea
            rows={2}
            className="input"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <label className="label">Tipo de trabajo</label>
            <select className="input" value={workType} onChange={(e) => setWorkType(e.target.value)}>
              {settings.workTypes.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Método de pago</label>
            <select className="input" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              {settings.paymentMethods.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div>
            <label className="label">Código diseño</label>
            <input
              className="input uppercase"
              value={designCode}
              onChange={(e) => setDesignCode(e.target.value.toUpperCase())}
              placeholder="D-001"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Nombre del diseño</label>
            <input
              className="input"
              value={designName}
              onChange={(e) => setDesignName(e.target.value)}
              placeholder="Diseño personalizado"
            />
          </div>
        </div>

        {/* Prendas del pedido */}
        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-extrabold uppercase text-slate-600">Prendas y Precios Unitarios</div>
          {items.map((it, idx) => (
            <div key={it.id} className="grid grid-cols-12 items-center gap-2 text-xs">
              <div className="col-span-5 font-bold text-slate-800">
                {it.brandName} · {it.colorName} ({it.size})
              </div>
              <div className="col-span-3">
                <label className="block text-[10px] text-slate-500">Cant.</label>
                <input
                  type="number"
                  min={1}
                  className="input h-9 px-2"
                  value={it.qtyInput}
                  onChange={(e) => {
                    const v = e.target.value;
                    setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, qtyInput: v } : x)));
                  }}
                />
              </div>
              <div className="col-span-4">
                <label className="block text-[10px] text-slate-500">Precio (L)</label>
                <input
                  type="number"
                  min={0}
                  className="input h-9 px-2"
                  value={it.priceInput}
                  onChange={(e) => {
                    const v = e.target.value;
                    setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, priceInput: v } : x)));
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Envío (L)</label>
            <input
              type="number"
              min={0}
              className="input"
              value={shipping}
              onChange={(e) => setShipping(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Pagado / Anticipo (L)</label>
            <input
              type="number"
              min={0}
              className="input"
              value={deposit}
              onChange={(e) => setDeposit(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="label">Notas de producción / entrega</label>
          <textarea
            rows={2}
            className="input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}
