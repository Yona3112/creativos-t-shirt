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
            {/* Cuello interior realista */}
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

/** Estudio 3D interactivo con movimiento suave por física, rotación táctil, vista frente/espalda y probador de diseño. */
export function InteractiveShirt3D({
  hex,
  colorName,
  brandName,
  designUrl,
  placement = 'center',
  designScale = 1,
  designOffsetY = 0,
  autoMotion = true
}: {
  hex: string;
  colorName: string;
  brandName: string;
  designUrl?: string | null;
  placement?: DecalPlacement;
  designScale?: number;
  designOffsetY?: number;
  autoMotion?: boolean;
}) {
  const [side, setSide] = useState<'front' | 'back'>('front');
  const [pose, setPose] = useState({ rx: 4, ry: -12, floatY: 0, lightX: 35 });
  const targetRef = useRef({ rx: 4, ry: -12 });
  const currentRef = useRef({ rx: 4, ry: -12 });
  const draggingRef = useRef(false);
  const pointerStartRef = useRef({ x: 0, y: 0, rx: 0, ry: 0 });

  useEffect(() => {
    if (placement === 'back') setSide('back');
    else setSide('front');
  }, [placement]);

  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - t0) / 1000;
      if (!draggingRef.current && autoMotion) {
        targetRef.current.ry = Math.sin(elapsed * 1.15) * 18;
        targetRef.current.rx = Math.cos(elapsed * 0.85) * 6 + 3;
      }
      currentRef.current.rx += (targetRef.current.rx - currentRef.current.rx) * 0.12;
      currentRef.current.ry += (targetRef.current.ry - currentRef.current.ry) * 0.12;
      const floatY = Math.sin(elapsed * 1.8) * 5;
      const lightX = 50 - currentRef.current.ry * 1.4;
      setPose({
        rx: currentRef.current.rx,
        ry: currentRef.current.ry,
        floatY,
        lightX: Math.max(10, Math.min(90, lightX))
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [autoMotion]);

  const isLight = contrastText(hex) === '#111827';
  const stroke = isLight ? 'rgba(15,23,42,0.24)' : 'rgba(255,255,255,0.24)';

  const decalPositionStyle = (): { left: string; top: string; width: string } => {
    const baseScale = Math.max(0.5, Math.min(1.6, designScale));
    const yShift = designOffsetY;
    if (placement === 'pocket') {
      return {
        left: '61%',
        top: `${36 + yShift}%`,
        width: `${15 * baseScale}%`
      };
    }
    if (placement === 'full') {
      return {
        left: '50%',
        top: `${48 + yShift}%`,
        width: `${42 * baseScale}%`
      };
    }
    return {
      left: '50%',
      top: `${44 + yShift}%`,
      width: `${31 * baseScale}%`
    };
  };

  const showDecalOnCurrentSide =
    !!designUrl && ((side === 'front' && placement !== 'back') || (side === 'back' && placement === 'back'));

  const decalStyle = decalPositionStyle();

  return (
    <div className="relative flex flex-col items-center select-none">
      {/* Controles rápidos de vista 3D */}
      <div className="z-10 mb-2 flex items-center gap-2">
        <button
          type="button"
          className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
            side === 'front'
              ? 'bg-slate-900 text-white shadow'
              : 'bg-white/90 text-slate-700 ring-1 ring-slate-200'
          }`}
          onClick={() => setSide('front')}
        >
          Vista Frente
        </button>
        <button
          type="button"
          className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
            side === 'back'
              ? 'bg-slate-900 text-white shadow'
              : 'bg-white/90 text-slate-700 ring-1 ring-slate-200'
          }`}
          onClick={() => setSide('back')}
        >
          Vista Espalda
        </button>
      </div>

      {/* Escenario 3D interactivo */}
      <div
        className="relative flex h-[320px] w-full max-w-[340px] cursor-grab items-center justify-center touch-none active:cursor-grabbing sm:h-[360px]"
        style={{ perspective: '950px' }}
        onPointerDown={(e: any) => {
          draggingRef.current = true;
          pointerStartRef.current = {
            x: e.clientX,
            y: e.clientY,
            rx: targetRef.current.rx,
            ry: targetRef.current.ry
          };
          if (e.currentTarget?.setPointerCapture) {
            e.currentTarget.setPointerCapture(e.pointerId);
          }
        }}
        onPointerMove={(e: any) => {
          if (!draggingRef.current) return;
          const dx = e.clientX - pointerStartRef.current.x;
          const dy = e.clientY - pointerStartRef.current.y;
          targetRef.current.ry = Math.max(-38, Math.min(38, pointerStartRef.current.ry + dx * 0.35));
          targetRef.current.rx = Math.max(-18, Math.min(22, pointerStartRef.current.rx - dy * 0.22));
        }}
        onPointerUp={() => {
          draggingRef.current = false;
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
        }}
      >
        {/* Sombra dinámica en el piso */}
        <div
          className="pointer-events-none absolute bottom-3 h-6 w-48 rounded-full bg-slate-900/20 blur-md transition-transform duration-75"
          style={{
            transform: `translateX(${-pose.ry * 0.7}px) scale(${1 - pose.floatY * 0.012})`
          }}
        />

        {/* Cuerpo 3D con transformación suave */}
        <div
          className="relative h-[290px] w-[290px] sm:h-[325px] sm:w-[325px]"
          style={{
            transformStyle: 'preserve-3d',
            transform: `translateY(${pose.floatY}px) rotateX(${pose.rx}deg) rotateY(${pose.ry}deg)`
          }}
        >
          <svg viewBox="0 0 240 240" className="h-full w-full overflow-visible">
            <defs>
              <radialGradient id="spec3d" cx={`${pose.lightX}%`} cy="28%" r="65%">
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
                <feDropShadow
                  dx={String(-pose.ry * 0.22)}
                  dy="12"
                  stdDeviation="8"
                  floodColor="#0f172a"
                  floodOpacity="0.28"
                />
              </filter>
            </defs>

            <g filter="url(#drop3d)">
              {/* Capa trasera de grosor 3D */}
              <path
                d="M84 24 L58 32 L14 60 L34 106 L60 93 L60 212 Q120 219 180 212 L180 93 L206 106 L226 60 L182 32 L156 24 C148 42 135 50 120 50 C105 50 92 42 84 24 Z"
                fill="#0f172a"
                fillOpacity="0.25"
                transform={`translate(${pose.ry * 0.12}, 2.5)`}
              />

              {/* Silueta principal de la camisa */}
              <path
                d="M84 24 L58 32 L14 60 L34 106 L60 93 L60 212 Q120 219 180 212 L180 93 L206 106 L226 60 L182 32 L156 24 C148 42 135 50 120 50 C105 50 92 42 84 24 Z"
                fill={hex}
                stroke="#0f172a"
                strokeOpacity="0.3"
                strokeWidth="2"
                strokeLinejoin="round"
                style={{ transition: 'fill 300ms cubic-bezier(0.22, 1, 0.36, 1)' }}
              />

              {/* Iluminación especular 3D que reacciona al giro */}
              <path
                d="M84 24 L58 32 L14 60 L34 106 L60 93 L60 212 Q120 219 180 212 L180 93 L206 106 L226 60 L182 32 L156 24 C148 42 135 50 120 50 C105 50 92 42 84 24 Z"
                fill="url(#spec3d)"
              />

              {/* Pliegues verticales naturales de tela */}
              <path
                d="M84 24 L58 32 L14 60 L34 106 L60 93 L60 212 Q120 219 180 212 L180 93 L206 106 L226 60 L182 32 L156 24 C148 42 135 50 120 50 C105 50 92 42 84 24 Z"
                fill="url(#drape3d)"
              />

              {side === 'front' ? (
                <>
                  {/* Cuello frontal con etiqueta interna */}
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
                  {/* Cuello alto de espalda */}
                  <path
                    d="M84 24 Q120 31 156 24"
                    fill="none"
                    stroke={stroke}
                    strokeWidth="6"
                    strokeLinecap="round"
                  />
                  <path
                    d="M88 30 Q120 37 152 30"
                    fill="none"
                    stroke={stroke}
                    strokeWidth="1.5"
                  />
                </>
              )}

              {/* Costuras de mangas y dobladillo */}
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

          {/* Estampado / Diseño aplicado sobre el plano 3D del pecho/espalda */}
          {showDecalOnCurrentSide && (
            <div
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-150"
              style={{
                left: decalStyle.left,
                top: decalStyle.top,
                width: decalStyle.width,
                transform: `translate(-50%, -50%) translateZ(8px)`
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
