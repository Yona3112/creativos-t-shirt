/**
 * Generador de calcomanías (decals) en Canvas 2D de alta resolución:
 * - Texto Western auténtico (Vaquero / Ranchero en arco o bloque con serifs y decorados)
 * - Logotipo oficial "Contacta con Creativos Gift Shop"
 */

export interface WesternTextOptions {
  text: string;
  subText?: string;
  style?: 'arch' | 'slab' | 'vintage';
  textColor?: string;
  outlineColor?: string;
}

export interface CreativosLogoOptions {
  variant?: 'contact' | 'official' | 'stamp';
  phone?: string;
  textColor?: string;
}

// Asegurar que las fuentes de Google Fonts estén disponibles antes de pintar el Canvas
async function ensureFontsLoaded(): Promise<void> {
  if (typeof document !== 'undefined' && 'fonts' in document) {
    try {
      await document.fonts.ready;
    } catch {
      // Ignorar fallback
    }
  }
}

/**
 * Genera un decal PNG transparente con Texto Western auténtico
 */
export async function generateWesternTextDecal(opts: WesternTextOptions): Promise<string> {
  await ensureFontsLoaded();

  const canvas = document.createElement('canvas');
  const size = 1024;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D context');

  ctx.clearRect(0, 0, size, size);

  const mainText = (opts.text || 'RANCHO').toUpperCase().trim();
  const subText = (opts.subText || '').toUpperCase().trim();
  const textColor = opts.textColor || '#FFFFFF';
  const outlineColor = opts.outlineColor || '#111827';
  const style = opts.style || 'arch';

  const fontWestern = 'Rye, "Sancreek", "Cinzel", "Copperplate", "Rockwell Extra Bold", "Impact", serif';

  if (style === 'arch') {
    // Dibujo en Arco (Estilo Ranchero Clásico)
    const centerX = size / 2;
    const centerY = size * 0.58;
    const radius = size * 0.38;

    ctx.save();
    ctx.font = `bold 118px ${fontWestern}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 14;
    ctx.lineJoin = 'miter';
    ctx.miterLimit = 2;

    const chars = mainText.split('');
    const totalChars = chars.length;
    // Ángulo total del arco según la cantidad de caracteres
    const maxAngle = Math.min(Math.PI * 0.65, Math.max(Math.PI * 0.32, totalChars * 0.085));
    const startAngle = -Math.PI / 2 - maxAngle / 2;
    const stepAngle = maxAngle / Math.max(1, totalChars - 1);

    chars.forEach((ch, i) => {
      const angle = totalChars === 1 ? -Math.PI / 2 : startAngle + i * stepAngle;
      ctx.save();
      ctx.translate(centerX + radius * Math.cos(angle), centerY + radius * Math.sin(angle));
      ctx.rotate(angle + Math.PI / 2);

      // Sombra 3D profunda
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillText(ch, 4, 6);

      // Trazo / Contorno exterior
      ctx.strokeStyle = outlineColor;
      ctx.strokeText(ch, 0, 0);

      // Relleno principal
      ctx.fillStyle = textColor;
      ctx.fillText(ch, 0, 0);

      ctx.restore();
    });
    ctx.restore();

    // Estrellas / Espuelas decorativas a los lados
    ctx.save();
    ctx.font = `bold 42px ${fontWestern}`;
    ctx.fillStyle = '#C8A876';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('★   ★   ★', centerX, centerY - radius * 0.42);
    ctx.restore();

    // Subtexto (recto o en cinta inferior)
    if (subText) {
      ctx.save();
      const subY = centerY + 110;
      // Barra de fondo para legibilidad
      ctx.fillStyle = 'rgba(17, 24, 39, 0.85)';
      const subWidth = Math.min(size * 0.78, Math.max(280, subText.length * 28 + 60));
      ctx.beginPath();
      ctx.roundRect(centerX - subWidth / 2, subY - 32, subWidth, 64, 8);
      ctx.fill();
      ctx.strokeStyle = '#C8A876';
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.font = `900 36px ${fontWestern}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(subText, centerX, subY);
      ctx.restore();
    }
  } else if (style === 'slab') {
    // Dibujo en Bloque Western Recto con bordes rústicos
    const centerX = size / 2;
    const centerY = size / 2;

    // Regla decorativa superior
    ctx.save();
    ctx.strokeStyle = '#C8A876';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(centerX - 360, centerY - 140);
    ctx.lineTo(centerX + 360, centerY - 140);
    ctx.stroke();

    ctx.font = `bold 32px ${fontWestern}`;
    ctx.fillStyle = '#C8A876';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✦   EST. 2024 · CREATIVOS   ✦', centerX, centerY - 165);

    // Texto principal
    ctx.font = `bold 125px ${fontWestern}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 16;
    ctx.miterLimit = 2;

    // Sombra 3D
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillText(mainText, centerX + 5, centerY + 8);

    // Contorno
    ctx.strokeStyle = outlineColor;
    ctx.strokeText(mainText, centerX, centerY);

    // Relleno
    ctx.fillStyle = textColor;
    ctx.fillText(mainText, centerX, centerY);

    // Regla decorativa inferior
    ctx.strokeStyle = '#C8A876';
    ctx.beginPath();
    ctx.moveTo(centerX - 360, centerY + 140);
    ctx.lineTo(centerX + 360, centerY + 140);
    ctx.stroke();

    if (subText) {
      ctx.font = `bold 46px ${fontWestern}`;
      ctx.fillStyle = textColor;
      ctx.strokeStyle = outlineColor;
      ctx.lineWidth = 8;
      ctx.strokeText(subText, centerX, centerY + 90);
      ctx.fillText(subText, centerX, centerY + 90);
    }
    ctx.restore();
  } else {
    // Vintage Badge Oval
    const centerX = size / 2;
    const centerY = size / 2;

    ctx.save();
    // Borde oval exterior
    ctx.strokeStyle = '#C8A876';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, 380, 260, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Doblado interior punteado
    ctx.setLineDash([12, 10]);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, 360, 240, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Texto central
    ctx.font = `bold 105px ${fontWestern}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 14;
    ctx.strokeStyle = outlineColor;
    ctx.strokeText(mainText, centerX, centerY - 20);
    ctx.fillStyle = textColor;
    ctx.fillText(mainText, centerX, centerY - 20);

    // Subtexto inferior
    ctx.font = `bold 36px ${fontWestern}`;
    ctx.fillStyle = '#C8A876';
    ctx.fillText(subText || '★ AUTÉNTICO & PERSONALIZADO ★', centerX, centerY + 90);
    ctx.restore();
  }

  return canvas.toDataURL('image/png');
}

/**
 * Genera el logo oficial "Contacta con Creativos Gift Shop" en alta resolución
 */
export async function generateCreativosLogoDecal(opts: CreativosLogoOptions = {}): Promise<string> {
  await ensureFontsLoaded();

  const canvas = document.createElement('canvas');
  const size = 1024;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D context');

  ctx.clearRect(0, 0, size, size);

  const phone = opts.phone || '9831-0305';
  const textColor = opts.textColor || '#FFFFFF';
  const fontWestern = 'Rye, "Cinzel", "Copperplate", "Impact", serif';
  const centerX = size / 2;
  const centerY = size / 2;

  ctx.save();

  // Escudo circular o redondeado
  ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
  ctx.beginPath();
  ctx.arc(centerX, centerY, 380, 0, Math.PI * 2);
  ctx.fill();

  // Borde dorado trenzado
  ctx.strokeStyle = '#C8A876';
  ctx.lineWidth = 10;
  ctx.stroke();

  // Segundo anillo interior
  ctx.setLineDash([14, 8]);
  ctx.strokeStyle = '#F59E0B';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(centerX, centerY, 355, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Icono central (Regalo / Corona de Creativos)
  ctx.font = '84px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🎁', centerX, centerY - 80);

  // Nombre de marca
  ctx.font = `bold 54px ${fontWestern}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = textColor;
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#000000';
  ctx.strokeText('CREATIVOS', centerX, centerY);
  ctx.fillText('CREATIVOS', centerX, centerY);

  ctx.font = `bold 42px ${fontWestern}`;
  ctx.fillStyle = '#C8A876';
  ctx.strokeText('GIFT SHOP', centerX, centerY + 50);
  ctx.fillText('GIFT SHOP', centerX, centerY + 50);

  // Línea separadora
  ctx.strokeStyle = '#C8A876';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(centerX - 180, centerY + 95);
  ctx.lineTo(centerX + 180, centerY + 95);
  ctx.stroke();

  // Contacto & Teléfono
  ctx.font = 'bold 30px "Segoe UI", system-ui, sans-serif';
  ctx.fillStyle = '#E2E8F0';
  ctx.fillText('CONTACTA CON NOSOTROS', centerX, centerY + 140);

  // Badge del número
  ctx.fillStyle = '#059669';
  ctx.beginPath();
  ctx.roundRect(centerX - 190, centerY + 180, 380, 60, 30);
  ctx.fill();
  ctx.strokeStyle = '#10B981';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.font = '900 34px "Segoe UI", system-ui, sans-serif';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(`📞 Tel. ${phone}`, centerX, centerY + 212);

  // Lema superior arqueado
  ctx.font = `bold 22px ${fontWestern}`;
  ctx.fillStyle = '#C8A876';
  ctx.fillText('★ CALIDAD PREMIUM & SUBLIMACIÓN ★', centerX, centerY - 210);

  ctx.restore();

  return canvas.toDataURL('image/png');
}
