import { useEffect, useState } from 'react';
import type { Order, Settings } from '../lib/types';
import { buildWorkshopOrdersPdfFile, sharePdfFileNative } from '../lib/pdf';
import { downloadBlob } from '../lib/csv';
import { folioLabel } from '../lib/ids';
import { printDailyOrdersReport } from '../lib/printReports';
import { Modal, toast } from './ui';

export function WorkshopPdfModal({
  open,
  onClose,
  orders,
  settings,
  title
}: {
  open: boolean;
  onClose: () => void;
  orders: Order[];
  settings: Settings;
  title: string;
}) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pdfData, setPdfData] = useState<{ file: File; previewUrls: string[] } | null>(null);

  useEffect(() => {
    if (!open) {
      setPdfData(null);
      setErr(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr(null);
    void buildWorkshopOrdersPdfFile(orders, settings, title)
      .then((res) => {
        if (!cancelled) {
          setPdfData(res);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setErr((e as Error).message || 'No se pudo generar el PDF de taller');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, orders, settings, title]);

  const handleSave = () => {
    if (!pdfData) return;
    downloadBlob(pdfData.file.name, pdfData.file);
    toast(`PDF guardado (${pdfData.file.name})`, 'ok');
  };

  const handleSend = async () => {
    if (!pdfData) return;
    const summaryText =
      orders.length === 1
        ? `Orden de Taller ${folioLabel(orders[0].folio)} · ${orders[0].shipTo.name || 'Consumidor Final'}`
        : `${title} · ${settings.storeName}`;
    const res = await sharePdfFileNative(pdfData.file, {
      title: pdfData.file.name,
      text: summaryText
    });
    if (res === 'shared') {
      toast('PDF enviado / compartido', 'ok');
    } else if (res === 'downloaded') {
      toast(`PDF descargado (${pdfData.file.name}). Ya puedes enviarlo por WhatsApp`, 'info');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        pdfData ? (
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={handleSave}
              className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-2xl border border-slate-300 bg-white px-2.5 text-xs font-bold text-slate-900 shadow-sm hover:bg-slate-50 active:scale-95"
            >
              💾 Guardar PDF
            </button>
            <button
              type="button"
              onClick={() => void handleSend()}
              className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-2xl bg-[#25D366] px-2.5 text-xs font-bold text-white shadow-sm hover:bg-[#1ebe5b] active:scale-95"
            >
              📤 Enviar PDF
            </button>
            <button
              type="button"
              onClick={() => printDailyOrdersReport(orders, settings, title)}
              className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-2xl bg-slate-900 px-2.5 text-xs font-bold text-white shadow-sm hover:bg-slate-800 active:scale-95"
            >
              🖨️ Imprimir
            </button>
          </div>
        ) : undefined
      }
    >
      {loading ? (
        <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
          <div className="h-9 w-9 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900" />
          <div className="text-sm font-bold text-slate-800">
            Generando PDF de taller con diseños…
          </div>
          <div className="text-xs text-slate-500">
            Un momento por favor
          </div>
        </div>
      ) : err ? (
        <div className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-center">
          <div className="text-sm font-bold text-rose-800">{err}</div>
          <button
            type="button"
            onClick={() => printDailyOrdersReport(orders, settings, title)}
            className="btn-primary text-xs"
          >
            🖨️ Intentar vista de impresión
          </button>
        </div>
      ) : pdfData ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
            <span className="truncate font-mono">{pdfData.file.name}</span>
            <span className="shrink-0 text-slate-500">
              {pdfData.previewUrls.length} pág{pdfData.previewUrls.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="space-y-3">
            {pdfData.previewUrls.map((url, idx) => (
              <img
                key={idx}
                src={url}
                alt={`Página ${idx + 1}`}
                className="w-full rounded-2xl border border-slate-200 shadow-sm"
              />
            ))}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
