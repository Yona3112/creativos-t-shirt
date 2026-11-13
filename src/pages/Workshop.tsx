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
        confirmLabel="Sí, eliminar y devolver"
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
  const photo = usePhoto(order.photoId);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState(order.notes || '');

  const finish = () => {
    const err = setOrderStatus(order.id, 'enviado');
    if (err) return toast(err, 'error');
    toast(`${folioLabel(order.folio)} enviado a despacho`);
  };

  return (
    <article className="card space-y-3 border-2 border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xl font-extrabold text-brand-900">{folioLabel(order.folio)}</span>
          <span className="rounded-lg bg-brand-100 px-3 py-1 text-sm font-bold text-brand-900">{order.workType}</span>
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
        </div>
      )}

      {photo && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
          <img
            src={photo}
            alt={`Diseño ${folioLabel(order.folio)}`}
            className="max-h-72 w-full cursor-zoom-in object-contain"
            onClick={() => onZoom(photo)}
          />
          <div className="border-t border-slate-200 p-2">
            <button className="btn-soft w-full" onClick={() => onZoom(photo)}>
              🔍 Ver Diseño
            </button>
          </div>
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
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-base font-semibold text-amber-950">
            📝 {order.notes}
          </div>
        )
      )}

      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-slate-50/60">
        {order.items.map((it) => (
          <WorkshopItemRow
            key={it.id}
            item={it}
            fallbackPhotoId={order.items.length === 1 ? order.photoId : null}
            onZoom={onZoom}
          />
        ))}
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
  onZoom
}: {
  item: Order['items'][number];
  fallbackPhotoId: string | null;
  onZoom: (src: string) => void;
}) {
  const photo = usePhoto(item.photoId || fallbackPhotoId);
  const side = item.placement === 'back' ? 'Espalda' : item.placement ? 'Frente' : null;

  return (
    <li className="flex items-center justify-between gap-2.5 px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        {photo ? (
          <button
            type="button"
            onClick={() => onZoom(photo)}
            className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-black/15 bg-white p-0.5 shadow-sm"
            title="Ver diseño"
          >
            <img src={photo} alt={item.designName || 'Diseño'} className="h-full w-full object-contain" />
          </button>
        ) : (
          <ColorDot hex={item.colorHex} size={24} />
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <ColorDot hex={item.colorHex} size={14} />
            <span className="truncate font-bold text-slate-900">
              {item.brandName} · {item.colorName}
            </span>
          </div>
          {item.designName ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs">
              <span className="font-semibold text-slate-700">
                {item.designCode ? `[${item.designCode}] ` : ''}{item.designName}
              </span>
              {side && (
                <span className="rounded bg-slate-200/80 px-1.5 py-0.2 text-[10px] font-bold text-slate-700">
                  📍 {side}
                </span>
              )}
            </div>
          ) : (
            <div className="text-[11px] font-medium text-slate-500">👕 Lisa</div>
          )}
        </div>
      </div>
      <span className="shrink-0 rounded-lg bg-white px-3 py-1 text-base font-extrabold text-slate-900 shadow-sm ring-1 ring-slate-200">
        {item.size} × {item.qty}
      </span>
    </li>
  );
}
