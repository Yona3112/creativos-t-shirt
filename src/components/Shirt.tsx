import { useEffect, useRef, useState } from 'react';
import { contrastText } from '../lib/inventory';

export type DecalPlacement = 'center' | 'pocket' | 'full' | 'back';

export function ShirtPreview({
  hex,
  label,
  size = 150,
  designUrl
}: {
  hex: string;
  label?: string;
  size?: number;
  designUrl?: string | null;
}) {
  const isLight = contrastText(hex) === '#111827';
  const stroke = isLight ? 'rgba(15,23,42,0.22)' : 'rgba(255,255,255,0.22)';
  return (
    <div className="flex flex-col items-center select-none">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 220 220" width={size} height={size} aria-label={label || 'Vista previa'}>
          <defs>
            <linearGradient id="shirt3d-body" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ffffff" stopOpacity={isLight ? '0.18' : '0.12'} />
              <stop offset="45%" stopColor="#000000" stopOpacity="0" />
              <stop offset="100%" stopColor="#000000" stopOpacity="0.22" />
            </linearGradient>
            <linearGradient id="shirt3d-folds" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#000" stopOpacity="0.16" />
              <stop offset="18%" stopColor="#fff" stopOpacity="0.06" />
              <stop offset="50%" stopColor="#000" stopOpacity="0" />
              <stop offset="82%" stopColor="#fff" stopOpacity="0.05" />
              <stop offset="100%" stopColor="#000" stopOpacity="0.18" />
            </linearGradient>
            <filter id="shirt3d-shadow" x="-15%" y="-10%" width="130%" height="130%">
              <feDropShadow dx="0" dy="8" stdDeviation="6" floodColor="#0f172a" floodOpacity="0.22" />
            </filter>
          </defs>
          <ellipse cx="110" cy="204" rx="54" ry="6" fill="rgba(15,23,42,0.14)" />
          <g filter="url(#shirt3d-shadow)">
            <path
              d="M78 22 L54 29 L14 54 L32 95 L56 84 L56 194 Q110 200 164 194 L164 84 L188 95 L206 54 L166 29 L142 22 C135 38 123 45 110 45 C97 45 85 38 78 22 Z"
              fill={hex}
              stroke="#0f172a"
              strokeOpacity="0.28"
              strokeWidth="2"
              strokeLinejoin="round"
              style={{ transition: 'fill 260ms cubic-bezier(0.22, 1, 0.36, 1)' }}
            />
            <path
              d="M78 22 L54 29 L14 54 L32 95 L56 84 L56 194 Q110 200 164 194 L164 84 L188 95 L206 54 L166 29 L142 22 C135 38 123 45 110 45 C97 45 85 38 78 22 Z"
              fill="url(#shirt3d-body)"
            />
            <path
              d="M78 22 L54 29 L14 54 L32 95 L56 84 L56 194 Q110 200 164 194 L164 84 L188 95 L206 54 L166 29 L142 22 C135 38 123 45 110 45 C97 45 85 38 78 22 Z"
              fill="url(#shirt3d-folds)"
            />
            <path
              d="M78 22 Q110 32 142 22 C135 38 123 45 110 45 C97 45 85 38 78 22 Z"
              fill="rgba(0,0,0,0.22)"
            />
            <path
              d="M78 22 C85 38 97 45 110 45 C123 45 135 38 142 22"
              fill="none"
              stroke={stroke}
              strokeWidth="4.5"
            />
            <path d="M56 84 L56 62 M164 84 L164 62" stroke={stroke} strokeWidth="2" />
          </g>
        </svg>
        {designUrl && (
          <img
            src={designUrl}
            alt="Diseño"
            className="pointer-events-none absolute left-1/2 top-[43%] w-[34%] -translate-x-1/2 -translate-y-1/2 object-contain drop-shadow-sm"
          />
        )}
      </div>
      {label && <span className="mt-1 text-sm font-semibold text-slate-700">{label}</span>}
    </div>
  );
}

/**
 * Estudio 3D interactivo de 60/120 FPS reales:
 * Actualiza las matrices CSS 3D y la iluminación SVG directamente en el DOM (sin re-renderizar React en cada frame),
 * con física de resorte amortiguado e inercia táctil suave.
 */
export function InteractiveShirt3D({
  hex,
  colorName,
  brandName,
  designUrl,
  placement = 'center',
  designScale = 1,
  designOffsetY = 0,
  autoMotion = true,
  stockBadge
}: {
  hex: string;
  colorName: string;
  brandName: string;
  designUrl?: string | null;
  placement?: DecalPlacement;
  designScale?: number;
  designOffsetY?: number;
  autoMotion?: boolean;
  stockBadge?: { available: boolean; text: string } | null;
}) {
  const [side, setSide] = useState<'front' | 'back'>('front');

  const bodyRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const specGradRef = useRef<SVGRadialGradientElement>(null);
  const depthLayerRef = useRef<SVGPathElement>(null);

  const physRef = useRef({
    rx: 4,
    ry: -12,
    vx: 0,
    vy: 0,
    targetRx: 4,
    targetRy: -12,
    flipOffset: 0,
    dragging: false,
    lastX: 0,
    lastY: 0
  });

  useEffect(() => {
    if (placement === 'back') setSide('back');
    else setSide('front');
  }, [placement]);

  const switchSide = (next: 'front' | 'back') => {
    if (next !== side) {
      // Impulso suave de giro al voltear la prenda
      physRef.current.vy += next === 'back' ? 14 : -14;
      setSide(next);
    }
  };

  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();

    const animate = (now: number) => {
      const elapsed = (now - t0) / 1000;
      const p = physRef.current;

      if (!p.dragging && autoMotion) {
        p.targetRy = Math.sin(elapsed * 1.1) * 19;
        p.targetRx = Math.cos(elapsed * 0.85) * 5.5 + 3;
      }

      // Física de resorte amortiguado (stiffness + damping)
      const ax = (p.targetRx - p.rx) * 0.085;
      const ay = (p.targetRy - p.ry) * 0.085;
      p.vx = (p.vx + ax) * 0.82;
      p.vy = (p.vy + ay) * 0.82;
      p.rx += p.vx;
      p.ry += p.vy;

      const floatY = Math.sin(elapsed * 1.9) * 5.5;
      const lightX = Math.max(12, Math.min(88, 50 - p.ry * 1.35));

      if (bodyRef.current) {
        bodyRef.current.style.transform = `translate3d(0, ${floatY.toFixed(2)}px, 0) rotateX(${p.rx.toFixed(
          2
        )}deg) rotateY(${p.ry.toFixed(2)}deg)`;
      }
      if (shadowRef.current) {
        const sScale = (1 - floatY * 0.012).toFixed(3);
        shadowRef.current.style.transform = `translate3d(${(-p.ry * 0.75).toFixed(1)}px, 0, 0) scale(${sScale})`;
      }
      if (specGradRef.current) {
        specGradRef.current.setAttribute('cx', `${lightX.toFixed(1)}%`);
      }
      if (depthLayerRef.current) {
        depthLayerRef.current.setAttribute('transform', `translate(${(p.ry * 0.13).toFixed(2)}, 2.5)`);
      }

      raf = requestAnimationFrame(animate);
    };

    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [autoMotion]);

  const isLight = contrastText(hex) === '#111827';
  const stroke = isLight ? 'rgba(15,23,42,0.24)' : 'rgba(255,255,255,0.24)';

  const decalPositionStyle = (): { left: string; top: string; width: string } => {
    const baseScale = Math.max(0.5, Math.min(1.6, designScale));
    const yShift = designOffsetY;
    if (placement === 'pocket') {
      return { left: '61%', top: `${36 + yShift}%`, width: `${15 * baseScale}%` };
    }
    if (placement === 'full') {
      return { left: '50%', top: `${48 + yShift}%`, width: `${42 * baseScale}%` };
    }
    return { left: '50%', top: `${44 + yShift}%`, width: `${31 * baseScale}%` };
  };

  const showDecalOnCurrentSide =
    !!designUrl && ((side === 'front' && placement !== 'back') || (side === 'back' && placement === 'back'));

  const decalStyle = decalPositionStyle();

  return (
    <div className="relative flex flex-col items-center select-none">
      {/* Barra superior del visor: Frente / Espalda + Estado de stock en vivo */}
      <div className="z-10 mb-2 flex flex-wrap items-center justify-center gap-2">
        <div className="inline-flex rounded-full bg-slate-200/80 p-1">
          <button
            type="button"
            className={`rounded-full px-3.5 py-1 text-xs font-bold transition ${
              side === 'front' ? 'bg-slate-900 text-white shadow' : 'text-slate-700'
            }`}
            onClick={() => switchSide('front')}
          >
            Vista Frente
          </button>
          <button
            type="button"
            className={`rounded-full px-3.5 py-1 text-xs font-bold transition ${
              side === 'back' ? 'bg-slate-900 text-white shadow' : 'text-slate-700'
            }`}
            onClick={() => switchSide('back')}
          >
            Vista Espalda
          </button>
        </div>

        {stockBadge && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-extrabold ${
              stockBadge.available
                ? 'bg-emerald-100 text-emerald-900 ring-1 ring-emerald-300'
                : 'bg-amber-100 text-amber-900 ring-1 ring-amber-300'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                stockBadge.available ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
              }`}
            />
            {stockBadge.text}
          </span>
        )}
      </div>

      {/* Escenario 3D interactivo acelerado por GPU */}
      <div
        className="relative flex h-[310px] w-full max-w-[340px] cursor-grab items-center justify-center touch-none active:cursor-grabbing sm:h-[350px]"
        style={{ perspective: '950px' }}
        onPointerDown={(e: any) => {
          const p = physRef.current;
          p.dragging = true;
          p.lastX = e.clientX;
          p.lastY = e.clientY;
          p.targetRx = p.rx;
          p.targetRy = p.ry;
          if (e.currentTarget?.setPointerCapture) {
            e.currentTarget.setPointerCapture(e.pointerId);
          }
        }}
        onPointerMove={(e: any) => {
          const p = physRef.current;
          if (!p.dragging) return;
          const dx = e.clientX - p.lastX;
          const dy = e.clientY - p.lastY;
          p.lastX = e.clientX;
          p.lastY = e.clientY;
          p.targetRy = Math.max(-42, Math.min(42, p.targetRy + dx * 0.42));
          p.targetRx = Math.max(-20, Math.min(22, p.targetRx - dy * 0.28));
        }}
        onPointerUp={() => {
          physRef.current.dragging = false;
        }}
        onPointerCancel={() => {
          physRef.current.dragging = false;
        }}
      >
        {/* Sombra dinámica en el piso */}
        <div
          ref={shadowRef}
          className="pointer-events-none absolute bottom-3 h-6 w-48 rounded-full bg-slate-900/20 blur-md will-change-transform"
        />

        {/* Cuerpo 3D */}
        <div
          ref={bodyRef}
          className="relative h-[285px] w-[285px] will-change-transform sm:h-[320px] sm:w-[320px]"
          style={{ transformStyle: 'preserve-3d' }}
        >
          <svg viewBox="0 0 240 240" className="h-full w-full overflow-visible">
            <defs>
              <radialGradient ref={specGradRef} id="spec3d" cx="35%" cy="28%" r="65%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity={isLight ? '0.28' : '0.18'} />
                <stop offset="55%" stopColor="#000000" stopOpacity="0" />
                <stop offset="100%" stopColor="#000000" stopOpacity="0.28" />
              </radialGradient>
              <linearGradient id="drape3d" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#000000" stopOpacity="0.22" />
                <stop offset="15%" stopColor="#ffffff" stopOpacity="0.07" />
                <stop offset="32%" stopColor="#000000" stopOpacity="0.04" />
                <stop offset="50%" stopColor="#ffffff" stopOpacity="0.06" />
                <stop offset="68%" stopColor="#000000" stopOpacity="0.04" />
                <stop offset="85%" stopColor="#ffffff" stopOpacity="0.07" />
                <stop offset="100%" stopColor="#000000" stopOpacity="0.24" />
              </linearGradient>
              <filter id="drop3d" x="-20%" y="-15%" width="140%" height="140%">
                <feDropShadow dx="0" dy="12" stdDeviation="8" floodColor="#0f172a" floodOpacity="0.26" />
              </filter>
            </defs>

            <g filter="url(#drop3d)">
              <path
                ref={depthLayerRef}
                d="M84 24 L58 32 L14 60 L34 106 L60 93 L60 212 Q120 219 180 212 L180 93 L206 106 L226 60 L182 32 L156 24 C148 42 135 50 120 50 C105 50 92 42 84 24 Z"
                fill="#0f172a"
                fillOpacity="0.25"
              />

              <path
                d="M84 24 L58 32 L14 60 L34 106 L60 93 L60 212 Q120 219 180 212 L180 93 L206 106 L226 60 L182 32 L156 24 C148 42 135 50 120 50 C105 50 92 42 84 24 Z"
                fill={hex}
                stroke="#0f172a"
                strokeOpacity="0.3"
                strokeWidth="2"
                strokeLinejoin="round"
                style={{ transition: 'fill 280ms cubic-bezier(0.22, 1, 0.36, 1)' }}
              />

              <path
                d="M84 24 L58 32 L14 60 L34 106 L60 93 L60 212 Q120 219 180 212 L180 93 L206 106 L226 60 L182 32 L156 24 C148 42 135 50 120 50 C105 50 92 42 84 24 Z"
                fill="url(#spec3d)"
              />

              <path
                d="M84 24 L58 32 L14 60 L34 106 L60 93 L60 212 Q120 219 180 212 L180 93 L206 106 L226 60 L182 32 L156 24 C148 42 135 50 120 50 C105 50 92 42 84 24 Z"
                fill="url(#drape3d)"
              />

              {side === 'front' ? (
                <>
                  <path
                    d="M84 24 Q120 35 156 24 C148 42 135 50 120 50 C105 50 92 42 84 24 Z"
                    fill="rgba(0,0,0,0.26)"
                  />
                  <rect x="111" y="29" width="18" height="9" rx="1.5" fill="#f8fafc" opacity="0.85" />
                  <path
                    d="M84 24 C92 42 105 50 120 50 C135 50 148 42 156 24"
                    fill="none"
                    stroke={stroke}
                    strokeWidth="5"
                  />
                </>
              ) : (
                <>
                  <path
                    d="M84 24 Q120 31 156 24"
                    fill="none"
                    stroke={stroke}
                    strokeWidth="6"
                    strokeLinecap="round"
                  />
                  <path d="M88 30 Q120 37 152 30" fill="none" stroke={stroke} strokeWidth="1.5" />
                </>
              )}

              <path d="M60 93 L58 32 M180 93 L182 32" stroke={stroke} strokeWidth="1.6" />
              <path
                d="M62 206 Q120 213 178 206"
                fill="none"
                stroke={stroke}
                strokeWidth="1.4"
                strokeDasharray="3 2"
              />
            </g>
          </svg>

          {showDecalOnCurrentSide && (
            <div
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-150"
              style={{
                left: decalStyle.left,
                top: decalStyle.top,
                width: decalStyle.width,
                transform: 'translate(-50%, -50%) translateZ(8px)'
              }}
            >
              <img
                src={designUrl!}
                alt="Diseño en camisa"
                className="h-auto w-full object-contain drop-shadow-sm"
              />
            </div>
          )}
        </div>
      </div>

      <div className="mt-1 flex items-center gap-2 text-xs font-semibold text-slate-500">
        <span>🖐 Arrastra para girar en 3D</span>
        <span>·</span>
        <span className="font-bold text-slate-800">
          {brandName} · {colorName}
        </span>
      </div>
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
