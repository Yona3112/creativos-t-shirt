import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { contrastText } from '../lib/inventory';
import {
  analyzeDesignTone,
  isColorCompatibleWithDesign,
  isDarkFabricColor,
  type DesignToneAnalysis
} from '../lib/image';
import type { AllowedColorMode, DesignTone } from '../lib/types';
import { WesternDesignModal } from './WesternDesignModal';

export type DecalPlacement = 'center' | 'pocket' | 'full' | 'back';
export type MotionMode = 'wind' | 'walk' | 'orbit';
export type BoutiqueTheme = 'ranchero' | 'establo' | 'nocturno' | 'arena';

const BOUTIQUE_THEMES: Record<
  BoutiqueTheme,
  {
    label: string;
    stageClass: string;
    galleryClass: string;
    auraColor: string;
  }
> = {
  ranchero: {
    label: '✨ Estudio Blanco',
    stageClass:
      'border border-slate-200 bg-gradient-to-b from-slate-100 via-white to-slate-100 text-slate-800 shadow-sm',
    galleryClass:
      'border border-slate-200 bg-white text-slate-800 shadow-sm',
    auraColor: '#2563EB20'
  },
  establo: {
    label: '🏢 Gris Ejecutivo',
    stageClass:
      'border border-slate-200 bg-gradient-to-b from-slate-200/70 via-slate-50 to-slate-200/50 text-slate-800 shadow-sm',
    galleryClass:
      'border border-slate-200 bg-white text-slate-800 shadow-sm',
    auraColor: '#4F46E520'
  },
  nocturno: {
    label: '🌙 Pizarra Suave',
    stageClass:
      'border border-slate-300 bg-gradient-to-b from-slate-100 via-slate-50 to-white text-slate-800 shadow-sm',
    galleryClass:
      'border border-slate-200 bg-white text-slate-800 shadow-sm',
    auraColor: '#0EA5E920'
  },
  arena: {
    label: '🌾 Minimalista',
    stageClass:
      'border border-slate-200 bg-white text-slate-800 shadow-sm',
    galleryClass:
      'border border-slate-200 bg-white text-slate-800 shadow-sm',
    auraColor: '#3B82F620'
  }
};

function clamp(x: number, a: number, b: number): number {
  return x < a ? a : x > b ? b : x;
}

function hexToRgbNorm(hex: string): [number, number, number] {
  const clean = (hex || '#111827').replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0');
  const num = parseInt(full.slice(0, 6), 16) || 0;
  return [((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255];
}

/* ============================================================================
 * CARGADOR BINARIO GLTF 2.0 (.GLB) — MODELO 3D REAL ESCANEADO (shirt_baked.glb)
 * Extrae los 10,513 vértices, 19,517 triángulos, mapa de normales de algodón
 * (1024x1024) y mapa de Oclusión Ambiental horneado (1024x1024) del modelo real.
 * ========================================================================== */

interface RealShirtGLB {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
  normalImg: HTMLImageElement | null;
  aoImg: HTMLImageElement | null;
}

let cachedGLB: RealShirtGLB | null = null;
let loadingPromise: Promise<RealShirtGLB> | null = null;

function decodeBlobToImage(blob: Blob): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

async function loadRealShirtGLB(): Promise<RealShirtGLB> {
  if (cachedGLB) return cachedGLB;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const res = await fetch('/shirt_baked.glb');
    if (!res.ok) throw new Error('No se pudo cargar shirt_baked.glb');
    const buf = await res.arrayBuffer();
    const dv = new DataView(buf);

    const jsonLen = dv.getUint32(12, true);
    const jsonBytes = new Uint8Array(buf, 20, jsonLen);
    const gltf = JSON.parse(new TextDecoder().decode(jsonBytes));

    const binStart = 20 + jsonLen + 8;
    const bvs = gltf.bufferViews as { byteOffset: number; byteLength: number }[];

    const rawPos = new Float32Array(buf, binStart + bvs[0].byteOffset, bvs[0].byteLength / 4);
    const rawNorm = new Float32Array(buf, binStart + bvs[1].byteOffset, bvs[1].byteLength / 4);
    const rawUv = new Float32Array(buf, binStart + bvs[2].byteOffset, bvs[2].byteLength / 4);
    const rawIdx = new Uint16Array(buf, binStart + bvs[3].byteOffset, bvs[3].byteLength / 2);

    // Centrar y normalizar escala del modelo escaneado para encuadre de estudio
    const positions = new Float32Array(rawPos.length);
    const scale = 2.72;
    const offsetY = 0.045;
    for (let i = 0; i < rawPos.length; i += 3) {
      positions[i] = rawPos[i] * scale;
      positions[i + 1] = (rawPos[i + 1] + offsetY) * scale;
      positions[i + 2] = rawPos[i + 2] * scale;
    }

    const normals = new Float32Array(rawNorm);
    const uvs = new Float32Array(rawUv);
    const indices = new Uint16Array(rawIdx);

    let normalImg: HTMLImageElement | null = null;
    let aoImg: HTMLImageElement | null = null;

    if (bvs[4]) {
      const normalBytes = new Uint8Array(buf, binStart + bvs[4].byteOffset, bvs[4].byteLength);
      normalImg = await decodeBlobToImage(new Blob([normalBytes], { type: 'image/jpeg' }));
    }
    if (bvs[5]) {
      const aoBytes = new Uint8Array(buf, binStart + bvs[5].byteOffset, bvs[5].byteLength);
      aoImg = await decodeBlobToImage(new Blob([aoBytes], { type: 'image/jpeg' }));
    }

    cachedGLB = {
      positions,
      normals,
      uvs,
      indices,
      normalImg,
      aoImg
    };
    return cachedGLB;
  })();

  return loadingPromise;
}

/* ============================================================================
 * SHADERS WEBGL PBR REALISTA:
 * - Geometría 3D escaneada de shirt_baked.glb
 * - Mapa de Oclusión Ambiental (AO) real horneado en los pliegues y costuras
 * - Mapa de Normales de punto de algodón (1024x1024 repetido 8x8)
 * - Proyección de diseño / logo en espacio 3D sobre pecho o espalda sin distorsión
 * ========================================================================== */

const VERT_SRC = `
attribute vec3 a_pos;
attribute vec3 a_norm;
attribute vec2 a_uv;

uniform mat4 u_proj;
uniform mat4 u_view;
uniform float u_time;
uniform float u_mode;
uniform float u_motionActive;

varying vec3 v_viewPos;
varying vec3 v_viewNorm;
varying vec3 v_objPos;
varying vec3 v_objNorm;
varying vec2 v_uv;

void main() {
  vec3 p = a_pos;
  vec3 n = a_norm;

  v_objPos = a_pos;
  v_objNorm = a_norm;

  if (u_motionActive > 0.5) {
    // Movimiento sutil y orgánico de tela real (sin deformar ni romper la malla)
    float lowerFactor = clamp((0.45 - p.y) / 1.25, 0.0, 1.0);
    float breeze = sin(u_time * 2.2 + p.x * 4.5 + p.y * 3.0) * 0.008 * lowerFactor
                 + cos(u_time * 1.6 - p.x * 6.0 + p.y * 4.0) * 0.005 * lowerFactor;

    if (u_mode > 0.5 && u_mode < 1.5) {
      // Balanceo suave de caminata de maniquí invisible
      float twist = sin(u_time * 3.0) * 0.08 * p.y;
      float c = cos(twist);
      float s = sin(twist);
      p = vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
      n = vec3(n.x * c - n.z * s, n.y, n.x * s + n.z * c);
    }

    p.z += breeze;
  }

  vec4 vp = u_view * vec4(p, 1.0);
  v_viewPos = vp.xyz;
  v_viewNorm = mat3(u_view) * n;
  v_uv = a_uv;

  gl_Position = u_proj * vp;
}
`;

const FRAG_SRC = `
precision highp float;

varying vec3 v_viewPos;
varying vec3 v_viewNorm;
varying vec3 v_objPos;
varying vec3 v_objNorm;
varying vec2 v_uv;

uniform vec3 u_baseColor;
uniform sampler2D u_decalTex;
uniform sampler2D u_normalMap;
uniform sampler2D u_aoMap;
uniform int u_hasDecal;
uniform int u_hasNormalMap;
uniform int u_hasAoMap;
uniform int u_decalOnBack;
uniform vec4 u_decalRect; // (centerX, centerY, widthX, heightY) en espacio 3D del torso

void main() {
  vec3 N = normalize(v_viewNorm);
  bool interior = !gl_FrontFacing;
  if (interior) {
    N = -N;
  }

  // 1. Oclusión Ambiental (AO) suave y uniforme (sin sombras duras ni parches oscuros en espalda o pecho)
  float bakedAO = 1.0;
  if (u_hasAoMap == 1) {
    vec3 aoSample = texture2D(u_aoMap, v_uv).rgb;
    float rawAO = (aoSample.r + aoSample.g + aoSample.b) / 3.0;
    float cleanAO = clamp((rawAO - 0.42) * 1.55 + 0.88, 0.84, 1.0);
    bakedAO = mix(1.0, cleanAO, 0.32);
  }

  // 2. Micro-relieve real de tejido de algodón (Normal Map 8x8 de shirt_baked.glb)
  float fabricGrain = 0.0;
  if (u_hasNormalMap == 1) {
    vec2 tiledUV = fract(v_uv * 8.0);
    vec3 nSample = texture2D(u_normalMap, tiledUV).rgb * 2.0 - 1.0;
    N = normalize(N + vec3(nSample.x, nSample.y, 0.0) * 0.22);
    fabricGrain = (nSample.x + nSample.y) * 0.014;
  }

  vec3 fabricBase = clamp(u_baseColor + vec3(fabricGrain), 0.0, 1.0);
  vec3 decalColor = fabricBase;
  float decalMask = 0.0;

  // 3. Proyección 3D amplia sobre toda la superficie frontal o trasera (sin recortar ni borrar al agrandar el diseño)
  if (u_hasDecal == 1 && !interior) {
    bool isBackTarget = (u_decalOnBack == 1);
    float sideNz = isBackTarget ? -v_objNorm.z : v_objNorm.z;

    // Cobertura completa del shader en todo el ancho y alto del modelo 3D (x: ±0.74, y: -0.83 a +0.82)
    if (sideNz > 0.03 && abs(v_objPos.x) < 0.74 && v_objPos.y < 0.82 && v_objPos.y > -0.83) {
      float sideX = isBackTarget ? -v_objPos.x : v_objPos.x;
      float du = (sideX - u_decalRect.x) / u_decalRect.z + 0.5;
      float dv = (u_decalRect.y - v_objPos.y) / u_decalRect.w + 0.5;

      if (du >= 0.0 && du <= 1.0 && dv >= 0.0 && dv <= 1.0) {
        vec4 tex = texture2D(u_decalTex, vec2(du, dv));
        float angleFade = smoothstep(0.03, 0.16, sideNz);
        float alpha = tex.a * angleFade;
        // Des-premultiplicar RGB para que el filtrado bilineal de WebGL nunca manche de negro los bordes ni los huecos internos
        vec3 cleanDecalRgb = tex.a > 0.008 ? clamp(tex.rgb / tex.a, 0.0, 1.0) : fabricBase;
        decalColor = cleanDecalRgb;
        decalMask = alpha;
      }
    }
  }

  // 4. Iluminación de Estudio Fotográfico Simétrica y Limpia (sin manchas ni sombras raras)
  vec3 V = normalize(-v_viewPos);
  vec3 L_key = normalize(vec3(0.32, 0.55, 0.82));
  vec3 L_fill = normalize(vec3(-0.48, 0.28, 0.72));
  vec3 L_top = normalize(vec3(0.0, 0.88, 0.42));

  float ndlKey = max(dot(N, L_key), 0.0);
  float wrapKey = ndlKey * 0.55 + 0.45;
  float ndlFill = max(dot(N, L_fill), 0.0);
  float ndlTop = max(dot(N, L_top), 0.0);

  // Sheen aterciopelado sutil de fibra de algodón en los bordes
  float ndv = max(dot(N, V), 0.0);
  float cottonSheen = pow(1.0 - ndv, 3.2) * 0.11;

  // Iluminación pareja de la tela de algodón
  float fabricLight = (0.44 + 0.46 * wrapKey + 0.16 * ndlFill + 0.06 * ndlTop) * bakedAO;
  if (interior) {
    fabricLight *= 0.58;
  }
  vec3 litFabric = fabricBase * fabricLight + vec3(cottonSheen);

  // Iluminación de la tinta del diseño (DTF / Serigrafía): colores 100% nítidos y sin sombras encima
  vec3 H = normalize(L_key + V);
  float inkSpec = pow(max(dot(N, H), 0.0), 28.0) * 0.04;
  float inkLight = clamp(0.95 + 0.09 * wrapKey, 0.94, 1.02);
  vec3 litInk = (decalColor + vec3(fabricGrain * 0.35)) * inkLight + vec3(inkSpec);

  vec3 finalColor = mix(litFabric, litInk, decalMask);

  gl_FragColor = vec4(clamp(finalColor, 0.0, 1.0), 1.0);
}
`;

/* ============================================================================
 * MATRICES DE CÁMARA 3D CON SOPORTE DE ZOOM Y ENCUADRE
 * ========================================================================== */

function createMat4Perspective(fovRad: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1.0 / Math.tan(fovRad / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0
  ]);
}

function createMat4ModelView(
  rotXDeg: number,
  rotYDeg: number,
  tz: number,
  ty = 0,
  tx = 0
): Float32Array {
  const rx = (rotXDeg * Math.PI) / 180;
  const ry = (rotYDeg * Math.PI) / 180;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);

  return new Float32Array([
    cy, sx * sy, -cx * sy, 0,
    0, cx, sx, 0,
    sy, -sx * cy, cx * cy, 0,
    tx, ty, tz, 1
  ]);
}

function compileProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      gl.deleteShader(s);
      return null;
    }
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT_SRC);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  return prog;
}

/**
 * Recorta los márgenes transparentes del PNG del diseño antes de subirlo a la GPU.
 * Sin esto, un PNG con mucho borde vacío se ve pequeño y descentrado (el arte real
 * queda flotando dentro de un lienzo invisible). Devuelve la fuente recortada y su aspecto real.
 */
function trimDesignImage(img: HTMLImageElement): { source: TexImageSource; aspect: number } {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const fallback = { source: img as TexImageSource, aspect: w / Math.max(1, h) };
  if (!w || !h) return fallback;
  try {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return fallback;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      const row = y * w * 4;
      for (let x = 0; x < w; x++) {
        if (data[row + x * 4 + 3] > 16) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return fallback;
    const cw = maxX - minX + 1;
    const ch = maxY - minY + 1;
    // Sin margen transparente relevante: usar la imagen tal cual
    if (cw >= w * 0.97 && ch >= h * 0.97) return fallback;
    const out = document.createElement('canvas');
    out.width = cw;
    out.height = ch;
    out.getContext('2d')?.drawImage(c, minX, minY, cw, ch, 0, 0, cw, ch);
    return { source: out, aspect: cw / Math.max(1, ch) };
  } catch {
    return fallback;
  }
}

function uploadDecalTexture(gl: WebGLRenderingContext, tex: WebGLTexture, img: HTMLImageElement): number {
  const { source, aspect } = trimDesignImage(img);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return aspect;
}

function computeDecalRect3D(
  placement: DecalPlacement,
  scale: number,
  offsetX: number,
  offsetY: number,
  aspect: number
): [number, number, number, number] {
  const s = clamp(scale, 0.30, 4.00);
  const safeAspect = clamp(aspect || 1, 0.40, 2.50);

  if (placement === 'pocket') {
    const baseX = 0.135;
    const baseY = 0.19;
    const maxW = 0.115 * s;
    const maxH = 0.13 * s;
    let widthX = maxW;
    let heightY = widthX / safeAspect;
    if (heightY > maxH) {
      heightY = maxH;
      widthX = heightY * safeAspect;
    }
    const centerX = clamp(baseX + offsetX * 0.014, -0.45, 0.45);
    const centerY = clamp(baseY - offsetY * 0.015, -0.58, 0.52);
    return [centerX, centerY, widthX, heightY];
  }

  // Estándar industrial DTF sobre shirt_baked.glb (torso ancho ±0.42, cuello espalda y=0.77, cuello frente y=0.70):
  // - En Tamaño A3 (scale = 2.0 / 200%): caja de impresión 0.70 × 0.90 (cubre 83% del ancho del pecho/espalda).
  // - En Tamaño A4 (scale = 1.6 / 160%): caja de impresión 0.56 × 0.72.
  // - Si el diseño es apaisado (menor altura), sube automáticamente hacia la zona superior del pecho/espalda.
  const isBack = placement === 'back';
  const isFull = placement === 'full';
  const maxW = (isFull ? 0.38 : 0.35) * s;
  const maxH = (isFull ? 0.49 : 0.45) * s;

  let widthX = maxW;
  let heightY = widthX / safeAspect;
  if (heightY > maxH) {
    heightY = maxH;
    widthX = heightY * safeAspect;
  }

  const baseCenterY = isBack ? 0.05 : 0.02;
  const refH = isFull ? 0.90 : 0.84;
  const upperLift = Math.max(0, (refH - heightY) * 0.25);
  const centerX = clamp(offsetX * 0.014, -0.48, 0.48);
  const centerY = clamp(baseCenterY + upperLift - offsetY * 0.015, -0.62, 0.56);
  return [centerX, centerY, widthX, heightY];
}

/* ============================================================================
 * COMPONENTES PÚBLICOS: ShirtPreview & InteractiveShirt3D (CON PANELES LATERALES Y ZOOM)
 * ========================================================================== */

export function ShirtPreview({
  hex,
  label,
  size = 150,
  designUrl,
  designScale = 1,
  designOffsetX = 0,
  designOffsetY = 0,
  placement = 'center'
}: {
  hex: string;
  label?: string;
  size?: number;
  designUrl?: string | null;
  designScale?: number;
  designOffsetX?: number;
  designOffsetY?: number;
  placement?: DecalPlacement;
}) {
  return (
    <div className="flex flex-col items-center select-none">
      <div style={{ width: size, height: size }}>
        <WebGLShirtCanvas
          hex={hex}
          designUrl={designUrl || null}
          placement={placement}
          designScale={designScale}
          designOffsetX={designOffsetX}
          designOffsetY={designOffsetY}
          zoom={1}
          autoMotion
          compact
        />
      </div>
      {label && <span className="mt-1 text-sm font-semibold text-slate-700">{label}</span>}
    </div>
  );
}

export interface CatalogQuickDesign {
  id: string;
  name: string;
  /** Código corto del diseño (ej. D-001) para reportes de ventas */
  code?: string;
  /** Campaña o colección (ej. Ranchero, Turístico, Cristiana) */
  campaign?: string;
  /** Cantidad vendida en pedidos */
  soldCount?: number;
  /** Destacado manualmente como Más vendido */
  featured?: boolean;
  /** Si debe mostrar la viñeta especial minimalista de Más vendido */
  isBestSeller?: boolean;
  photoId: string;
  imageUrl: string | null;
  placement: DecalPlacement;
  clientVisible: boolean;
  /** Tono predominante detectado de la imagen ('dark' | 'light' | 'mixed') */
  tone?: DesignTone;
  /** Restricción de telas permitidas para este diseño */
  allowedColorMode?: AllowedColorMode;
  /** IDs específicos permitidos cuando allowedColorMode === 'custom' */
  allowedColorIds?: string[];
}

export interface ShirtColorOption {
  id: string;
  name: string;
  hex: string;
  stockText?: string;
  available?: boolean;
  included?: boolean;
}

/**
 * Estudio 3D Interactivo con modelo escaneado real (`shirt_baked.glb`),
 * selector de color integrado arriba, controles intuitivos a los lados,
 * Zoom de acercamiento y bandeja responsiva de Diseños del Catálogo a un clic (Tamaño A3).
 */
export function InteractiveShirt3D({
  hex,
  colorName,
  brandName: _brandName,
  designUrl,
  placement = 'center',
  designScale = 2.0,
  designOffsetX = 0,
  designOffsetY = 0,
  onDesignChange,
  onUploadFile,
  onClearDesign,
  removeBg,
  onToggleRemoveBg,
  bgTolerance = 36,
  onChangeBgTolerance,
  onAiRemoveBg,
  onUpscale4K,
  processingText,
  colorOptions,
  activeColorId,
  onSelectColor,
  onToggleColorIncluded,
  onAddNewColor,
  onEditColor,
  onDeleteColor,
  catalogDesigns,
  activeCatalogDesignId,
  onSelectCatalogDesign,
  isStoreOwner = false,
  onSaveCurrentToCatalog,
  onUploadCatalogFiles,
  onToggleCatalogDesignVisible,
  onToggleCatalogDesignFeatured,
  onDeleteCatalogDesign,
  onRenameCatalogDesign,
  onChangeDesignCampaign,
  onChangeDesignColors,
  campaigns,
  activeCampaign = 'all',
  onChangeActiveCampaign,
  onAddCampaign,
  boutiqueTheme = 'ranchero',
  onChangeBoutiqueTheme: _onChangeBoutiqueTheme,
  autoMotion = true,
  stockBadge,
  wizardStep
}: {
  hex: string;
  colorName: string;
  brandName: string;
  designUrl?: string | null;
  placement?: DecalPlacement;
  designScale?: number;
  designOffsetX?: number;
  designOffsetY?: number;
  onDesignChange?: (patch: {
    scale?: number;
    offsetX?: number;
    offsetY?: number;
    placement?: DecalPlacement;
    designUrl?: string | null;
    designName?: string | null;
    photoId?: string | null;
  }) => void;
  onUploadFile?: (file: File) => void;
  onClearDesign?: () => void;
  removeBg?: boolean;
  onToggleRemoveBg?: (next: boolean) => void;
  bgTolerance?: number;
  onChangeBgTolerance?: (tol: number) => void;
  onAiRemoveBg?: () => void;
  onUpscale4K?: () => void;
  processingText?: string | null;
  colorOptions?: ShirtColorOption[];
  activeColorId?: string;
  onSelectColor?: (colorId: string) => void;
  onToggleColorIncluded?: (colorId: string) => void;
  onAddNewColor?: () => void;
  onEditColor?: (colorId: string) => void;
  onDeleteColor?: (colorId: string) => void;
  catalogDesigns?: CatalogQuickDesign[];
  activeCatalogDesignId?: string | null;
  onSelectCatalogDesign?: (design: CatalogQuickDesign) => void;
  isStoreOwner?: boolean;
  onSaveCurrentToCatalog?: (
    chosen?:
      | string
      | {
          campaign?: string;
          name?: string;
          allowedColorMode?: AllowedColorMode | 'auto';
          allowedColorIds?: string[];
          tone?: DesignTone;
        }
  ) => void;
  onUploadCatalogFiles?: (
    files: FileList | File[],
    chosen?:
      | string
      | {
          campaign?: string;
          customName?: string;
          allowedColorMode?: AllowedColorMode | 'auto';
          allowedColorIds?: string[];
        }
  ) => void;
  onToggleCatalogDesignVisible?: (designId: string, nextVisible: boolean) => void;
  onToggleCatalogDesignFeatured?: (designId: string, nextFeatured: boolean) => void;
  onDeleteCatalogDesign?: (designId: string) => void;
  onRenameCatalogDesign?: (designId: string, name: string, code: string) => void;
  onChangeDesignCampaign?: (designId: string, campaign: string) => void;
  onChangeDesignColors?: (
    designId: string,
    allowedColorMode: AllowedColorMode,
    allowedColorIds?: string[],
    tone?: DesignTone
  ) => void;
  campaigns?: string[];
  activeCampaign?: string;
  onChangeActiveCampaign?: (campaign: string) => void;
  onAddCampaign?: () => void;
  boutiqueTheme?: BoutiqueTheme;
  onChangeBoutiqueTheme?: (theme: BoutiqueTheme) => void;
  autoMotion?: boolean;
  stockBadge?: { available: boolean; text: string } | null;
  /** Modo asistente (tienda): limita qué controles se muestran por paso */
  wizardStep?: 'color' | 'design' | 'size' | 'data' | null;
}) {
  const [mode] = useState<MotionMode>('wind');
  const [touchAction, setTouchAction] = useState<'rotate' | 'moveDesign'>('rotate');
  const [targetAngleY, setTargetAngleY] = useState<number | null>(placement === 'back' ? 180 : 0);
  const [zoom, setZoom] = useState<number>(1);
  const [showcaseActive, setShowcaseActive] = useState<boolean>(false);
  const themeStyle = BOUTIQUE_THEMES[boutiqueTheme] || BOUTIQUE_THEMES.ranchero;
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const catalogBatchInputRef = useRef<HTMLInputElement>(null);
  const clientCarouselRef = useRef<HTMLDivElement>(null);
  const adminCarouselRef = useRef<HTMLDivElement>(null);
  const [isWesternModalOpen, setIsWesternModalOpen] = useState(false);
  const [showPositionSliders, setShowPositionSliders] = useState(false);
  const [uploadModalState, setUploadModalState] = useState<
    { mode: 'files'; files: File[] } | { mode: 'current' } | null
  >(null);
  const [uploadTargetCampaign, setUploadTargetCampaign] = useState<string>(
    activeCampaign && activeCampaign !== 'all' ? activeCampaign : 'Ranchero'
  );
  const [uploadCustomName, setUploadCustomName] = useState<string>('');
  const [uploadColorMode, setUploadColorMode] = useState<AllowedColorMode | 'auto'>('auto');
  const [uploadCustomColorIds, setUploadCustomColorIds] = useState<string[]>([]);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(null);
  const [uploadAnalysis, setUploadAnalysis] = useState<DesignToneAnalysis | null>(null);
  const [uploadBatchSummary, setUploadBatchSummary] = useState<{
    dark: number;
    light: number;
    mixed: number;
  } | null>(null);
  const [editColorsDesign, setEditColorsDesign] = useState<CatalogQuickDesign | null>(null);

  useEffect(() => {
    if (activeCampaign && activeCampaign !== 'all') {
      setUploadTargetCampaign(activeCampaign);
    }
  }, [activeCampaign]);

  const activeCatalogDesign =
    (catalogDesigns || []).find(
      (d) =>
        (activeCatalogDesignId && d.id === activeCatalogDesignId) ||
        (!!designUrl && !!d.imageUrl && d.imageUrl === designUrl)
    ) || null;

  const findCompatibleColor = (
    design: CatalogQuickDesign | null,
    preferCurrentFirst = true
  ): ShirtColorOption | null => {
    if (!colorOptions || colorOptions.length === 0) return null;
    if (preferCurrentFirst) {
      const current = colorOptions.find((c) =>
        activeColorId ? c.id === activeColorId : c.name === colorName
      );
      if (current && isColorCompatibleWithDesign(current, design).allowed) {
        return current;
      }
    }
    return colorOptions.find((c) => isColorCompatibleWithDesign(c, design).allowed) || null;
  };

  // Auto-cambiar a un color compatible si el diseño activo bloquea la camisa actual
  useEffect(() => {
    if (!activeCatalogDesign || !colorOptions || !onSelectColor) return;
    const current = colorOptions.find((c) =>
      activeColorId ? c.id === activeColorId : c.name === colorName
    );
    if (!current) return;
    const compat = isColorCompatibleWithDesign(current, activeCatalogDesign);
    if (!compat.allowed) {
      const next = findCompatibleColor(activeCatalogDesign, false);
      if (next && next.id !== current.id) {
        onSelectColor(next.id);
      }
    }
  }, [
    activeCatalogDesign?.id,
    activeCatalogDesign?.allowedColorMode,
    activeCatalogDesign?.tone,
    activeCatalogDesign?.allowedColorIds?.join(','),
    activeColorId
  ]);

  const applyCatalogDesignWithColorGuard = (d: CatalogQuickDesign) => {
    if (colorOptions && onSelectColor) {
      const current = colorOptions.find((c) =>
        activeColorId ? c.id === activeColorId : c.name === colorName
      );
      if (current && !isColorCompatibleWithDesign(current, d).allowed) {
        const next = findCompatibleColor(d, false);
        if (next && next.id !== current.id) {
          onSelectColor(next.id);
        }
      }
    }
    onSelectCatalogDesign?.(d);
  };

  const openUploadDialog = (nextState: { mode: 'files'; files: File[] } | { mode: 'current' }) => {
    const defCamp =
      activeCampaign && activeCampaign !== 'all'
        ? activeCampaign
        : campaigns && campaigns.length > 0
        ? campaigns[0]
        : 'Ranchero';
    setUploadTargetCampaign(defCamp);
    setUploadAnalysis(null);
    setUploadBatchSummary(null);
    setUploadPreviewUrl(null);
    setEditColorsDesign(null);

    if (nextState.mode === 'files') {
      const first = nextState.files[0];
      setUploadCustomName(
        nextState.files.length === 1 && first
          ? first.name.replace(/\.[^/.]+$/, '').replace(/[-_]+/g, ' ').trim().slice(0, 32)
          : ''
      );
      setUploadColorMode(nextState.files.length > 1 ? 'auto' : 'all');
      setUploadCustomColorIds((colorOptions || []).map((c) => c.id));
      setUploadModalState(nextState);

      const readAsDataUrl = (f: File) =>
        new Promise<string>((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve(typeof r.result === 'string' ? r.result : '');
          r.onerror = () => resolve('');
          r.readAsDataURL(f);
        });

      void (async () => {
        const urls = await Promise.all(nextState.files.map(readAsDataUrl));
        if (urls[0]) setUploadPreviewUrl(urls[0]);
        const analyses = await Promise.all(urls.filter(Boolean).map(analyzeDesignTone));
        if (analyses.length > 0) {
          setUploadAnalysis(analyses[0]);
          if (nextState.files.length === 1) {
            const sug = analyses[0].suggestedColorMode;
            setUploadColorMode(sug);
            if (colorOptions) {
              setUploadCustomColorIds(
                colorOptions
                  .filter((c) =>
                    sug === 'light_fabrics'
                      ? !isDarkFabricColor(c.hex)
                      : sug === 'dark_fabrics'
                      ? isDarkFabricColor(c.hex)
                      : true
                  )
                  .map((c) => c.id)
              );
            }
          } else {
            const dark = analyses.filter((a) => a.tone === 'dark').length;
            const light = analyses.filter((a) => a.tone === 'light').length;
            const mixed = analyses.length - dark - light;
            setUploadBatchSummary({ dark, light, mixed });
            setUploadColorMode('auto');
          }
        }
      })();
    } else {
      setUploadCustomName('');
      setUploadPreviewUrl(designUrl || null);
      setUploadColorMode('all');
      setUploadCustomColorIds((colorOptions || []).map((c) => c.id));
      setUploadModalState(nextState);
      if (designUrl) {
        void analyzeDesignTone(designUrl).then((res) => {
          setUploadAnalysis(res);
          setUploadColorMode(res.suggestedColorMode);
          if (colorOptions) {
            setUploadCustomColorIds(
              colorOptions
                .filter((c) =>
                  res.suggestedColorMode === 'light_fabrics'
                    ? !isDarkFabricColor(c.hex)
                    : res.suggestedColorMode === 'dark_fabrics'
                    ? isDarkFabricColor(c.hex)
                    : true
                )
                .map((c) => c.id)
            );
          }
        });
      }
    }
  };

  const openEditColorsDialog = (d: CatalogQuickDesign) => {
    setUploadModalState(null);
    setEditColorsDesign(d);
    setUploadPreviewUrl(d.imageUrl);
    setUploadAnalysis(null);
    const mode: AllowedColorMode =
      d.allowedColorMode ||
      (d.tone === 'dark' ? 'light_fabrics' : d.tone === 'light' ? 'dark_fabrics' : 'all');
    setUploadColorMode(mode);
    setUploadCustomColorIds(
      d.allowedColorIds && d.allowedColorIds.length > 0
        ? d.allowedColorIds
        : (colorOptions || [])
            .filter((c) => isColorCompatibleWithDesign(c, { ...d, allowedColorMode: mode }).allowed)
            .map((c) => c.id)
    );
    if (d.imageUrl) {
      void analyzeDesignTone(d.imageUrl).then(setUploadAnalysis);
    }
  };

  const handleApplyWesternDesign = (dataUrl: string, name: string, targetPlacement: 'back' | 'center') => {
    onSelectCatalogDesign?.({
      id: `custom_${Date.now()}`,
      name,
      placement: targetPlacement,
      imageUrl: dataUrl,
      photoId: `photo_${Date.now()}`,
      clientVisible: true
    });
    onDesignChange?.({ placement: targetPlacement, scale: 2.0, offsetX: 0, offsetY: 0 });
  };

  useEffect(() => {
    if (placement === 'back') setTargetAngleY(180);
    else setTargetAngleY(0);
  }, [placement]);

  // Modo "Desfile Automático": recorre suavemente los diseños del catálogo en la camisa 3D
  useEffect(() => {
    if (!showcaseActive || !catalogDesigns || catalogDesigns.length < 2 || !onSelectCatalogDesign) {
      return;
    }
    const readyDesigns = catalogDesigns.filter((d) => !!d.imageUrl);
    if (readyDesigns.length < 2) return;

    const timer = window.setInterval(() => {
      const currentIdx = readyDesigns.findIndex(
        (d) =>
          (activeCatalogDesignId && d.id === activeCatalogDesignId) ||
          (designUrl && d.imageUrl === designUrl)
      );
      const nextIdx = (currentIdx + 1) % readyDesigns.length;
      applyCatalogDesignWithColorGuard(readyDesigns[nextIdx]);
    }, 3200);

    return () => window.clearInterval(timer);
  }, [showcaseActive, catalogDesigns, activeCatalogDesignId, designUrl, onSelectCatalogDesign, activeColorId]);

  const adjustScale = (delta: number) => {
    const next = clamp(Math.round((designScale + delta) * 100) / 100, 0.30, 4.00);
    onDesignChange?.({ scale: next });
  };

  const filteredCatalogDesigns = (catalogDesigns || []).filter((d) => {
    if (!activeCampaign || activeCampaign === 'all') return true;
    return (d.campaign || '').toLowerCase() === activeCampaign.toLowerCase();
  });

  const readySlideDesigns = filteredCatalogDesigns.filter((d) => !!d.imageUrl);
  const currentSlideIdx = readySlideDesigns.findIndex(
    (d) =>
      (activeCatalogDesignId && d.id === activeCatalogDesignId) ||
      (!!designUrl && d.imageUrl === designUrl)
  );

  const stepCatalogDesign = (delta: number) => {
    if (!readySlideDesigns.length || !onSelectCatalogDesign) return;
    setShowcaseActive(false);
    const nextIdx =
      currentSlideIdx < 0
        ? delta >= 0
          ? 0
          : readySlideDesigns.length - 1
        : (currentSlideIdx + delta + readySlideDesigns.length) % readySlideDesigns.length;
    applyCatalogDesignWithColorGuard(readySlideDesigns[nextIdx]);
  };

  const scrollCarousel = (ref: { current: HTMLDivElement | null }, dir: -1 | 1) => {
    if (!ref.current) return;
    ref.current.scrollBy({ left: dir * 280, behavior: 'smooth' });
  };

  if (!isStoreOwner) {
    const isBackSide = placement === 'back';
    const currentSlideDesign = currentSlideIdx >= 0 ? readySlideDesigns[currentSlideIdx] : null;
    return (
      <div className="relative select-none space-y-4">
        {onUploadFile && (
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/png,image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUploadFile(f);
              e.target.value = '';
            }}
          />
        )}
        {/* ESCENARIO 3D ESTILO APPLE STUDIO */}
        <div
          className={`relative overflow-hidden rounded-[28px] p-4 shadow-xl transition-colors duration-500 sm:p-6 ${themeStyle.stageClass}`}
        >
          {/* Barra superior flotante minimalista: Vista/Lado + Zoom */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex rounded-full bg-black/45 p-1 backdrop-blur-md ring-1 ring-white/15">
              {(
                [
                  ['back', 180, 'Espalda'],
                  ['center', 0, 'Frente'],
                  ['profile', 38, 'Perfil']
                ] as const
              ).map(([sideKey, angle, lbl]) => {
                const active = targetAngleY === angle;
                return (
                  <button
                    key={lbl}
                    type="button"
                    onClick={() => {
                      setTargetAngleY(angle);
                      if (designUrl && (sideKey === 'back' || sideKey === 'center')) {
                        onDesignChange?.({ placement: sideKey, offsetX: 0, offsetY: 0 });
                      }
                    }}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition sm:px-3.5 sm:text-xs ${
                      active
                        ? 'bg-white text-slate-950 shadow-sm'
                        : 'text-white/80 hover:text-white'
                    }`}
                  >
                    {lbl}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setZoom((z) => (z > 1.35 ? 1 : 1.7))}
              className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[11px] font-semibold backdrop-blur-md transition sm:text-xs ${
                zoom > 1.35
                  ? 'bg-white text-slate-950 shadow-sm'
                  : 'bg-black/45 text-white/85 ring-1 ring-white/15 hover:text-white'
              }`}
            >
              <span>{zoom > 1.35 ? 'Alejar' : 'Acercar'}</span>
            </button>
          </div>

          {/* Lienzo 3D Central con botones laterales tipo Slide */}
          <div
            className="relative mx-auto flex w-full max-w-[360px] items-center justify-center"
            style={{ aspectRatio: '1 / 1' }}
          >
            <div
              className="studio-aura-pulse pointer-events-none absolute inset-6 rounded-full blur-2xl transition-colors duration-700"
              style={{
                background: `radial-gradient(circle, ${hex}88 0%, ${themeStyle.auraColor} 55%, transparent 75%)`
              }}
            />
            <div className="floor-shadow-breath pointer-events-none absolute bottom-3 h-5 w-44 rounded-full bg-black/60 blur-md" />

            {readySlideDesigns.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => stepCatalogDesign(-1)}
                  aria-label="Diseño anterior"
                  className="absolute left-0 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-lg font-bold text-white/90 ring-1 ring-white/15 backdrop-blur-md transition hover:bg-black/65 active:scale-95"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => stepCatalogDesign(1)}
                  aria-label="Siguiente diseño"
                  className="absolute right-0 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-lg font-bold text-white/90 ring-1 ring-white/15 backdrop-blur-md transition hover:bg-black/65 active:scale-95"
                >
                  ›
                </button>
              </>
            )}

            <WebGLShirtCanvas
              hex={hex}
              designUrl={designUrl || null}
              placement={placement}
              designScale={designScale}
              designOffsetX={designOffsetX}
              designOffsetY={designOffsetY}
              zoom={zoom}
              onZoomChange={(nextZ) => setZoom(nextZ)}
              autoMotion={autoMotion && zoom <= 1.25}
              mode={mode}
              targetAngleY={targetAngleY}
              touchAction="rotate"
            />
          </div>

          {/* Selector de Ubicación del Estampado + Ajuste tipo Slide */}
          {designUrl && (!wizardStep || wizardStep === 'design') && (
            <div className="mt-1 space-y-2">
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                <div className="inline-flex items-center gap-1 rounded-full bg-black/50 p-1 backdrop-blur-md ring-1 ring-white/15">
                  <button
                    type="button"
                    onClick={() => {
                      onDesignChange?.({ placement: 'back', offsetX: 0, offsetY: 0 });
                      setTargetAngleY(180);
                    }}
                    className={`rounded-full px-3.5 py-1 text-xs font-semibold transition ${
                      isBackSide ? 'bg-white text-slate-950 shadow-sm' : 'text-white/80 hover:text-white'
                    }`}
                  >
                    Espalda
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onDesignChange?.({ placement: 'center', offsetX: 0, offsetY: 0 });
                      setTargetAngleY(0);
                    }}
                    className={`rounded-full px-3.5 py-1 text-xs font-semibold transition ${
                      !isBackSide ? 'bg-white text-slate-950 shadow-sm' : 'text-white/80 hover:text-white'
                    }`}
                  >
                    Frente
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPositionSliders((v) => !v)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                      showPositionSliders
                        ? 'bg-white text-slate-950 shadow-sm'
                        : 'text-white/80 hover:text-white'
                    }`}
                  >
                    Mover
                  </button>
                  {onClearDesign && (
                    <button
                      type="button"
                      onClick={onClearDesign}
                      className="rounded-full px-3 py-1 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/20 hover:text-rose-200"
                    >
                      Quitar
                    </button>
                  )}
                </div>
              </div>

              <AnimatePresence>
                {showPositionSliders && onDesignChange && (
                  <motion.div
                    initial={{ opacity: 0, height: 0, y: -6 }}
                    animate={{ opacity: 1, height: 'auto', y: 0 }}
                    exit={{ opacity: 0, height: 0, y: -6 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                    className="mx-auto max-w-sm overflow-hidden rounded-2xl bg-white/95 p-3 text-slate-900 shadow-md backdrop-blur-md"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-slate-700">
                        Desliza para mover o ajustar el diseño
                      </span>
                      <button
                        type="button"
                        onClick={() => onDesignChange({ offsetX: 0, offsetY: 0, scale: 2.0 })}
                        className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-200"
                      >
                        Centrar A3
                      </button>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <div>
                        <div className="flex justify-between text-[10px] font-medium text-slate-500">
                          <span>↕ Altura</span>
                          <span>{Math.round(designOffsetY)}</span>
                        </div>
                        <input
                          type="range"
                          min="-20"
                          max="22"
                          step="1"
                          value={designOffsetY}
                          onChange={(e) => onDesignChange({ offsetY: Number(e.target.value) })}
                          className="w-full accent-slate-900"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-[10px] font-medium text-slate-500">
                          <span>↔ Lado</span>
                          <span>{Math.round(designOffsetX)}</span>
                        </div>
                        <input
                          type="range"
                          min="-20"
                          max="20"
                          step="1"
                          value={designOffsetX}
                          onChange={(e) => onDesignChange({ offsetX: Number(e.target.value) })}
                          className="w-full accent-slate-900"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-[10px] font-medium text-slate-500">
                          <span>⤢ Tamaño</span>
                          <span>{Math.round(designScale * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min="1.0"
                          max="2.2"
                          step="0.05"
                          value={designScale}
                          onChange={(e) => onDesignChange({ scale: Number(e.target.value) })}
                          className="w-full accent-slate-900"
                        />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Selector de Color minimalista tipo Apple (respeta contraste negro/blanco del diseño) */}
          {(!wizardStep || wizardStep === 'color') && colorOptions && colorOptions.length > 0 && onSelectColor && (() => {
            const hasRestricted = colorOptions.some(
              (c) => !isColorCompatibleWithDesign(c, activeCatalogDesign).allowed
            );
            const restrictionLabel =
              activeCatalogDesign?.allowedColorMode === 'light_fabrics' ||
              (!activeCatalogDesign?.allowedColorMode && activeCatalogDesign?.tone === 'dark')
                ? 'Diseño de tinta oscura · disponible solo en telas claras'
                : activeCatalogDesign?.allowedColorMode === 'dark_fabrics' ||
                  (!activeCatalogDesign?.allowedColorMode && activeCatalogDesign?.tone === 'light')
                ? 'Diseño claro · disponible solo en telas oscuras'
                : 'Colores seleccionados para este diseño';

            return (
              <div className="mt-4 flex flex-col items-center gap-2 rounded-2xl bg-white/95 px-4 py-3 shadow-sm backdrop-blur-md">
                <div className="text-xs font-medium text-slate-500">
                  Color — <strong className="font-semibold text-slate-900">{colorName}</strong>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2.5">
                  {colorOptions.map((c) => {
                    const active = activeColorId ? c.id === activeColorId : c.name === colorName;
                    const compat = isColorCompatibleWithDesign(c, activeCatalogDesign);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        disabled={!compat.allowed}
                        onClick={() => compat.allowed && onSelectColor(c.id)}
                        title={compat.allowed ? c.name : `${c.name} · ${compat.reason}`}
                        aria-label={compat.allowed ? c.name : `${c.name} no disponible`}
                        className={`relative h-8 w-8 rounded-full border transition-transform duration-150 ${
                          !compat.allowed
                            ? 'cursor-not-allowed border-slate-300 opacity-25'
                            : active
                            ? 'scale-110 border-slate-900 ring-2 ring-slate-900 ring-offset-2'
                            : 'border-black/20 hover:scale-105'
                        }`}
                        style={{ backgroundColor: c.hex }}
                      >
                        {!compat.allowed && (
                          <span
                            className="pointer-events-none absolute inset-0 flex items-center justify-center"
                            aria-hidden="true"
                          >
                            <span className="h-[1.5px] w-7 -rotate-45 rounded bg-slate-700/80" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {hasRestricted && activeCatalogDesign && (
                  <div className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-600">
                    <span>{restrictionLabel}</span>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* GALERÍA DE DISEÑOS TIPO SLIDE ESTILO APPLE (CON MÁS VENDIDOS AL INICIO) */}
        {(!wizardStep || wizardStep === 'design') && (
        <div className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="text-sm font-semibold tracking-tight text-slate-900">Diseños</h3>
              {campaigns && campaigns.length > 0 && onChangeActiveCampaign && (
                <div className="ml-1 flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onChangeActiveCampaign('all')}
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition ${
                      activeCampaign === 'all'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    Todos
                  </button>
                  {campaigns.map((camp) => (
                    <button
                      key={camp}
                      type="button"
                      onClick={() => onChangeActiveCampaign(camp)}
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition ${
                        activeCampaign.toLowerCase() === camp.toLowerCase()
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {camp}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {filteredCatalogDesigns.length > 2 && (
                <div className="inline-flex items-center gap-1 rounded-full bg-slate-100 p-0.5">
                  <button
                    type="button"
                    onClick={() => scrollCarousel(clientCarouselRef, -1)}
                    className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-slate-700 hover:bg-white"
                    aria-label="Deslizar a la izquierda"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    onClick={() => scrollCarousel(clientCarouselRef, 1)}
                    className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-slate-700 hover:bg-white"
                    aria-label="Deslizar a la derecha"
                  >
                    ›
                  </button>
                </div>
              )}
              {onUploadFile && (
                <button
                  type="button"
                  onClick={() => uploadInputRef.current?.click()}
                  className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white transition hover:bg-slate-800 active:scale-95"
                >
                  + Subir archivo A3
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsWesternModalOpen(true)}
                className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-800 transition hover:bg-slate-50 active:scale-95"
              >
                + Texto / Logo
              </button>
              {designUrl && onClearDesign && (
                <button
                  type="button"
                  onClick={onClearDesign}
                  className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-200"
                >
                  Sin diseño
                </button>
              )}
            </div>
          </div>

          {/* Control rápido tipo Slide para cambiar diseño */}
          {readySlideDesigns.length > 1 && (
            <div className="mb-3 flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-2">
              <button
                type="button"
                onClick={() => stepCatalogDesign(-1)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold text-slate-700 shadow-sm ring-1 ring-black/5 hover:bg-slate-100"
              >
                ‹
              </button>
              <div className="flex flex-1 flex-col gap-1">
                <div className="flex items-center justify-between text-[11px] font-medium text-slate-600">
                  <span className="truncate font-semibold text-slate-900">
                    {currentSlideDesign ? currentSlideDesign.name : 'Desliza para elegir diseño'}
                  </span>
                  <span>
                    {currentSlideIdx >= 0 ? currentSlideIdx + 1 : 0} / {readySlideDesigns.length}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={readySlideDesigns.length - 1}
                  step={1}
                  value={currentSlideIdx >= 0 ? currentSlideIdx : 0}
                  onChange={(e) => {
                    const idx = Number(e.target.value);
                    const target = readySlideDesigns[idx];
                    if (target && onSelectCatalogDesign) {
                      setShowcaseActive(false);
                      applyCatalogDesignWithColorGuard(target);
                    }
                  }}
                  className="w-full accent-slate-900"
                />
              </div>
              <button
                type="button"
                onClick={() => stepCatalogDesign(1)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold text-slate-700 shadow-sm ring-1 ring-black/5 hover:bg-slate-100"
              >
                ›
              </button>
            </div>
          )}

          <div
            ref={clientCarouselRef}
            className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-1"
          >
            {filteredCatalogDesigns.map((d) => {
              const isSelected =
                (activeCatalogDesignId && activeCatalogDesignId === d.id) ||
                (!!designUrl && !!d.imageUrl && designUrl === d.imageUrl);
              const thumbCompat = isColorCompatibleWithDesign(
                { id: activeColorId, name: colorName, hex },
                d
              ).allowed;
              const thumbBg = thumbCompat
                ? hex
                : d.allowedColorMode === 'dark_fabrics' ||
                  (!d.allowedColorMode && d.tone === 'light')
                ? '#1A1A1C'
                : '#F5F5F7';
              return (
                <motion.button
                  key={d.id}
                  type="button"
                  whileHover={{ scale: 1.04, y: -2 }}
                  whileTap={{ scale: 0.96 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 25 }}
                  onClick={() => {
                    setShowcaseActive(false);
                    if (isSelected && onClearDesign) {
                      onClearDesign();
                      return;
                    }
                    applyCatalogDesignWithColorGuard(d);
                  }}
                  disabled={!d.imageUrl}
                  className={`group relative flex w-[122px] shrink-0 snap-start flex-col rounded-2xl p-1.5 text-left transition ${
                    isSelected
                      ? 'bg-slate-900 text-white shadow-md'
                      : 'bg-slate-50 text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  {d.isBestSeller && (
                    <span className="absolute left-2.5 top-2.5 z-10 inline-flex items-center gap-0.5 rounded-full bg-white/95 px-2 py-0.5 text-[9px] font-bold tracking-tight text-slate-900 shadow-sm ring-1 ring-black/10 backdrop-blur-md">
                      <span className="text-amber-500">★</span> Más vendido
                    </span>
                  )}
                  <div
                    className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border border-black/10 p-2 transition duration-200 group-hover:scale-[1.02]"
                    style={{ backgroundColor: thumbBg }}
                  >
                    {d.imageUrl ? (
                      <img
                        src={d.imageUrl}
                        alt={d.name}
                        className="h-full w-full object-contain drop-shadow-sm"
                        loading="lazy"
                      />
                    ) : (
                      <span className="text-[10px] font-medium text-slate-400">...</span>
                    )}
                  </div>
                  <div
                    className={`mt-1.5 w-full truncate px-1 text-center text-xs font-semibold ${
                      isSelected ? 'text-white' : 'text-slate-800'
                    }`}
                  >
                    {d.name}
                  </div>
                </motion.button>
              );
            })}
          </div>
        </div>
        )}

        <WesternDesignModal
          isOpen={isWesternModalOpen}
          onClose={() => setIsWesternModalOpen(false)}
          onApply={handleApplyWesternDesign}
          initialPlacement={placement === 'back' ? 'back' : 'center'}
        />
      </div>
    );
  }

  return (
    <div className="relative select-none space-y-3">
      {onUploadFile && (
        <input
          ref={uploadInputRef}
          type="file"
          accept="image/png,image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              onUploadFile(f);
              if (onUploadCatalogFiles) {
                openUploadDialog({ mode: 'files', files: [f] });
              }
            }
            e.target.value = '';
          }}
        />
      )}

      {/* ESCENARIO Y HERRAMIENTAS ESTILO APPLE STUDIO (ADMIN) */}
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[1fr_280px]">
        {/* LIENZO 3D CENTRAL */}
        <div className="relative overflow-hidden rounded-[28px] border border-slate-200/80 bg-gradient-to-b from-white via-[#F5F5F7] to-[#ECECEF] p-4 shadow-sm">
          {/* Barra superior flotante: Vista y Stock */}
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex items-center rounded-full bg-white/90 p-1 shadow-sm ring-1 ring-black/5 backdrop-blur-md">
              {(
                [
                  [180, 'Espalda'],
                  [0, 'Frente'],
                  [38, 'Perfil']
                ] as const
              ).map(([angle, lbl]) => {
                const active =
                  targetAngleY === angle ||
                  (targetAngleY === null &&
                    ((angle === 180 && placement === 'back') ||
                      (angle === 0 && placement !== 'back')));
                return (
                  <button
                    key={lbl}
                    type="button"
                    onClick={() => setTargetAngleY(angle)}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                      active
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {lbl}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-1.5">
              {stockBadge && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${
                    stockBadge.available
                      ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200'
                      : 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      stockBadge.available ? 'bg-emerald-500' : 'bg-amber-500'
                    }`}
                  />
                  {stockBadge.text}
                </span>
              )}
              <button
                type="button"
                onClick={() => setZoom((z) => (z > 1.35 ? 1 : 1.7))}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold shadow-sm ring-1 ring-black/5 backdrop-blur-md transition ${
                  zoom > 1.35
                    ? 'bg-slate-900 text-white'
                    : 'bg-white/90 text-slate-700 hover:bg-white'
                }`}
              >
                {zoom > 1.35 ? 'Alejar' : 'Acercar'}
              </button>
            </div>
          </div>

          {/* Modelo 3D */}
          <div
            className="relative mx-auto flex w-full max-w-[400px] items-center justify-center"
            style={{ aspectRatio: '1 / 1' }}
          >
            <div
              className="pointer-events-none absolute inset-10 rounded-full blur-3xl transition-colors duration-700"
              style={{
                background: `radial-gradient(circle, ${hex}30 0%, transparent 70%)`
              }}
            />
            <div className="pointer-events-none absolute bottom-4 h-4 w-44 rounded-full bg-black/15 blur-md" />

            {readySlideDesigns.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => stepCatalogDesign(-1)}
                  aria-label="Diseño anterior"
                  className="absolute left-1 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-lg font-bold text-slate-800 shadow-sm ring-1 ring-black/5 backdrop-blur-md transition hover:bg-white active:scale-95"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => stepCatalogDesign(1)}
                  aria-label="Siguiente diseño"
                  className="absolute right-1 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-lg font-bold text-slate-800 shadow-sm ring-1 ring-black/5 backdrop-blur-md transition hover:bg-white active:scale-95"
                >
                  ›
                </button>
              </>
            )}

            <WebGLShirtCanvas
              hex={hex}
              designUrl={designUrl || null}
              placement={placement}
              designScale={designScale}
              designOffsetX={designOffsetX}
              designOffsetY={designOffsetY}
              zoom={zoom}
              onZoomChange={(nextZ) => setZoom(nextZ)}
              autoMotion={autoMotion && touchAction !== 'moveDesign' && zoom <= 1.25}
              mode={mode}
              targetAngleY={targetAngleY}
              touchAction={touchAction}
              onMoveDesign={(dx, dy) => {
                onDesignChange?.({
                  offsetX: clamp(designOffsetX + dx, -24, 24),
                  offsetY: clamp(designOffsetY + dy, -24, 26)
                });
              }}
            />
          </div>

          {processingText && (
            <div className="mt-1 flex justify-center">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3.5 py-1 text-xs font-medium text-white">
                <span className="h-2 w-2 animate-ping rounded-full bg-sky-400" />
                <span>{processingText}</span>
              </div>
            </div>
          )}

          {/* Barra de Color limpia debajo de la camisa */}
          {colorOptions && colorOptions.length > 0 && onSelectColor && (
            <div className="mt-2 rounded-2xl bg-white/90 p-3 shadow-sm ring-1 ring-black/5 backdrop-blur-md">
              {(() => {
                const activeIdx = colorOptions.findIndex((c) =>
                  activeColorId ? c.id === activeColorId : c.name === colorName
                );
                const curColor =
                  colorOptions[activeIdx >= 0 ? activeIdx : 0] || colorOptions[0];
                const curIncluded = curColor.included ?? true;

                return (
                  <div className="space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-4 w-4 rounded-full border border-black/20"
                          style={{ backgroundColor: curColor.hex }}
                        />
                        <span className="text-xs font-semibold text-slate-900">
                          {curColor.name}
                        </span>
                        {curColor.stockText && (
                          <span className="text-xs text-slate-500">· {curColor.stockText}</span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1">
                        {onToggleColorIncluded && (
                          <button
                            type="button"
                            onClick={() => onToggleColorIncluded(curColor.id)}
                            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                              curIncluded
                                ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200'
                                : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            {curIncluded ? 'Visible' : 'Oculto'}
                          </button>
                        )}
                        {onEditColor && (
                          <button
                            type="button"
                            onClick={() => onEditColor(curColor.id)}
                            className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-200"
                          >
                            Editar
                          </button>
                        )}
                        {onDeleteColor && (
                          <button
                            type="button"
                            onClick={() => onDeleteColor(curColor.id)}
                            className="rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-100"
                          >
                            Eliminar
                          </button>
                        )}
                        {onAddNewColor && (
                          <button
                            type="button"
                            onClick={onAddNewColor}
                            className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-800"
                          >
                            + Color
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {colorOptions.map((c) => {
                        const active = activeColorId
                          ? c.id === activeColorId
                          : c.name === colorName;
                        const included = c.included ?? true;
                        const compat = isColorCompatibleWithDesign(c, activeCatalogDesign);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            disabled={!compat.allowed}
                            onClick={() => compat.allowed && onSelectColor(c.id)}
                            title={
                              compat.allowed
                                ? `${c.name}${c.stockText ? ` · ${c.stockText}` : ''}`
                                : `${c.name} · ${compat.reason}`
                            }
                            className={`relative h-7 w-7 rounded-full border transition-transform ${
                              !compat.allowed
                                ? 'cursor-not-allowed border-slate-300 opacity-25'
                                : active
                                ? 'scale-110 border-slate-900 ring-2 ring-slate-900 ring-offset-2'
                                : included
                                ? 'border-black/20 hover:scale-105'
                                : 'border-dashed border-slate-300 opacity-40'
                            }`}
                            style={{ backgroundColor: c.hex }}
                          >
                            {!compat.allowed && (
                              <span
                                className="pointer-events-none absolute inset-0 flex items-center justify-center"
                                aria-hidden="true"
                              >
                                <span className="h-[1.5px] w-6 -rotate-45 rounded bg-slate-700/80" />
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {activeCatalogDesign &&
                      colorOptions.some(
                        (c) => !isColorCompatibleWithDesign(c, activeCatalogDesign).allowed
                      ) && (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50/90 px-2.5 py-1.5 text-[11px] text-amber-900 ring-1 ring-amber-200/70">
                          <span>
                            {activeCatalogDesign.allowedColorMode === 'light_fabrics' ||
                            (!activeCatalogDesign.allowedColorMode &&
                              activeCatalogDesign.tone === 'dark')
                              ? 'Diseño oscuro bloqueado en telas oscuras para mantener nitidez.'
                              : activeCatalogDesign.allowedColorMode === 'dark_fabrics' ||
                                (!activeCatalogDesign.allowedColorMode &&
                                  activeCatalogDesign.tone === 'light')
                              ? 'Diseño claro bloqueado en telas claras para mantener nitidez.'
                              : 'Algunos colores están bloqueados para este diseño.'}
                          </span>
                          {onChangeDesignColors && (
                            <button
                              type="button"
                              onClick={() => openEditColorsDialog(activeCatalogDesign)}
                              className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-800 ring-1 ring-black/10 hover:bg-slate-50"
                            >
                              Colores disponibles
                            </button>
                          )}
                        </div>
                      )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* PANEL DERECHO DE ESTUDIO (Ajuste de Diseño A3/A4 y Posición) */}
        <div className="space-y-3 rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-sm">
          {onUploadFile && (
            <div className="space-y-2 border-b border-slate-100 pb-3">
              <div className="text-xs font-semibold text-slate-900">Arte / Diseño (PNG o JPG)</div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => uploadInputRef.current?.click()}
                  className="flex-1 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 active:scale-95"
                >
                  {designUrl ? 'Cambiar PNG/JPG' : 'Subir PNG / JPG'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsWesternModalOpen(true)}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800 transition hover:bg-slate-100"
                >
                  + Texto
                </button>
                {designUrl && onClearDesign && (
                  <button
                    type="button"
                    onClick={onClearDesign}
                    title="Quitar diseño"
                    className="rounded-xl bg-rose-50 px-2.5 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-100"
                  >
                    ✕
                  </button>
                )}
              </div>

              {onToggleRemoveBg && (
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-slate-600">JPG → PNG sin fondo</span>
                  <button
                    type="button"
                    onClick={() => onToggleRemoveBg(!removeBg)}
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition ${
                      removeBg
                        ? 'bg-emerald-100 text-emerald-900'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {removeBg ? 'Activo' : 'Activar'}
                  </button>
                </div>
              )}

              {designUrl && removeBg && onChangeBgTolerance && (
                <div className="rounded-xl bg-slate-50 px-2.5 py-1.5">
                  <div className="flex items-center justify-between text-[11px] font-medium text-slate-600">
                    <span>Recorte fino</span>
                    <span>{bgTolerance}</span>
                  </div>
                  <input
                    type="range"
                    min="14"
                    max="78"
                    step="2"
                    value={bgTolerance}
                    onChange={(e) => onChangeBgTolerance(parseInt(e.target.value, 10))}
                    className="mt-1 w-full accent-slate-900"
                  />
                </div>
              )}

              {designUrl && (onAiRemoveBg || onUpscale4K) && (
                <div className="grid grid-cols-2 gap-1.5 pt-1">
                  {onAiRemoveBg && (
                    <button
                      type="button"
                      disabled={!!processingText}
                      onClick={onAiRemoveBg}
                      className="rounded-xl bg-slate-100 px-2 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-200 disabled:opacity-40"
                    >
                      Fondo IA
                    </button>
                  )}
                  {onUpscale4K && (
                    <button
                      type="button"
                      disabled={!!processingText}
                      onClick={onUpscale4K}
                      className="rounded-xl bg-slate-100 px-2 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-200 disabled:opacity-40"
                    >
                      Mejorar 4K
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Tamaño de Impresión A3 / A4 */}
          <div className="space-y-2 border-b border-slate-100 pb-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-900">Tamaño</span>
              <span className="text-xs font-medium text-slate-500">
                {designScale >= 1.85
                  ? `A3 (${Math.round(designScale * 100)}%)`
                  : designScale >= 1.45
                  ? `A4 (${Math.round(designScale * 100)}%)`
                  : `${Math.round(designScale * 100)}%`}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                disabled={!designUrl || !onDesignChange}
                onClick={() =>
                  onDesignChange?.({
                    scale: 2.0,
                    offsetX: 0,
                    offsetY: 0
                  })
                }
                className={`rounded-xl py-2 text-xs font-semibold transition disabled:opacity-40 ${
                  designScale >= 1.85
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                A3 (200%)
              </button>
              <button
                type="button"
                disabled={!designUrl || !onDesignChange}
                onClick={() =>
                  onDesignChange?.({
                    scale: 1.6,
                    offsetX: 0,
                    offsetY: 0
                  })
                }
                className={`rounded-xl py-2 text-xs font-semibold transition disabled:opacity-40 ${
                  designScale < 1.85 && designScale >= 1.4
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                A4 (160%)
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                disabled={!designUrl || !onDesignChange}
                onClick={() => adjustScale(-0.15)}
                className="rounded-xl bg-slate-100 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-40"
              >
                − Reducir
              </button>
              <button
                type="button"
                disabled={!designUrl || !onDesignChange}
                onClick={() => adjustScale(0.15)}
                className="rounded-xl bg-slate-100 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-40"
              >
                + Ampliar
              </button>
            </div>
          </div>

          {/* Ubicación y Sliders de Posición en la prenda */}
          {onDesignChange && (
            <div className="space-y-2.5 border-b border-slate-100 pb-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-900">Ubicación y Posición</span>
                {designUrl && (designOffsetX !== 0 || designOffsetY !== 0) && (
                  <button
                    type="button"
                    onClick={() => onDesignChange({ offsetX: 0, offsetY: 0 })}
                    className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-200"
                  >
                    Centrar
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    ['back', 'Espalda'],
                    ['center', 'Frente'],
                    ['pocket', 'Logo Izq.']
                  ] as const
                ).map(([id, lbl]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onDesignChange({ placement: id, offsetX: 0, offsetY: 0 })}
                    className={`rounded-xl py-1.5 text-xs font-semibold transition ${
                      placement === id
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>

              {/* Sliders tipo Apple para mover el diseño arriba/abajo e izquierda/derecha */}
              {designUrl && (
                <div className="space-y-2 rounded-2xl bg-slate-50 p-2.5">
                  <div>
                    <div className="flex items-center justify-between text-[11px] font-medium text-slate-600">
                      <span>↕ Altura (Arriba / Abajo)</span>
                      <span>{Math.round(designOffsetY)}</span>
                    </div>
                    <input
                      type="range"
                      min="-20"
                      max="22"
                      step="1"
                      value={designOffsetY}
                      onChange={(e) => onDesignChange({ offsetY: Number(e.target.value) })}
                      className="mt-1 w-full accent-slate-900"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-[11px] font-medium text-slate-600">
                      <span>↔ Lado (Izq. / Der.)</span>
                      <span>{Math.round(designOffsetX)}</span>
                    </div>
                    <input
                      type="range"
                      min="-20"
                      max="20"
                      step="1"
                      value={designOffsetX}
                      onChange={(e) => onDesignChange({ offsetX: Number(e.target.value) })}
                      className="mt-1 w-full accent-slate-900"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Modo de interacción al arrastrar */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-900">Interacción</div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setTouchAction('rotate')}
                className={`rounded-xl py-2 text-xs font-semibold transition ${
                  touchAction === 'rotate'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Girar 3D
              </button>
              <button
                type="button"
                disabled={!designUrl}
                onClick={() => setTouchAction('moveDesign')}
                className={`rounded-xl py-2 text-xs font-semibold transition disabled:opacity-40 ${
                  touchAction === 'moveDesign'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Mover Diseño
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* GALERÍA DE DISEÑOS DEL CATÁLOGO */}
      {(isStoreOwner || (catalogDesigns && catalogDesigns.length > 0)) && (
        <div className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-sm">
          {onUploadCatalogFiles && (
            <input
              ref={catalogBatchInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  const filesArr = Array.from(e.target.files);
                  openUploadDialog({ mode: 'files', files: filesArr });
                }
                e.target.value = '';
              }}
            />
          )}

          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-semibold tracking-tight text-slate-900">
                Diseños ({filteredCatalogDesigns.length})
              </span>
              {campaigns && onChangeActiveCampaign && (
                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onChangeActiveCampaign('all')}
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                      activeCampaign === 'all'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    Todas
                  </button>
                  {campaigns.map((camp) => (
                    <button
                      key={camp}
                      type="button"
                      onClick={() => onChangeActiveCampaign(camp)}
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                        activeCampaign.toLowerCase() === camp.toLowerCase()
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {camp}
                    </button>
                  ))}
                  {isStoreOwner && onAddCampaign && (
                    <button
                      type="button"
                      onClick={onAddCampaign}
                      className="rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:border-slate-500 hover:text-slate-900"
                    >
                      + Campaña
                    </button>
                  )}
                </div>
              )}
            </div>

            {isStoreOwner && (
              <div className="flex flex-wrap items-center gap-1.5">
                {filteredCatalogDesigns.length > 2 && (
                  <div className="inline-flex items-center gap-1 rounded-full bg-slate-100 p-0.5">
                    <button
                      type="button"
                      onClick={() => scrollCarousel(adminCarouselRef, -1)}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-slate-700 hover:bg-white"
                      aria-label="Deslizar a la izquierda"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      onClick={() => scrollCarousel(adminCarouselRef, 1)}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-slate-700 hover:bg-white"
                      aria-label="Deslizar a la derecha"
                    >
                      ›
                    </button>
                  </div>
                )}
                {designUrl && onSaveCurrentToCatalog && (
                  <button
                    type="button"
                    onClick={() => openUploadDialog({ mode: 'current' })}
                    className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700"
                  >
                    + Guardar actual
                  </button>
                )}
                {onUploadCatalogFiles && (
                  <button
                    type="button"
                    onClick={() => catalogBatchInputRef.current?.click()}
                    className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800"
                  >
                    + Subir Diseños (PNG/JPG)
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Barra tipo Slide para recorrer diseños del catálogo */}
          {readySlideDesigns.length > 1 && (
            <div className="mb-3 flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-2">
              <button
                type="button"
                onClick={() => stepCatalogDesign(-1)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold text-slate-700 shadow-sm ring-1 ring-black/5 hover:bg-slate-100"
              >
                ‹
              </button>
              <div className="flex flex-1 flex-col gap-1">
                <div className="flex items-center justify-between text-[11px] font-medium text-slate-600">
                  <span className="truncate font-semibold text-slate-900">
                    {currentSlideIdx >= 0 ? readySlideDesigns[currentSlideIdx].name : 'Desliza para cambiar diseño'}
                  </span>
                  <span>
                    {currentSlideIdx >= 0 ? currentSlideIdx + 1 : 0} / {readySlideDesigns.length}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={readySlideDesigns.length - 1}
                  step={1}
                  value={currentSlideIdx >= 0 ? currentSlideIdx : 0}
                  onChange={(e) => {
                    const idx = Number(e.target.value);
                    const target = readySlideDesigns[idx];
                    if (target && onSelectCatalogDesign) {
                      setShowcaseActive(false);
                      applyCatalogDesignWithColorGuard(target);
                    }
                  }}
                  className="w-full accent-slate-900"
                />
              </div>
              <button
                type="button"
                onClick={() => stepCatalogDesign(1)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold text-slate-700 shadow-sm ring-1 ring-black/5 hover:bg-slate-100"
              >
                ›
              </button>
            </div>
          )}

          {filteredCatalogDesigns.length === 0 ? (
            <div className="flex items-center justify-between gap-2 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3">
              <span className="text-xs text-slate-500">
                {activeCampaign !== 'all'
                  ? `Sin diseños en la campaña "${activeCampaign}"`
                  : 'Sin diseños guardados'}
              </span>
              {onUploadCatalogFiles && (
                <button
                  type="button"
                  onClick={() => catalogBatchInputRef.current?.click()}
                  className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  + Subir diseños
                </button>
              )}
            </div>
          ) : (
            <div
              ref={adminCarouselRef}
              className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-1"
            >
              {filteredCatalogDesigns.map((d) => {
                const isSelected =
                  (activeCatalogDesignId && activeCatalogDesignId === d.id) ||
                  (!!designUrl && !!d.imageUrl && designUrl === d.imageUrl);
                const thumbCompat = isColorCompatibleWithDesign(
                  { id: activeColorId, name: colorName, hex },
                  d
                ).allowed;
                const thumbBg = thumbCompat
                  ? hex
                  : d.allowedColorMode === 'dark_fabrics' ||
                    (!d.allowedColorMode && d.tone === 'light')
                  ? '#1A1A1C'
                  : '#F5F5F7';
                const colorLabel =
                  d.allowedColorMode === 'light_fabrics' || (!d.allowedColorMode && d.tone === 'dark')
                    ? '☀️ Telas claras'
                    : d.allowedColorMode === 'dark_fabrics' || (!d.allowedColorMode && d.tone === 'light')
                    ? '🌙 Telas oscuras'
                    : d.allowedColorMode === 'custom'
                    ? `🎨 ${d.allowedColorIds?.length || 0} color(es)`
                    : '🎨 Todos colores';
                return (
                  <div
                    key={d.id}
                    className={`group relative flex w-[138px] shrink-0 snap-start flex-col justify-between rounded-2xl border p-2 transition ${
                      isSelected
                        ? 'border-slate-900 bg-slate-50 shadow-sm ring-1 ring-slate-900'
                        : d.clientVisible
                        ? 'border-slate-200 bg-white hover:border-slate-300'
                        : 'border-dashed border-slate-200 bg-slate-50/60 opacity-75'
                    }`}
                  >
                    {isStoreOwner && onToggleCatalogDesignFeatured && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleCatalogDesignFeatured(d.id, !d.featured);
                        }}
                        title={
                          d.featured
                            ? 'Quitar de Más vendidos'
                            : 'Destacar al inicio como Más vendido'
                        }
                        className={`absolute left-3 top-3 z-10 flex h-5 items-center gap-0.5 rounded-full px-1.5 text-[9px] font-bold shadow-sm backdrop-blur-md transition ${
                          d.isBestSeller || d.featured
                            ? 'bg-white/95 text-slate-900 ring-1 ring-black/10'
                            : 'bg-black/40 text-white/80 hover:bg-white/90 hover:text-slate-900'
                        }`}
                      >
                        <span className={d.isBestSeller || d.featured ? 'text-amber-500' : ''}>
                          ★
                        </span>
                        {(d.isBestSeller || d.featured) && <span>Más vendido</span>}
                      </button>
                    )}

                    {!onToggleCatalogDesignFeatured && d.isBestSeller && (
                      <span className="absolute left-3 top-3 z-10 inline-flex items-center gap-0.5 rounded-full bg-white/95 px-2 py-0.5 text-[9px] font-bold tracking-tight text-slate-900 shadow-sm ring-1 ring-black/10 backdrop-blur-md">
                        <span className="text-amber-500">★</span> Más vendido
                      </span>
                    )}

                    {isStoreOwner && onDeleteCatalogDesign && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteCatalogDesign(d.id);
                        }}
                        title="Eliminar diseño"
                        className="absolute right-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-white/90 text-[10px] font-bold text-rose-600 shadow-sm hover:bg-rose-600 hover:text-white"
                      >
                        ✕
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setShowcaseActive(false);
                        applyCatalogDesignWithColorGuard(d);
                      }}
                      disabled={!d.imageUrl}
                      className="flex w-full flex-col items-center text-left focus:outline-none"
                    >
                      <div
                        className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border border-black/10 p-2"
                        style={{ backgroundColor: thumbBg }}
                      >
                        {d.imageUrl ? (
                          <img
                            src={d.imageUrl}
                            alt={d.name}
                            className="h-full w-full object-contain drop-shadow-sm"
                            loading="lazy"
                          />
                        ) : (
                          <span className="text-[10px] text-slate-400">Sin imagen</span>
                        )}
                      </div>
                      <div className="mt-1.5 w-full truncate text-center text-xs font-semibold text-slate-900">
                        {d.name}
                      </div>
                    </button>

                    {isStoreOwner && (
                      <div className="mt-1.5 space-y-1">
                        {onChangeDesignColors && (
                          <button
                            type="button"
                            onClick={() => openEditColorsDialog(d)}
                            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-1.5 py-1 text-[10px] font-semibold text-slate-700 transition hover:bg-slate-100"
                            title="Elegir colores disponibles para este diseño"
                          >
                            {colorLabel}
                          </button>
                        )}
                        {campaigns && onChangeDesignCampaign && (
                          <select
                            value={d.campaign || 'all'}
                            onChange={(e) => onChangeDesignCampaign(d.id, e.target.value)}
                            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-1.5 py-1 text-[10px] font-semibold text-slate-700 outline-none"
                            title="Campaña del diseño"
                          >
                            <option value="all">General (Todas)</option>
                            {campaigns.map((camp) => (
                              <option key={camp} value={camp}>
                                {camp}
                              </option>
                            ))}
                          </select>
                        )}
                        <div className="flex items-center gap-1">
                          {onRenameCatalogDesign && (
                            <button
                              type="button"
                              onClick={() => {
                                const nextName = window.prompt('Nombre del diseño:', d.name);
                                if (nextName === null) return;
                                const nextCode = window.prompt('Código del diseño:', d.code || '');
                                if (nextCode === null) return;
                                onRenameCatalogDesign(
                                  d.id,
                                  nextName.trim() || d.name,
                                  nextCode.trim().toUpperCase()
                                );
                              }}
                              className="flex-1 rounded-lg bg-slate-100 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-200"
                            >
                              Editar
                            </button>
                          )}
                          {onToggleCatalogDesignVisible && (
                            <button
                              type="button"
                              onClick={() => onToggleCatalogDesignVisible(d.id, !d.clientVisible)}
                              className={`flex-1 rounded-lg py-1 text-[10px] font-semibold ${
                                d.clientVisible
                                  ? 'bg-emerald-50 text-emerald-800'
                                  : 'bg-slate-100 text-slate-500'
                              }`}
                            >
                              {d.clientVisible ? 'Visible' : 'Oculto'}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {(uploadModalState || editColorsDesign) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
          onClick={() => {
            setUploadModalState(null);
            setEditColorsDesign(null);
          }}
        >
          <div
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-[28px] border border-slate-200 bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold tracking-tight text-slate-900">
                  {editColorsDesign
                    ? `Colores · ${editColorsDesign.name}`
                    : uploadModalState?.mode === 'files'
                    ? 'Subir Diseño · Opciones'
                    : 'Guardar Diseño en Catálogo'}
                </h3>
                <p className="text-xs text-slate-500">
                  {editColorsDesign
                    ? 'Configura en qué colores de camisa luce nítido este diseño'
                    : uploadModalState?.mode === 'files'
                    ? `${uploadModalState.files.length} archivo(s) · elige campaña y tonos compatibles`
                    : 'Elige campaña y colores permitidos para que se vea impecable'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setUploadModalState(null);
                  setEditColorsDesign(null);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600 hover:bg-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              {/* Vista previa + Cálculo automático de Negro / Blanco */}
              {(uploadPreviewUrl || uploadAnalysis || uploadBatchSummary) && (
                <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3">
                  {uploadPreviewUrl && (
                    <div
                      className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-black/10 p-1.5"
                      style={{
                        backgroundColor:
                          uploadColorMode === 'dark_fabrics'
                            ? '#1A1A1C'
                            : uploadColorMode === 'light_fabrics'
                            ? '#FFFFFF'
                            : uploadAnalysis?.tone === 'light'
                            ? '#1A1A1C'
                            : '#F5F5F7'
                      }}
                    >
                      <img
                        src={uploadPreviewUrl}
                        alt="Vista previa"
                        className="h-full w-full object-contain"
                      />
                    </div>
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    {uploadBatchSummary ? (
                      <div className="text-xs font-semibold text-slate-800">
                        Cálculo del lote: 🖤 {uploadBatchSummary.dark} oscuro(s) · 🤍{' '}
                        {uploadBatchSummary.light} claro(s) · 🎨 {uploadBatchSummary.mixed} mixto(s)
                      </div>
                    ) : uploadAnalysis ? (
                      <>
                        <div className="text-xs font-semibold text-slate-900">
                          {uploadAnalysis.tone === 'dark'
                            ? '🖤 Diseño de tinta oscura detectado'
                            : uploadAnalysis.tone === 'light'
                            ? '🤍 Diseño de tinta blanca/clara detectado'
                            : '🎨 Diseño multitono equilibrado'}
                        </div>
                        <div className="text-[11px] text-slate-600">
                          Negro/Oscuro: <b>{uploadAnalysis.darkPercent}%</b> · Blanco/Claro:{' '}
                          <b>{uploadAnalysis.lightPercent}%</b>
                        </div>
                      </>
                    ) : (
                      <div className="text-xs text-slate-500">Calculando contraste negro/blanco…</div>
                    )}
                  </div>
                </div>
              )}

              {/* Nombre del diseño (cuando es 1 archivo o diseño actual al subir) */}
              {!editColorsDesign &&
                ((uploadModalState?.mode === 'files' && uploadModalState.files.length === 1) ||
                  uploadModalState?.mode === 'current') && (
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      Nombre del diseño
                    </label>
                    <input
                      type="text"
                      value={uploadCustomName}
                      onChange={(e) => setUploadCustomName(e.target.value)}
                      placeholder="Ej. Rancho Honduras Dorado"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-900 outline-none focus:border-slate-900 focus:bg-white"
                    />
                  </div>
                )}

              {/* Selector de Campaña (solo al subir/guardar) */}
              {!editColorsDesign && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-700">
                    1 · Campaña del catálogo
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(campaigns && campaigns.length > 0
                      ? campaigns
                      : ['Ranchero', 'Turístico', 'Cristiana']
                    ).map((camp) => {
                      const sel = uploadTargetCampaign.toLowerCase() === camp.toLowerCase();
                      return (
                        <button
                          key={camp}
                          type="button"
                          onClick={() => setUploadTargetCampaign(camp)}
                          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                            sel
                              ? 'bg-slate-900 text-white shadow-sm'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          {camp}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => setUploadTargetCampaign('all')}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                        uploadTargetCampaign === 'all'
                          ? 'bg-slate-900 text-white shadow-sm'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      Todas (General)
                    </button>
                    {onAddCampaign && (
                      <button
                        type="button"
                        onClick={onAddCampaign}
                        className="rounded-full border border-dashed border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-500 hover:text-slate-900"
                      >
                        + Nueva
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Colores disponibles para este diseño */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-700">
                  {editColorsDesign
                    ? 'Colores de camisa disponibles para este diseño'
                    : '2 · Colores de camisa disponibles'}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {uploadModalState?.mode === 'files' && uploadModalState.files.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setUploadColorMode('auto')}
                      className={`col-span-2 rounded-xl border px-3 py-2 text-left text-xs font-semibold transition ${
                        uploadColorMode === 'auto'
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      ✨ Automático por archivo (calcula negro/blanco individual)
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setUploadColorMode('light_fabrics');
                      if (colorOptions) {
                        setUploadCustomColorIds(
                          colorOptions.filter((c) => !isDarkFabricColor(c.hex)).map((c) => c.id)
                        );
                      }
                    }}
                    className={`rounded-xl border px-3 py-2 text-left text-xs font-semibold transition ${
                      uploadColorMode === 'light_fabrics'
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    ☀️ Solo telas claras
                    <div className="text-[10px] font-normal opacity-80">Bloquea negro y oscuros</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUploadColorMode('dark_fabrics');
                      if (colorOptions) {
                        setUploadCustomColorIds(
                          colorOptions.filter((c) => isDarkFabricColor(c.hex)).map((c) => c.id)
                        );
                      }
                    }}
                    className={`rounded-xl border px-3 py-2 text-left text-xs font-semibold transition ${
                      uploadColorMode === 'dark_fabrics'
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    🌙 Solo telas oscuras
                    <div className="text-[10px] font-normal opacity-80">Bloquea blanco y claras</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUploadColorMode('all');
                      if (colorOptions) {
                        setUploadCustomColorIds(colorOptions.map((c) => c.id));
                      }
                    }}
                    className={`rounded-xl border px-3 py-2 text-left text-xs font-semibold transition ${
                      uploadColorMode === 'all'
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    🎨 Todos los colores
                    <div className="text-[10px] font-normal opacity-80">Sin restricción</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setUploadColorMode('custom')}
                    className={`rounded-xl border px-3 py-2 text-left text-xs font-semibold transition ${
                      uploadColorMode === 'custom'
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    ✓ Elegir específicos
                    <div className="text-[10px] font-normal opacity-80">Toca cada color abajo</div>
                  </button>
                </div>

                {colorOptions && colorOptions.length > 0 && uploadColorMode !== 'auto' && (
                  <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-2.5">
                    <div className="mb-1.5 text-[11px] font-medium text-slate-500">
                      {uploadColorMode === 'custom'
                        ? 'Toca los colores donde SÍ se puede usar este diseño:'
                        : 'Vista de colores habilitados:'}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {colorOptions.map((c) => {
                        const checked =
                          uploadColorMode === 'all'
                            ? true
                            : uploadColorMode === 'light_fabrics'
                            ? !isDarkFabricColor(c.hex)
                            : uploadColorMode === 'dark_fabrics'
                            ? isDarkFabricColor(c.hex)
                            : uploadCustomColorIds.includes(c.id);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setUploadColorMode('custom');
                              setUploadCustomColorIds((prev) =>
                                prev.includes(c.id)
                                  ? prev.filter((id) => id !== c.id)
                                  : [...prev, c.id]
                              );
                            }}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                              checked
                                ? 'border-slate-900 bg-white text-slate-900 shadow-sm'
                                : 'border-slate-200 bg-slate-100 text-slate-400 opacity-60 line-through'
                            }`}
                          >
                            <span
                              className="h-3 w-3 rounded-full border border-black/20"
                              style={{ backgroundColor: c.hex }}
                            />
                            <span>{c.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {!editColorsDesign && (
                <div className="rounded-2xl bg-emerald-50/80 px-3.5 py-2.5 text-xs font-medium text-emerald-900">
                  ✓ Se publicará como <b>Visible al cliente</b> en{' '}
                  <b>{uploadTargetCampaign === 'all' ? 'General (Todas)' : uploadTargetCampaign}</b>.
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setUploadModalState(null);
                    setEditColorsDesign(null);
                  }}
                  className="rounded-full bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (editColorsDesign) {
                      const finalMode: AllowedColorMode =
                        uploadColorMode === 'auto'
                          ? uploadAnalysis?.suggestedColorMode || 'all'
                          : uploadColorMode;
                      onChangeDesignColors?.(
                        editColorsDesign.id,
                        finalMode,
                        finalMode === 'custom' ? uploadCustomColorIds : undefined,
                        uploadAnalysis?.tone || editColorsDesign.tone
                      );
                      setEditColorsDesign(null);
                      return;
                    }
                    const camp = uploadTargetCampaign;
                    const st = uploadModalState;
                    setUploadModalState(null);
                    if (!st) return;
                    if (st.mode === 'files') {
                      onUploadCatalogFiles?.(st.files, {
                        campaign: camp,
                        customName: uploadCustomName.trim() || undefined,
                        allowedColorMode: uploadColorMode,
                        allowedColorIds:
                          uploadColorMode === 'custom' ? uploadCustomColorIds : undefined
                      });
                    } else {
                      const finalMode: AllowedColorMode =
                        uploadColorMode === 'auto'
                          ? uploadAnalysis?.suggestedColorMode || 'all'
                          : uploadColorMode;
                      onSaveCurrentToCatalog?.({
                        campaign: camp,
                        name: uploadCustomName.trim() || undefined,
                        allowedColorMode: finalMode,
                        allowedColorIds:
                          finalMode === 'custom' ? uploadCustomColorIds : undefined,
                        tone: uploadAnalysis?.tone
                      });
                    }
                  }}
                  className="rounded-full bg-slate-900 px-5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800"
                >
                  {editColorsDesign ? 'Guardar colores' : 'Subir y Hacer Visible'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <WesternDesignModal
        isOpen={isWesternModalOpen}
        onClose={() => setIsWesternModalOpen(false)}
        onApply={handleApplyWesternDesign}
        initialPlacement={placement === 'back' ? 'back' : 'center'}
      />
    </div>
  );
}

/* ============================================================================
 * LIENZO WEBGL 3D QUE RENDERIZA EL MODELO ESCANEADO REAL (shirt_baked.glb)
 * ========================================================================== */

function WebGLShirtCanvas({
  hex,
  designUrl,
  placement = 'center',
  designScale = 1,
  designOffsetX = 0,
  designOffsetY = 0,
  zoom = 1,
  onZoomChange,
  autoMotion = true,
  mode = 'wind',
  targetAngleY = null,
  touchAction = 'rotate',
  compact = false,
  onMoveDesign
}: {
  hex: string;
  designUrl: string | null;
  placement?: DecalPlacement;
  designScale?: number;
  designOffsetX?: number;
  designOffsetY?: number;
  zoom?: number;
  onZoomChange?: (nextZoom: number) => void;
  autoMotion?: boolean;
  mode?: MotionMode;
  targetAngleY?: number | null;
  touchAction?: 'rotate' | 'moveDesign';
  compact?: boolean;
  onMoveDesign?: (dx: number, dy: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const stateRef = useRef({
    hex,
    placement,
    designScale,
    designOffsetX,
    designOffsetY,
    zoom,
    onZoomChange,
    autoMotion,
    mode,
    touchAction,
    onMoveDesign,
    hasDecal: false,
    hasNormalMap: false,
    hasAoMap: false,
    decalAspect: 1,
    indexCount: 0
  });
  stateRef.current = {
    hex,
    placement,
    designScale,
    designOffsetX,
    designOffsetY,
    zoom,
    onZoomChange,
    autoMotion,
    mode,
    touchAction,
    onMoveDesign,
    hasDecal: stateRef.current.hasDecal,
    hasNormalMap: stateRef.current.hasNormalMap,
    hasAoMap: stateRef.current.hasAoMap,
    decalAspect: stateRef.current.decalAspect,
    indexCount: stateRef.current.indexCount
  };

  const initialRgb = hexToRgbNorm(hex);
  const rotRef = useRef({
    rx: 5,
    ry: -14,
    vx: 0,
    vy: 0,
    baseRy: 0,
    smoothZoom: zoom,
    smoothScale: designScale,
    smoothOffsetX: designOffsetX,
    smoothOffsetY: designOffsetY,
    decalPop: 1,
    decalPopVel: 0,
    smoothR: initialRgb[0],
    smoothG: initialRgb[1],
    smoothB: initialRgb[2],
    dragging: false,
    lastX: 0,
    lastY: 0,
    lastTime: performance.now()
  });

  useEffect(() => {
    if (targetAngleY !== null && targetAngleY !== undefined) {
      rotRef.current.baseRy = targetAngleY;
    }
  }, [targetAngleY]);

  const glRef = useRef<{
    gl: WebGLRenderingContext;
    decalTex: WebGLTexture | null;
  } | null>(null);

  // Actualizar textura del diseño (Decal) cuando cambia designUrl con efecto elástico (Spring Pop-in)
  useEffect(() => {
    const ctx = glRef.current;
    if (!ctx) return;
    const { gl, decalTex } = ctx;
    if (!designUrl || !decalTex) {
      stateRef.current.hasDecal = false;
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      stateRef.current.decalAspect = uploadDecalTexture(gl, decalTex, img);
      stateRef.current.hasDecal = true;
      // Impulso elástico al estampar el diseño sobre la prenda 3D
      rotRef.current.decalPop = 0.58;
      rotRef.current.decalPopVel = 0.09;
      rotRef.current.vy = 3.8;
      rotRef.current.vx = -1.4;
    };
    img.src = designUrl;
  }, [designUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = (canvas.getContext('webgl', { antialias: true, alpha: true }) ||
      canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return;

    const prog = compileProgram(gl);
    if (!prog) return;
    gl.useProgram(prog);

    const posBuf = gl.createBuffer();
    const normBuf = gl.createBuffer();
    const uvBuf = gl.createBuffer();
    const idxBuf = gl.createBuffer();

    // Textura 0: Diseño del usuario (Decal)
    const decalTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, decalTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 0])
    );

    // Textura 1: Normal Map de algodón real (1024x1024 de shirt_baked.glb)
    const normalTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, normalTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([128, 128, 255, 255])
    );

    // Textura 2: Ambient Occlusion Map real (1024x1024 de shirt_baked.glb)
    const aoTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, aoTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255])
    );

    glRef.current = { gl, decalTex };

    // Si ya había un diseño al montar, cargarlo en TEXTURE0
    if (designUrl && decalTex) {
      const img = new Image();
      img.onload = () => {
        stateRef.current.decalAspect = uploadDecalTexture(gl, decalTex, img);
        stateRef.current.hasDecal = true;
      };
      img.src = designUrl;
    }

    let disposed = false;

    // Cargar el modelo 3D real shirt_baked.glb y sus texturas horneadas
    void loadRealShirtGLB().then((glbData) => {
      if (disposed) return;

      const bindAttr = (buf: WebGLBuffer | null, data: Float32Array, name: string, size: number) => {
        const loc = gl.getAttribLocation(prog, name);
        if (loc < 0) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      };

      bindAttr(posBuf, glbData.positions, 'a_pos', 3);
      bindAttr(normBuf, glbData.normals, 'a_norm', 3);
      bindAttr(uvBuf, glbData.uvs, 'a_uv', 2);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, glbData.indices, gl.STATIC_DRAW);
      stateRef.current.indexCount = glbData.indices.length;

      if (glbData.normalImg && normalTex) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, normalTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, glbData.normalImg);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        stateRef.current.hasNormalMap = true;
      }

      if (glbData.aoImg && aoTex) {
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, aoTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, glbData.aoImg);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        stateRef.current.hasAoMap = true;
      }
    });

    const uProj = gl.getUniformLocation(prog, 'u_proj');
    const uView = gl.getUniformLocation(prog, 'u_view');
    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uMode = gl.getUniformLocation(prog, 'u_mode');
    const uMotionActive = gl.getUniformLocation(prog, 'u_motionActive');
    const uBaseColor = gl.getUniformLocation(prog, 'u_baseColor');
    const uDecalTex = gl.getUniformLocation(prog, 'u_decalTex');
    const uNormalMap = gl.getUniformLocation(prog, 'u_normalMap');
    const uAoMap = gl.getUniformLocation(prog, 'u_aoMap');
    const uHasDecal = gl.getUniformLocation(prog, 'u_hasDecal');
    const uHasNormalMap = gl.getUniformLocation(prog, 'u_hasNormalMap');
    const uHasAoMap = gl.getUniformLocation(prog, 'u_hasAoMap');
    const uDecalOnBack = gl.getUniformLocation(prog, 'u_decalOnBack');
    const uDecalRect = gl.getUniformLocation(prog, 'u_decalRect');

    gl.uniform1i(uDecalTex, 0);
    gl.uniform1i(uNormalMap, 1);
    gl.uniform1i(uAoMap, 2);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    let raf = 0;
    const t0 = performance.now();

    const render = (now: number) => {
      const elapsed = (now - t0) / 1000;
      const st = stateRef.current;
      const r = rotRef.current;

      const dt = Math.min(0.05, Math.max(0.001, (now - r.lastTime) / 1000));
      r.lastTime = now;
      const damp = (cur: number, target: number, lambda: number) =>
        cur + (target - cur) * (1 - Math.exp(-lambda * dt));

      // Interpolación suave e independiente de FPS de Zoom, Escala y Posición del diseño
      r.smoothZoom = damp(r.smoothZoom, st.zoom, 14);
      r.smoothScale = damp(r.smoothScale, st.designScale, 18);
      r.smoothOffsetX = damp(r.smoothOffsetX, st.designOffsetX, 22);
      r.smoothOffsetY = damp(r.smoothOffsetY, st.designOffsetY, 22);

      // Resorte elástico del diseño (Spring Pop-in tipo Apple)
      const springForce = (1.0 - r.decalPop) * 0.22;
      r.decalPopVel = (r.decalPopVel + springForce) * 0.76;
      r.decalPop = clamp(r.decalPop + r.decalPopVel, 0.35, 1.18);

      // Transición suave de color RGB sobre las fibras de algodón
      const [targetR, targetG, targetB] = hexToRgbNorm(st.hex);
      r.smoothR = damp(r.smoothR, targetR, 12);
      r.smoothG = damp(r.smoothG, targetG, 12);
      r.smoothB = damp(r.smoothB, targetB, 12);

      if (!r.dragging) {
        if (st.autoMotion) {
          if (st.mode === 'orbit') {
            r.ry = (r.ry + 0.55) % 360;
          } else if (st.mode === 'walk') {
            const target = r.baseRy + Math.sin(elapsed * 2.2) * 10;
            r.ry = damp(r.ry, target, 10) + r.vy;
            r.rx = damp(r.rx, 4 + Math.abs(Math.cos(elapsed * 2.2)) * 3, 10) + r.vx;
          } else {
            // Balanceo sutil y refinado estilo vitrina Apple
            const target = r.baseRy + Math.sin(elapsed * 0.75) * 6.5;
            r.ry = damp(r.ry, target, 9) + r.vy;
            r.rx = damp(r.rx, 4.5 + Math.cos(elapsed * 0.6) * 2.2, 9) + r.vx;
          }
          r.vx *= 0.85;
          r.vy *= 0.85;
        } else {
          // Incluso con autoMotion en pausa, girar suavemente hacia Frente/Perfil/Espalda
          r.ry = damp(r.ry, r.baseRy, 14) + r.vy;
          r.rx = clamp(r.rx + r.vx, -28, 32);
          r.vx *= 0.88;
          r.vy *= 0.88;
        }
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = Math.max(240, Math.round((canvas.clientWidth || 360) * dpr));
      const ch = Math.max(240, Math.round((canvas.clientHeight || 360) * dpr));
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      if (st.indexCount > 0) {
        const proj = createMat4Perspective(
          (32 * Math.PI) / 180,
          canvas.width / Math.max(1, canvas.height),
          0.1,
          20.0
        );
        // Al hacer zoom (> 1), la cámara se acerca desde -3.05 hasta -1.30 y encuadra la zona del pecho
        const camZ = -3.05 / clamp(r.smoothZoom, 0.85, 2.35);
        const zoomFocusY = r.smoothZoom > 1.05 ? -(r.smoothZoom - 1.0) * 0.14 : 0;
        const bounceY =
          st.autoMotion && st.mode === 'walk'
            ? Math.abs(Math.sin(elapsed * 2.2)) * 0.02 - 0.01
            : st.autoMotion
            ? Math.sin(elapsed * 1.2) * 0.01
            : 0;

        const view = createMat4ModelView(r.rx, r.ry, camZ, bounceY + zoomFocusY);

        gl.uniformMatrix4fv(uProj, false, proj);
        gl.uniformMatrix4fv(uView, false, view);
        gl.uniform1f(uTime, elapsed);
        gl.uniform1f(uMode, st.mode === 'walk' ? 1.0 : st.mode === 'orbit' ? 2.0 : 0.0);
        gl.uniform1f(uMotionActive, st.autoMotion ? 1.0 : 0.0);

        gl.uniform3f(uBaseColor, r.smoothR, r.smoothG, r.smoothB);

        gl.uniform1i(uHasDecal, st.hasDecal ? 1 : 0);
        gl.uniform1i(uHasNormalMap, st.hasNormalMap ? 1 : 0);
        gl.uniform1i(uHasAoMap, st.hasAoMap ? 1 : 0);
        gl.uniform1i(uDecalOnBack, st.placement === 'back' ? 1 : 0);

        const effectiveScale = clamp(r.smoothScale * r.decalPop, 0.25, 4.15);
        const rect = computeDecalRect3D(
          st.placement,
          effectiveScale,
          r.smoothOffsetX,
          r.smoothOffsetY,
          st.decalAspect
        );
        gl.uniform4f(uDecalRect, rect[0], rect[1], rect[2], rect[3]);

        gl.drawElements(gl.TRIANGLES, st.indexCount, gl.UNSIGNED_SHORT, 0);
      }

      raf = requestAnimationFrame(render);
    };

    const onWheelNative = (e: WheelEvent) => {
      if (!stateRef.current.onZoomChange) return;
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY < 0 ? 0.14 : -0.14;
      const next = clamp(Math.round((stateRef.current.zoom + delta) * 100) / 100, 0.85, 2.35);
      stateRef.current.onZoomChange(next);
    };

    canvas.addEventListener('wheel', onWheelNative, { passive: false });

    raf = requestAnimationFrame(render);
    return () => {
      disposed = true;
      canvas.removeEventListener('wheel', onWheelNative);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const res = compact ? 320 : 680;

  return (
    <canvas
      ref={canvasRef}
      width={res}
      height={res}
      className="h-full w-full cursor-grab touch-none overscroll-none drop-shadow-xl active:cursor-grabbing"
      onPointerDown={(e: any) => {
        const r = rotRef.current;
        r.dragging = true;
        r.lastX = e.clientX;
        r.lastY = e.clientY;
        r.vx = 0;
        r.vy = 0;
        if (e.currentTarget?.setPointerCapture) {
          e.currentTarget.setPointerCapture(e.pointerId);
        }
      }}
      onPointerMove={(e: any) => {
        const r = rotRef.current;
        if (!r.dragging) return;
        const dx = e.clientX - r.lastX;
        const dy = e.clientY - r.lastY;
        r.lastX = e.clientX;
        r.lastY = e.clientY;

        if (stateRef.current.touchAction === 'moveDesign' && stateRef.current.onMoveDesign) {
          stateRef.current.onMoveDesign(dx * 0.14, dy * 0.14);
        } else {
          r.ry += dx * 0.55;
          r.baseRy = r.ry;
          r.rx = clamp(r.rx + dy * 0.35, -28, 32);
          r.vy = dx * 0.18;
          r.vx = dy * 0.12;
        }
      }}
      onPointerUp={() => {
        rotRef.current.dragging = false;
      }}
      onPointerCancel={() => {
        rotRef.current.dragging = false;
      }}
    />
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
