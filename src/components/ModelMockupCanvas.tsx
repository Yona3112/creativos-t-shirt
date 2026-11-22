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
      photoUrl: '/mockups/ranchero-back.jpg',
      maskUrl: '/mockups/ranchero-back-mask.png',
      printBox: { x: 0.3691, y: 0.389, w: 0.284, h: 0.2681 }
    },
    front: {
      photoUrl: '/mockups/ranchero-front.jpg',
      maskUrl: '/mockups/ranchero-front-mask.png',
      printBox: { x: 0.3692, y: 0.4173, w: 0.2682, h: 0.2532 }
    }
  },
  cristiana: {
    id: 'cristiana',
    label: 'Cristiana',
    badge: 'Colección Cristiana',
    chipLabel: '✝️ Cristiana',
    tint: [1.01, 1.0, 0.98],
    back: {
      photoUrl: '/mockups/cristiana-back.jpg',
      maskUrl: '/mockups/cristiana-back-mask.png',
      printBox: { x: 0.3948, y: 0.4247, w: 0.2078, h: 0.1962 }
    },
    front: {
      photoUrl: '/mockups/cristiana-front.jpg',
      maskUrl: '/mockups/cristiana-front-mask.png',
      printBox: { x: 0.3902, y: 0.4575, w: 0.2444, h: 0.2307 }
    }
  },
  turistico: {
    id: 'turistico',
    label: 'Honduras',
    badge: 'Turístico Honduras',
    chipLabel: '🇭🇳 Honduras',
    tint: [0.99, 1.0, 1.02],
    back: {
      photoUrl: '/mockups/turistico-back.jpg',
      maskUrl: '/mockups/turistico-back-mask.png',
      printBox: { x: 0.3692, y: 0.395, w: 0.2603, h: 0.2457 }
    },
    front: {
      photoUrl: '/mockups/turistico-front.jpg',
      maskUrl: '/mockups/turistico-front-mask.png',
      printBox: { x: 0.3693, y: 0.4418, w: 0.2771, h: 0.2616 }
    }
  }
};

interface PreparedScene {
  width: number;
  height: number;
  baseData: Uint8ClampedArray;
  maskAlpha: Uint8ClampedArray;
  shading: Float32Array;
  maskCanvas: HTMLCanvasElement;
  shadowOverlayCanvas: HTMLCanvasElement;
}

const sceneCache = new Map<string, Promise<PreparedScene>>();
const designImgCache = new Map<string, Promise<HTMLImageElement>>();
const recolorCache = new Map<string, HTMLCanvasElement>();

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
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

function loadDesignImage(url: string): Promise<HTMLImageElement> {
  const hit = designImgCache.get(url);
  if (hit) return hit;
  const p = loadImage(url).catch((err) => {
    designImgCache.delete(url);
    throw err;
  });
  if (designImgCache.size > 32) {
    const first = designImgCache.keys().next().value;
    if (first) designImgCache.delete(first);
  }
  designImgCache.set(url, p);
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
      const lumRgba = (0.299 * baseData[idx] + 0.587 * baseData[idx + 1] + 0.114 * baseData[idx + 2]) / 255;
      rawLums[i] = lumRgba;
      if (a >= 200) sampleLums.push(lumRgba);
    }

    sampleLums.sort((a, b) => a - b);
    let p92 = sampleLums.length > 0 ? sampleLums[Math.floor(sampleLums.length * 0.92)] : 0.92;
    if (p92 < 0.65) p92 = 0.85;

    const shading = new Float32Array(total);
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = width;
    shadowCanvas.height = height;
    const shadowCtx = shadowCanvas.getContext('2d');
    const shadowImg = shadowCtx ? shadowCtx.createImageData(width, height) : null;

    for (let i = 0; i < total; i++) {
      const s = clamp(rawLums[i] / p92, 0, 1.08);
      shading[i] = s;
      if (shadowImg) {
        const idx = i * 4;
        const a = maskAlpha[i];
        shadowImg.data[idx] = 0;
        shadowImg.data[idx + 1] = 0;
        shadowImg.data[idx + 2] = 0;
        // Solo agregar sombreado donde hay pliegues reales del algodón sin apagar zonas iluminadas
        const creaseAlpha = a > 0 && s < 0.96 ? clamp(Math.round((0.96 - s) * 190 * (a / 255)), 0, 145) : 0;
        shadowImg.data[idx + 3] = creaseAlpha;
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

  const { width, height, baseData, maskAlpha, shading } = scene;
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

    const s = shading[i];
    const sheen = (1 - targetLum) * Math.pow(clamp(s, 0, 1.05), 2.2) * 34;
    const nr = clamp(Math.round((tr * s + sheen) * tint[0]), 0, 255);
    const ng = clamp(Math.round((tg * s + sheen) * tint[1]), 0, 255);
    const nb = clamp(Math.round((tb * s + sheen) * tint[2]), 0, 255);

    const f = a / 255;
    out[idx] = Math.round(baseData[idx] * (1 - f) + nr * f);
    out[idx + 1] = Math.round(baseData[idx + 1] * (1 - f) + ng * f);
    out[idx + 2] = Math.round(baseData[idx + 2] * (1 - f) + nb * f);
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
  const fullSceneKey = `${sceneCfg.id}-${viewKey}`;

  useEffect(() => {
    let cancelled = false;

    const renderAll = async () => {
      try {
        const scenePromise = loadPreparedScene(viewAsset);
        const designPromise = designUrl ? loadDesignImage(designUrl) : Promise.resolve(null);
        const [scene, designImg] = await Promise.all([scenePromise, designPromise]);
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
        ctx.clearRect(0, 0, scene.width, scene.height);
        ctx.drawImage(recolored, 0, 0);

        if (designImg && designImg.naturalWidth > 0 && designImg.naturalHeight > 0) {
          const W = scene.width;
          const H = scene.height;
          const box = viewAsset.printBox;
          const bx = box.x * W;
          const by = box.y * H;
          const bw = box.w * W;
          const bh = box.h * H;

          const scaleFactor = clamp((designScale || 2.0) / 2.0, 0.45, 1.2);
          const fitRatio = Math.min(bw / designImg.naturalWidth, bh / designImg.naturalHeight);
          const drawW = designImg.naturalWidth * fitRatio * scaleFactor;
          const drawH = designImg.naturalHeight * fitRatio * scaleFactor;

          const dxShift = (clamp(designOffsetX || 0, -24, 24) / 20) * bw * 0.24;
          const dyShift = (clamp(designOffsetY || 0, -24, 24) / 22) * bh * 0.28;
          const dx = bx + (bw - drawW) * 0.5 + dxShift;
          const dy = by + (bh - drawH) * 0.35 + dyShift;

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
            artCtx.drawImage(designImg, dx, dy, drawW, drawH);
            artCtx.globalCompositeOperation = 'destination-in';
            artCtx.drawImage(scene.maskCanvas, 0, 0);
            artCtx.globalCompositeOperation = 'source-over';

            ctx.save();
            ctx.globalAlpha = 0.94;
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

        if (!cancelled) {
          setReadyKey(fullSceneKey);
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
        <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-slate-200 via-slate-100 to-slate-200" />
      )}
      <canvas
        ref={canvasRef}
        className={`h-full w-full object-cover transition-transform duration-300 ease-out ${
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
