import { useEffect, useRef, useState } from 'react';
import type { DecalPlacement } from './Shirt';
import type { MockupSceneId } from '../lib/publicCatalog';

export interface MockupPrintBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MockupViewAsset {
  photoUrl: string;
  maskUrl: string;
  printBox: MockupPrintBox;
}

export interface MockupSceneConfig {
  id: MockupSceneId;
  label: string;
  badge: string;
  chipLabel: string;
  tint: [number, number, number];
  back: MockupViewAsset;
  front: MockupViewAsset;
}

export const MOCKUP_SCENES: Record<MockupSceneId, MockupSceneConfig> = {
  ranchero: {
    id: 'ranchero',
    label: 'Rancho',
    badge: 'Colección Ranchero',
    chipLabel: '🤠 Rancho',
    tint: [1.02, 0.99, 0.95],
    back: {
      photoUrl: '/mockups/ranchero-back.jpg?v=3',
      maskUrl: '/mockups/ranchero-back-mask.png?v=3',
      printBox: { x: 0.3238, y: 0.4252, w: 0.3785, h: 0.3755 }
    },
    front: {
      photoUrl: '/mockups/ranchero-front.jpg?v=3',
      maskUrl: '/mockups/ranchero-front-mask.png?v=3',
      printBox: { x: 0.3254, y: 0.447, w: 0.3635, h: 0.349 }
    }
  },
  cristiana: {
    id: 'cristiana',
    label: 'Cristiana',
    badge: 'Colección Cristiana',
    chipLabel: '✝️ Cristiana',
    tint: [1.01, 1.0, 0.98],
    back: {
      photoUrl: '/mockups/cristiana-back.jpg?v=3',
      maskUrl: '/mockups/cristiana-back-mask.png?v=3',
      printBox: { x: 0.3373, y: 0.43, w: 0.3214, h: 0.3188 }
    },
    front: {
      photoUrl: '/mockups/cristiana-front.jpg?v=3',
      maskUrl: '/mockups/cristiana-front-mask.png?v=3',
      printBox: { x: 0.353, y: 0.4645, w: 0.324, h: 0.311 }
    }
  },
  turistico: {
    id: 'turistico',
    label: 'Honduras',
    badge: 'Turístico Honduras',
    chipLabel: '🇭🇳 Honduras',
    tint: [0.99, 1.0, 1.02],
    back: {
      photoUrl: '/mockups/turistico-back.jpg?v=3',
      maskUrl: '/mockups/turistico-back-mask.png?v=3',
      printBox: { x: 0.3252, y: 0.415, w: 0.3483, h: 0.3455 }
    },
    front: {
      photoUrl: '/mockups/turistico-front.jpg?v=3',
      maskUrl: '/mockups/turistico-front-mask.png?v=3',
      printBox: { x: 0.3362, y: 0.456, w: 0.3458, h: 0.332 }
    }
  }
};

interface PreparedScene {
  width: number;
  height: number;
  baseData: Uint8ClampedArray;
  maskAlpha: Uint8ClampedArray;
  shading: Float32Array;
  detail: Float32Array;
  maskCanvas: HTMLCanvasElement;
  shadowOverlayCanvas: HTMLCanvasElement;
}

interface PreparedDesign {
  img: HTMLImageElement;
  trimX: number;
  trimY: number;
  trimW: number;
  trimH: number;
}

const sceneCache = new Map<string, Promise<PreparedScene>>();
const designCache = new Map<string, Promise<PreparedDesign>>();
const recolorCache = new Map<string, HTMLCanvasElement>();

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

async function yieldToMain(): Promise<void> {
  const g = globalThis as { scheduler?: { yield?: () => Promise<void> } };
  if (g.scheduler && typeof g.scheduler.yield === 'function') {
    await g.scheduler.yield();
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function parseHexRgb(hex: string): [number, number, number] {
  const clean = (hex || '#1A1A1C').replace('#', '').trim();
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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith('data:') && !src.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`No se pudo cargar imagen: ${src}`));
    img.src = src;
  });
}

function computeTightTrimBox(img: HTMLImageElement): PreparedDesign {
  const w = img.naturalWidth || 1;
  const h = img.naturalHeight || 1;
  const fallback: PreparedDesign = { img, trimX: 0, trimY: 0, trimW: w, trimH: h };
  try {
    const maxDim = 256;
    const scale = Math.min(1, maxDim / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));
    const c = document.createElement('canvas');
    c.width = tw;
    c.height = th;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return fallback;
    ctx.drawImage(img, 0, 0, tw, th);
    const data = ctx.getImageData(0, 0, tw, th).data;

    let minX = tw;
    let minY = th;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < th; y++) {
      const rowOff = y * tw * 4;
      for (let x = 0; x < tw; x++) {
        if (data[rowOff + x * 4 + 3] > 16) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX || maxY < minY) return fallback;

    const sx = clamp(Math.floor((minX / tw) * w - w * 0.01), 0, Math.max(0, w - 1));
    const sy = clamp(Math.floor((minY / th) * h - h * 0.01), 0, Math.max(0, h - 1));
    const ex = clamp(Math.ceil(((maxX + 1) / tw) * w + w * 0.01), sx + 1, w);
    const ey = clamp(Math.ceil(((maxY + 1) / th) * h + h * 0.01), sy + 1, h);
    return {
      img,
      trimX: sx,
      trimY: sy,
      trimW: Math.max(1, ex - sx),
      trimH: Math.max(1, ey - sy)
    };
  } catch {
    return fallback;
  }
}

function loadPreparedDesign(url: string): Promise<PreparedDesign> {
  const hit = designCache.get(url);
  if (hit) return hit;
  const p = loadImage(url)
    .then(computeTightTrimBox)
    .catch((err) => {
      designCache.delete(url);
      throw err;
    });
  if (designCache.size > 32) {
    const first = designCache.keys().next().value;
    if (first) designCache.delete(first);
  }
  designCache.set(url, p);
  return p;
}

function loadPreparedScene(asset: MockupViewAsset): Promise<PreparedScene> {
  const key = `${asset.photoUrl}|${asset.maskUrl}`;
  const hit = sceneCache.get(key);
  if (hit) return hit;

  const p = (async () => {
    const [photoImg, maskImg] = await Promise.all([
      loadImage(asset.photoUrl),
      loadImage(asset.maskUrl)
    ]);

    const width = photoImg.naturalWidth || 768;
    const height = photoImg.naturalHeight || 960;
    const total = width * height;

    const photoCanvas = document.createElement('canvas');
    photoCanvas.width = width;
    photoCanvas.height = height;
    const photoCtx = photoCanvas.getContext('2d', { willReadFrequently: true });
    if (!photoCtx) throw new Error('No se pudo crear contexto 2D');
    photoCtx.drawImage(photoImg, 0, 0, width, height);
    const baseData = photoCtx.getImageData(0, 0, width, height).data;

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = width;
    maskCanvas.height = height;
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
    if (!maskCtx) throw new Error('No se pudo crear contexto de máscara');
    maskCtx.drawImage(maskImg, 0, 0, width, height);
    const maskRaw = maskCtx.getImageData(0, 0, width, height).data;

    const maskAlpha = new Uint8ClampedArray(total);
    const rawLums = new Float32Array(total);
    const sampleLums: number[] = [];

    for (let i = 0; i < total; i++) {
      const idx = i * 4;
      const a = maskRaw[idx + 3];
      maskAlpha[i] = a;
      const lum = (0.299 * baseData[idx] + 0.587 * baseData[idx + 1] + 0.114 * baseData[idx + 2]) / 255;
      rawLums[i] = lum;
      if ((i & 3) === 0 && a >= 200) sampleLums.push(lum);
    }

    sampleLums.sort((a, b) => a - b);
    const p03 = sampleLums.length > 0 ? sampleLums[Math.floor(sampleLums.length * 0.03)] : 0.45;
    const p97 = sampleLums.length > 0 ? sampleLums[Math.floor(sampleLums.length * 0.97)] : 0.96;
    const floor = p03 * 0.55;
    const denom = Math.max(0.25, p97 - floor);

    await yieldToMain();

    const shading = new Float32Array(total);
    const detail = new Float32Array(total);
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = width;
    shadowCanvas.height = height;
    const shadowCtx = shadowCanvas.getContext('2d');
    const shadowImg = shadowCtx ? shadowCtx.createImageData(width, height) : null;

    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        const i = row + x;
        const s = clamp((rawLums[i] - floor) / denom, 0.12, 1.08);
        shading[i] = s;
        if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
          const avg =
            (rawLums[i - width - 1] +
              rawLums[i - width] +
              rawLums[i - width + 1] +
              rawLums[i - 1] +
              rawLums[i] +
              rawLums[i + 1] +
              rawLums[i + width - 1] +
              rawLums[i + width] +
              rawLums[i + width + 1]) /
            9;
          detail[i] = rawLums[i] - avg;
        }
        if (shadowImg) {
          const idx = i * 4;
          const a = maskAlpha[i];
          shadowImg.data[idx] = 0;
          shadowImg.data[idx + 1] = 0;
          shadowImg.data[idx + 2] = 0;
          const creaseAlpha =
            a > 0 && s < 0.94 ? clamp(Math.round((0.94 - s) * 145 * (a / 255)), 0, 120) : 0;
          shadowImg.data[idx + 3] = creaseAlpha;
        }
      }
    }
    if (shadowCtx && shadowImg) {
      shadowCtx.putImageData(shadowImg, 0, 0);
    }

    return {
      width,
      height,
      baseData,
      maskAlpha,
      shading,
      detail,
      maskCanvas,
      shadowOverlayCanvas: shadowCanvas
    };
  })().catch((err) => {
    sceneCache.delete(key);
    throw err;
  });

  sceneCache.set(key, p);
  return p;
}

function getRecoloredBaseCanvas(
  cacheKey: string,
  scene: PreparedScene,
  hex: string,
  tint: [number, number, number]
): HTMLCanvasElement {
  const fullKey = `${cacheKey}|${hex.toUpperCase()}`;
  const cached = recolorCache.get(fullKey);
  if (cached) return cached;

  const { width, height, baseData, maskAlpha, shading, detail } = scene;
  const [tr, tg, tb] = parseHexRgb(hex);
  const targetLum = (0.299 * tr + 0.587 * tg + 0.114 * tb) / 255;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const img = ctx.createImageData(width, height);
  const out = img.data;
  const total = width * height;

  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    const a = maskAlpha[i];
    if (a === 0) {
      out[idx] = baseData[idx];
      out[idx + 1] = baseData[idx + 1];
      out[idx + 2] = baseData[idx + 2];
      out[idx + 3] = 255;
      continue;
    }

    // Evitar oscurecimiento artificial en el borde suavizado de 1px contra fondos oscuros
    const s = a < 235 ? Math.max(shading[i], 0.72) : shading[i];
    const det = a < 235 ? 0 : detail[i];

    let nr: number;
    let ng: number;
    let nb: number;

    if (targetLum < 0.22) {
      // Negro intenso y telas muy oscuras preservando textura y pliegues naturales
      const darkFactor = 0.4 + 0.6 * (targetLum / 0.22);
      const sPow = Math.pow(s, 1.75);
      const ridge = Math.pow(clamp((s - 0.78) / 0.24, 0, 1), 2.2) * 18;
      const micro = det * 42;
      nr = clamp(Math.round((tr * darkFactor * sPow + ridge + micro) * tint[0]), 0, 255);
      ng = clamp(Math.round((tg * darkFactor * sPow + ridge + micro) * tint[1]), 0, 255);
      nb = clamp(Math.round((tb * darkFactor * sPow + ridge + micro) * tint[2]), 0, 255);
    } else if (targetLum <= 0.86) {
      // Colores teñidos intensos y tonos medios
      const sPow = Math.pow(s, 1.32);
      const ridge = Math.pow(clamp((s - 0.84) / 0.2, 0, 1), 2.0) * 16;
      const micro = det * 55;
      nr = clamp(Math.round((tr * sPow + ridge + micro) * tint[0]), 0, 255);
      ng = clamp(Math.round((tg * sPow + ridge + micro) * tint[1]), 0, 255);
      nb = clamp(Math.round((tb * sPow + ridge + micro) * tint[2]), 0, 255);
    } else {
      // Blanco y tonos muy claros con iluminación fotográfica natural original
      nr = clamp(Math.round(baseData[idx] * (tr / 248)), 0, 255);
      ng = clamp(Math.round(baseData[idx + 1] * (tg / 248)), 0, 255);
      nb = clamp(Math.round(baseData[idx + 2] * (tb / 248)), 0, 255);
    }

    const f = a / 255;
    const fEff = targetLum < 0.5 && f < 1 ? Math.min(1, Math.pow(f, 0.82)) : f;
    out[idx] = Math.round(baseData[idx] * (1 - fEff) + nr * fEff);
    out[idx + 1] = Math.round(baseData[idx + 1] * (1 - fEff) + ng * fEff);
    out[idx + 2] = Math.round(baseData[idx + 2] * (1 - fEff) + nb * fEff);
    out[idx + 3] = 255;
  }

  ctx.putImageData(img, 0, 0);

  if (recolorCache.size >= 18) {
    const first = recolorCache.keys().next().value;
    if (first) recolorCache.delete(first);
  }
  recolorCache.set(fullKey, canvas);
  return canvas;
}

export function ModelMockupCanvas({
  sceneId,
  placement,
  hex,
  designUrl,
  designScale = 2.0,
  designOffsetX = 0,
  designOffsetY = 0,
  zoom = 1,
  onSwipeDesign,
  onError
}: {
  sceneId: MockupSceneId;
  placement: DecalPlacement;
  hex: string;
  designUrl?: string | null;
  designScale?: number;
  designOffsetX?: number;
  designOffsetY?: number;
  zoom?: number;
  onSwipeDesign?: (delta: 1 | -1) => void;
  onError?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workArtCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const workFoldCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  const [readyKey, setReadyKey] = useState<string>('');
  const sceneCfg = MOCKUP_SCENES[sceneId] || MOCKUP_SCENES.ranchero;
  const viewKey = placement === 'back' ? 'back' : 'front';
  const viewAsset = sceneCfg[viewKey];
  const fullSceneKey = `${sceneCfg.id}-${viewKey}-v3`;

  useEffect(() => {
    let cancelled = false;

    const renderAll = async () => {
      try {
        const scenePromise = loadPreparedScene(viewAsset);
        const designPromise = designUrl ? loadPreparedDesign(designUrl) : Promise.resolve(null);

        const scene = await scenePromise;
        if (cancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) return;
        if (canvas.width !== scene.width || canvas.height !== scene.height) {
          canvas.width = scene.width;
          canvas.height = scene.height;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const recolored = getRecoloredBaseCanvas(fullSceneKey, scene, hex, sceneCfg.tint);
        const drawBaseShirt = () => {
          ctx.clearRect(0, 0, scene.width, scene.height);
          ctx.drawImage(recolored, 0, 0);
        };

        // Mostrar primero la camiseta en el modelo sin esperar a que decodifique el estampado
        drawBaseShirt();
        if (!cancelled) {
          setReadyKey(fullSceneKey);
        }

        if (!designUrl) return;
        const design = await designPromise;
        if (cancelled) return;

        if (design && design.trimW > 0 && design.trimH > 0) {
          drawBaseShirt();
          const W = scene.width;
          const H = scene.height;
          const box = viewAsset.printBox;
          const bx = box.x * W;
          const by = box.y * H;
          const bw = box.w * W;
          const bh = box.h * H;

          const scaleFactor = clamp((designScale || 2.0) / 2.0, 0.45, 1.2);
          const fitRatio = Math.min(bw / design.trimW, bh / design.trimH);
          const drawW = design.trimW * fitRatio * scaleFactor;
          const drawH = design.trimH * fitRatio * scaleFactor;

          const dxShift = (clamp(designOffsetX || 0, -24, 24) / 20) * bw * 0.24;
          const dyShift = (clamp(designOffsetY || 0, -24, 24) / 22) * bh * 0.28;
          const dx = bx + (bw - drawW) * 0.5 + dxShift;
          const dy = by + (bh - drawH) * 0.28 + dyShift;

          let artCanvas = workArtCanvasRef.current;
          if (!artCanvas || artCanvas.width !== W || artCanvas.height !== H) {
            artCanvas = document.createElement('canvas');
            artCanvas.width = W;
            artCanvas.height = H;
            workArtCanvasRef.current = artCanvas;
          }
          const artCtx = artCanvas.getContext('2d');

          let foldCanvas = workFoldCanvasRef.current;
          if (!foldCanvas || foldCanvas.width !== W || foldCanvas.height !== H) {
            foldCanvas = document.createElement('canvas');
            foldCanvas.width = W;
            foldCanvas.height = H;
            workFoldCanvasRef.current = foldCanvas;
          }
          const foldCtx = foldCanvas.getContext('2d');

          if (artCtx && foldCtx) {
            artCtx.globalCompositeOperation = 'source-over';
            artCtx.clearRect(0, 0, W, H);
            artCtx.drawImage(
              design.img,
              design.trimX,
              design.trimY,
              design.trimW,
              design.trimH,
              dx,
              dy,
              drawW,
              drawH
            );
            artCtx.globalCompositeOperation = 'destination-in';
            artCtx.drawImage(scene.maskCanvas, 0, 0);
            artCtx.globalCompositeOperation = 'source-over';

            ctx.save();
            ctx.globalAlpha = 0.97;
            ctx.drawImage(artCanvas, 0, 0);
            ctx.restore();

            foldCtx.globalCompositeOperation = 'source-over';
            foldCtx.clearRect(0, 0, W, H);
            foldCtx.drawImage(scene.shadowOverlayCanvas, 0, 0);
            foldCtx.globalCompositeOperation = 'destination-in';
            foldCtx.drawImage(artCanvas, 0, 0);
            foldCtx.globalCompositeOperation = 'source-over';

            ctx.drawImage(foldCanvas, 0, 0);
          }
        }
      } catch {
        if (!cancelled) {
          onError?.();
        }
      }
    };

    void renderAll();
    return () => {
      cancelled = true;
    };
  }, [fullSceneKey, viewAsset, sceneCfg.tint, hex, designUrl, designScale, designOffsetX, designOffsetY, onError]);

  const zoomed = zoom > 1.35;
  const originX = Math.round((viewAsset.printBox.x + viewAsset.printBox.w * 0.5) * 100);
  const originY = Math.round((viewAsset.printBox.y + viewAsset.printBox.h * 0.45) * 100);
  const loaded = readyKey === fullSceneKey;

  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-[18px] bg-slate-200/70"
      style={{ touchAction: 'pan-y' }}
      onPointerDown={(e: { clientX: number; clientY: number }) => {
        pointerStartRef.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e: { clientX: number; clientY: number }) => {
        const start = pointerStartRef.current;
        pointerStartRef.current = null;
        if (!start || !onSwipeDesign) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (Math.abs(dx) >= 42 && Math.abs(dx) > Math.abs(dy) * 1.2) {
          onSwipeDesign(dx < 0 ? 1 : -1);
        }
      }}
      onPointerCancel={() => {
        pointerStartRef.current = null;
      }}
    >
      {!loaded && (
        <img
          src={viewAsset.photoUrl}
          alt={sceneCfg.badge}
          width={768}
          height={960}
          fetchPriority="high"
          decoding="async"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover transition-transform duration-300 ease-out"
          style={{
            transform: zoomed ? 'scale(1.65)' : 'scale(1)',
            transformOrigin: `${originX}% ${originY}%`
          }}
        />
      )}
      <canvas
        ref={canvasRef}
        className={`relative h-full w-full object-cover transition-opacity duration-200 transition-transform duration-300 ease-out ${
          loaded ? 'opacity-100' : 'opacity-0'
        }`}
        style={{
          transform: zoomed ? 'scale(1.65)' : 'scale(1)',
          transformOrigin: `${originX}% ${originY}%`
        }}
      />
    </div>
  );
}
