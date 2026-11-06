import { useState, useEffect } from 'react';
import {
  generateWesternTextDecal,
  generateCreativosLogoDecal
} from '../lib/westernTextGenerator';

interface WesternDesignModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (dataUrl: string, designName: string, placement: 'back' | 'center') => void;
  initialPlacement?: 'back' | 'center';
}

export function WesternDesignModal({
  isOpen,
  onClose,
  onApply,
  initialPlacement = 'back'
}: WesternDesignModalProps) {
  const [tab, setTab] = useState<'western' | 'logo'>('western');

  // Opciones de Texto Western
  const [text, setText] = useState('RANCHO');
  const [subText, setSubText] = useState('SIN MIEDO AL SOL');
  const [westernStyle, setWesternStyle] = useState<'arch' | 'slab' | 'vintage'>('arch');
  const [textColor, setTextColor] = useState('#FFFFFF');
  const [placement, setPlacement] = useState<'back' | 'center'>(initialPlacement);

  // Opciones de Logo Creativos
  const [logoPhone, setLogoPhone] = useState('9831-0305');

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // Regenerar vista previa en vivo cuando cambian las opciones
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsGenerating(true);

    const updatePreview = async () => {
      try {
        let url = '';
        if (tab === 'western') {
          url = await generateWesternTextDecal({
            text: text || 'TEXTO',
            subText,
            style: westernStyle,
            textColor,
            outlineColor: textColor === '#111827' ? '#FFFFFF' : '#111827'
          });
        } else {
          url = await generateCreativosLogoDecal({
            phone: logoPhone
          });
        }
        if (!cancelled) {
          setPreviewUrl(url);
        }
      } catch (err) {
        console.error('Error generando decal:', err);
      } finally {
        if (!cancelled) setIsGenerating(false);
      }
    };

    const timer = setTimeout(() => {
      void updatePreview();
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, tab, text, subText, westernStyle, textColor, logoPhone]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (!previewUrl) return;
    const name =
      tab === 'western'
        ? `Texto Western: ${text || 'Vaquero'}${subText ? ` · ${subText}` : ''}`
        : 'Logo Oficial Creativos Gift Shop';
    onApply(previewUrl, name, placement);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm sm:p-4 animate-in fade-in duration-200">
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-slate-700 bg-slate-900 text-white shadow-2xl">
        {/* CABECERA */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/20 text-base text-amber-400">
              🤠
            </span>
            <div>
              <h3 className="text-base font-black tracking-wide text-white">
                Personalizar: Texto Western o Logo
              </h3>
              <p className="text-[11px] font-medium text-slate-400">
                Se coloca en calidad A3 en tu camisa · L 350.00
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* PESTAÑAS: TEXTO WESTERN vs LOGO CREATIVOS */}
        <div className="grid grid-cols-2 border-b border-slate-800 bg-slate-950/60 p-1.5 gap-1 text-xs font-black">
          <button
            type="button"
            onClick={() => setTab('western')}
            className={`flex items-center justify-center gap-1.5 rounded-xl py-2 transition ${
              tab === 'western'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>🤠 Texto Western (Ranchero)</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('logo')}
            className={`flex items-center justify-center gap-1.5 rounded-xl py-2 transition ${
              tab === 'logo'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>🎁 Logo Creativos Gift Shop</span>
          </button>
        </div>

        {/* CONTENIDO SCROLLEABLE */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {/* VISTA PREVIA DEL ESTAMPADO */}
          <div className="relative flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-2xl border border-slate-800 bg-[#141519] p-3 shadow-inner">
            <div
              className="absolute inset-0 opacity-15"
              style={{
                backgroundImage:
                  'radial-gradient(circle, #ffffff 1px, transparent 1px)',
                backgroundSize: '16px 16px'
              }}
            />
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Vista previa personalizada"
                className="relative z-10 max-h-full max-w-full object-contain drop-shadow-xl"
              />
            ) : (
              <div className="relative z-10 flex flex-col items-center gap-2 text-slate-400">
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
                <span>Generando diseño...</span>
              </div>
            )}
            <span className="absolute bottom-2 left-2 rounded-md bg-black/70 px-2 py-0.5 text-[10px] font-bold text-amber-300 backdrop-blur-sm">
              ✨ Resolución A3 Pro
            </span>
          </div>

          {tab === 'western' ? (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block font-extrabold uppercase tracking-wider text-slate-300">
                  Texto Principal (Vaquero / Ranchero)
                </label>
                <input
                  type="text"
                  value={text}
                  maxLength={24}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Ej: RANCHO, SAN MARCOS, TU NOMBRE..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-black uppercase text-amber-300 placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block font-extrabold uppercase tracking-wider text-slate-300">
                  Subtexto o Frase Inferior (Opcional)
                </label>
                <input
                  type="text"
                  value={subText}
                  maxLength={36}
                  onChange={(e) => setSubText(e.target.value)}
                  placeholder="Ej: SIN MIEDO AL SOL, HONDURAS, 100% VAQUERO..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold uppercase text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                />
              </div>

              {/* ESTILO DE ARCO / BLOQUE */}
              <div>
                <label className="mb-1 block font-extrabold uppercase tracking-wider text-slate-300">
                  Estilo de Tipografía
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      ['arch', '🏹 Arco Vaquero'],
                      ['slab', '⬛ Bloque Western'],
                      ['vintage', '🎖️ Escudo Oval']
                    ] as const
                  ).map(([id, lbl]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setWesternStyle(id)}
                      className={`rounded-xl border py-2 text-center text-xs font-extrabold transition ${
                        westernStyle === id
                          ? 'border-amber-500 bg-amber-500/20 text-amber-300'
                          : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>

              {/* COLOR DE LETRA */}
              <div>
                <label className="mb-1 block font-extrabold uppercase tracking-wider text-slate-300">
                  Color de Letra
                </label>
                <div className="flex items-center gap-2">
                  {[
                    ['#FFFFFF', 'Blanco'],
                    ['#111827', 'Negro'],
                    ['#F59E0B', 'Oro / Amarillo'],
                    ['#991B1B', 'Rojo Vaquero'],
                    ['#2563EB', 'Azul']
                  ].map(([hex, name]) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => setTextColor(hex)}
                      className={`flex h-8 w-8 items-center justify-center rounded-full border-2 transition ${
                        textColor === hex
                          ? 'scale-110 border-amber-400 ring-2 ring-amber-400/50'
                          : 'border-slate-600'
                      }`}
                      style={{ backgroundColor: hex }}
                      title={name}
                    >
                      {textColor === hex && (
                        <span className={hex === '#FFFFFF' ? 'text-black font-black' : 'text-white font-black'}>
                          ✓
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-200">
                <p className="font-extrabold">
                  🎁 Logotipo Oficial y Contacto de Creativos Gift Shop
                </p>
                <p className="mt-1 text-[11px] text-amber-200/80">
                  Ideal para promociones, pedidos de catálogo o mostrar el sello original de la marca.
                </p>
              </div>

              <div>
                <label className="mb-1 block font-extrabold uppercase tracking-wider text-slate-300">
                  Teléfono de Contacto en el Logo
                </label>
                <input
                  type="text"
                  value={logoPhone}
                  onChange={(e) => setLogoPhone(e.target.value)}
                  placeholder="9831-0305"
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-bold text-white focus:border-amber-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* DÓNDE COLOCARLO (FRENTE O ESPALDA) */}
          <div className="border-t border-slate-800 pt-3">
            <label className="mb-1 block font-extrabold uppercase tracking-wider text-slate-300">
              ¿Dónde quieres colocarlo?
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPlacement('back')}
                className={`rounded-xl border py-2 text-center text-xs font-black transition ${
                  placement === 'back'
                    ? 'border-amber-500 bg-amber-500/20 text-amber-300'
                    : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                🔄 En la Espalda (Recomendado A3)
              </button>
              <button
                type="button"
                onClick={() => setPlacement('center')}
                className={`rounded-xl border py-2 text-center text-xs font-black transition ${
                  placement === 'center'
                    ? 'border-amber-500 bg-amber-500/20 text-amber-300'
                    : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                👕 En el Frente (Pecho)
              </button>
            </div>
          </div>
        </div>

        {/* PIE / BOTÓN DE ACCIÓN */}
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950 p-4">
          <div className="text-left">
            <span className="block text-[11px] text-slate-400">Precio Estampada:</span>
            <span className="text-base font-black text-amber-400">Personalizada · L 350.00</span>
          </div>
          <button
            type="button"
            disabled={!previewUrl || isGenerating}
            onClick={handleConfirm}
            className="flex items-center gap-1.5 rounded-2xl bg-amber-500 px-5 py-2.5 text-xs font-black text-slate-950 shadow-lg transition hover:bg-amber-400 active:scale-95 disabled:opacity-40"
          >
            <span>✓ Aplicar a Camisa 3D</span>
          </button>
        </div>
      </div>
    </div>
  );
}
