import { useEffect, useRef, useState } from 'react';
import { contrastText } from '../lib/inventory';

export type DecalPlacement = 'center' | 'pocket' | 'full' | 'back';
export type MotionMode = 'wind' | 'walk' | 'orbit';

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
 * GENERADOR DE MALLA 3D VOLUMÉTRICA (GHOST MANNEQUIN / PERSONAJE INVISIBLE)
 * Construye una prenda 3D cerrada en hombros, costados y mangas, y ABIERTA en
 * cuello, puños y ruedo inferior, con normales suaves y coordenadas UV.
 * ========================================================================== */

interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
}

function clamp(x: number, a: number, b: number): number {
  return x < a ? a : x > b ? b : x;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Evalúa si un punto (x, y) pertenece a la silueta anatómica de la camisa
 * y devuelve:
 * - thickness: grosor Z en ese punto (0 en las costuras cerradas laterales/hombros, > 0 en el interior y en las aberturas huecas)
 * - inside: true si está dentro de la prenda (para la capa dada: front o back)
 * - fold: pliegue estático natural de caída de tela
 */
function sampleGarmentVolume(
  x: number,
  y: number,
  isFront: boolean
): { inside: boolean; z: number; fold: number; isCollar: number } {
  const ax = Math.abs(x);

  // Límites verticales globales
  if (y < -0.92 || y > 0.82) {
    return { inside: false, z: 0, fold: 0, isCollar: 0 };
  }

  // 1. Torso vs Mangas
  // El torso tiene semiancho ~0.46 en cintura, ensanchándose a 0.50 en pecho (y=0.25) y hombros
  const torsoHalfW =
    0.455 +
    0.035 * Math.exp(-Math.pow((y - 0.22) / 0.28, 2)) +
    0.02 * smoothstep(-0.3, -0.9, y);

  // Línea superior de hombro / manga exterior: baja desde (ax=0.24, y=0.78) hasta (ax=0.96, y=0.22)
  let topLimit = 0.78;
  if (ax <= 0.24) {
    topLimit = 0.78;
  } else if (ax <= 0.52) {
    // Caída de hombro
    topLimit = 0.78 - ((ax - 0.24) / 0.28) * 0.13;
  } else {
    // Borde superior de manga (ángulo natural de 38 grados)
    topLimit = 0.65 - ((ax - 0.52) / 0.44) * 0.43;
  }

  if (y > topLimit) {
    return { inside: false, z: 0, fold: 0, isCollar: 0 };
  }

  // 2. Recorte del cuello (Crew Neck 3D):
  // En el frente el cuello baja hasta y = 0.46 (curva U profunda);
  // En la espalda el cuello es alto (baja solo hasta y = 0.70), dejando ver el interior trasero desde el frente!
  const neckRadiusX = 0.245;
  let isCollar = 0;
  if (ax < neckRadiusX) {
    const nx = ax / neckRadiusX;
    const neckCurve = Math.sqrt(Math.max(0, 1 - nx * nx));
    const neckThreshold = isFront ? 0.77 - 0.30 * neckCurve : 0.78 - 0.075 * neckCurve;
    if (y > neckThreshold) {
      return { inside: false, z: 0, fold: 0, isCollar: 0 };
    }
    // Banda acanalada del cuello (collar rib) alrededor del borde del cuello
    const distToNeck = neckThreshold - y;
    if (distToNeck < 0.055) {
      isCollar = 1 - distToNeck / 0.055;
    }
  }

  // 3. Región del Torso vs Región de la Manga
  if (ax <= torsoHalfW && y <= 0.66) {
    // Estamos en el torso
    // Dobladillo inferior curvo
    const hemY = -0.88 - 0.03 * (1 - Math.pow(ax / torsoHalfW, 2));
    if (y < hemY) {
      return { inside: false, z: 0, fold: 0, isCollar: 0 };
    }

    // Perfil cilíndrico horizontal: se cierra suavemente en los costados (ax -> torsoHalfW)
    // EXCEPTO en la unión con la manga (y entre 0.14 y 0.65), donde el volumen continúa hacia el hombro/manga
    const sideRatio = clamp(ax / torsoHalfW, 0, 1);
    const armholeBlend = smoothstep(0.08, 0.28, y) * (1 - smoothstep(0.60, 0.75, y));
    const effectiveRatio = sideRatio * (1 - 0.48 * armholeBlend);
    const cylProfile = Math.sqrt(Math.max(0, 1 - effectiveRatio * effectiveRatio));

    // Cierre suave en la costura superior del hombro (solo para ax > neckRadiusX)
    let shoulderSeam = 1;
    if (ax >= neckRadiusX - 0.01) {
      const distTop = clamp((topLimit - y) / 0.08, 0, 1);
      shoulderSeam = Math.sqrt(distTop);
    }

    // Contorno anatómico: pecho ligeramente más prominente arriba, espalda con volumen escapular
    const anatomyZ = isFront
      ? 0.27 + 0.055 * Math.exp(-Math.pow((y - 0.22) / 0.32, 2))
      : 0.24 + 0.045 * Math.exp(-Math.pow((y - 0.28) / 0.34, 2));

    // Pliegues verticales naturales de caída + pliegues diagonales desde la sisa
    const drape =
      0.012 * Math.sin(x * 18.0 + y * 2.5) * smoothstep(0.35, -0.85, y) +
      0.010 * Math.cos(x * 31.0 - y * 4.0) * smoothstep(0.1, -0.85, y);
    const armpitDist = Math.hypot(ax - 0.44, y - 0.16);
    const armpitCrease =
      0.016 *
      Math.sin((ax - 0.2) * 28 + (y - 0.16) * 22) *
      Math.exp(-Math.pow(armpitDist / 0.22, 2));

    const fold = drape + armpitCrease;
    const collarBump = isCollar > 0 ? 0.014 * Math.sin(isCollar * Math.PI) : 0;
    const zMag = anatomyZ * cylProfile * shoulderSeam + fold + collarBump;

    return {
      inside: true,
      z: isFront ? zMag : -zMag,
      fold,
      isCollar
    };
  }

  // 4. Región de la Manga (ax > torsoHalfW o esquina de hombro)
  // Eje central de la manga desde el hombro (0.44, 0.45) hacia el puño (0.86, 0.05)
  const x0 = 0.44;
  const y0 = 0.44;
  const dirX = 0.80;
  const dirY = -0.60; // vector unitario a lo largo de la manga
  const perpX = 0.60;
  const perpY = 0.80; // vector unitario perpendicular al tubo de la manga

  const dx = ax - x0;
  const dy = y - y0;
  const along = dx * dirX + dy * dirY; // distancia a lo largo de la manga (0 .. 0.50)
  const across = dx * perpX + dy * perpY; // distancia transversal al eje de la manga

  const maxSleeveLen = 0.46;
  if (along < -0.18 || along > maxSleeveLen) {
    return { inside: false, z: 0, fold: 0, isCollar: 0 };
  }

  // Radio del tubo de la manga (se estrecha suavemente hacia el puño)
  const tSleeve = clamp(along / maxSleeveLen, 0, 1);
  const sleeveRadius = 0.21 * (1 - 0.20 * tSleeve);

  if (Math.abs(across) > sleeveRadius) {
    return { inside: false, z: 0, fold: 0, isCollar: 0 };
  }

  // Transición bajo la axila para evitar picos entre torso y manga
  if (ax < torsoHalfW + 0.06 && y < 0.14) {
    return { inside: false, z: 0, fold: 0, isCollar: 0 };
  }

  // Perfil cilíndrico transversal de la manga:
  // Se cierra a 0 en el borde superior e inferior de la manga (across -> ±sleeveRadius),
  // pero queda ABIERTO en el puño (along == maxSleeveLen) para que la manga sea hueca en 3D!
  const rNorm = clamp(across / sleeveRadius, -1, 1);
  const sleeveCyl = Math.sqrt(Math.max(0, 1 - rNorm * rNorm));
  const sleeveFold = 0.008 * Math.sin(along * 26 + across * 18);
  const zSleeve = (0.19 * (1 - 0.15 * tSleeve)) * sleeveCyl + sleeveFold;

  return {
    inside: true,
    z: isFront ? zSleeve : -zSleeve,
    fold: sleeveFold,
    isCollar: 0
  };
}

let cachedMesh: MeshData | null = null;

function buildGarmentMesh(): MeshData {
  if (cachedMesh) return cachedMesh;

  const NX = 112;
  const NY = 112;
  const minX = -0.96;
  const maxX = 0.96;
  const minY = -0.92;
  const maxY = 0.82;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const buildShell = (isFront: boolean) => {
    const vertIndex = new Int32Array(NX * NY).fill(-1);
    const zGrid = new Float32Array(NX * NY);
    const insideGrid = new Uint8Array(NX * NY);
    const collarGrid = new Float32Array(NX * NY);

    for (let j = 0; j < NY; j++) {
      const v = j / (NY - 1);
      const y = minY + v * (maxY - minY);
      for (let i = 0; i < NX; i++) {
        const u = i / (NX - 1);
        const x = minX + u * (maxX - minX);
        const idx = j * NX + i;
        const sample = sampleGarmentVolume(x, y, isFront);
        if (sample.inside) {
          insideGrid[idx] = 1;
          zGrid[idx] = sample.z;
          collarGrid[idx] = sample.isCollar;
        }
      }
    }

    const dxStep = (maxX - minX) / (NX - 1);
    const dyStep = (maxY - minY) / (NY - 1);

    for (let j = 0; j < NY; j++) {
      const v = j / (NY - 1);
      const y = minY + v * (maxY - minY);
      for (let i = 0; i < NX; i++) {
        const idx = j * NX + i;
        if (!insideGrid[idx]) continue;

        const u = i / (NX - 1);
        const x = minX + u * (maxX - minX);
        const z = zGrid[idx];

        // Derivadas finitas para la normal 3D suave
        const zL = i > 0 && insideGrid[idx - 1] ? zGrid[idx - 1] : 0;
        const zR = i < NX - 1 && insideGrid[idx + 1] ? zGrid[idx + 1] : 0;
        const zD = j > 0 && insideGrid[idx - NX] ? zGrid[idx - NX] : 0;
        const zU = j < NY - 1 && insideGrid[idx + NX] ? zGrid[idx + NX] : 0;

        const dzdx = (zR - zL) / (2 * dxStep);
        const dzdy = (zU - zD) / (2 * dyStep);

        let nx = -dzdx;
        let ny = -dzdy;
        let nz = 1.0;
        if (!isFront) {
          nx = dzdx;
          ny = dzdy;
          nz = -1.0;
        }
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;

        const vIdx = positions.length / 3;
        vertIndex[idx] = vIdx;
        positions.push(x, y, z);
        normals.push(nx, ny, nz);
        // Guardamos en uv: (x normalizado de pecho, y normalizado de pecho), con signo en U para distinguir Frente vs Espalda
        const chestU = (x + 0.45) / 0.9; // 0..1 en el ancho del torso
        const chestV = 1 - (y + 0.88) / 1.66; // 0 arriba .. 1 abajo
        uvs.push(isFront ? chestU : chestU + 10.0, chestV + (collarGrid[idx] > 0.2 ? 10.0 : 0.0));
      }
    }

    for (let j = 0; j < NY - 1; j++) {
      for (let i = 0; i < NX - 1; i++) {
        const a = vertIndex[j * NX + i];
        const b = vertIndex[j * NX + i + 1];
        const c = vertIndex[(j + 1) * NX + i];
        const d = vertIndex[(j + 1) * NX + i + 1];
        if (a >= 0 && b >= 0 && c >= 0 && d >= 0) {
          if (isFront) {
            indices.push(a, b, c, b, d, c);
          } else {
            indices.push(a, c, b, b, c, d);
          }
        }
      }
    }
  };

  buildShell(true);
  buildShell(false);

  cachedMesh = {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices)
  };
  return cachedMesh;
}

/* ============================================================================
 * SHADERS WEBGL 3D (ILUMINACIÓN PBR DE ALGODÓN + PLIEGUES VIVOS + ESTAMPADO UV)
 * ========================================================================== */

const VERT_SRC = `
attribute vec3 a_pos;
attribute vec3 a_norm;
attribute vec2 a_uv;

uniform mat4 u_proj;
uniform mat4 u_view;
uniform float u_time;
uniform float u_mode;

varying vec3 v_pos;
varying vec3 v_norm;
varying vec2 v_uv;
varying float v_wave;

void main() {
  vec3 p = a_pos;
  vec3 n = a_norm;

  // Ondas reales 3D en los vértices de la tela (viento / caminata)
  float lowerWeight = clamp((0.55 - p.y) / 1.4, 0.0, 1.0);
  float windWave = sin(u_time * 2.6 + p.x * 7.5 + p.y * 4.0) * 0.016 * lowerWeight
                 + cos(u_time * 1.9 - p.x * 12.0 + p.y * 6.0) * 0.009 * lowerWeight;

  if (u_mode > 0.5 && u_mode < 1.5) {
    // Modo Caminata de Personaje Invisible: torsión opuesta entre hombros y cadera
    float twist = sin(u_time * 3.2) * 0.16 * p.y;
    float c = cos(twist);
    float s = sin(twist);
    p = vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
    n = vec3(n.x * c - n.z * s, n.y, n.x * s + n.z * c);
    windWave += sin(u_time * 6.4 + p.x * 9.0) * 0.012 * lowerWeight;
  }

  p.z += (n.z >= 0.0 ? 1.0 : -1.0) * windWave;

  vec4 viewPos = u_view * vec4(p, 1.0);
  v_pos = viewPos.xyz;
  v_norm = mat3(u_view) * n;
  v_uv = a_uv;
  v_wave = windWave;

  gl_Position = u_proj * viewPos;
}
`;

const FRAG_SRC = `
precision highp float;

varying vec3 v_pos;
varying vec3 v_norm;
varying vec2 v_uv;
varying float v_wave;

uniform vec3 u_baseColor;
uniform sampler2D u_decalTex;
uniform int u_hasDecal;
uniform int u_decalOnBack;
uniform vec4 u_decalRect; // (centerU, centerV, widthU, heightV)

void main() {
  bool isBackShell = v_uv.x > 5.0;
  float rawU = isBackShell ? (v_uv.x - 10.0) : v_uv.x;
  bool isCollar = v_uv.y > 5.0;
  float rawV = isCollar ? (v_uv.y - 10.0) : v_uv.y;

  vec3 N = normalize(v_norm);
  bool interior = !gl_FrontFacing;
  if (interior) {
    N = -N;
  }

  // Micro-textura de tejido de algodón peinado + acanalado en el cuello
  float weave = sin(rawU * 260.0) * sin(rawV * 260.0) * 0.018;
  if (isCollar) {
    weave += sin(rawU * 140.0) * 0.04;
  }

  vec3 base = u_baseColor + vec3(weave);

  // Aplicación del diseño / logo 3D sobre la superficie curva del pecho o espalda
  if (u_hasDecal == 1 && !interior) {
    bool targetSide = (u_decalOnBack == 1) ? isBackShell : (!isBackShell);
    if (targetSide) {
      //En la espalda invertimos X para que el diseño no salga espejado al girar 180 grados
      float sideU = isBackShell ? (1.0 - rawU) : rawU;
      float du = (sideU - u_decalRect.x) / u_decalRect.z + 0.5;
      float dv = (rawV - u_decalRect.y) / u_decalRect.w + 0.5;
      if (du >= 0.0 && du <= 1.0 && dv >= 0.0 && dv <= 1.0) {
        vec4 tex = texture2D(u_decalTex, vec2(du, dv));
        // Donde el fondo fue eliminado (tex.a == 0), queda exactamente el color de la camisa
        base = mix(base, tex.rgb, tex.a);
      }
    }
  }

  // Etiqueta tejida interna ("CREATIVOS") en el interior del cuello trasero
  if (interior && isBackShell && rawU > 0.42 && rawU < 0.58 && rawV > 0.07 && rawV < 0.145) {
    base = vec3(0.95, 0.96, 0.98);
    if (rawV > 0.095 && rawV < 0.115 && rawU > 0.44 && rawU < 0.56) {
      base = vec3(0.12, 0.16, 0.24);
    }
  }

  // Iluminación tridimensional de estudio (3 puntos: Key Light, Fill Light, Rim Fresnel)
  vec3 V = normalize(-v_pos);
  vec3 L1 = normalize(vec3(0.45, 0.65, 0.85));
  vec3 L2 = normalize(vec3(-0.65, 0.25, 0.55));
  vec3 L3 = normalize(vec3(0.0, 0.85, -0.75));

  float diff1 = max(dot(N, L1), 0.0);
  float diff2 = max(dot(N, L2), 0.0) * 0.38;
  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.6) * 0.28;
  float backRim = max(dot(N, L3), 0.0) * 0.18;

  // Sombra de pliegues dinámicos 3D
  float foldShade = 1.0 + v_wave * 4.2;

  float lighting = (0.44 + 0.54 * diff1 + diff2) * foldShade;

  // Si estamos viendo el INTERIOR hueco de la prenda (cuello, mangas o ruedo), oscurecemos por oclusión ambiental
  if (interior) {
    lighting *= 0.42;
    rim *= 0.15;
  }

  vec3 finalColor = base * lighting + vec3(rim + backRim) * (0.35 + 0.65 * base);
  gl_FragColor = vec4(clamp(finalColor, 0.0, 1.0), 1.0);
}
`;

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

function createMat4ModelView(rxDeg: number, ryDeg: number, tz: number, ty: number): Float32Array {
  const rx = (rxDeg * Math.PI) / 180;
  const ry = (ryDeg * Math.PI) / 180;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);

  // R = Rx * Ry
  return new Float32Array([
    cy, sx * sy, -cx * sy, 0,
    0, cx, sx, 0,
    sy, -sx * cy, cx * cy, 0,
    0, ty, tz, 1
  ]);
}

function compileProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn(gl.getShaderInfoLog(s));
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

function computeDecalRect(
  placement: DecalPlacement,
  scale: number,
  offsetX: number,
  offsetY: number,
  aspect: number
): [number, number, number, number] {
  const s = clamp(scale, 0.35, 1.85);
  let baseU = 0.5;
  let baseV = 0.39;
  let wU = 0.34 * s;

  if (placement === 'pocket') {
    baseU = 0.64;
    baseV = 0.31;
    wU = 0.16 * s;
  } else if (placement === 'full') {
    baseU = 0.5;
    baseV = 0.43;
    wU = 0.48 * s;
  }

  const hV = (wU / Math.max(0.25, aspect)) * 0.85;
  const centerU = clamp(baseU + offsetX * 0.01, 0.22, 0.78);
  const centerV = clamp(baseV + offsetY * 0.01, 0.22, 0.74);
  return [centerU, centerV, wU, hV];
}

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
          autoMotion
          compact
        />
      </div>
      {label && <span className="mt-1 text-sm font-semibold text-slate-700">{label}</span>}
    </div>
  );
}

/**
 * Visor WebGL 3D Real (360° completos + Arrastre de Diseño sobre la prenda + Zoom + Controles de tamaño).
 */
export function InteractiveShirt3D({
  hex,
  colorName,
  brandName,
  designUrl,
  placement = 'center',
  designScale = 1,
  designOffsetX = 0,
  designOffsetY = 0,
  onDesignChange,
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
  onDesignChange?: (patch: { scale?: number; offsetX?: number; offsetY?: number; placement?: DecalPlacement }) => void;
  autoMotion?: boolean;
  stockBadge?: { available: boolean; text: string } | null;
}) {
  const [mode, setMode] = useState<MotionMode>('wind');
  const [touchAction, setTouchAction] = useState<'rotate' | 'moveDesign'>('rotate');
  const [targetAngleY, setTargetAngleY] = useState<number | null>(null);

  useEffect(() => {
    if (placement === 'back') setTargetAngleY(180);
    else setTargetAngleY(0);
  }, [placement]);

  const adjustScale = (delta: number) => {
    const next = clamp(Math.round((designScale + delta) * 100) / 100, 0.35, 1.85);
    onDesignChange?.({ scale: next });
  };

  return (
    <div className="relative flex flex-col items-center select-none">
      {/* Barra superior: Ángulos 3D (Frente / Perfil / Espalda) + Animación + Stock en vivo */}
      <div className="z-10 mb-2 flex flex-wrap items-center justify-center gap-1.5">
        <div className="inline-flex rounded-full bg-slate-200/90 p-1">
          {(
            [
              [0, 'Frente'],
              [42, 'Perfil 3D'],
              [180, 'Espalda']
            ] as const
          ).map(([angle, lbl]) => (
            <button
              key={lbl}
              type="button"
              className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                targetAngleY === angle ? 'bg-slate-900 text-white shadow' : 'text-slate-700'
              }`}
              onClick={() => setTargetAngleY(angle)}
            >
              {lbl}
            </button>
          ))}
        </div>

        <div className="inline-flex rounded-full bg-slate-200/90 p-1">
          {(
            [
              ['wind', '🌬️ Tela 3D'],
              ['walk', '🚶 Caminata'],
              ['orbit', '🔄 Giro 360°']
            ] as const
          ).map(([id, lbl]) => (
            <button
              key={id}
              type="button"
              className={`rounded-full px-2.5 py-1 text-xs font-bold transition ${
                mode === id ? 'bg-slate-900 text-white shadow' : 'text-slate-700'
              }`}
              onClick={() => setMode(id)}
            >
              {lbl}
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

      {/* Controles directos sobre el visor cuando hay un diseño cargado */}
      {designUrl && onDesignChange && (
        <div className="z-10 mb-2 flex flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-slate-200 bg-white/95 px-2.5 py-1.5 shadow-sm">
          <button
            type="button"
            className={`rounded-xl px-2.5 py-1.5 text-xs font-bold transition ${
              touchAction === 'rotate'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700'
            }`}
            onClick={() => setTouchAction('rotate')}
          >
            🖐 Girar 3D
          </button>
          <button
            type="button"
            className={`rounded-xl px-2.5 py-1.5 text-xs font-bold transition ${
              touchAction === 'moveDesign'
                ? 'bg-sky-600 text-white'
                : 'bg-slate-100 text-slate-700'
            }`}
            onClick={() => setTouchAction('moveDesign')}
          >
            ✥ Mover Diseño
          </button>
          <span className="mx-0.5 text-slate-300">|</span>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-base font-extrabold text-slate-800 active:scale-95"
            onClick={() => adjustScale(-0.12)}
            title="Hacer diseño más pequeño"
          >
            −
          </button>
          <span className="min-w-[44px] text-center text-xs font-extrabold text-slate-700">
            {Math.round(designScale * 100)}%
          </span>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-base font-extrabold text-slate-800 active:scale-95"
            onClick={() => adjustScale(0.12)}
            title="Hacer diseño más grande"
          >
            +
          </button>
          <button
            type="button"
            className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600"
            onClick={() => onDesignChange({ scale: 1, offsetX: 0, offsetY: 0 })}
            title="Centrar diseño"
          >
            ↺ Centrar
          </button>
        </div>
      )}

      {/* Lienzo WebGL 3D Real */}
      <div className="relative h-[340px] w-full max-w-[380px] sm:h-[380px]">
        <WebGLShirtCanvas
          hex={hex}
          designUrl={designUrl || null}
          placement={placement}
          designScale={designScale}
          designOffsetX={designOffsetX}
          designOffsetY={designOffsetY}
          autoMotion={autoMotion && touchAction !== 'moveDesign'}
          mode={mode}
          targetAngleY={targetAngleY}
          touchAction={touchAction}
          onMoveDesign={(dx, dy) => {
            onDesignChange?.({
              offsetX: clamp(designOffsetX + dx, -22, 22),
              offsetY: clamp(designOffsetY + dy, -22, 24)
            });
          }}
        />
      </div>

      <div className="mt-1 flex items-center gap-2 text-xs font-semibold text-slate-500">
        <span>
          {touchAction === 'moveDesign'
            ? '✥ Arrastra sobre la camisa para colocar el diseño'
            : '🖐 Arrastra 360° para girar la prenda en 3D real'}
        </span>
        <span>·</span>
        <span className="font-bold text-slate-800">
          {brandName} · {colorName}
        </span>
      </div>
    </div>
  );
}

function WebGLShirtCanvas({
  hex,
  designUrl,
  placement = 'center',
  designScale = 1,
  designOffsetX = 0,
  designOffsetY = 0,
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
    autoMotion,
    mode,
    touchAction,
    onMoveDesign,
    hasDecal: false,
    decalAspect: 1
  });
  stateRef.current = {
    hex,
    placement,
    designScale,
    designOffsetX,
    designOffsetY,
    autoMotion,
    mode,
    touchAction,
    onMoveDesign,
    hasDecal: stateRef.current.hasDecal,
    decalAspect: stateRef.current.decalAspect
  };

  const rotRef = useRef({
    rx: 8,
    ry: -18,
    vx: 0,
    vy: 0,
    baseRy: 0,
    dragging: false,
    lastX: 0,
    lastY: 0
  });

  useEffect(() => {
    if (targetAngleY !== null && targetAngleY !== undefined) {
      rotRef.current.baseRy = targetAngleY;
      rotRef.current.ry = targetAngleY;
    }
  }, [targetAngleY]);

  const glRef = useRef<{
    gl: WebGLRenderingContext;
    tex: WebGLTexture | null;
  } | null>(null);

  // Actualizar textura WebGL cuando cambia el diseño
  useEffect(() => {
    const ctx = glRef.current;
    if (!ctx) return;
    const { gl, tex } = ctx;
    if (!designUrl || !tex) {
      stateRef.current.hasDecal = false;
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      stateRef.current.decalAspect = img.naturalWidth / Math.max(1, img.naturalHeight);
      stateRef.current.hasDecal = true;
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

    const mesh = buildGarmentMesh();

    const makeBuf = (target: number, data: ArrayBufferView) => {
      const b = gl.createBuffer();
      gl.bindBuffer(target, b);
      gl.bufferData(target, data, gl.STATIC_DRAW);
      return b;
    };

    const posBuf = makeBuf(gl.ARRAY_BUFFER, mesh.positions);
    const normBuf = makeBuf(gl.ARRAY_BUFFER, mesh.normals);
    const uvBuf = makeBuf(gl.ARRAY_BUFFER, mesh.uvs);
    const idxBuf = makeBuf(gl.ELEMENT_ARRAY_BUFFER, mesh.indices);

    const bindAttr = (buf: WebGLBuffer | null, name: string, size: number) => {
      const loc = gl.getAttribLocation(prog, name);
      if (loc < 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };

    bindAttr(posBuf, 'a_pos', 3);
    bindAttr(normBuf, 'a_norm', 3);
    bindAttr(uvBuf, 'a_uv', 2);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
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

    glRef.current = { gl, tex };

    // Si ya había un designUrl al montar, cargarlo
    if (designUrl && tex) {
      const img = new Image();
      img.onload = () => {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        stateRef.current.decalAspect = img.naturalWidth / Math.max(1, img.naturalHeight);
        stateRef.current.hasDecal = true;
      };
      img.src = designUrl;
    }

    const uProj = gl.getUniformLocation(prog, 'u_proj');
    const uView = gl.getUniformLocation(prog, 'u_view');
    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uMode = gl.getUniformLocation(prog, 'u_mode');
    const uBaseColor = gl.getUniformLocation(prog, 'u_baseColor');
    const uHasDecal = gl.getUniformLocation(prog, 'u_hasDecal');
    const uDecalOnBack = gl.getUniformLocation(prog, 'u_decalOnBack');
    const uDecalRect = gl.getUniformLocation(prog, 'u_decalRect');

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    let raf = 0;
    const t0 = performance.now();

    const render = (now: number) => {
      const elapsed = (now - t0) / 1000;
      const st = stateRef.current;
      const r = rotRef.current;

      if (!r.dragging) {
        if (st.autoMotion) {
          if (st.mode === 'orbit') {
            r.ry = (r.ry + 0.55) % 360;
          } else if (st.mode === 'walk') {
            const target = r.baseRy + Math.sin(elapsed * 3.2) * 18;
            r.ry += (target - r.ry) * 0.1;
            r.rx += (6 + Math.abs(Math.cos(elapsed * 3.2)) * 5 - r.rx) * 0.1;
          } else {
            const target = r.baseRy + Math.sin(elapsed * 1.15) * 24;
            r.ry += (target - r.ry) * 0.08;
            r.rx += (7 + Math.cos(elapsed * 0.85) * 4 - r.rx) * 0.08;
          }
        } else {
          r.ry += r.vy;
          r.rx = clamp(r.rx + r.vx, -32, 38);
          r.vx *= 0.90;
          r.vy *= 0.90;
        }
      }

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      const proj = createMat4Perspective((34 * Math.PI) / 180, canvas.width / canvas.height, 0.1, 20.0);
      const bounceY =
        st.autoMotion && st.mode === 'walk'
          ? Math.abs(Math.sin(elapsed * 3.2)) * 0.045 - 0.02
          : Math.sin(elapsed * 1.8) * 0.025;
      const view = createMat4ModelView(r.rx, r.ry, -3.15, bounceY);

      gl.uniformMatrix4fv(uProj, false, proj);
      gl.uniformMatrix4fv(uView, false, view);
      gl.uniform1f(uTime, elapsed);
      gl.uniform1f(uMode, st.mode === 'walk' ? 1.0 : st.mode === 'orbit' ? 2.0 : 0.0);

      const [cr, cg, cb] = hexToRgbNorm(st.hex);
      gl.uniform3f(uBaseColor, cr, cg, cb);

      gl.uniform1i(uHasDecal, st.hasDecal ? 1 : 0);
      gl.uniform1i(uDecalOnBack, st.placement === 'back' ? 1 : 0);
      const rect = computeDecalRect(
        st.placement,
        st.designScale,
        st.designOffsetX,
        st.designOffsetY,
        st.decalAspect
      );
      gl.uniform4f(uDecalRect, rect[0], rect[1], rect[2], rect[3]);

      gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);

      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const res = compact ? 320 : 640;

  return (
    <canvas
      ref={canvasRef}
      width={res}
      height={res}
      className="h-full w-full cursor-grab touch-none drop-shadow-xl active:cursor-grabbing"
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
          r.rx = clamp(r.rx + dy * 0.35, -32, 38);
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
