import { useEffect, useMemo, useRef, useState } from 'react';
import type { Order, OrderStatus, Section, Settings } from '../lib/types';
import { notifyPhotos, useAppState } from '../lib/store';
import { brandColors, skuOf } from '../lib/inventory';
import { folioLabel, uid } from '../lib/ids';
import { fromCents, money, toCents } from '../lib/money';
import { dayKey, fmtDateTime } from '../lib/time';
import { deleteOrder, markPaid, orderStockReturnCount, patchOrder, setOrderStatus, STATUS_FLOW, STATUS_LABEL, updateOrderDetails } from '../lib/actions';
import { printDailyOrdersReport } from '../lib/printReports';
import { shareLabel } from '../lib/pdf';
import { WorkshopPdfModal } from '../components/WorkshopPdfModal';
import { compressImage } from '../lib/image';
import { savePhoto } from '../lib/db';
import { uploadPhotoNow } from '../lib/sync';
import { copyText } from '../lib/csv';
import { buildBoxfulClipboardSummary, createBoxfulShipment, getBoxfulConfig } from '../lib/boxful';
import { fillTemplate, whatsappUrl } from '../lib/whatsapp';
import { ColorDot, Confirm, Empty, Modal, PhotoViewer, StatusBadge, toast, usePhoto } from '../components/ui';

export { StatusBadge };

type OrderFilter = 'all' | 'por_cobrar' | OrderStatus;
const VALID_FILTERS = new Set<OrderFilter>(['all', 'por_cobrar', ...STATUS_FLOW, 'cancelado']);

function readInitialOrderFilter(): OrderFilter {
  try {
    const v = sessionStorage.getItem('cgs_orders_filter') as OrderFilter | null;
    sessionStorage.removeItem('cgs_orders_filter');
    if (v && VALID_FILTERS.has(v)) return v;
  } catch {}
  return 'all';
}

function readInitialOrderQuery(): string {
  try {
    const q = sessionStorage.getItem('cgs_orders_query') || '';
    sessionStorage.removeItem('cgs_orders_query');
    return q;
  } catch {
    return '';
  }
}

export default function Orders({ navigate }: { navigate?: (s: Section) => void }) {
  const state = useAppState();
  const { settings } = state;
  const today = dayKey();

  const [filter, setFilter] = useState<OrderFilter>(readInitialOrderFilter);
  const [query, setQuery] = useState(readInitialOrderQuery);
  const [printDate, setPrintDate] = useState(today);
  const [onlySelectedDay, setOnlySelectedDay] = useState(false);
  const [visibleCount, setVisibleCount] = useState(25);
  const [viewer, setViewer] = useState<string | null>(null);
  const [cancelOrder, setCancelOrder] = useState<Order | null>(null);
  const [settlingOrder, setSettlingOrder] = useState<Order | null>(null);
  const [settleMethod, setSettleMethod] = useState('');
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [confirmDeleteOrder, setConfirmDeleteOrder] = useState<Order | null>(null);
  const [pdfModal, setPdfModal] = useState<{ orders: Order[]; title: string } | null>(null);

  const settleableMethods = useMemo(() => {
    const list = settings.paymentMethods.filter((m) => !m.toLowerCase().includes('pendiente'));
    return list.length > 0 ? list : ['Efectivo', 'Transferencia Bancaria'];
  }, [settings.paymentMethods]);

  useEffect(() => {
    setVisibleCount(25);
  }, [filter, query, onlySelectedDay, printDate]);

  const receivableCount = useMemo(
    () =>
      state.orders.filter(
        (o) => !o.deleted && o.status !== 'cancelado' && o.status !== 'borrador' && o.balance > 0
      ).length,
    [state.orders]
  );

  const dayOrders = useMemo(
    () =>
      state.orders
        .filter((o) => !o.deleted && o.status !== 'cancelado' && o.status !== 'borrador' && dayKey(o.createdAt) === printDate)
        .sort((a, b) => a.folio - b.folio),
    [state.orders, printDate]
  );

  const orders = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.orders
      .filter((o) => !o.deleted)
      .filter((o) => (onlySelectedDay ? dayKey(o.createdAt) === printDate : true))
      .filter((o) => {
        if (filter === 'all') return true;
        if (filter === 'por_cobrar') {
          return o.status !== 'cancelado' && o.status !== 'borrador' && o.balance > 0;
        }
        return o.status === filter;
      })
      .filter((o) => {
        if (!q) return true;
        return (
          folioLabel(o.folio).toLowerCase().includes(q) ||
          String(o.folio).includes(q) ||
          o.shipTo.name.toLowerCase().includes(q) ||
          o.shipTo.phone.toLowerCase().includes(q) ||
          o.trackingNumber.toLowerCase().includes(q) ||
          (o.designCode || '').toLowerCase().includes(q) ||
          (o.designName || '').toLowerCase().includes(q) ||
          o.items.some(
            (it) =>
              (it.designCode || '').toLowerCase().includes(q) ||
              (it.designName || '').toLowerCase().includes(q) ||
              (it.colorName || '').toLowerCase().includes(q) ||
              (it.brandName || '').toLowerCase().includes(q) ||
              (it.size || '').toLowerCase() === q
          )
        );
      })
      .sort((a, b) => b.folio - a.folio);
  }, [state.orders, onlySelectedDay, printDate, filter, query]);

  const visibleOrders = useMemo(() => orders.slice(0, visibleCount), [orders, visibleCount]);

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
                setPdfModal({
                  orders: dayOrders,
                  title: printDate === today ? `Pedidos de Hoy (${printDate})` : `Pedidos del Día (${printDate})`
                });
              }}
            >
              📄 PDF Taller Día ({dayOrders.length})
            </button>
            <button
              type="button"
              className="btn-soft px-3 py-2 text-xs"
              disabled={orders.length === 0}
              onClick={() =>
                setPdfModal({
                  orders,
                  title: `Pedidos (${orders.length})`
                })
              }
            >
              📄 PDF Lista ({orders.length})
            </button>
            <button
              type="button"
              className="btn-ghost px-3 py-2 text-xs"
              disabled={dayOrders.length === 0}
              onClick={() =>
                printDailyOrdersReport(
                  dayOrders,
                  settings,
                  printDate === today ? `Pedidos de Hoy (${printDate})` : `Pedidos del Día (${printDate})`
                )
              }
            >
              🖨️ Imprimir Día
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="Buscar por folio, cliente, diseño, color, talla o guía..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="btn-ghost shrink-0 px-3 text-xs"
              title="Limpiar búsqueda"
            >
              ✕ Limpiar
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            className={`chip px-3 text-sm ${filter === 'all' ? 'chip-on' : 'chip-off'}`}
            onClick={() => setFilter('all')}
          >
            Todos
          </button>
          <button
            className={`chip px-3 text-sm ${
              filter === 'por_cobrar'
                ? 'bg-rose-600 text-white shadow'
                : receivableCount > 0
                ? 'border border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100'
                : 'chip-off'
            }`}
            onClick={() => setFilter('por_cobrar')}
          >
            💸 Por cobrar ({receivableCount})
          </button>
          {([...STATUS_FLOW, 'cancelado'] as const).map((st) => (
            <button
              key={st}
              className={`chip px-3 text-sm ${filter === st ? 'chip-on' : 'chip-off'}`}
              onClick={() => setFilter(st)}
            >
              {STATUS_LABEL[st]}
            </button>
          ))}
        </div>
      </div>

      {orders.length === 0 ? (
        <Empty icon="📦" text="Sin pedidos" />
      ) : (
        <div className="space-y-3">
          {visibleOrders.map((o) => (
            <OrderCard
              key={o.id}
              order={o}
              settings={settings}
              onZoom={setViewer}
              onAskCancel={() => {
                if (o.status === 'borrador') {
                  const err = setOrderStatus(o.id, 'cancelado', { returnAsReadyMade: false });
                  if (err) toast(err, 'error');
                  else toast(`Borrador ${folioLabel(o.folio)} cancelado`);
                  return;
                }
                setCancelOrder(o);
              }}
              onAskSettle={() => {
                if ((o.paymentMethod || '').toLowerCase().includes('pendiente')) {
                  setSettleMethod(settleableMethods[0] || 'Efectivo');
                  setSettlingOrder(o);
                  return;
                }
                markPaid(o.id);
                toast('Pago completo registrado');
              }}
              onEdit={() => setEditingOrder(o)}
              onRepeat={
                navigate
                  ? () => {
                      try {
                        sessionStorage.setItem('cgs_repeat_order_v1', JSON.stringify(o));
                      } catch {}
                      navigate('vender');
                    }
                  : undefined
              }
              onAskDelete={() => setConfirmDeleteOrder(o)}
              onOpenWorkshopPdf={() =>
                setPdfModal({
                  orders: [o],
                  title: `Orden Taller ${folioLabel(o.folio)}`
                })
              }
            />
          ))}
          {orders.length > visibleOrders.length && (
            <button
              type="button"
              onClick={() => setVisibleCount((c) => c + 25)}
              className="btn-soft w-full py-3 text-sm font-extrabold"
            >
              Mostrar más pedidos ({orders.length - visibleOrders.length} restantes)
            </button>
          )}
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
            ? (() => {
                const ret = orderStockReturnCount(confirmDeleteOrder);
                return ret > 0
                  ? `¿Eliminar el pedido ${folioLabel(confirmDeleteOrder.folio)}? Se regresarán ${ret} camisa(s) en blanco al inventario.`
                  : `¿Eliminar el pedido ${folioLabel(confirmDeleteOrder.folio)} del listado?`;
              })()
            : ''
        }
        confirmLabel={
          confirmDeleteOrder && orderStockReturnCount(confirmDeleteOrder) > 0
            ? 'Sí, eliminar y devolver stock'
            : 'Sí, eliminar pedido'
        }
        danger
        onConfirm={() => {
          if (confirmDeleteOrder) {
            const ret = orderStockReturnCount(confirmDeleteOrder);
            deleteOrder(confirmDeleteOrder.id);
            toast(
              ret > 0
                ? `Pedido ${folioLabel(confirmDeleteOrder.folio)} eliminado · ${ret} camisa(s) devueltas al inventario`
                : `Pedido ${folioLabel(confirmDeleteOrder.folio)} eliminado`,
              'ok'
            );
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

      <Modal
        open={Boolean(settlingOrder)}
        onClose={() => setSettlingOrder(null)}
        title={settlingOrder ? `Liquidar ${folioLabel(settlingOrder.folio)}` : ''}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setSettlingOrder(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn-primary bg-emerald-600 hover:bg-emerald-700"
              onClick={() => {
                if (!settlingOrder) return;
                markPaid(settlingOrder.id, settleMethod || settleableMethods[0] || 'Efectivo');
                toast(`Pago completo registrado (${settleMethod || settleableMethods[0] || 'Efectivo'})`);
                setSettlingOrder(null);
              }}
            >
              ✓ Confirmar Liquidación
            </button>
          </div>
        }
      >
        {settlingOrder && (
          <div className="space-y-3">
            <div className="rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm font-bold text-emerald-950">
              Saldo a liquidar: {money(settlingOrder.balance)} · Total: {money(settlingOrder.total)}
            </div>
            <div>
              <label className="label">¿Con qué método pagó el cliente?</label>
              <div className="grid grid-cols-2 gap-1.5">
                {settleableMethods.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setSettleMethod(m)}
                    className={`rounded-xl border px-3 py-2 text-xs font-bold transition ${
                      settleMethod === m
                        ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {pdfModal && (
        <WorkshopPdfModal
          open
          onClose={() => setPdfModal(null)}
          orders={pdfModal.orders}
          settings={settings}
          title={pdfModal.title}
        />
      )}
    </div>
  );
}

function OrderCard({
  order,
  settings,
  onZoom,
  onAskCancel,
  onAskSettle,
  onEdit,
  onRepeat,
  onAskDelete,
  onOpenWorkshopPdf
}: {
  order: Order;
  settings: Settings;
  onZoom: (src: string) => void;
  onAskCancel: () => void;
  onAskSettle: () => void;
  onEdit: () => void;
  onRepeat?: () => void;
  onAskDelete: () => void;
  onOpenWorkshopPdf: () => void;
}) {
  const photo = usePhoto(order.photoId);
  const guidePhoto = usePhoto(order.guidePhotoId || null);
  const guideInputRef = useRef<HTMLInputElement>(null);
  const [carrier, setCarrier] = useState(order.carrier || settings.carriers[0] || '');
  const [tracking, setTracking] = useState(order.trackingNumber || '');
  const [trackingUrl, setTrackingUrl] = useState(order.trackingUrl || '');
  const [busyPdf, setBusyPdf] = useState(false);
  const [busyBoxful, setBusyBoxful] = useState(false);

  useEffect(() => {
    setCarrier(order.carrier || settings.carriers[0] || '');
    setTracking(order.trackingNumber || '');
    setTrackingUrl(order.trackingUrl || '');
  }, [order.id, order.carrier, order.trackingNumber, order.trackingUrl, settings.carriers]);

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

    // Si hay foto de la guía subida y el dispositivo soporta compartir archivos nativos (móvil), compartir imagen + texto
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
          patchOrder(order.id, { whatsappSentAt: Date.now() });
          return;
        }
      } catch {
        /* fallback a WhatsApp directo */
      }
    }

    const phoneDigits = (order.shipTo.phone || '').replace(/\D/g, '');
    if (phoneDigits.length < 8) {
      toast('Agrega un teléfono válido al pedido para abrir WhatsApp directo', 'info');
      return;
    }

    patchOrder(order.id, { whatsappSentAt: Date.now() });
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

  const hasGuideOrTracking = Boolean(guidePhoto || tracking.trim() || order.status === 'enviado');

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
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-slate-500">{fmtDateTime(order.createdAt)}</span>
          {onRepeat && (
            <button
              type="button"
              onClick={onRepeat}
              className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-800 hover:bg-sky-100"
              title="Crear un nuevo pedido igual a este"
            >
              🔄 Repetir
            </button>
          )}
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
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-xl px-3 py-1.5 text-sm font-extrabold ${
                order.deposit <= 0
                  ? 'bg-amber-500 text-stone-950'
                  : 'bg-red-600 text-white'
              }`}
            >
              {order.deposit <= 0
                ? `⏳ Pago pendiente (Paga en tienda): ${money(order.balance)}`
                : `Saldo pendiente: ${money(order.balance)}`}
            </span>
            <button
              className="btn-ghost min-h-[44px] px-3 text-xs font-bold text-emerald-700"
              onClick={onAskSettle}
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
            <OrderItemRow key={it.id} item={it} orderStatus={order.status} onZoom={onZoom} />
          ))}
        </ul>
      </div>

      {/* Transportista, Subida de Guía y Boxful */}
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
            </div>
          </div>

          {guidePhoto && (
            <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/70 p-2">
              <button
                type="button"
                onClick={() => onZoom(guidePhoto)}
                className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-emerald-300 bg-white"
              >
                <img src={guidePhoto} alt="Guía de envío" className="h-full w-full object-cover" />
              </button>
              <div className="text-xs">
                <div className="font-extrabold text-emerald-950">✓ Guía de envío adjunta</div>
                <div className="text-emerald-700">
                  Se adjunta automáticamente al tocar &quot;WhatsApp Guía&quot; (toca la foto para ampliar)
                </div>
              </div>
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

      {/* Acciones de PDF taller, etiqueta y WhatsApp unificado */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <button type="button" className="btn-primary" onClick={onOpenWorkshopPdf}>
          🧾 Orden Taller PDF
        </button>
        <button className="btn-soft" onClick={handlePdf} disabled={busyPdf}>
          📄 {busyPdf ? 'Generando...' : `Etiqueta PDF`}
        </button>
        <button
          type="button"
          className="btn bg-[#25D366] text-white hover:bg-[#1ebe5b]"
          onClick={() => void handleQuickSendGuideWsp()}
          title="Enviar guía / aviso al cliente por WhatsApp (incluye foto de guía si el dispositivo lo soporta)"
        >
          <span>💬 {hasGuideOrTracking ? 'WhatsApp Guía' : 'WhatsApp Cliente'}</span>
          {order.whatsappSentAt && (
            <span className="ml-1 rounded-full bg-black/20 px-1.5 py-0.5 text-[10px] font-bold">
              ✓
            </span>
          )}
        </button>
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
  const state = useAppState();
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
      qtyInput: String(it.qty),
      designCodeInput: it.designCode || (order.items.length === 1 ? order.designCode || '' : ''),
      designNameInput: it.designName || (order.items.length === 1 ? order.designName || '' : '')
    }))
  );

  const handleAddItem = () => {
    const base = items[items.length - 1];
    const fallbackBrand = state.brands.find((b) => !b.deleted && b.id === base?.brandId) || state.brands.find((b) => !b.deleted);
    const cols = fallbackBrand ? brandColors(state, fallbackBrand.id) : [];
    const fallbackColor = cols.find((c) => c.id === base?.colorId) || cols[0];
    const defaultSize = base?.size || (settings.sizes.includes('M') ? 'M' : settings.sizes[0] || 'M');
    const defaultPrice = base ? base.unitPrice : settings.priceCustom || 35000;
    setItems((prev) => [
      ...prev,
      {
        id: uid(),
        brandId: fallbackBrand?.id || base?.brandId || '',
        colorId: fallbackColor?.id || base?.colorId || '',
        size: defaultSize,
        qty: 1,
        unitPrice: defaultPrice,
        manualPrice: true,
        fromStock: 0,
        brandName: fallbackBrand?.name || base?.brandName || '',
        colorName: fallbackColor?.name || base?.colorName || '',
        colorHex: fallbackColor?.hex || base?.colorHex || '#1A1A1C',
        sku: skuOf(fallbackBrand, fallbackColor, defaultSize),
        designId: null,
        designName: null,
        designCode: null,
        photoId: null,
        photoUrl: null,
        placement: base?.placement || order.placement || 'back',
        priceInput: String(fromCents(defaultPrice)),
        qtyInput: '1',
        designCodeInput: '',
        designNameInput: ''
      }
    ]);
  };

  const handleSave = () => {
    if (items.length === 0) return toast('El pedido debe tener al menos una prenda', 'error');
    const isSingleItem = items.length === 1;
    const nextItems = items.map((it) => {
      const brandObj = state.brands.find((b) => b.id === it.brandId);
      const colorObj = state.colors.find((c) => c.id === it.colorId);
      return {
        id: it.id,
        brandId: it.brandId,
        colorId: it.colorId,
        size: it.size,
        qty: Math.max(1, Math.floor(Number(it.qtyInput) || 1)),
        unitPrice: toCents(it.priceInput),
        manualPrice: true,
        fromStock: it.fromStock,
        brandName: brandObj?.name || it.brandName,
        colorName: colorObj?.name || it.colorName,
        colorHex: colorObj?.hex || it.colorHex,
        sku: skuOf(brandObj, colorObj, it.size) || it.sku,
        designId: it.designId || null,
        designName: isSingleItem
          ? (designName.trim() || it.designNameInput.trim() || null)
          : (it.designNameInput.trim() || null),
        designCode: isSingleItem
          ? (designCode.trim().toUpperCase() || it.designCodeInput.trim().toUpperCase() || null)
          : (it.designCodeInput.trim().toUpperCase() || null),
        photoId: it.photoId || null,
        photoUrl: null,
        placement: it.placement || null
      };
    });
    const itemDesignNames = Array.from(
      new Set(nextItems.map((i) => i.designName).filter((x): x is string => Boolean(x)))
    );
    const firstItemCode = nextItems.find((i) => i.designCode)?.designCode || null;
    const subtotal = nextItems.reduce((sum, i) => sum + i.qty * i.unitPrice, 0);
    const shipCents = toCents(shipping);
    const total = subtotal + shipCents;
    const depCents = Math.min(total, Math.max(0, toCents(deposit)));

    updateOrderDetails(order.id, {
      shipTo: {
        name: name.trim(),
        phone: phone.trim(),
        address: address.trim()
      },
      workType,
      paymentMethod,
      designName: isSingleItem
        ? (designName.trim() || null)
        : (itemDesignNames.length > 0 ? itemDesignNames.join(' + ') : designName.trim() || null),
      designCode: isSingleItem
        ? (designCode.trim().toUpperCase() || null)
        : (designCode.trim().toUpperCase() || firstItemCode),
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

        {items.length <= 1 && (
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
        )}

        {/* Prendas del pedido */}
        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-extrabold uppercase text-slate-600">
              {items.length > 1 ? 'Prendas, Precios y Diseños' : 'Prendas y Precios Unitarios'}
            </div>
            <button
              type="button"
              onClick={handleAddItem}
              className="rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-slate-800"
            >
              + Agregar prenda
            </button>
          </div>
          {items.map((it, idx) => {
            const availColors = brandColors(state, it.brandId);
            return (
            <div key={it.id} className="space-y-2 rounded-lg border border-slate-200/80 bg-white p-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-bold text-slate-800">
                  <ColorDot hex={it.colorHex} size={12} />
                  <span>{it.brandName || 'Camisa'}</span>
                </div>
                {items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                    className="rounded-md bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-600 hover:bg-rose-100"
                    title="Quitar prenda del pedido"
                  >
                    ✕ Quitar
                  </button>
                )}
              </div>
              <div className="grid grid-cols-12 items-end gap-2">
                <div className="col-span-4">
                  <label className="block text-[10px] text-slate-500">Color</label>
                  <select
                    className="input h-9 px-1.5 text-xs"
                    value={it.colorId}
                    onChange={(e) => {
                      const cid = e.target.value;
                      const cObj = availColors.find((c) => c.id === cid);
                      setItems((prev) =>
                        prev.map((x, i) =>
                          i === idx
                            ? {
                                ...x,
                                colorId: cid,
                                colorName: cObj?.name || x.colorName,
                                colorHex: cObj?.hex || x.colorHex
                              }
                            : x
                        )
                      );
                    }}
                  >
                    {availColors.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-3">
                  <label className="block text-[10px] text-slate-500">Talla</label>
                  <select
                    className="input h-9 px-1.5 text-xs font-bold"
                    value={it.size}
                    onChange={(e) => {
                      const sz = e.target.value;
                      setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, size: sz } : x)));
                    }}
                  >
                    {settings.sizes.map((sz) => (
                      <option key={sz} value={sz}>
                        {sz}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-[10px] text-slate-500">Cant.</label>
                  <input
                    type="number"
                    min={1}
                    className="input h-9 px-1.5 text-center"
                    value={it.qtyInput}
                    onChange={(e) => {
                      const v = e.target.value;
                      setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, qtyInput: v } : x)));
                    }}
                  />
                </div>
                <div className="col-span-3">
                  <label className="block text-[10px] text-slate-500">Precio (L)</label>
                  <input
                    type="number"
                    min={0}
                    className="input h-9 px-1.5"
                    value={it.priceInput}
                    onChange={(e) => {
                      const v = e.target.value;
                      setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, priceInput: v } : x)));
                    }}
                  />
                </div>
              </div>
              {items.length > 1 && (
                <div className="grid grid-cols-12 gap-2">
                  <div className="col-span-4">
                    <input
                      className="input h-8 px-2 text-[11px] uppercase"
                      value={it.designCodeInput}
                      onChange={(e) => {
                        const v = e.target.value.toUpperCase();
                        setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, designCodeInput: v } : x)));
                      }}
                      placeholder="Código (opc.)"
                      aria-label={`Código diseño prenda ${idx + 1}`}
                    />
                  </div>
                  <div className="col-span-8">
                    <input
                      className="input h-8 px-2 text-[11px]"
                      value={it.designNameInput}
                      onChange={(e) => {
                        const v = e.target.value;
                        setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, designNameInput: v } : x)));
                      }}
                      placeholder="Diseño de esta prenda (vacío = Lisa)"
                      aria-label={`Nombre diseño prenda ${idx + 1}`}
                    />
                  </div>
                </div>
              )}
            </div>
            );
          })}
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

function OrderItemRow({
  item,
  orderStatus,
  onZoom
}: {
  item: Order['items'][number];
  orderStatus: Order['status'];
  onZoom: (src: string) => void;
}) {
  const photo = usePhoto(item.photoId);
  const side = item.placement === 'back' ? 'Espalda' : item.placement ? 'Frente' : null;

  return (
    <li className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {photo ? (
          <button
            type="button"
            onClick={() => onZoom(photo)}
            className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded border border-black/10 bg-white p-0.5"
            title="Ver diseño"
          >
            <img src={photo} alt={item.designName || 'Diseño'} className="h-full w-full object-contain" />
          </button>
        ) : (
          <ColorDot hex={item.colorHex} size={18} />
        )}
        <span className="font-semibold text-slate-900">
          {item.brandName} · {item.colorName} · {item.size}
        </span>
        {item.designName && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700">
            {item.designCode ? `[${item.designCode}] ` : ''}{item.designName}
            {side && ` · ${side}`}
          </span>
        )}
        {orderStatus !== 'cancelado' && (
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
              item.fromStock >= item.qty
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-amber-50 text-amber-700'
            }`}
          >
            {item.fromStock >= item.qty
              ? `✓ Stock (${item.fromStock})`
              : `Stock: ${item.fromStock}/${item.qty} · Bajo pedido: ${item.qty - item.fromStock}`}
          </span>
        )}
      </div>
      <span className="font-bold text-slate-900">
        {item.qty} × {money(item.unitPrice)}
      </span>
    </li>
  );
}
