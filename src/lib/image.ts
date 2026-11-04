/** Comprime una imagen en el cliente: máx. 560px, JPEG calidad 0.78 (o PNG si conserva transparencia). */
export async function compressImage(
  file: File,
  maxSide = 560,
  quality = 0.82,
  removeBg = true,
  tolerance = 42
): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('No se pudo leer la imagen'));
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas no disponible');
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    if (removeBg) {
      stripSolidBackground(ctx, w, h, tolerance);
      return canvas.toDataURL('image/png');
    }

    return canvas.toDataURL('image/png', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Re-procesa una imagen ya cargada (dataURL o File) aplicando o quitando el removedor de fondo
 * con la tolerancia indicada. Devuelve un PNG con canal alfa transparente.
 */
export async function applyBackgroundRemoval(
  sourceDataUrl: string,
  removeBg: boolean,
  tolerance = 42
): Promise<string> {
  if (!removeBg) return sourceDataUrl;
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('No se pudo procesar la imagen'));
    i.src = sourceDataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return sourceDataUrl;
  ctx.drawImage(img, 0, 0);
  stripSolidBackground(ctx, canvas.width, canvas.height, tolerance);
  return canvas.toDataURL('image/png');
}

/**
 * Detecta el color de fondo dominante en las esquinas/bordes (típico de JPG con fondo blanco, gris o negro)
 * y convierte ese fondo en transparente con suavizado de bordes (feathering) para que tome el color exacto de la camisa.
 */
function stripSolidBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  tolerance: number
): void {
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  // Si la imagen ya tiene píxeles transparentes en las esquinas, respetamos su transparencia original
  const corners = [
    0,
    (w - 1) * 4,
    (h - 1) * w * 4,
    ((h - 1) * w + (w - 1)) * 4
  ];
  let transparentCorners = 0;
  for (const idx of corners) {
    if (d[idx + 3] < 40) transparentCorners++;
  }
  if (transparentCorners >= 2) return;

  // Muestrear píxeles del borde exterior para obtener el color de fondo promedio
  const samples: [number, number, number][] = [];
  const stepX = Math.max(1, Math.floor(w / 16));
  const stepY = Math.max(1, Math.floor(h / 16));
  for (let x = 0; x < w; x += stepX) {
    const top = x * 4;
    const bot = ((h - 1) * w + x) * 4;
    samples.push([d[top], d[top + 1], d[top + 2]]);
    samples.push([d[bot], d[bot + 1], d[bot + 2]]);
  }
  for (let y = 0; y < h; y += stepY) {
    const left = y * w * 4;
    const right = (y * w + (w - 1)) * 4;
    samples.push([d[left], d[left + 1], d[left + 2]]);
    samples.push([d[right], d[right + 1], d[right + 2]]);
  }

  // Elegir el cluster de color más frecuente en los bordes (mediana por canal)
  const rs = samples.map((s) => s[0]).sort((a, b) => a - b);
  const gs = samples.map((s) => s[1]).sort((a, b) => a - b);
  const bs = samples.map((s) => s[2]).sort((a, b) => a - b);
  const mid = Math.floor(samples.length / 2);
  const bgR = rs[mid];
  const bgG = gs[mid];
  const bgB = bs[mid];

  const tol = Math.max(10, Math.min(110, tolerance));
  const feather = 22;
  const maxDist = tol + feather;

  for (let i = 0; i < d.length; i += 4) {
    const dr = d[i] - bgR;
    const dg = d[i + 1] - bgG;
    const db = d[i + 2] - bgB;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist <= tol) {
      d[i + 3] = 0;
    } else if (dist < maxDist) {
      const factor = (dist - tol) / feather;
      d[i + 3] = Math.round(d[i + 3] * factor);
    }
  }

  ctx.putImageData(imgData, 0, 0);
}
