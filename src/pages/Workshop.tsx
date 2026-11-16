import { useMemo, useState } from 'react';
import type { Order } from '../lib/types';
import { useAppState } from '../lib/store';
import { folioLabel } from '../lib/ids';
import { money } from '../lib/money';
import { deleteOrder, orderStockReturnCount, patchOrder, setOrderStatus } from '../lib/actions';
import { printDailyOrdersReport } from '../lib/printReports';
import { ColorDot, Confirm, Empty, PhotoViewer, toast, usePhoto } from '../components/ui';
import { WorkshopPdfModal } from '../components/WorkshopPdfModal';

export default function Workshop() {
  const state = useAppState();
  const [viewer, setViewer] = useState<string | null>(null);
  const [pdfModal, setPdfModal] = useState<{ orders: Order[]; title: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Order | null>(null);

  const queue = useMemo(
    () =>
      state.orders
        .filter((o) => !o.deleted && o.status === 'en_produccion')
        .sort((a, b) => a.folio - b.folio),
    [state.orders]
  );

  if (queue.length === 0) {
    return <Empty icon="🔨" text="Sin pedidos en producción" />;
  }

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-2 bg-slate-50/80 py-3">
        <div className="text-xs font-extrabold text-slate-700">
          🔨 {queue.length} pedido{queue.length === 1 ? '' : 's'} en cola de producción / taller
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-primary px-3.5 py-2 text-xs"
            onClick={() =>
              setPdfModal({
                orders: queue,
                title: `Cola de Taller (${queue.length} pedidos)`
              })
            }
          >
            📄 Guardar / Enviar PDF Taller
          </button>
          <button
            type="button"
            className="btn-soft px-3 py-2 text-xs"
            onClick={() =>
              printDailyOrdersReport(
                queue,
                state.settings,
                `Cola de Producción en Taller (${queue.length} pedidos)`
              )
            }
          >
            🖨️ Imprimir
          </button>
        </div>
      </div>
      {queue.map((order) => (
        <WorkshopCard
          key={order.id}
          order={order}
          onZoom={setViewer}
          onOpenPdf={() =>
            setPdfModal({
              orders: [order],
              title: `Orden de Taller · ${folioLabel(order.folio)}`
            })
          }
          onAskDelete={() => setConfirmDelete(order)}
        />
      ))}
      <PhotoViewer src={viewer} onClose={() => setViewer(null)} />
      {pdfModal && (
        <WorkshopPdfModal
          open
          onClose={() => setPdfModal(null)}
          orders={pdfModal.orders}
          settings={state.settings}
          title={pdfModal.title}
        />
      )}
      <Confirm
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Eliminar pedido y devolver stock"
        text={
          confirmDelete
            ? `¿Eliminar el pedido ${folioLabel(confirmDelete.folio)} hecho por error? ${
                orderStockReturnCount(confirmDelete) > 0
                  ? `Se devolverán ${orderStockReturnCount(confirmDelete)} camisa(s) al inventario.`
                  : 'Se eliminará del historial y taller.'
              }`
            : ''
        }
        confirmLabel={
          confirmDelete && orderStockReturnCount(confirmDelete) > 0
            ? 'Sí, eliminar y devolver'
            : 'Sí, eliminar pedido'
        }
        danger
        onConfirm={() => {
          if (confirmDelete) {
            const ret = orderStockReturnCount(confirmDelete);
            deleteOrder(confirmDelete.id);
            toast(
              ret > 0
                ? `Pedido ${folioLabel(confirmDelete.folio)} eliminado · ${ret} camisa(s) regresaron al inventario`
                : `Pedido ${folioLabel(confirmDelete.folio)} eliminado`
            );
          }
        }}
      />
    </div>
  );
}

function WorkshopCard({
  order,
  onZoom,
  onOpenPdf,
  onAskDelete
}: {
  order: Order;
  onZoom: (src: string) => void;
  onOpenPdf: () => void;
  onAskDelete: () => void;
}) {
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState(order.notes || '');

  const finish = () => {
    const err = setOrderStatus(order.id, 'enviado');
    if (err) return toast(err, 'error');
    toast(`${folioLabel(order.folio)} enviado a despacho`);
  };

  const totalUnits = order.items.reduce((s, it) => s + it.qty, 0);
  const anyItemHasOwnPhoto = order.items.some((it) => Boolean(it.photoId));

  return (
    <article className="card space-y-3 border border-slate-200/90 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xl font-extrabold text-brand-900">{folioLabel(order.folio)}</span>
          <span className="rounded-lg bg-brand-100 px-3 py-1 text-xs font-extrabold text-brand-900">
            {order.workType}
          </span>
          <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
            {totalUnits} {totalUnits === 1 ? 'prenda' : 'prendas'}
          </span>
          <button
            type="button"
            onClick={() => {
              setNotesDraft(order.notes || '');
              setEditingNotes((v) => !v);
            }}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            ✏️ Notas
          </button>
          <button
            type="button"
            onClick={onOpenPdf}
            className="rounded-lg border border-slate-200 bg-slate-900 px-2.5 py-1 text-xs font-bold text-white hover:bg-slate-800"
            title="Guardar o enviar PDF de este pedido"
          >
            📄 PDF
          </button>
          <button
            type="button"
            onClick={onAskDelete}
            className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-bold text-rose-700 hover:bg-rose-100"
            title="Eliminar pedido y devolver camisas al stock"
          >
            🗑️
          </button>
        </div>
        {order.balance > 0 ? (
          <span className="rounded-xl bg-red-600 px-3 py-1.5 text-sm font-extrabold text-white">
            ⚠️ Resta cobrar: {money(order.balance)}
          </span>
        ) : (
          <span className="rounded-xl bg-emerald-100 px-3 py-1.5 text-sm font-extrabold text-emerald-800">
            ✓ Pagado 100%
          </span>
        )}
      </div>

      {order.shipTo.name && (
        <div className="text-sm font-semibold text-slate-600">
          Cliente: <span className="text-slate-900">{order.shipTo.name}</span>
          {order.shipTo.phone && order.shipTo.phone !== 'Consumidor Final' && (
            <span className="ml-1.5 font-normal text-slate-500">· {order.shipTo.phone}</span>
          )}
        </div>
      )}

      {editingNotes ? (
        <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50/70 p-3">
          <label className="label text-xs text-amber-950">Notas de taller / producción</label>
          <textarea
            rows={2}
            className="input bg-white"
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            placeholder="Especificaciones de estampado, talla, ubicación..."
          />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost text-xs" onClick={() => setEditingNotes(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn-primary text-xs"
              onClick={() => {
                patchOrder(order.id, { notes: notesDraft.trim() });
                setEditingNotes(false);
                toast('Notas de taller actualizadas', 'ok');
              }}
            >
              Guardar notas
            </button>
          </div>
        </div>
      ) : (
        order.notes && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-950">
            📝 {order.notes}
          </div>
        )
      )}

      <ul className="divide-y divide-slate-200/80 rounded-2xl border border-slate-200 bg-slate-50/60">
        {order.items.map((it) => {
          const itemLooksPlain =
            !it.photoId &&
            !it.designId &&
            !it.designName &&
            !it.designCode &&
            (order.items.length > 1 && anyItemHasOwnPhoto);
          const fallbackPhotoId =
            !itemLooksPlain && !anyItemHasOwnPhoto
              ? order.photoId
              : order.items.length === 1
              ? order.photoId
              : null;
          return (
            <WorkshopItemRow
              key={it.id}
              item={it}
              fallbackPhotoId={fallbackPhotoId}
              fallbackPlacement={order.placement || null}
              onZoom={onZoom}
            />
          );
        })}
      </ul>

      <button className="btn-success w-full text-base" onClick={finish}>
        ✅ Terminado en Taller → Pasar a Envío
      </button>
    </article>
  );
}

function WorkshopItemRow({
  item,
  fallbackPhotoId,
  fallbackPlacement,
  onZoom
}: {
  item: Order['items'][number];
  fallbackPhotoId: string | null;
  fallbackPlacement: Order['placement'] | null;
  onZoom: (src: string) => void;
}) {
  const photo = usePhoto(item.photoId || fallbackPhotoId);
  const effPlacement = item.placement || (photo ? fallbackPlacement : null);
  const side = effPlacement === 'back' ? 'ESPALDA' : effPlacement ? 'FRENTE' : null;

  return (
    <li className="flex items-center justify-between gap-3 px-3 py-3">
      <div className="flex min-w-0 items-center gap-3">
        {photo ? (
          <button
            type="button"
            onClick={() => onZoom(photo)}
            className="group relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-black/15 p-1 shadow-sm transition hover:scale-105"
            style={{ backgroundColor: item.colorHex || '#111827' }}
            title="Toca para ver diseño en grande"
          >
            <img src={photo} alt={item.designName || 'Diseño'} className="h-full w-full object-contain" />
            {side && (
              <span className="absolute inset-x-0 bottom-0 bg-black/70 py-0.5 text-center text-[8px] font-black tracking-wider text-white">
                {side}
              </span>
            )}
            <span className="absolute right-1 top-1 rounded bg-black/50 px-1 text-[9px] text-white opacity-0 transition group-hover:opacity-100">
              🔍
            </span>
          </button>
        ) : (
          <div
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-black/10 shadow-inner"
            style={{ backgroundColor: item.colorHex || '#F1F5F9' }}
            title={item.colorName}
          >
            <ColorDot hex={item.colorHex} size={26} />
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <ColorDot hex={item.colorHex} size={14} />
            <span className="truncate font-extrabold text-slate-900">
              {item.brandName} · {item.colorName}
            </span>
          </div>
          {item.designName || photo ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
              {item.designCode && (
                <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-300">
                  {item.designCode}
                </span>
              )}
              <span className="font-bold text-slate-800">
                {item.designName || 'Diseño personalizado'}
              </span>
              {side && (
                <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-extrabold text-amber-900">
                  📍 {side}
                </span>
              )}
            </div>
          ) : (
            <div className="mt-0.5 text-xs font-medium text-slate-500">👕 Camisa Lisa (Sin diseño)</div>
          )}
        </div>
      </div>
      <span className="shrink-0 rounded-xl bg-white px-3.5 py-1.5 text-base font-extrabold text-slate-900 shadow-sm ring-1 ring-slate-200">
        {item.size} × {item.qty}
      </span>
    </li>
  );
}
