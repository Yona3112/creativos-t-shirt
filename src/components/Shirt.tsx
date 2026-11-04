import { useEffect, useRef, useState } from 'react';
import { contrastText } from '../lib/inventory';

export function ShirtPreview({ hex, label, size = 150 }: { hex: string; label?: string; size?: number }) {
  const stroke = contrastText(hex) === '#ffffff' ? 'rgba(255,255,255,0.25)' : 'rgba(17,24,39,0.25)';
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 200" width={size} height={size} aria-label={label || 'Vista previa'}>
        <defs>
          <linearGradient id="shade" x1="0" x2="1">
            <stop offset="0" stopColor="#000" stopOpacity="0.10" />
            <stop offset="0.5" stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.12" />
          </linearGradient>
        </defs>
        <path
          d="M70 18 L50 24 L14 46 L30 84 L50 74 L50 186 L150 186 L150 74 L170 84 L186 46 L150 24 L130 18 C124 32 112 38 100 38 C88 38 76 32 70 18 Z"
          fill={hex}
          stroke="#1f2937"
          strokeOpacity="0.35"
          strokeWidth="2.5"
          strokeLinejoin="round"
          style={{ transition: 'fill 200ms ease' }}
        />
        <path
          d="M70 18 L50 24 L14 46 L30 84 L50 74 L50 186 L150 186 L150 74 L170 84 L186 46 L150 24 L130 18 C124 32 112 38 100 38 C88 38 76 32 70 18 Z"
          fill="url(#shade)"
        />
        <path d="M70 18 C76 32 88 38 100 38 C112 38 124 32 130 18" fill="none" stroke={stroke} strokeWidth="4" />
        <path d="M50 74 L50 60 M150 74 L150 60" stroke={stroke} strokeWidth="2" />
      </svg>
      {label && <span className="mt-1 text-sm font-semibold text-slate-700">{label}</span>}
    </div>
  );
}

/** Círculo de color que abre el selector nativo para cambiar el tono. */
export function ColorSwatchPicker({
  hex,
  onChange,
  size = 40,
  title
}: {
  hex: string;
  onChange: (hex: string) => void;
  size?: number;
  title?: string;
}) {
  const [local, setLocal] = useState(hex);
  const ref = useRef<HTMLInputElement>(null);
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => setLocal(hex), [hex]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // "change" nativo = el usuario cerró el selector con un color final
    const handler = () => {
      const v = el.value.toUpperCase();
      if (v !== hex.toUpperCase()) cb.current(v);
    };
    el.addEventListener('change', handler);
    return () => el.removeEventListener('change', handler);
  }, [hex]);
  return (
    <label
      className="relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full border-2 border-white shadow ring-1 ring-black/20"
      style={{ width: size, height: size, background: local }}
      title={title || 'Cambiar tono'}
    >
      <input
        type="color"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        value={local.length === 7 ? local.toLowerCase() : '#000000'}
        ref={ref}
        onChange={(e) => setLocal(e.target.value)}
      />
      <span className="pointer-events-none text-xs" style={{ color: contrastText(local) }}>
        ✎
      </span>
    </label>
  );
}
