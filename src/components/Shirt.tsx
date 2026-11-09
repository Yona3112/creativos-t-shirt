import { useEffect, useRef, useState } from 'react';
import { contrastText } from '../lib/inventory';
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

  // 3. Proyección 3D del diseño / logo sobre el pecho o la espalda (usando normal pura sin corte Z en el centro)
  if (u_hasDecal == 1 && !interior) {
    bool isBackTarget = (u_decalOnBack == 1);
    float sideNz = isBackTarget ? -v_objNorm.z : v_objNorm.z;

    // Solo proyectar en la cara frontal o trasera del torso según su normal 3D (permitiendo tamaño A3 completo)
    if (sideNz > 0.05 && abs(v_objPos.x) < 0.49) {
      float sideX = isBackTarget ? -v_objPos.x : v_objPos.x;
      float du = (sideX - u_decalRect.x) / u_decalRect.z + 0.5;
      float dv = (u_decalRect.y - v_objPos.y) / u_decalRect.w + 0.5;

      if (du >= 0.0 && du <= 1.0 && dv >= 0.0 && dv <= 1.0) {
        vec4 tex = texture2D(u_decalTex, vec2(du, dv));
        float angleFade = smoothstep(0.05, 0.22, sideNz);
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

function computeDecalRect3D(
  placement: DecalPlacement,
  scale: number,
  offsetX: number,
  offsetY: number,
  aspect: number
): [number, number, number, number] {
  const s = clamp(scale, 0.30, 4.00);
  let baseX = 0.0;
  let baseY = 0.12;
  // Escala calibrada: A3 (~200% / 2.0) y A4 (~160% / 1.6) ajustados anatómicamente al torso
  let widthX = 0.32 * s;

  if (placement === 'pocket') {
    baseX = 0.165;
    baseY = 0.25;
    widthX = 0.11 * s;
  } else if (placement === 'full') {
    baseX = 0.0;
    baseY = 0.11;
    widthX = 0.33 * s;
  } else if (placement === 'back') {
    baseX = 0.0;
    baseY = 0.12;
    widthX = 0.32 * s;
  }

  const heightY = widthX / Math.max(0.25, aspect);
  const centerX = clamp(baseX + offsetX * 0.012, -0.34, 0.34);
  const centerY = clamp(baseY - offsetY * 0.015, -0.52, 0.40);
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
  photoId: string;
  imageUrl: string | null;
  placement: DecalPlacement;
  clientVisible: boolean;
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
  brandName,
  designUrl,
  placement = 'center',
  designScale = 2.0,
  designOffsetX = 0,
  designOffsetY = 2,
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
  onDeleteCatalogDesign,
  onRenameCatalogDesign,
  boutiqueTheme = 'ranchero',
  onChangeBoutiqueTheme,
  autoMotion = true,
  stockBadge
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
  onSaveCurrentToCatalog?: () => void;
  onUploadCatalogFiles?: (files: FileList) => void;
  onToggleCatalogDesignVisible?: (designId: string, nextVisible: boolean) => void;
  onDeleteCatalogDesign?: (designId: string) => void;
  onRenameCatalogDesign?: (designId: string, name: string, code: string) => void;
  boutiqueTheme?: BoutiqueTheme;
  onChangeBoutiqueTheme?: (theme: BoutiqueTheme) => void;
  autoMotion?: boolean;
  stockBadge?: { available: boolean; text: string } | null;
}) {
  const [mode, setMode] = useState<MotionMode>('wind');
  const [touchAction, setTouchAction] = useState<'rotate' | 'moveDesign'>('rotate');
  const [targetAngleY, setTargetAngleY] = useState<number | null>(placement === 'back' ? 180 : 0);
  const [zoom, setZoom] = useState<number>(1);
  const [showcaseActive, setShowcaseActive] = useState<boolean>(false);
  const [localTheme, setLocalTheme] = useState<BoutiqueTheme>(boutiqueTheme);
  const activeTheme = onChangeBoutiqueTheme || !isStoreOwner ? boutiqueTheme : localTheme;
  const setTheme = (t: BoutiqueTheme) => {
    setLocalTheme(t);
    onChangeBoutiqueTheme?.(t);
  };
  const themeStyle = BOUTIQUE_THEMES[activeTheme] || BOUTIQUE_THEMES.ranchero;
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const catalogBatchInputRef = useRef<HTMLInputElement>(null);
  const colorSlideRef = useRef<HTMLDivElement>(null);
  const [isWesternModalOpen, setIsWesternModalOpen] = useState(false);

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

  const slideColors = (dir: -1 | 1) => {
    const el = colorSlideRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * 135, behavior: 'smooth' });
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
      onSelectCatalogDesign(readyDesigns[nextIdx]);
    }, 3200);

    return () => window.clearInterval(timer);
  }, [showcaseActive, catalogDesigns, activeCatalogDesignId, designUrl, onSelectCatalogDesign]);

  const adjustScale = (delta: number) => {
    const next = clamp(Math.round((designScale + delta) * 100) / 100, 0.30, 3.00);
    onDesignChange?.({ scale: next });
  };

  const adjustZoom = (delta: number) => {
    setZoom((z) => clamp(Math.round((z + delta) * 100) / 100, 0.85, 2.35));
  };

  if (!isStoreOwner) {
    const isBackSide = placement === 'back';
    return (
      <div className="relative select-none space-y-3">
        {/* BARRA SUPERIOR DE AMBIENTE + VISTA 3D */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-[#141519]/95 px-3 py-2 text-white shadow-md backdrop-blur-md">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#C8A876]">
            Vista de la camisa 3D
          </span>

          <div className="flex items-center gap-1">
            {(
              [
                [180, '🔄 Ver Espalda'],
                [0, '👕 Ver Frente'],
                [38, '📐 Perfil']
              ] as const
            ).map(([angle, lbl]) => (
              <button
                key={lbl}
                type="button"
                onClick={() => setTargetAngleY(angle)}
                className={`rounded-xl px-2.5 py-1 text-xs font-extrabold transition ${
                  targetAngleY === angle
                    ? 'bg-[#C8A876] text-[#0E0F12] shadow-sm'
                    : 'bg-white/[0.06] text-white/80 hover:bg-white/[0.12]'
                }`}
              >
                {lbl}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setZoom((z) => (z > 1.35 ? 1 : 1.75))}
              className={`rounded-xl px-2.5 py-1 text-xs font-extrabold transition ${
                zoom > 1.35
                  ? 'bg-sky-400 text-slate-950'
                  : 'bg-white/[0.06] text-white/80 hover:bg-white/[0.12]'
              }`}
            >
              {zoom > 1.35 ? '🔭 Alejar' : '🔍 Zoom'}
            </button>
          </div>
        </div>

        {/* ESCENARIO SHOWROOM DEL CLIENTE */}
        <div className={`relative overflow-hidden rounded-3xl p-4 shadow-2xl transition-colors duration-500 ${themeStyle.stageClass}`}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1 text-[11px] font-extrabold text-[#E8D5B5] ring-1 ring-white/10 backdrop-blur-sm">
              👕 {brandName || 'Camisa'} · Vista 360°
            </span>
            {stockBadge && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-extrabold shadow-sm ${
                  stockBadge.available
                    ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/40'
                    : 'bg-[#C8A876]/15 text-[#E8D5B5] ring-1 ring-[#C8A876]/40'
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    stockBadge.available ? 'bg-emerald-400 animate-pulse' : 'bg-[#C8A876]'
                  }`}
                />
                {stockBadge.text}
              </span>
            )}
          </div>

          {/* AVISO CLARO DE QUÉ LADO DE LA CAMISA ESTÁ VIENDO Y DÓNDE VA EL DISEÑO */}
          <div className="mb-1 flex flex-wrap items-center justify-center gap-2">
            <span className="rounded-xl bg-black/50 px-3 py-1 text-xs font-extrabold text-white ring-1 ring-white/10">
              👁 Viendo ahora:{' '}
              <strong className="text-[#E8D5B5]">
                {targetAngleY === 180
                  ? 'ESPALDA (Parte de Atrás)'
                  : targetAngleY === 0
                  ? 'FRENTE (Parte Delantera)'
                  : 'PERFIL 3D'}
              </strong>
            </span>
            {designUrl ? (
              <span
                className={`rounded-xl px-3 py-1 text-xs font-extrabold shadow-sm ring-1 ${
                  isBackSide
                    ? 'bg-[#C8A876] text-[#0E0F12] ring-[#E8D5B5]'
                    : 'bg-sky-400 text-slate-950 ring-sky-200'
                }`}
              >
                📍 Diseño en: {isBackSide ? 'ESPALDA (Atrás)' : 'FRENTE (Pecho)'}
              </span>
            ) : (
              <span className="rounded-xl bg-white/[0.08] px-3 py-1 text-xs font-bold text-white/80 ring-1 ring-white/10">
                👕 Camisa Lisa (Sin diseño seleccionado)
              </span>
            )}
          </div>

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

          {/* CONTROLES CLAROS PARA EL CLIENTE: CAMBIAR ENTRE ESPALDA Y FRENTE O QUITAR EL DISEÑO */}
          {designUrl && (
            <div className="mt-2 rounded-2xl border border-white/10 bg-black/50 p-2.5 backdrop-blur-md">
              <div className="mb-1.5 text-center text-[11px] font-extrabold uppercase tracking-wider text-[#C8A876]">
                📍 ¿En qué lado de la camisa quieres este diseño?
              </div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => {
                    onDesignChange?.({ placement: 'back', offsetX: 0, offsetY: 2 });
                    setTargetAngleY(180);
                  }}
                  className={`flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-extrabold transition ${
                    isBackSide
                      ? 'bg-[#C8A876] text-[#0E0F12] shadow-md ring-2 ring-[#C8A876]/40'
                      : 'bg-white/[0.08] text-white hover:bg-white/[0.15]'
                  }`}
                >
                  <span>🔄</span>
                  <span>En la ESPALDA (Atrás) {isBackSide ? '✓' : ''}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onDesignChange?.({ placement: 'center', offsetX: 0, offsetY: 2 });
                    setTargetAngleY(0);
                  }}
                  className={`flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-extrabold transition ${
                    !isBackSide
                      ? 'bg-sky-400 text-slate-950 shadow-md ring-2 ring-sky-200'
                      : 'bg-white/[0.08] text-white hover:bg-white/[0.15]'
                  }`}
                >
                  <span>👕</span>
                  <span>En el FRENTE (Pecho) {!isBackSide ? '✓' : ''}</span>
                </button>
                {onClearDesign && (
                  <button
                    type="button"
                    onClick={onClearDesign}
                    className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-rose-400/40 bg-rose-500/15 px-3 py-1.5 text-xs font-extrabold text-rose-200 transition hover:bg-rose-500 hover:text-white"
                  >
                    <span>🚫</span>
                    <span>Quitar Diseño</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* SLIDE DE COLORES DENTRO DEL ESCAPARATE */}
          {colorOptions && colorOptions.length > 0 && onSelectColor && (
            <div className="mt-3 rounded-2xl border border-slate-200/90 bg-white/95 p-2.5 shadow-sm backdrop-blur-md">
              <div className="mb-1.5 flex items-center justify-between text-[11px] font-extrabold uppercase tracking-wider text-slate-700">
                <span>🎨 1. Elige el Color de tu Camisa</span>
                <span className="font-black text-slate-900">{colorName}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {colorOptions.length > 3 && (
                  <button
                    type="button"
                    onClick={() => slideColors(-1)}
                    className="flex h-8 w-6 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-sm font-extrabold text-slate-700 hover:bg-slate-200"
                    aria-label="Anterior color"
                  >
                    ‹
                  </button>
                )}
                <div
                  ref={colorSlideRef}
                  className="flex flex-1 snap-x snap-mandatory items-center gap-2 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  {colorOptions.map((c) => {
                    const active = activeColorId ? c.id === activeColorId : c.name === colorName;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => onSelectColor(c.id)}
                        className={`flex shrink-0 snap-start items-center gap-2 rounded-full border px-3 py-1.5 text-left text-xs font-extrabold transition ${
                          active
                            ? 'scale-105 border-slate-900 bg-slate-900 text-white shadow-md ring-2 ring-slate-900/30'
                            : 'border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100'
                        }`}
                      >
                        <span
                          className="relative h-5 w-5 shrink-0 rounded-full border border-black/25 shadow-inner"
                          style={{ backgroundColor: c.hex }}
                        />
                        <div className="leading-none">
                          <div>{c.name}</div>
                          {c.stockText && (
                            <div
                              className={`mt-0.5 text-[10px] font-bold ${
                                active
                                  ? c.available
                                    ? 'text-emerald-300'
                                    : 'text-amber-300'
                                  : c.available
                                  ? 'text-emerald-600'
                                  : 'text-amber-600'
                              }`}
                            >
                              {c.stockText}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
                {colorOptions.length > 3 && (
                  <button
                    type="button"
                    onClick={() => slideColors(1)}
                    className="flex h-8 w-6 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-sm font-extrabold text-slate-700 hover:bg-slate-200"
                    aria-label="Siguiente color"
                  >
                    ›
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* GALERÍA DE DISEÑOS DISPONIBLES PARA EL CLIENTE */}
        {catalogDesigns && catalogDesigns.length > 0 && (
          <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-sm">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-brand-50 border border-brand-200 px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wide text-brand-700">
                  ✨ Paso 2
                </span>
                <div>
                  <span className="text-sm font-extrabold text-slate-900">
                    Elige tu Diseño (Tamaño A3 o A4)
                  </span>
                  <span className="block text-[11px] font-medium text-slate-500">
                    Toca un diseño del catálogo o escribe tu texto western (Personalizada · L 350.00)
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setIsWesternModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-black text-amber-900 shadow-sm transition hover:bg-amber-100 active:scale-95"
                  title="Crear texto estilo Western (Ranchero) o Logo Oficial"
                >
                  <span>🤠 Texto Western / Logo</span>
                </button>
                {designUrl && onClearDesign && (
                  <button
                    type="button"
                    onClick={onClearDesign}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-extrabold text-slate-700 transition hover:bg-slate-100"
                  >
                    👕 L 300.00
                  </button>
                )}
                {catalogDesigns.length >= 2 && (
                  <button
                    type="button"
                    onClick={() => setShowcaseActive((v) => !v)}
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-extrabold transition active:scale-95 ${
                      showcaseActive
                        ? 'bg-brand-600 text-white shadow ring-2 ring-brand-500/50'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    <span>{showcaseActive ? '⏸ Pausar Desfile' : '🎬 Desfile Automático'}</span>
                  </button>
                )}
              </div>
            </div>

            <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 pt-1 sm:flex-wrap sm:overflow-visible">
              {catalogDesigns.map((d, idx) => {
                const isSelected =
                  (activeCatalogDesignId && activeCatalogDesignId === d.id) ||
                  (!!designUrl && !!d.imageUrl && designUrl === d.imageUrl);
                return (
                  <button
                    key={d.id}
                    type="button"
                    style={{ animationDelay: `${(idx % 6) * 160}ms` }}
                    onClick={() => {
                      setShowcaseActive(false);
                      if (isSelected && onClearDesign) {
                        onClearDesign();
                        return;
                      }
                      onSelectCatalogDesign?.(d);
                    }}
                    disabled={!d.imageUrl}
                    className={`catalog-card-motion group relative flex w-[124px] shrink-0 snap-start flex-col rounded-2xl border p-2 text-left transition ${
                      isSelected
                        ? 'border-brand-600 bg-brand-50/70 shadow-md ring-2 ring-brand-500'
                        : 'border-slate-200 bg-slate-50 hover:border-slate-400 hover:bg-slate-100'
                    }`}
                  >
                    <div
                      className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-inner transition duration-300 group-hover:scale-[1.03]"
                      style={{ backgroundColor: hex }}
                    >
                      {d.imageUrl ? (
                        <img
                          src={d.imageUrl}
                          alt={d.name}
                          className="h-full w-full object-contain drop-shadow-md transition-transform duration-300 group-hover:scale-110"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center gap-1 p-2 text-center">
                          <svg className="h-6 w-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <span className="text-[9px] font-bold text-slate-400">Sin foto</span>
                        </div>
                      )}
                      <span className="absolute bottom-1 left-1 rounded-md bg-slate-900/80 px-1.5 py-0.5 text-[9px] font-extrabold text-white">
                        {isSelected
                          ? isBackSide
                            ? 'En Espalda'
                            : 'En Frente'
                          : 'Espalda A3'}
                      </span>
                      {isSelected && (
                        <span className="absolute left-1 top-1 rounded-md bg-brand-600 px-1.5 py-0.5 text-[9px] font-black text-white shadow">
                          ✓ Puesto
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 w-full truncate text-center text-xs font-extrabold text-slate-900">
                      {d.name}
                    </div>
                    <div className="mt-0.5 w-full text-center text-[10px] font-bold text-slate-500">
                      {isSelected ? 'Toca para quitar' : 'Probar en Espalda'}
                    </div>
                  </button>
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
    <div className="relative select-none">
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

      {/* Cabecera compacta con estado de stock en vivo */}
      {stockBadge && (
        <div className="mb-2 flex items-center justify-center">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-extrabold shadow-sm ${
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
        </div>
      )}

      {/* Disposición de Estudio: Panel Izquierdo (Color + Cámara + Zoom + Movimiento) + Camisa 3D Central + Panel Derecho (Solo Admin) */}
      <div
        className={`grid grid-cols-1 items-center gap-3 ${
          isStoreOwner ? 'md:grid-cols-[224px_1fr_210px]' : 'md:grid-cols-[224px_1fr]'
        }`}
      >
        {/* PANEL LATERAL IZQUIERDO: Color de Camisa (Slide Compacto), Ángulo 3D, Zoom y Movimiento */}
        <div className="order-2 flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-slate-200/90 bg-white/95 p-2.5 shadow-sm md:order-1 md:flex-col md:items-stretch">
          {/* 1. COLOR DE CAMISA EN EL PANEL DE HERRAMIENTAS (Sin palabras ocultas + edición directa) */}
          {colorOptions && colorOptions.length > 0 && onSelectColor && (
            <div className="w-full border-b border-slate-100 pb-2">
              <div className="mb-1.5 flex items-center justify-between gap-1">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                  🎨 Color de Camisa
                </span>
                {isStoreOwner && onAddNewColor && (
                  <button
                    type="button"
                    onClick={onAddNewColor}
                    className="shrink-0 rounded-lg bg-sky-600 px-2 py-0.5 text-[10px] font-extrabold text-white shadow-sm transition hover:bg-sky-700 active:scale-95"
                    title="Agregar nuevo color de camisa (Solo Admin)"
                  >
                    + Color
                  </button>
                )}
              </div>

              {/* Selector de Color Paso a Paso (‹ ›) + Tarjeta Completa Sin Cortar Palabras */}
              {(() => {
                const activeIdx = colorOptions.findIndex((c) =>
                  activeColorId ? c.id === activeColorId : c.name === colorName
                );
                const curColor =
                  colorOptions[activeIdx >= 0 ? activeIdx : 0] || colorOptions[0];
                const curIncluded = curColor.included ?? true;
                const stepColor = (dir: -1 | 1) => {
                  if (colorOptions.length === 0) return;
                  const nextIdx =
                    (activeIdx + dir + colorOptions.length) % colorOptions.length;
                  onSelectColor(colorOptions[nextIdx].id);
                };

                return (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1">
                      {colorOptions.length > 1 && (
                        <button
                          type="button"
                          onClick={() => stepColor(-1)}
                          className="flex h-10 w-6 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-sm font-black text-slate-700 hover:bg-slate-200 active:scale-95 transition"
                          aria-label="Color anterior"
                          title="Color anterior"
                        >
                          ‹
                        </button>
                      )}

                      {/* Tarjeta destacada del Color Actual - Ancho completo para el nombre sin cortar letras */}
                      <button
                        type="button"
                        onClick={() => onSelectColor(curColor.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-slate-900 bg-slate-900 px-2.5 py-1.5 text-left text-white shadow-sm"
                        title={`${curColor.name}${curColor.stockText ? ` (${curColor.stockText})` : ''}`}
                      >
                        <span
                          className="relative h-5 w-5 shrink-0 rounded-full border border-white/40 shadow-inner"
                          style={{ backgroundColor: curColor.hex }}
                        >
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-1 ring-white ${
                              curColor.available ? 'bg-emerald-500' : 'bg-amber-400'
                            }`}
                          />
                        </span>
                        <div className="min-w-0 flex-1 leading-tight">
                          <div className="break-words text-[11px] font-black leading-snug text-white">
                            {curColor.name}
                          </div>
                          <div
                            className={`text-[10px] font-bold ${
                              curColor.available ? 'text-emerald-300' : 'text-amber-300'
                            }`}
                          >
                            {curColor.stockText || (curColor.available ? '● En Stock' : '⏳ Pronto')}
                          </div>
                        </div>
                      </button>

                      {colorOptions.length > 1 && (
                        <button
                          type="button"
                          onClick={() => stepColor(1)}
                          className="flex h-10 w-6 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-sm font-black text-slate-700 hover:bg-slate-200 active:scale-95 transition"
                          aria-label="Color siguiente"
                          title="Color siguiente"
                        >
                          ›
                        </button>
                      )}
                    </div>

                    {/* Fila de Botones Admin para el Color Actual (Visible / Editar / Eliminar) */}
                    {isStoreOwner && (onToggleColorIncluded || onEditColor || onDeleteColor) && (
                      <div className="flex items-center justify-center gap-1">
                        {onToggleColorIncluded && (
                          <button
                            type="button"
                            onClick={() => onToggleColorIncluded(curColor.id)}
                            className={`flex flex-1 items-center justify-center gap-1 rounded-lg px-1.5 py-1 text-[10px] font-extrabold transition ${
                              curIncluded
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
                                : 'bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200'
                            }`}
                            title={
                              curIncluded
                                ? 'Visible en la tienda (clic para ocultar al cliente)'
                                : 'Oculto en la tienda (clic para mostrar al cliente)'
                            }
                          >
                            <span>{curIncluded ? '✓ Visible' : '× Oculto'}</span>
                          </button>
                        )}
                        {onEditColor && (
                          <button
                            type="button"
                            onClick={() => onEditColor(curColor.id)}
                            className="flex items-center justify-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-extrabold text-slate-700 hover:bg-slate-100 transition"
                            title={`Editar nombre o tono de "${curColor.name}"`}
                          >
                            ✏️ Editar
                          </button>
                        )}
                        {onDeleteColor && (
                          <button
                            type="button"
                            onClick={() => onDeleteColor(curColor.id)}
                            className="flex items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-extrabold text-rose-700 hover:bg-rose-100 transition"
                            title={`Eliminar color "${curColor.name}"`}
                          >
                            🗑️
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Puntos rápidos de color en miniatura para cambio en 1 toque */}
              <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1">
                {colorOptions.map((c) => {
                  const active = activeColorId ? c.id === activeColorId : c.name === colorName;
                  const included = c.included ?? true;
                  return (
                    <button
                      key={`dot-${c.id}`}
                      type="button"
                      onClick={() => onSelectColor(c.id)}
                      title={`${c.name}${c.stockText ? ` · ${c.stockText}` : ''}`}
                      className={`relative h-5 w-5 rounded-full border transition ${
                        active
                          ? 'scale-110 border-slate-900 ring-2 ring-sky-400'
                          : included
                          ? 'border-black/20 hover:scale-110'
                          : 'border-dashed border-slate-300 opacity-45'
                      }`}
                      style={{ backgroundColor: c.hex }}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* 2. ÁNGULO 3D */}
          <div className="w-full">
            <div className="mb-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
              Ángulo 3D
            </div>
            <div className="grid grid-cols-3 gap-1">
              {(
                [
                  [0, '👕 Frente'],
                  [38, '📐 Perfil'],
                  [180, '🔄 Espalda']
                ] as const
              ).map(([angle, lbl]) => (
                <button
                  key={lbl}
                  type="button"
                  className={`min-h-[32px] rounded-xl px-1.5 py-1 text-center text-[11px] font-bold transition ${
                    targetAngleY === angle
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                  onClick={() => setTargetAngleY(angle)}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          {/* 3. ZOOM CAMISA */}
          <div className="w-full border-t border-slate-100 pt-1.5">
            <div className="mb-1 flex items-center justify-between text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
              <span>Zoom Camisa</span>
              <span className="font-bold text-slate-700">{Math.round(zoom * 100)}%</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="flex h-8 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xs font-extrabold text-slate-800 hover:bg-slate-200 active:scale-95"
                onClick={() => adjustZoom(-0.2)}
                title="Alejar camisa"
              >
                🔍−
              </button>
              <button
                type="button"
                className="flex h-8 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xs font-extrabold text-slate-800 hover:bg-slate-200 active:scale-95"
                onClick={() => adjustZoom(0.2)}
                title="Acercar camisa para ver el diseño"
              >
                🔍+
              </button>
              <button
                type="button"
                className={`min-h-[32px] flex-1 rounded-xl px-2 py-1 text-[11px] font-bold transition ${
                  zoom > 1.35
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'bg-sky-50 text-sky-900 hover:bg-sky-100'
                }`}
                onClick={() => setZoom((z) => (z > 1.35 ? 1 : 1.75))}
              >
                {zoom > 1.35 ? '🔭 Completa' : '🎯 Acercar'}
              </button>
            </div>
          </div>

          {/* 4. MODO DE MOVIMIENTO 3D */}
          <div className="w-full border-t border-slate-100 pt-1.5">
            <div className="mb-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
              Movimiento
            </div>
            <div className="grid grid-cols-3 gap-1">
              {(
                [
                  ['wind', '🌬️ Tela'],
                  ['walk', '🚶 Paso'],
                  ['orbit', '🔄 360°']
                ] as const
              ).map(([id, lbl]) => (
                <button
                  key={id}
                  type="button"
                  className={`min-h-[32px] rounded-xl px-1.5 py-1 text-center text-[11px] font-bold transition ${
                    mode === id
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                  onClick={() => setMode(id)}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          {/* 5. TEMA DE FONDO DE LA TIENDA BOUTIQUE (RANCHERO / ESTABLO / NOCTURNO / ARENA) */}
          <div className="w-full border-t border-slate-100 pt-1.5">
            <div className="mb-1 text-[10px] font-extrabold uppercase tracking-wider text-amber-700">
              🤠 Fondo Tienda
            </div>
            <div className="grid grid-cols-2 gap-1">
              {(Object.keys(BOUTIQUE_THEMES) as BoutiqueTheme[]).map((tKey) => (
                <button
                  key={tKey}
                  type="button"
                  onClick={() => setTheme(tKey)}
                  className={`min-h-[28px] rounded-lg px-1.5 py-0.5 text-[10px] font-extrabold transition ${
                    activeTheme === tKey
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'bg-amber-50 text-amber-900 hover:bg-amber-100'
                  }`}
                >
                  {BOUTIQUE_THEMES[tKey].label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ESCENARIO CENTRAL: Proporción 1:1 exacta con Halo de Estudio y Sombra Flotante */}
        <div className="order-1 flex flex-col items-center justify-center md:order-2">
          <div
            className="relative mx-auto flex w-full max-w-[380px] items-center justify-center"
            style={{ aspectRatio: '1 / 1' }}
          >
            {/* Halo ambiental dinámico que toma el color de la camisa */}
            <div
              className="studio-aura-pulse pointer-events-none absolute inset-6 rounded-full blur-2xl transition-colors duration-700"
              style={{
                background: `radial-gradient(circle, ${hex}55 0%, #38bdf825 55%, transparent 75%)`
              }}
            />
            {/* Sombra flotante de estudio debajo de la prenda 3D */}
            <div className="floor-shadow-breath pointer-events-none absolute bottom-3 h-5 w-44 rounded-full bg-slate-900/25 blur-md" />

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
            <div className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-sky-100 px-3 py-1 text-[11px] font-extrabold text-sky-900">
              <span className="h-2 w-2 animate-ping rounded-full bg-sky-600" />
              <span>{processingText}</span>
            </div>
          )}
          <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5 text-center text-xs font-semibold text-slate-500">
            <span>
              {touchAction === 'moveDesign'
                ? '✥ Arrastra sobre el pecho/espalda para mover el diseño'
                : '🖐 Arrastra para girar 360° · Rueda del mouse para Zoom'}
            </span>
            <span>·</span>
            <span className="font-bold text-slate-800">
              {brandName} · {colorName}
            </span>
          </div>
        </div>

        {/* PANEL LATERAL DERECHO: Exclusivo para el Administrador (Subir Imagen, Recorte, Tamaño A3 y Zona) */}
        {isStoreOwner && (
          <div className="order-3 flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-slate-200/90 bg-white/95 p-2.5 shadow-sm md:flex-col md:items-stretch">
            {onUploadFile && (
              <div className="w-full border-b border-slate-100 pb-2">
                <div className="mb-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                  Diseño (PNG sin fondo)
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => uploadInputRef.current?.click()}
                    className="flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-sky-600 px-2.5 py-1.5 text-xs font-extrabold text-white shadow-sm transition hover:bg-sky-700 active:scale-95"
                  >
                    <span>📸</span>
                    <span>{designUrl ? 'Cambiar PNG' : 'Subir PNG'}</span>
                  </button>
                  {designUrl && onClearDesign && (
                    <button
                      type="button"
                      onClick={onClearDesign}
                      title="Quitar imagen de la camisa"
                      className="flex h-[40px] w-9 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-xs font-extrabold text-rose-600 hover:bg-rose-100"
                    >
                      🗑
                    </button>
                  )}
                </div>

                {onToggleRemoveBg && (
                  <button
                    type="button"
                    onClick={() => onToggleRemoveBg(!removeBg)}
                    className={`mt-1.5 flex min-h-[32px] w-full items-center justify-between rounded-xl px-2.5 py-1 text-[11px] font-bold transition ${
                      removeBg
                        ? 'bg-emerald-50 text-emerald-900 ring-1 ring-emerald-300'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                    title="Quitar fondo exterior y huecos internos de letras (A, B, O) sin halo negro"
                  >
                    <span>🪄 Quitar Fondo</span>
                    <span className="font-extrabold">{removeBg ? 'ON' : 'OFF'}</span>
                  </button>
                )}

                {designUrl && removeBg && onChangeBgTolerance && (
                  <div className="mt-1.5 rounded-xl bg-slate-50 px-2 py-1.5">
                    <div className="flex items-center justify-between text-[10px] font-bold text-slate-600">
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
                      className="mt-0.5 w-full accent-slate-900"
                    />
                  </div>
                )}

                {designUrl && (onAiRemoveBg || onUpscale4K) && (
                  <div className="mt-1 grid grid-cols-2 gap-1">
                    {onAiRemoveBg && (
                      <button
                        type="button"
                        disabled={!!processingText}
                        onClick={onAiRemoveBg}
                        className="min-h-[30px] rounded-lg bg-slate-100 px-1.5 py-1 text-[10px] font-extrabold text-slate-800 hover:bg-slate-200 disabled:opacity-40"
                        title="Recorte de fondo con Inteligencia Artificial"
                      >
                        🤖 Fondo IA
                      </button>
                    )}
                    {onUpscale4K && (
                      <button
                        type="button"
                        disabled={!!processingText}
                        onClick={onUpscale4K}
                        className="min-h-[30px] rounded-lg bg-slate-100 px-1.5 py-1 text-[10px] font-extrabold text-slate-800 hover:bg-slate-200 disabled:opacity-40"
                        title="Mejorar nitidez y escalar diseño a 4K Ultra HD"
                      >
                        ✨ 4K HD
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="w-full">
              <div className="mb-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                Al arrastrar
              </div>
              <div className="grid grid-cols-2 gap-1 md:grid-cols-1">
                <button
                  type="button"
                  className={`min-h-[36px] rounded-xl px-2.5 py-1.5 text-left text-xs font-bold transition ${
                    touchAction === 'rotate'
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                  onClick={() => setTouchAction('rotate')}
                >
                  🖐 Girar Camisa 3D
                </button>
                <button
                  type="button"
                  disabled={!designUrl}
                  className={`min-h-[36px] rounded-xl px-2.5 py-1.5 text-left text-xs font-bold transition ${
                    !designUrl
                      ? 'cursor-not-allowed bg-slate-50 text-slate-300'
                      : touchAction === 'moveDesign'
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'bg-sky-50 text-sky-900 hover:bg-sky-100'
                  }`}
                  onClick={() => setTouchAction('moveDesign')}
                >
                  ✥ Mover Diseño
                </button>
              </div>
            </div>

            <div className="w-full border-t border-slate-100 pt-2">
              <div className="mb-1 flex items-center justify-between text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                <span>Tamaño Diseño</span>
                <span className="font-bold text-slate-700">
                  {designScale >= 1.85 ? `A3 (${Math.round(designScale * 100)}%)` : designScale >= 1.45 ? `A4 (${Math.round(designScale * 100)}%)` : `${Math.round(designScale * 100)}%`}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={!designUrl || !onDesignChange}
                  className="flex h-9 flex-1 items-center justify-center rounded-xl bg-slate-100 text-xs font-extrabold text-slate-800 hover:bg-slate-200 active:scale-95 disabled:opacity-40"
                  onClick={() => adjustScale(-0.15)}
                  title="Hacer diseño más pequeño"
                >
                  − Pequeño
                </button>
                <button
                  type="button"
                  disabled={!designUrl || !onDesignChange}
                  className="flex h-9 flex-1 items-center justify-center rounded-xl bg-slate-100 text-xs font-extrabold text-slate-800 hover:bg-slate-200 active:scale-95 disabled:opacity-40"
                  onClick={() => adjustScale(0.15)}
                  title="Hacer diseño más grande"
                >
                  + Grande
                </button>
              </div>

              {/* Botones directos Tamaño A3 (~200%) y Tamaño A4 (~160%) */}
              <div className="mt-1.5 grid grid-cols-2 gap-1">
                <button
                  type="button"
                  disabled={!designUrl || !onDesignChange}
                  className={`min-h-[34px] rounded-xl px-2 py-1 text-[11px] font-extrabold transition disabled:opacity-40 ${
                    designScale >= 1.85
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'bg-sky-50 text-sky-900 hover:bg-sky-100'
                  }`}
                  onClick={() =>
                    onDesignChange?.({
                      scale: 2.0,
                      offsetX: 0,
                      offsetY: 0
                    })
                  }
                  title="Establecer tamaño A3 (200%) proporcional"
                >
                  ✨ A3 (200%)
                </button>
                <button
                  type="button"
                  disabled={!designUrl || !onDesignChange}
                  className={`min-h-[34px] rounded-xl px-2 py-1 text-[11px] font-extrabold transition disabled:opacity-40 ${
                    designScale < 1.85 && designScale >= 1.4
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                  onClick={() =>
                    onDesignChange?.({
                      scale: 1.6,
                      offsetX: 0,
                      offsetY: 0
                    })
                  }
                  title="Establecer tamaño A4 (160%) centrado"
                >
                  📄 A4 (160%)
                </button>
              </div>
            </div>

            {onDesignChange && (
              <div className="w-full border-t border-slate-100 pt-2">
                <div className="mb-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                  Zona Rápida
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {(
                    [
                      ['center', 'Pecho'],
                      ['pocket', 'Logo Izq.'],
                      ['full', 'Grande'],
                      ['back', 'Espalda']
                    ] as const
                  ).map(([id, lbl]) => (
                    <button
                      key={id}
                      type="button"
                      className={`min-h-[32px] rounded-lg px-1.5 py-1 text-[11px] font-bold transition ${
                        placement === id
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                      onClick={() => onDesignChange({ placement: id, offsetX: 0, offsetY: 0 })}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* BANDEJA RESPONSIVA DE DISEÑOS DEL CATÁLOGO A MANO (1 clic = colocar en Tamaño A3) */}
      {(isStoreOwner || (catalogDesigns && catalogDesigns.length > 0)) && (
        <div className="mt-3 rounded-2xl border border-slate-200/90 bg-white/95 p-3 shadow-sm">
          {onUploadCatalogFiles && (
            <input
              ref={catalogBatchInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  onUploadCatalogFiles(e.target.files);
                }
                e.target.value = '';
              }}
            />
          )}

          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-extrabold uppercase tracking-wide text-slate-800">
                🎨 {isStoreOwner ? 'Diseños del Catálogo (A Mano)' : 'Diseños Disponibles'}
              </span>
              <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-[11px] font-extrabold text-sky-900">
                📐 Clic = Colocar en Tamaño A3
              </span>
              {catalogDesigns && catalogDesigns.length >= 2 && (
                <button
                  type="button"
                  onClick={() => setShowcaseActive((v) => !v)}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-extrabold transition active:scale-95 ${
                    showcaseActive
                      ? 'bg-amber-500 text-white shadow-sm ring-2 ring-amber-300'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                  title="Desfilar automáticamente todos los diseños del catálogo sobre la camisa 3D"
                >
                  <span>{showcaseActive ? '⏸ Desfile Vivo: ON' : '🎬 Desfile Automático'}</span>
                </button>
              )}
            </div>

            {isStoreOwner && (
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setIsWesternModalOpen(true)}
                  className="rounded-xl border border-amber-400 bg-amber-500/20 px-2.5 py-1.5 text-xs font-black text-amber-900 shadow-sm transition hover:bg-amber-500/30 active:scale-95"
                  title="Crear calcomanía de texto estilo Western (Ranchero) o Logo Oficial de Creativos Gift Shop"
                >
                  🤠 Texto Western / Logo
                </button>
                {designUrl && onSaveCurrentToCatalog && (
                  <button
                    type="button"
                    onClick={onSaveCurrentToCatalog}
                    className="rounded-xl bg-emerald-600 px-2.5 py-1.5 text-xs font-extrabold text-white shadow-sm transition hover:bg-emerald-700 active:scale-95"
                    title="Guardar el diseño que está puesto ahora en la camisa dentro del catálogo"
                  >
                    ➕ Guardar diseño actual en Catálogo
                  </button>
                )}
                {onUploadCatalogFiles && (
                  <button
                    type="button"
                    onClick={() => catalogBatchInputRef.current?.click()}
                    className="rounded-xl bg-slate-900 px-2.5 py-1.5 text-xs font-extrabold text-white shadow-sm transition hover:bg-slate-800 active:scale-95"
                    title="Subir uno o varios diseños al catálogo"
                  >
                    📥 + Subir Diseños al Catálogo
                  </button>
                )}
              </div>
            )}
          </div>

          {!catalogDesigns || catalogDesigns.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-3 text-center">
              <p className="text-xs font-semibold text-slate-500">
                Aún no has agregado diseños al catálogo rápido. Súbelos aquí y elige cuáles verá el cliente para que con un clic se coloquen en Tamaño A3.
              </p>
              {onUploadCatalogFiles && (
                <button
                  type="button"
                  onClick={() => catalogBatchInputRef.current?.click()}
                  className="rounded-xl bg-sky-600 px-3 py-1.5 text-xs font-extrabold text-white shadow-sm hover:bg-sky-700"
                >
                  📸 Subir primeros diseños al Catálogo
                </button>
              )}
            </div>
          ) : (
            <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 pt-1.5 sm:flex-wrap sm:overflow-visible">
              {catalogDesigns.map((d, idx) => {
                const isSelected =
                  (activeCatalogDesignId && activeCatalogDesignId === d.id) ||
                  (!!designUrl && !!d.imageUrl && designUrl === d.imageUrl);
                return (
                  <div
                    key={d.id}
                    style={{ animationDelay: `${(idx % 6) * 160}ms` }}
                    className={`catalog-card-motion group relative flex w-[114px] shrink-0 snap-start flex-col justify-between rounded-2xl border-2 p-1.5 sm:w-[124px] ${
                      isSelected
                        ? 'border-sky-500 bg-gradient-to-b from-sky-50 to-white shadow-lg ring-2 ring-sky-300/70'
                        : d.clientVisible || !isStoreOwner
                        ? 'border-slate-200 bg-white shadow-sm hover:border-sky-400 hover:shadow-md'
                        : 'border-dashed border-slate-300 bg-slate-50/80 opacity-80'
                    }`}
                  >
                    {isStoreOwner && onDeleteCatalogDesign && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteCatalogDesign(d.id);
                        }}
                        title="Eliminar diseño del catálogo"
                        className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-[11px] font-extrabold text-rose-600 shadow hover:bg-rose-600 hover:text-white"
                      >
                        ✕
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setShowcaseActive(false);
                        onSelectCatalogDesign?.(d);
                      }}
                      disabled={!d.imageUrl}
                      className="flex w-full flex-col items-center text-left focus:outline-none"
                      title={`Colocar "${d.name}" en la camisa en Tamaño A3`}
                    >
                      <div
                        className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border border-black/10 p-1.5 shadow-inner transition duration-300 group-hover:scale-[1.04]"
                        style={{ backgroundColor: hex }}
                      >
                        {d.imageUrl ? (
                          <img
                            src={d.imageUrl}
                            alt={d.name}
                            className="h-full w-full object-contain drop-shadow-md transition-transform duration-300 group-hover:scale-110"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center gap-1 p-2 text-center text-slate-400">
                            <span className="text-xl">🎨</span>
                            <span className="text-[9px] font-bold">Sin foto</span>
                          </div>
                        )}
                        <span className="absolute bottom-1 left-1 rounded-md bg-black/65 px-1.5 py-0.5 text-[9px] font-extrabold text-white backdrop-blur-sm">
                          {d.placement === 'back' ? 'Espalda A3' : 'Frente A3'}
                        </span>
                        {isSelected && (
                          <span className="absolute left-1 top-1 animate-bounce rounded-md bg-sky-600 px-1.5 py-0.5 text-[9px] font-extrabold text-white shadow">
                            ✓ Puesto
                          </span>
                        )}
                      </div>
                      <div className="mt-1 w-full truncate text-center text-[11px] font-extrabold text-slate-800">
                        {d.code && (
                          <span className="mr-1 rounded bg-slate-900 px-1 py-px font-mono text-[9px] text-amber-300">
                            {d.code}
                          </span>
                        )}
                        {d.name}
                      </div>
                    </button>

                    {isStoreOwner && onRenameCatalogDesign && (
                      <button
                        type="button"
                        onClick={() => {
                          const nextName = window.prompt('Nombre del diseño (para reportes de ventas):', d.name);
                          if (nextName === null) return;
                          const nextCode = window.prompt('Código del diseño (ej. D-001, TORO-01):', d.code || '');
                          if (nextCode === null) return;
                          onRenameCatalogDesign(d.id, nextName.trim() || d.name, nextCode.trim().toUpperCase());
                        }}
                        className="mt-1 flex min-h-[24px] w-full items-center justify-center rounded-lg bg-amber-50 px-1.5 py-0.5 text-[10px] font-extrabold text-amber-900 hover:bg-amber-100"
                        title="Cambiar nombre y código del diseño"
                      >
                        ✏️ Nombre / Código
                      </button>
                    )}

                    {isStoreOwner && onToggleCatalogDesignVisible && (
                      <button
                        type="button"
                        onClick={() => onToggleCatalogDesignVisible(d.id, !d.clientVisible)}
                        className={`mt-1 flex min-h-[26px] w-full items-center justify-center gap-1 rounded-lg px-1.5 py-0.5 text-[10px] font-extrabold transition ${
                          d.clientVisible
                            ? 'bg-emerald-100 text-emerald-900 hover:bg-emerald-200'
                            : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                        }`}
                        title={
                          d.clientVisible
                            ? 'El cliente PUEDE ver y probar este diseño. Haz clic para ocultarlo.'
                            : 'Oculto para el cliente. Haz clic para dejarlo disponible al cliente.'
                        }
                      >
                        <span>{d.clientVisible ? '👁 Cliente: Sí' : '🔒 Oculto'}</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
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
    decalPop: 1,
    decalPopVel: 0,
    smoothR: initialRgb[0],
    smoothG: initialRgb[1],
    smoothB: initialRgb[2],
    dragging: false,
    lastX: 0,
    lastY: 0
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
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, decalTex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      stateRef.current.decalAspect = img.naturalWidth / Math.max(1, img.naturalHeight);
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
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, decalTex);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        stateRef.current.decalAspect = img.naturalWidth / Math.max(1, img.naturalHeight);
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

      // Interpolación suave de Zoom, Escala y resorte elástico del diseño (Spring Pop-in)
      r.smoothZoom += (st.zoom - r.smoothZoom) * 0.14;
      r.smoothScale += (st.designScale - r.smoothScale) * 0.18;
      const springForce = (1.0 - r.decalPop) * 0.22;
      r.decalPopVel = (r.decalPopVel + springForce) * 0.76;
      r.decalPop = clamp(r.decalPop + r.decalPopVel, 0.35, 1.18);

      // Transición suave de color RGB sobre las fibras de algodón
      const [targetR, targetG, targetB] = hexToRgbNorm(st.hex);
      r.smoothR += (targetR - r.smoothR) * 0.14;
      r.smoothG += (targetG - r.smoothG) * 0.14;
      r.smoothB += (targetB - r.smoothB) * 0.14;

      if (!r.dragging) {
        if (st.autoMotion) {
          if (st.mode === 'orbit') {
            r.ry = (r.ry + 0.55) % 360;
          } else if (st.mode === 'walk') {
            const target = r.baseRy + Math.sin(elapsed * 3.0) * 16;
            r.ry += (target - r.ry) * 0.10 + r.vy;
            r.rx += (4 + Math.abs(Math.cos(elapsed * 3.0)) * 4 - r.rx) * 0.10 + r.vx;
          } else {
            const target = r.baseRy + Math.sin(elapsed * 1.1) * 19;
            r.ry += (target - r.ry) * 0.09 + r.vy;
            r.rx += (5 + Math.cos(elapsed * 0.8) * 3 - r.rx) * 0.09 + r.vx;
          }
          r.vx *= 0.85;
          r.vy *= 0.85;
        } else {
          // Incluso con autoMotion en pausa, girar suavemente hacia Frente/Perfil/Espalda
          r.ry += (r.baseRy - r.ry) * 0.12 + r.vy;
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
            ? Math.abs(Math.sin(elapsed * 3.0)) * 0.03 - 0.015
            : st.autoMotion
            ? Math.sin(elapsed * 1.6) * 0.015
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

        const effectiveScale = clamp(r.smoothScale * r.decalPop, 0.25, 3.15);
        const rect = computeDecalRect3D(
          st.placement,
          effectiveScale,
          st.designOffsetX,
          st.designOffsetY,
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
