import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { centsToInput, toCents } from '../lib/money';
import { getPhoto } from '../lib/db';
import { usePhotoVersion } from '../lib/store';

/* ------------------------------- Toasts ------------------------------ */

type Toast = { id: number; text: string; kind: 'ok' | 'error' | 'info' };
let toasts: Toast[] = [];
const toastListeners = new Set<() => void>();
let toastSeq = 1;

export function toast(text: string, kind: Toast['kind'] = 'ok'): void {
  const t = { id: toastSeq++, text, kind };
  toasts = [...toasts, t];
  toastListeners.forEach((l) => l());
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    toastListeners.forEach((l) => l());
  }, kind === 'error' ? 4200 : 2600);
}

export function Toasts() {
  const list = useSyncExternalStore(
    (l) => {
      toastListeners.add(l);
      return () => toastListeners.delete(l);
    },
    () => toasts
  );
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[80] flex flex-col items-center gap-2 px-4">
      <AnimatePresence>
        {list.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className={`pointer-events-auto max-w-md rounded-2xl px-4 py-3 text-center text-sm font-semibold text-white shadow-xl backdrop-blur-md ${
              t.kind === 'error' ? 'bg-red-600/95' : t.kind === 'info' ? 'bg-slate-900/95' : 'bg-emerald-600/95'
            }`}
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------- Modal ------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
            onClick={(e: { stopPropagation: () => void }) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
              <h2 className="text-lg font-bold">{title}</h2>
              <button className="btn-icon text-slate-500" onClick={onClose} aria-label="Cerrar">
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">{children}</div>
            {footer && <div className="safe-bottom border-t border-slate-100 px-4 pt-3">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------------------------- MoneyInput ----------------------------- */

export function MoneyInput({
  value,
  onChange,
  className = '',
  placeholder,
  allowEmpty,
  ariaLabel
}: {
  value: number | null;
  onChange: (cents: number | null) => void;
  className?: string;
  placeholder?: string;
  allowEmpty?: boolean;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(value === null ? '' : centsToInput(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value === null ? '' : centsToInput(value));
  }, [value]);
  return (
    <div className={`relative ${className}`}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-semibold text-slate-400">L</span>
      <input
        aria-label={ariaLabel}
        className="input pl-7 font-semibold"
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        placeholder={placeholder}
        value={text}
        onFocus={(e) => {
          focused.current = true;
          e.currentTarget.select();
        }}
        onBlur={() => {
          focused.current = false;
          if (text === '' && !allowEmpty) setText(value === null ? '' : centsToInput(value));
        }}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          if (t === '') {
            if (allowEmpty) onChange(null);
            return;
          }
          const c = toCents(t);
          if (c >= 0) onChange(c);
        }}
      />
    </div>
  );
}

/* ----------------------- Stepper con input directo -------------------- */

export function Stepper({
  value,
  onCommit,
  min = 0,
  size = 'md',
  ariaLabel
}: {
  value: number;
  onCommit: (n: number) => void;
  min?: number;
  size?: 'md' | 'sm';
  ariaLabel?: string;
}) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);
  const commit = (raw: string) => {
    const n = Math.max(min, Math.floor(Number(raw) || 0));
    setText(String(n));
    if (n !== value) onCommit(n);
  };
  const h = size === 'sm' ? 'h-12 w-11' : 'h-12 w-12';
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        className={`btn-icon ${h} bg-slate-100 text-slate-700`}
        onClick={() => onCommit(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label="Restar"
      >
        −
      </button>
      <input
        aria-label={ariaLabel}
        type="number"
        inputMode="numeric"
        min={min}
        className="input h-12 w-16 px-1 text-center font-bold"
        value={text}
        onFocus={(e) => {
          focused.current = true;
          e.currentTarget.select();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => {
          focused.current = false;
          commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      <button
        type="button"
        className={`btn-icon ${h} bg-brand-100 text-brand-800`}
        onClick={() => onCommit(value + 1)}
        aria-label="Sumar"
      >
        +
      </button>
    </div>
  );
}

/* ------------------------------ Varios ------------------------------- */

export function ColorDot({ hex, size = 20, ring }: { hex: string; size?: number; ring?: boolean }) {
  return (
    <span
      className={`inline-block shrink-0 rounded-full border border-black/15 ${ring ? 'ring-2 ring-brand-600 ring-offset-2' : ''}`}
      style={{ background: hex, width: size, height: size }}
    />
  );
}

export function Empty({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white/60 px-4 py-10 text-center text-slate-500">
      <span className="text-4xl">{icon}</span>
      <span className="font-medium">{text}</span>
    </div>
  );
}

export function usePhoto(id: string | null | undefined): string | null {
  const v = usePhotoVersion();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!id) {
      setSrc(null);
      return;
    }
    getPhoto(id).then((d) => alive && setSrc(d));
    return () => {
      alive = false;
    };
  }, [id, v]);
  return src;
}

export function PhotoViewer({ src, onClose }: { src: string | null; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  useEffect(() => setZoom(1), [src]);
  if (!src) return null;
  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black">
      <div className="safe-top flex items-center justify-between gap-2 p-2">
        <div className="flex gap-2">
          <button className="btn bg-white/15 text-white" onClick={() => setZoom((z) => Math.max(1, z - 0.5))}>
            −
          </button>
          <button className="btn bg-white/15 text-white" onClick={() => setZoom((z) => Math.min(5, z + 0.5))}>
            +
          </button>
        </div>
        <button className="btn bg-white text-slate-900" onClick={onClose}>
          ✕ Cerrar
        </button>
      </div>
      <div className="flex-1 overflow-auto" onDoubleClick={() => setZoom((z) => (z > 1 ? 1 : 2.5))}>
        <div className="flex min-h-full min-w-full items-center justify-center" style={{ width: `${zoom * 100}%` }}>
          <img src={src} alt="Diseño" className="max-w-none" style={{ width: '100%', height: 'auto' }} />
        </div>
      </div>
    </div>
  );
}

export function Confirm({
  open,
  title,
  text,
  confirmLabel,
  danger,
  onConfirm,
  onClose
}: {
  open: boolean;
  title: string;
  text: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Volver
          </button>
          <button
            className={danger ? 'btn-danger' : 'btn-primary'}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      }
    >
      <p className="text-slate-700">{text}</p>
    </Modal>
  );
}
