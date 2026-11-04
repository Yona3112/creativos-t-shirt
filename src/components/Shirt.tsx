import { useEffect, useRef, useState } from 'react';
import { contrastText } from '../lib/inventory';

export type DecalPlacement = 'center' | 'pocket' | 'full' | 'back';
export type MotionMode = 'wind' | 'walk' | 'orbit';

function hexToRgb(hex: string): [number, number, number] {
  const clean = (hex || '#111827').replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0');
  const num = parseInt(full.slice(0, 6), 16) || 0;
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/** Trazo anatómico realista de camiseta en maniquí invisible (Ghost Mannequin). */
function traceGarmentSilhouette(ctx: CanvasRenderingContext2D) {
  ctx.beginPath();
  // Hombro izquierdo externo desde el cuello
  ctx.moveTo(192, 62);
  ctx.bezierCurveTo(156, 68, 118, 80, 92, 96);
  // Manga izquierda exterior (caída anatómica natural)
  ctx.bezierCurveTo(68, 112, 42, 156, 26, 202);
  // Abertura de puño izquierdo con curva de volumen
  ctx.bezierCurveTo(46, 216, 74, 226, 98, 232);
  // Interior de manga izquierda hacia la sisa (axila)
  ctx.bezierCurveTo(108, 206, 116, 184, 122, 174);
  // Costado izquierdo del torso (caída natural con ligero entalle)
  ctx.bezierCurveTo(118, 248, 116, 350, 112, 456);
  // Dobladillo inferior curvo 3D
  ctx.bezierCurveTo(185, 474, 327, 474, 400, 456);
  // Costado derecho del torso hacia la sisa derecha
  ctx.bezierCurveTo(396, 350, 394, 248, 390, 174);
  // Interior de manga derecha
  ctx.bezierCurveTo(396, 184, 404, 206, 414, 232);
  // Abertura de puño derecho
  ctx.bezierCurveTo(438, 226, 466, 216, 486, 202);
  // Manga derecha exterior hacia hombro derecho
  ctx.bezierCurveTo(470, 156, 444, 112, 420, 96);
  // Hombro derecho hacia el cuello
  ctx.bezierCurveTo(394, 80, 356, 68, 320, 62);
  // Borde superior del cuello trasero (maniquí invisible)
  ctx.bezierCurveTo(286, 52, 226, 52, 192, 62);
  ctx.closePath();
}

/**
 * Dibuja una prenda realista estilo Ghost Mannequin (Personaje Invisible) en un contexto 512x520,
 * con cavidad 3D en cuello/puños/dobladillo, volumen anatómico de pecho/hombros, pliegues reales de tela
 * y estampado integrado en los pliegues.
 */
function renderGhostMannequinFrame(
  ctx: CanvasRenderingContext2D,
  opts: {
    hex: string;
    side: 'front' | 'back';
    ry: number;
    rx: number;
    phase: number;
    mode: MotionMode;
    designImg: HTMLImageElement | null;
    placement: DecalPlacement;
    designScale: number;
    designOffsetY: number;
  }
) {
  const W = 512;
  const H = 520;
  ctx.clearRect(0, 0, W, H);

  const [r, g, b] = hexToRgb(opts.hex);
  const lum = (r * 299 + g * 587 + b * 114) / 1000;
  const isDark = lum < 90;

  // Parallax 3D entre el frente y el interior hueco del cuello/ruedos
  const parallaxX = opts.ry * 0.42;
  const parallaxY = opts.rx * 0.28;
  const wave = Math.sin(opts.phase * 2.2);
  const walkSwing = opts.mode === 'walk' ? Math.sin(opts.phase * 3.2) : 0;

  ctx.save();

  // 1. Hueco inferior (interior trasero del dobladillo que da efecto de "personaje invisible")
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(256 - parallaxX * 0.4, 456 - parallaxY * 0.3, 142, 16, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgb(${Math.max(0, Math.round(r * 0.38))}, ${Math.max(
    0,
    Math.round(g * 0.38)
  )}, ${Math.max(0, Math.round(b * 0.38))})`;
  ctx.fill();
  ctx.restore();

  // 2. Huecos de los puños (efecto manga hueca 3D)
  ctx.save();
  ctx.fillStyle = `rgb(${Math.max(0, Math.round(r * 0.32))}, ${Math.max(
    0,
    Math.round(g * 0.32)
  )}, ${Math.max(0, Math.round(b * 0.32))})`;
  ctx.beginPath();
  ctx.ellipse(62, 217, 36, 9, 0.38, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(450, 217, 36, 9, -0.38, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 3. Recorte de la silueta anatómica principal
  traceGarmentSilhouette(ctx);
  ctx.save();
  ctx.clip();

  // Color base de la tela
  ctx.fillStyle = opts.hex;
  ctx.fillRect(0, 0, W, H);

  // 4. Iluminación volumétrica 3D de estudio (pecho cilíndrico + hombros + caída)
  const lightCenterX = 256 - opts.ry * 3.2;
  const lightCenterY = 195 - opts.rx * 2.2;
  const chestGlow = ctx.createRadialGradient(lightCenterX, lightCenterY, 18, 256, 260, 275);
  if (isDark) {
    // En telas oscuras (Negro, Azul Marino, Vino) resaltamos el brillo de algodón de estudio
    chestGlow.addColorStop(0, 'rgba(255,255,255,0.22)');
    chestGlow.addColorStop(0.45, 'rgba(255,255,255,0.06)');
    chestGlow.addColorStop(0.78, 'rgba(0,0,0,0.18)');
    chestGlow.addColorStop(1, 'rgba(0,0,0,0.48)');
  } else {
    chestGlow.addColorStop(0, 'rgba(255,255,255,0.34)');
    chestGlow.addColorStop(0.45, 'rgba(255,255,255,0.05)');
    chestGlow.addColorStop(0.8, 'rgba(15,23,42,0.12)');
    chestGlow.addColorStop(1, 'rgba(15,23,42,0.32)');
  }
  ctx.fillStyle = chestGlow;
  ctx.fillRect(0, 0, W, H);

  // Sombreado cilíndrico lateral del torso (volumen de maniquí invisible)
  const torsoCyl = ctx.createLinearGradient(110, 0, 402, 0);
  torsoCyl.addColorStop(0, 'rgba(0,0,0,0.32)');
  torsoCyl.addColorStop(0.14, 'rgba(255,255,255,0.08)');
  torsoCyl.addColorStop(0.32, 'rgba(0,0,0,0.02)');
  torsoCyl.addColorStop(0.5, 'rgba(255,255,255,0.10)');
  torsoCyl.addColorStop(0.68, 'rgba(0,0,0,0.02)');
  torsoCyl.addColorStop(0.86, 'rgba(255,255,255,0.07)');
  torsoCyl.addColorStop(1, 'rgba(0,0,0,0.34)');
  ctx.fillStyle = torsoCyl;
  ctx.fillRect(105, 60, 302, 420);

  // 5. Estampado / Diseño aplicado sobre el pecho o espalda (ANTES de las sombras de pliegues para realismo total)
  const showDecal =
    !!opts.designImg &&
    ((opts.side === 'front' && opts.placement !== 'back') ||
      (opts.side === 'back' && opts.placement === 'back'));

  if (showDecal && opts.designImg) {
    const img = opts.designImg;
    const aspect = img.naturalWidth / Math.max(1, img.naturalHeight);
    const s = Math.max(0.5, Math.min(1.5, opts.designScale));
    let targetW = 152 * s;
    let centerX = 256 + parallaxX * 0.25;
    let centerY = 225 + opts.designOffsetY * 3.2;

    if (opts.placement === 'pocket') {
      targetW = 72 * s;
      centerX = 312 + parallaxX * 0.2;
      centerY = 182 + opts.designOffsetY * 2.5;
    } else if (opts.placement === 'full') {
      targetW = 205 * s;
      centerY = 248 + opts.designOffsetY * 3.2;
    }

    const targetH = targetW / aspect;

    // Deformación sutil por tiras verticales para seguir la curvatura 3D del pecho y la onda de la tela
    const slices = 18;
    const sliceW = targetW / slices;
    const srcSliceW = img.naturalWidth / slices;

    ctx.save();
    for (let i = 0; i < slices; i++) {
      const u = (i + 0.5) / slices - 0.5; // -0.5 a +0.5
      // Curvatura de cilindro de pecho + onda de viento en vivo
      const archY = Math.cos(u * Math.PI) * 5 - 3;
      const rippleY = Math.sin(opts.phase * 2.6 + u * 5.2) * 2.2;
      const dx = centerX - targetW / 2 + i * sliceW;
      const dy = centerY - targetH / 2 + archY + rippleY;

      ctx.drawImage(
        img,
        i * srcSliceW,
        0,
        srcSliceW,
        img.naturalHeight,
        dx,
        dy,
        sliceW + 0.6,
        targetH
      );
    }
    ctx.restore();
  }

  // 6. Pliegues dinámicos de tela (ondas suaves de viento y tensión en pecho/axilas/cintura)
  ctx.save();
  const foldCount = 7;
  for (let i = 0; i < foldCount; i++) {
    const t = i / (foldCount - 1);
    const baseX = 142 + t * 228;
    const sway = Math.sin(opts.phase * 2.2 + i * 1.15) * (5 + t * 3) + walkSwing * 4;
    const fx = baseX + sway;

    const foldGrad = ctx.createLinearGradient(fx - 18, 120, fx + 18, 450);
    foldGrad.addColorStop(0, 'rgba(0,0,0,0)');
    foldGrad.addColorStop(0.35, isDark ? 'rgba(255,255,255,0.045)' : 'rgba(255,255,255,0.12)');
    foldGrad.addColorStop(0.55, isDark ? 'rgba(0,0,0,0.20)' : 'rgba(15,23,42,0.09)');
    foldGrad.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.fillStyle = foldGrad;
    ctx.beginPath();
    ctx.moveTo(baseX - 16, 110);
    ctx.quadraticCurveTo(fx, 285, baseX + sway * 1.3 - 12, 465);
    ctx.lineTo(baseX + sway * 1.3 + 16, 465);
    ctx.quadraticCurveTo(fx + 14, 285, baseX + 16, 110);
    ctx.closePath();
    ctx.fill();
  }

  // Pliegues anatómicos de tensión desde las sisas (axilas) hacia el pecho
  const drawCrease = (x1: number, y1: number, cx: number, cy: number, x2: number, y2: number, alpha: number) => {
    ctx.save();
    ctx.strokeStyle = `rgba(0,0,0,${alpha})`;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.filter = 'blur(3px)';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(cx, cy + wave * 2, x2, y2);
    ctx.stroke();

    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x1, y1 - 3);
    ctx.quadraticCurveTo(cx, cy - 3 + wave * 2, x2, y2 - 3);
    ctx.stroke();
    ctx.restore();
  };

  drawCrease(122, 174, 158, 198, 195, 228, isDark ? 0.34 : 0.16);
  drawCrease(122, 162, 150, 172, 178, 188, isDark ? 0.25 : 0.12);
  drawCrease(390, 174, 354, 198, 317, 228, isDark ? 0.34 : 0.16);
  drawCrease(390, 162, 362, 172, 334, 188, isDark ? 0.25 : 0.12);
  ctx.restore();

  // 7. Costuras de mangas (sisas) y doble costura en puños y dobladillo
  ctx.save();
  ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.13)' : 'rgba(15,23,42,0.16)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(175, 66);
  ctx.quadraticCurveTo(138, 122, 122, 174);
  ctx.moveTo(337, 66);
  ctx.quadraticCurveTo(374, 122, 390, 174);
  ctx.stroke();

  // Costura de dobladillo inferior y puños
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(114, 444);
  ctx.bezierCurveTo(185, 462, 327, 462, 398, 444);
  ctx.moveTo(30, 192);
  ctx.quadraticCurveTo(64, 212, 102, 221);
  ctx.moveTo(482, 192);
  ctx.quadraticCurveTo(448, 212, 410, 221);
  ctx.stroke();
  ctx.restore();

  // 8. Cavidad 3D del Cuello (Ghost Mannequin / Personaje Invisible)
  if (opts.side === 'front') {
    // Interior trasero del cuello visible a través de la abertura (con parallax 3D real)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(190, 62);
    ctx.bezierCurveTo(224, 52, 288, 52, 322, 62);
    ctx.bezierCurveTo(310, 98, 286, 114, 256, 114);
    ctx.bezierCurveTo(226, 114, 202, 98, 190, 62);
    ctx.closePath();
    ctx.clip();

    // Tela interna de la espalda oscurecida por sombra profunda de cavidad
    const neckDepthGrad = ctx.createLinearGradient(256, 52, 256, 116);
    neckDepthGrad.addColorStop(
      0,
      `rgb(${Math.round(r * 0.52)}, ${Math.round(g * 0.52)}, ${Math.round(b * 0.52)})`
    );
    neckDepthGrad.addColorStop(
      1,
      `rgb(${Math.round(r * 0.22)}, ${Math.round(g * 0.22)}, ${Math.round(b * 0.22)})`
    );
    ctx.fillStyle = neckDepthGrad;
    ctx.fillRect(180, 48, 152, 74);

    // Cinta de refuerzo interna del cuello trasero (neck tape)
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(192, 67 - parallaxY * 0.3);
    ctx.quadraticCurveTo(256 - parallaxX * 0.5, 59 - parallaxY * 0.3, 320, 67 - parallaxY * 0.3);
    ctx.stroke();

    // Etiqueta tejida interna ("CREATIVOS") que se desplaza con parallax 3D dentro del cuello
    const tagX = 236 - parallaxX * 0.55;
    const tagY = 66 - parallaxY * 0.35;
    ctx.fillStyle = '#f8fafc';
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 2;
    ctx.fillRect(tagX, tagY, 40, 22);
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 7px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('CREATIVOS', tagX + 20, tagY + 10);
    ctx.font = '6px system-ui, sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText('GIFT SHOP', tagX + 20, tagY + 18);
    ctx.restore();

    // Ribete acanalado frontal del cuello redondo (con grosor 3D y sombra proyectada)
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.28)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 3;
    ctx.strokeStyle = `rgb(${Math.min(255, Math.round(r * 0.92 + 12))}, ${Math.min(
      255,
      Math.round(g * 0.92 + 12)
    )}, ${Math.min(255, Math.round(b * 0.92 + 12))})`;
    ctx.lineWidth = 11;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(189, 63);
    ctx.bezierCurveTo(202, 102, 226, 118, 256, 118);
    ctx.bezierCurveTo(286, 118, 310, 102, 323, 63);
    ctx.stroke();

    // Luz superior en el borde del cuello acanalado
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(192, 63);
    ctx.bezierCurveTo(205, 98, 227, 113, 256, 113);
    ctx.bezierCurveTo(285, 113, 307, 98, 320, 63);
    ctx.stroke();
    ctx.restore();
  } else {
    // Vista Espalda: cuello alto acanalado con pequeña abertura de maniquí invisible
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(192, 62);
    ctx.quadraticCurveTo(256, 53, 320, 62);
    ctx.quadraticCurveTo(256, 74, 192, 62);
    ctx.closePath();
    ctx.fillStyle = `rgb(${Math.round(r * 0.28)}, ${Math.round(g * 0.28)}, ${Math.round(b * 0.28)})`;
    ctx.fill();

    ctx.strokeStyle = `rgb(${Math.min(255, Math.round(r * 0.94 + 10))}, ${Math.min(
      255,
      Math.round(g * 0.94 + 10)
    )}, ${Math.min(255, Math.round(b * 0.94 + 10))})`;
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(190, 63);
    ctx.quadraticCurveTo(256, 76, 322, 63);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore(); // Fin de recorte de silueta

  // 9. Contorno Fresnel sutil para definir la prenda sobre fondos claros u oscuros
  ctx.save();
  traceGarmentSilhouette(ctx);
  ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.22)' : 'rgba(15,23,42,0.18)';
  ctx.lineWidth = 1.8;
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}

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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgTick, setImgTick] = useState(0);

  useEffect(() => {
    if (!designUrl) {
      imgRef.current = null;
      setImgTick((t) => t + 1);
      return;
    }
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setImgTick((t) => t + 1);
    };
    img.src = designUrl;
  }, [designUrl]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    renderGhostMannequinFrame(ctx, {
      hex,
      side: 'front',
      ry: -6,
      rx: 3,
      phase: 0.6,
      mode: 'wind',
      designImg: imgRef.current,
      placement: 'center',
      designScale: 1,
      designOffsetY: 0
    });
  }, [hex, imgTick]);

  return (
    <div className="flex flex-col items-center select-none">
      <canvas
        ref={canvasRef}
        width={512}
        height={520}
        style={{ width: size, height: size }}
        className="drop-shadow-md"
        aria-label={label || 'Vista previa'}
      />
      {label && <span className="mt-1 text-sm font-semibold text-slate-700">{label}</span>}
    </div>
  );
}

/**
 * Estudio 3D estilo VirtualThreads.io / Ghost Mannequin (Personaje Invisible):
 * Renderiza la prenda volumétrica real con cuello hueco 3D, pliegues vivos en movimiento
 * (Brisa, Caminata Invisible o Giro 3D) y estampado curvado sobre la tela.
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
  const [mode, setMode] = useState<MotionMode>('wind');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const propsRef = useRef({
    hex,
    side,
    mode,
    placement,
    designScale,
    designOffsetY,
    autoMotion
  });
  propsRef.current = { hex, side, mode, placement, designScale, designOffsetY, autoMotion };

  const physRef = useRef({
    rx: 4,
    ry: -10,
    vx: 0,
    vy: 0,
    targetRx: 4,
    targetRy: -10,
    dragging: false,
    lastX: 0,
    lastY: 0
  });

  useEffect(() => {
    if (!designUrl) {
      imgRef.current = null;
      return;
    }
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
    };
    img.src = designUrl;
  }, [designUrl]);

  useEffect(() => {
    if (placement === 'back') setSide('back');
    else setSide('front');
  }, [placement]);

  const switchSide = (next: 'front' | 'back') => {
    if (next !== side) {
      physRef.current.vy += next === 'back' ? 16 : -16;
      setSide(next);
    }
  };

  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();

    const animate = (now: number) => {
      const elapsed = (now - t0) / 1000;
      const p = physRef.current;
      const cur = propsRef.current;

      if (!p.dragging && cur.autoMotion) {
        if (cur.mode === 'wind') {
          p.targetRy = Math.sin(elapsed * 1.1) * 16;
          p.targetRx = Math.cos(elapsed * 0.85) * 4.5 + 3;
        } else if (cur.mode === 'walk') {
          // Movimiento de caminata de personaje invisible (balanceo de hombros y torso)
          p.targetRy = Math.sin(elapsed * 2.8) * 14;
          p.targetRx = Math.abs(Math.cos(elapsed * 2.8)) * 6;
        } else {
          // Giro amplio de estudio
          p.targetRy = Math.sin(elapsed * 0.9) * 28;
          p.targetRx = Math.cos(elapsed * 0.7) * 5 + 3;
        }
      }

      const ax = (p.targetRx - p.rx) * 0.09;
      const ay = (p.targetRy - p.ry) * 0.09;
      p.vx = (p.vx + ax) * 0.82;
      p.vy = (p.vy + ay) * 0.82;
      p.rx += p.vx;
      p.ry += p.vy;

      const walkBounce =
        cur.autoMotion && cur.mode === 'walk' ? Math.abs(Math.sin(elapsed * 2.8)) * -9 : Math.sin(elapsed * 1.9) * 5;
      const walkRoll = cur.autoMotion && cur.mode === 'walk' ? Math.cos(elapsed * 2.8) * 2.2 : 0;

      if (bodyRef.current) {
        bodyRef.current.style.transform = `translate3d(0, ${walkBounce.toFixed(
          2
        )}px, 0) rotateX(${p.rx.toFixed(2)}deg) rotateY(${p.ry.toFixed(2)}deg) rotateZ(${walkRoll.toFixed(
          2
        )}deg)`;
      }
      if (shadowRef.current) {
        const sScale = (1 - Math.abs(walkBounce) * 0.014).toFixed(3);
        shadowRef.current.style.transform = `translate3d(${(-p.ry * 0.8).toFixed(
          1
        )}px, 0, 0) scale(${sScale})`;
      }

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          renderGhostMannequinFrame(ctx, {
            hex: cur.hex,
            side: cur.side,
            ry: p.ry,
            rx: p.rx,
            phase: cur.autoMotion ? elapsed : 0.5,
            mode: cur.mode,
            designImg: imgRef.current,
            placement: cur.placement,
            designScale: cur.designScale,
            designOffsetY: cur.designOffsetY
          });
        }
      }

      raf = requestAnimationFrame(animate);
    };

    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="relative flex flex-col items-center select-none">
      {/* Controles superiores: Frente / Espalda + Modo de animación tipo VirtualThreads + Stock en vivo */}
      <div className="z-10 mb-2 flex flex-wrap items-center justify-center gap-2">
        <div className="inline-flex rounded-full bg-slate-200/80 p-1">
          <button
            type="button"
            className={`rounded-full px-3 py-1 text-xs font-bold transition ${
              side === 'front' ? 'bg-slate-900 text-white shadow' : 'text-slate-700'
            }`}
            onClick={() => switchSide('front')}
          >
            Frente
          </button>
          <button
            type="button"
            className={`rounded-full px-3 py-1 text-xs font-bold transition ${
              side === 'back' ? 'bg-slate-900 text-white shadow' : 'text-slate-700'
            }`}
            onClick={() => switchSide('back')}
          >
            Espalda
          </button>
        </div>

        <div className="inline-flex rounded-full bg-slate-200/80 p-1">
          {(
            [
              ['wind', '🌬️ Tela Viva'],
              ['walk', '🚶 Caminata'],
              ['orbit', '🔄 Giro 3D']
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`rounded-full px-2.5 py-1 text-xs font-bold transition ${
                mode === id ? 'bg-slate-900 text-white shadow' : 'text-slate-700'
              }`}
              onClick={() => setMode(id)}
            >
              {label}
            </button>
          ))}
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

      {/* Escenario 3D Ghost Mannequin */}
      <div
        className="relative flex h-[330px] w-full max-w-[360px] cursor-grab items-center justify-center touch-none active:cursor-grabbing sm:h-[370px]"
        style={{ perspective: '1000px' }}
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
        {/* Sombra proyectada en el piso */}
        <div
          ref={shadowRef}
          className="pointer-events-none absolute bottom-2 h-7 w-52 rounded-full bg-slate-900/25 blur-md will-change-transform"
        />

        {/* Prenda 3D sobre maniquí invisible */}
        <div
          ref={bodyRef}
          className="relative h-[305px] w-[305px] will-change-transform sm:h-[340px] sm:w-[340px]"
          style={{ transformStyle: 'preserve-3d' }}
        >
          <canvas
            ref={canvasRef}
            width={512}
            height={520}
            className="h-full w-full drop-shadow-2xl"
          />
        </div>
      </div>

      <div className="mt-1 flex items-center gap-2 text-xs font-semibold text-slate-500">
        <span>🖐 Arrastra para rotar la prenda</span>
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
