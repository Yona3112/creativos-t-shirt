import { useEffect, useRef, useState } from 'react';
import type { DecalPlacement } from './Shirt';
import type { MockupSceneId } from '../lib/publicCatalog';

export interface MockupPrintBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MockupSideAsset {
  photoUrl: string;
  maskUrl: string;
}

export interface MockupViewAsset extends MockupSideAsset {
  printBox: MockupPrintBox;
}

export interface MockupTurnFrame extends MockupSideAsset {
  id: string;
  angle: number;
  printSide?: 'front' | 'back';
  printBox?: MockupPrintBox;
}

export interface MockupSceneConfig {
  id: MockupSceneId;
  label: string;
  badge: string;
  chipLabel: string;
  tint: [number, number, number];
  back: MockupViewAsset;
  front: MockupViewAsset;
  /** Secuencia ordenada de ángulos intermedios desde Frente (0°) hacia Espalda (180°) */
  turnFrames?: MockupTurnFrame[];
}

export const MOCKUP_SCENES: Record<MockupSceneId, MockupSceneConfig> = {
  ranchero: {
    id: 'ranchero',
    label: 'Rancho',
    badge: 'Colección Ranchero',
    chipLabel: '🤠 Rancho',
    tint: [1.02, 0.99, 0.95],
    back: {
      photoUrl: '/mockups/ranchero-back.jpg?v=5',
      maskUrl: '/mockups/ranchero-back-mask.png?v=5',
      printBox: { x: 0.2911, y: 0.3782, w: 0.4308, h: 0.4411 }
    },
    front: {
      photoUrl: '/mockups/ranchero-front.jpg?v=5',
      maskUrl: '/mockups/ranchero-front-mask.png?v=5',
      printBox: { x: 0.3072, y: 0.4189, w: 0.3999, h: 0.3903 }
    },
    turnFrames: [
      {
        id: 'turn45',
        angle: 45,
        photoUrl: '/mockups/ranchero-turn45.jpg?v=5',
        maskUrl: '/mockups/ranchero-turn45-mask.png?v=5',
        printSide: 'front',
        printBox: { x: 0.405, y: 0.415, w: 0.3, h: 0.385 }
      },
      {
        id: 'side',
        angle: 90,
        photoUrl: '/mockups/ranchero-side.jpg?v=5',
        maskUrl: '/mockups/ranchero-side-mask.png?v=5'
      },
      {
        id: 'turn135',
        angle: 135,
        photoUrl: '/mockups/ranchero-turn135.jpg?v=5',
        maskUrl: '/mockups/ranchero-turn135-mask.png?v=5',
        printSide: 'back',
        printBox: { x: 0.285, y: 0.382, w: 0.32, h: 0.432 }
      }
    ]
  },
  cristiana: {
    id: 'cristiana',
    label: 'Cristiana',
    badge: 'Colección Cristiana',
    chipLabel: '✝️ Cristiana',
    tint: [1.01, 1.0, 0.98],
    back: {
      photoUrl: '/mockups/cristiana-back.jpg?v=5',
      maskUrl: '/mockups/cristiana-back-mask.png?v=5',
      printBox: { x: 0.3224, y: 0.4022, w: 0.3513, h: 0.3597 }
    },
    front: {
      photoUrl: '/mockups/cristiana-front.jpg?v=5',
      maskUrl: '/mockups/cristiana-front-mask.png?v=5',
      printBox: { x: 0.3368, y: 0.4381, w: 0.3564, h: 0.3478 }
    }
  },
  turistico: {
    id: 'turistico',
    label: 'Honduras',
    badge: 'Turístico Honduras',
    chipLabel: '🇭🇳 Honduras',
    tint: [0.99, 1.0, 1.02],
    back: {
      photoUrl: '/mockups/turistico-back.jpg?v=5',
      maskUrl: '/mockups/turistico-back-mask.png?v=5',
      printBox: { x: 0.309, y: 0.3838, w: 0.3807, h: 0.3898 }
    },
    front: {
      photoUrl: '/mockups/turistico-front.jpg?v=5',
      maskUrl: '/mockups/turistico-front-mask.png?v=5',
      printBox: { x: 0.3189, y: 0.4283, w: 0.3804, h: 0.3713 }
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

function loadPreparedScene(asset: MockupSideAsset): Promise<PreparedScene> {
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

  if (recolorCache.size >= 30) {
    const first = recolorCache.keys().next().value;
    if (first) recolorCache.delete(first);
  }
  recolorCache.set(fullKey, canvas);
  return canvas;
}

// Shader WebGL 1.0 inspirado en gl-transitions (DirectionalWarp/CrossWarp) y akella/webGLImageTransitions:
// Mantiene el fondo del rancho/paisaje 100% fijo en trípode y aplica advección rotacional + desenfoque
// direccional únicamente sobre el torso/modelo central para un giro 180° cinematográfico a 60fps.
const TURN_VERT_SHADER = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const TURN_FRAG_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D u_from;
uniform sampler2D u_to;
uniform float u_progress;
uniform float u_dir;
uniform float u_strength;
uniform float u_velocity;
uniform float u_blur;
varying vec2 v_uv;

float subjectMask(vec2 uv) {
  float xDist = abs(uv.x - 0.50);
  float mx = smoothstep(0.47, 0.23, xDist);
  float my = smoothstep(0.01, 0.14, uv.y) * smoothstep(1.00, 0.91, uv.y);
  return mx * my;
}

vec4 sampleDirectional(sampler2D tex, vec2 uv, float blurOffset) {
  vec2 uv0 = clamp(uv, 0.001, 0.999);
  if (blurOffset < 0.0004) {
    return texture2D(tex, uv0);
  }
  vec2 uvL = clamp(uv - vec2(blurOffset, 0.0), 0.001, 0.999);
  vec2 uvR = clamp(uv + vec2(blurOffset, 0.0), 0.001, 0.999);
  return texture2D(tex, uvL) * 0.23 + texture2D(tex, uv0) * 0.54 + texture2D(tex, uvR) * 0.23;
}

void main() {
  float p = clamp(u_progress, 0.0, 1.0);
  float mask = subjectMask(v_uv);
  float cylinder = 0.65 + 0.35 * cos((v_uv.x - 0.50) * 3.14159265);
  float advect = u_dir * u_strength * mask * cylinder;

  vec2 fromUv = vec2(v_uv.x - advect * p, v_uv.y);
  vec2 toUv   = vec2(v_uv.x + advect * (1.0 - p), v_uv.y);

  float yArch = u_velocity * 0.0035 * mask;
  fromUv.y += yArch;
  toUv.y   += yArch;

  float blurAmt = u_blur * u_velocity * mask;
  vec4 colFrom = sampleDirectional(u_from, fromUv, blurAmt);
  vec4 colTo   = sampleDirectional(u_to,   toUv,   blurAmt);

  gl_FragColor = mix(colFrom, colTo, p);
}
`;

interface WebGLTurnMorpher {
  setPair: (fromCanvas: HTMLCanvasElement, toCanvas: HTMLCanvasElement) => boolean;
  draw: (progress: number, dir: number, strength: number, velocity: number, blur: number) => boolean;
  dispose: () => void;
}

function createWebGLTurnMorpher(canvas: HTMLCanvasElement): WebGLTurnMorpher | null {
  try {
    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance'
    });
    if (!gl) return null;

    const compile = (type: number, source: string): WebGLShader | null => {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, source);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    };

    const vs = compile(gl.VERTEX_SHADER, TURN_VERT_SHADER);
    const fs = compile(gl.FRAGMENT_SHADER, TURN_FRAG_SHADER);
    if (!vs || !fs) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      return null;
    }

    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return null;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return null;
    }

    const quadBuf = gl.createBuffer();
    if (!quadBuf) {
      gl.deleteProgram(program);
      return null;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    const aPos = gl.getAttribLocation(program, 'a_pos');
    const uFrom = gl.getUniformLocation(program, 'u_from');
    const uTo = gl.getUniformLocation(program, 'u_to');
    const uProgress = gl.getUniformLocation(program, 'u_progress');
    const uDir = gl.getUniformLocation(program, 'u_dir');
    const uStrength = gl.getUniformLocation(program, 'u_strength');
    const uVelocity = gl.getUniformLocation(program, 'u_velocity');
    const uBlur = gl.getUniformLocation(program, 'u_blur');

    const initTex = (unit: number): WebGLTexture | null => {
      const tex = gl.createTexture();
      if (!tex) return null;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      // Regla NPOT WebGL 1.0: CLAMP_TO_EDGE + LINEAR sin mipmaps para texturas 768x960
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return tex;
    };

    const texFrom = initTex(0);
    const texTo = initTex(1);
    if (!texFrom || !texTo) {
      if (texFrom) gl.deleteTexture(texFrom);
      if (texTo) gl.deleteTexture(texTo);
      gl.deleteBuffer(quadBuf);
      gl.deleteProgram(program);
      return null;
    }

    gl.useProgram(program);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1i(uFrom, 0);
    gl.uniform1i(uTo, 1);

    const upload = (unit: number, tex: WebGLTexture, src: HTMLCanvasElement) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    };

    return {
      setPair(fromCanvas, toCanvas) {
        if (gl.isContextLost()) return false;
        const w = toCanvas.width || 768;
        const h = toCanvas.height || 960;
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        gl.viewport(0, 0, canvas.width, canvas.height);
        upload(0, texFrom, fromCanvas);
        upload(1, texTo, toCanvas);
        return true;
      },
      draw(progress, dir, strength, velocity, blur) {
        if (gl.isContextLost()) return false;
        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
        gl.uniform1f(uProgress, clamp(progress, 0, 1));
        gl.uniform1f(uDir, dir);
        gl.uniform1f(uStrength, strength);
        gl.uniform1f(uVelocity, velocity);
        gl.uniform1f(uBlur, blur);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        return true;
      },
      dispose() {
        if (!gl.isContextLost()) {
          gl.deleteTexture(texFrom);
          gl.deleteTexture(texTo);
          gl.deleteBuffer(quadBuf);
          gl.deleteProgram(program);
        }
      }
    };
  } catch {
    return null;
  }
}

function easeInOutSine(t: number): number {
  const x = clamp(t, 0, 1);
  return -(Math.cos(Math.PI * x) - 1) * 0.5;
}

function easeOutQuart(t: number): number {
  const inv = 1 - clamp(t, 0, 1);
  return 1 - inv * inv * inv * inv;
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
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const fallbackOutCanvasRef = useRef<HTMLCanvasElement>(null);
  const glMorpherRef = useRef<WebGLTurnMorpher | null>(null);
  const workArtCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const workFoldCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastRenderedRef = useRef<{
    sceneId: MockupSceneId;
    viewKey: 'back' | 'front';
    design: PreparedDesign | null;
  } | null>(null);
  const turnRafRef = useRef<number | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const [hasRenderedOnce, setHasRenderedOnce] = useState(false);
  const sceneCfg = MOCKUP_SCENES[sceneId] || MOCKUP_SCENES.ranchero;
  const viewKey: 'back' | 'front' = placement === 'back' ? 'back' : 'front';
  const viewAsset = sceneCfg[viewKey];
  const fullSceneKey = `${sceneCfg.id}-${viewKey}-v5`;

  // Liberar recursos WebGL al desmontar el componente
  useEffect(() => {
    return () => {
      if (glMorpherRef.current) {
        glMorpherRef.current.dispose();
        glMorpherRef.current = null;
      }
    };
  }, []);

  // Precalentar en segundo plano la cara opuesta y todos los ángulos de giro (45°, 90°, 135°)
  useEffect(() => {
    if (!hasRenderedOnce) return;
    const oppositeKey = viewKey === 'back' ? 'front' : 'back';
    const oppositeAsset = sceneCfg[oppositeKey];
    const turnFrames = sceneCfg.turnFrames || [];
    const timer = window.setTimeout(() => {
      void loadPreparedScene(oppositeAsset).catch(() => {});
      for (const frame of turnFrames) {
        void loadPreparedScene(frame).catch(() => {});
      }
    }, 280);
    return () => window.clearTimeout(timer);
  }, [hasRenderedOnce, sceneCfg, viewKey]);

  useEffect(() => {
    let cancelled = false;

    const resetTurnLayers = () => {
      if (turnRafRef.current !== null) {
        cancelAnimationFrame(turnRafRef.current);
        turnRafRef.current = null;
      }
      if (glCanvasRef.current) {
        glCanvasRef.current.style.opacity = '';
      }
      if (fallbackOutCanvasRef.current) {
        fallbackOutCanvasRef.current.style.opacity = '';
      }
    };

    const drawDesignOverlay = (
      ctx: CanvasRenderingContext2D,
      scene: PreparedScene,
      box: MockupPrintBox,
      design: PreparedDesign | null,
      horizontalSquash = 1
    ) => {
      if (!design || design.trimW <= 0 || design.trimH <= 0) return;
      const W = scene.width;
      const H = scene.height;
      const bx = box.x * W;
      const by = box.y * H;
      const bw = box.w * W;
      const bh = box.h * H;

      const scaleFactor = clamp((designScale || 2.0) / 2.0, 0.45, 1.2);
      const fitRatio = Math.min((bw / Math.max(0.5, horizontalSquash)) / design.trimW, bh / design.trimH);
      const drawW = design.trimW * fitRatio * scaleFactor * horizontalSquash;
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
    };

    const startTurnSequence = (frames: HTMLCanvasElement[], dir: 1 | -1) => {
      if (frames.length < 2) {
        resetTurnLayers();
        return;
      }

      const reducedMotion =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      const glCanvas = glCanvasRef.current;
      const fallbackOut = fallbackOutCanvasRef.current;
      const segCount = frames.length - 1;

      if (!reducedMotion && glCanvas) {
        if (!glMorpherRef.current) {
          glMorpherRef.current = createWebGLTurnMorpher(glCanvas);
        }
        const morpher = glMorpherRef.current;
        if (morpher) {
          const duration = segCount >= 4 ? 700 : 480;
          const strength = segCount >= 4 ? 0.052 : 0.085;
          const blurMax = segCount >= 4 ? 0.0085 : 0.011;
          let activeSeg = 0;

          if (morpher.setPair(frames[0], frames[1]) && morpher.draw(0, dir, strength, 0, blurMax)) {
            glCanvas.style.opacity = '1';
            const startTime = performance.now();

            const tick = (now: number) => {
              if (cancelled) return;
              const rawT = clamp((now - startTime) / duration, 0, 1);
              const globalT = easeInOutSine(rawT);
              const scaled = globalT * segCount;
              const segIdx = Math.min(segCount - 1, Math.floor(scaled));
              const localP = rawT >= 1 ? 1 : clamp(scaled - segIdx, 0, 1);
              const velocity = Math.sin(globalT * Math.PI);

              if (segIdx !== activeSeg) {
                activeSeg = segIdx;
                if (!morpher.setPair(frames[segIdx], frames[segIdx + 1])) {
                  resetTurnLayers();
                  return;
                }
              }

              if (!morpher.draw(localP, dir, strength, velocity, blurMax)) {
                resetTurnLayers();
                return;
              }

              if (rawT < 1) {
                turnRafRef.current = requestAnimationFrame(tick);
              } else {
                resetTurnLayers();
              }
            };

            turnRafRef.current = requestAnimationFrame(tick);
            return;
          }
        }
      }

      // Respaldo 2D suave (o para prefers-reduced-motion: reduce): fundido limpio sin deformación espacial
      if (!fallbackOut) {
        resetTurnLayers();
        return;
      }
      const firstFrame = frames[0];
      if (fallbackOut.width !== firstFrame.width || fallbackOut.height !== firstFrame.height) {
        fallbackOut.width = firstFrame.width;
        fallbackOut.height = firstFrame.height;
      }
      const fCtx = fallbackOut.getContext('2d');
      if (!fCtx) {
        resetTurnLayers();
        return;
      }
      fCtx.clearRect(0, 0, fallbackOut.width, fallbackOut.height);
      fCtx.drawImage(firstFrame, 0, 0);
      fallbackOut.style.opacity = '1';

      const duration = reducedMotion ? 180 : 320;
      const startTime = performance.now();
      const tickFallback = (now: number) => {
        if (cancelled) return;
        const rawT = clamp((now - startTime) / duration, 0, 1);
        fallbackOut.style.opacity = String(1 - easeOutQuart(rawT));
        if (rawT < 1) {
          turnRafRef.current = requestAnimationFrame(tickFallback);
        } else {
          resetTurnLayers();
        }
      };
      turnRafRef.current = requestAnimationFrame(tickFallback);
    };

    const renderAll = async () => {
      try {
        const prev = lastRenderedRef.current;
        const isSideFlip = Boolean(prev && prev.sceneId === sceneCfg.id && prev.viewKey !== viewKey);
        const turnDir: 1 | -1 = viewKey === 'back' ? 1 : -1;

        const scenePromise = loadPreparedScene(viewAsset);
        const designPromise = designUrl
          ? loadPreparedDesign(designUrl).catch(() => null)
          : Promise.resolve(null);

        const rawTurnFrames = sceneCfg.turnFrames || [];
        const orderedTurnFrames =
          turnDir === 1 ? rawTurnFrames : [...rawTurnFrames].reverse();
        const turnPromises = isSideFlip
          ? orderedTurnFrames.map((tf) => loadPreparedScene(tf).catch(() => null))
          : [];

        const scene = await scenePromise;
        if (cancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        // Giro 180° multi-ángulo con fondo fijo en trípode y shader WebGL de advección
        if (isSideFlip && canvas.width > 0 && canvas.height > 0) {
          const [designReady, ...loadedTurnScenes] = await Promise.all([
            designPromise,
            ...turnPromises
          ]);
          if (cancelled) return;

          // 1. Capturar fotograma de salida exacto (tal como está en pantalla)
          const fromFrame = document.createElement('canvas');
          fromFrame.width = canvas.width;
          fromFrame.height = canvas.height;
          const fromCtx = fromFrame.getContext('2d');
          if (fromCtx) {
            fromCtx.drawImage(canvas, 0, 0);
          }

          // 2. Componer fotograma final de llegada en un lienzo temporal
          const toFrame = document.createElement('canvas');
          toFrame.width = scene.width;
          toFrame.height = scene.height;
          const toCtx = toFrame.getContext('2d');
          if (toCtx) {
            const recolored = getRecoloredBaseCanvas(fullSceneKey, scene, hex, sceneCfg.tint);
            toCtx.drawImage(recolored, 0, 0);
            drawDesignOverlay(toCtx, scene, viewAsset.printBox, designReady, 1);
          }

          // 3. Componer fotogramas intermedios (45°, 90°, 135°) con el mismo color de prenda + arte en perspectiva
          const sequence: HTMLCanvasElement[] = [fromFrame];
          for (let i = 0; i < orderedTurnFrames.length; i++) {
            const tf = orderedTurnFrames[i];
            const tScene = loadedTurnScenes[i];
            if (!tScene) continue;

            const baseRecolored = getRecoloredBaseCanvas(
              `${sceneCfg.id}-${tf.id}-v5`,
              tScene,
              hex,
              sceneCfg.tint
            );

            // Elegir si el arte visible en 45° (frente) o 135° (espalda) corresponde al diseño entrante o saliente
            let frameDesign: PreparedDesign | null = null;
            if (tf.printSide && tf.printBox) {
              if (tf.printSide === viewKey) {
                frameDesign = designReady;
              } else if (prev && tf.printSide === prev.viewKey) {
                frameDesign = prev.design;
              }
            }

            if (frameDesign && tf.printBox) {
              const comp = document.createElement('canvas');
              comp.width = tScene.width;
              comp.height = tScene.height;
              const cCtx = comp.getContext('2d');
              if (cCtx) {
                cCtx.drawImage(baseRecolored, 0, 0);
                // Perspectiva 3/4 (~cos 42° ≈ 0.74) para que el estampado gire envolviendo la tela
                drawDesignOverlay(cCtx, tScene, tf.printBox, frameDesign, 0.74);
                sequence.push(comp);
                continue;
              }
            }
            sequence.push(baseRecolored);
          }
          sequence.push(toFrame);

          // 4. Arrancar la capa WebGL en t=0 ANTES de sustituir el lienzo 2D inferior (cero parpadeo)
          if (turnRafRef.current !== null) cancelAnimationFrame(turnRafRef.current);
          startTurnSequence(sequence, turnDir);

          // 5. Escribir el fotograma final nítido en el lienzo principal debajo de la animación
          if (canvas.width !== scene.width || canvas.height !== scene.height) {
            canvas.width = scene.width;
            canvas.height = scene.height;
          }
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, scene.width, scene.height);
            ctx.drawImage(toFrame, 0, 0);
          }

          lastRenderedRef.current = { sceneId: sceneCfg.id, viewKey, design: designReady };
          if (!cancelled) {
            setHasRenderedOnce(true);
          }
          return;
        }

        // Render normal (primera carga, cambio de color o cambio de diseño en la misma cara)
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

        drawBaseShirt();
        lastRenderedRef.current = { sceneId: sceneCfg.id, viewKey, design: null };
        if (!cancelled) {
          setHasRenderedOnce(true);
        }

        if (!designUrl) return;
        const design = await designPromise;
        if (cancelled) return;
        if (design) {
          drawBaseShirt();
          drawDesignOverlay(ctx, scene, viewAsset.printBox, design, 1);
          lastRenderedRef.current = { sceneId: sceneCfg.id, viewKey, design };
        }
      } catch {
        if (!cancelled) {
          onErrorRef.current?.();
        }
      }
    };

    void renderAll();
    return () => {
      cancelled = true;
      resetTurnLayers();
    };
  }, [fullSceneKey, sceneCfg, viewKey, viewAsset, hex, designUrl, designScale, designOffsetX, designOffsetY]);

  const zoomed = zoom > 1.35;
  const originX = Math.round((viewAsset.printBox.x + viewAsset.printBox.w * 0.5) * 100);
  const originY = Math.round((viewAsset.printBox.y + viewAsset.printBox.h * 0.45) * 100);

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
      <div
        className="relative h-full w-full transition-transform duration-300 ease-out"
        style={{
          transform: zoomed ? 'scale(1.65)' : 'scale(1)',
          transformOrigin: `${originX}% ${originY}%`
        }}
      >
        {!hasRenderedOnce && (
          <img
            src={viewAsset.photoUrl}
            alt={sceneCfg.badge}
            width={768}
            height={960}
            fetchPriority="high"
            decoding="async"
            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          />
        )}
        <canvas
          ref={canvasRef}
          className={`relative h-full w-full object-cover ${
            hasRenderedOnce ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <canvas
          ref={fallbackOutCanvasRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-0"
        />
        <canvas
          ref={glCanvasRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-0"
        />
      </div>
    </div>
  );
}
