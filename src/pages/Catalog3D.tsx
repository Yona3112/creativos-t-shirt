import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppState, useStock } from '../lib/store';
import { activeBrands, brandColors, normalPrice, vkey } from '../lib/inventory';
import { money } from '../lib/money';
import { uid } from '../lib/ids';
import { compressImage } from '../lib/image';
import { savePhoto } from '../lib/db';
import { fetchSharedPhoto, uploadPhotoNow } from '../lib/sync';
import { copyText } from '../lib/csv';
import { whatsappUrl } from '../lib/whatsapp';
import { InteractiveShirt3D, type DecalPlacement } from '../components/Shirt';
import { NewColorModal } from '../components/NewColorModal';
import { Stepper, toast } from '../components/ui';

export interface SharedCatalogPayload {
  storeName: string;
  storePhone: string;
  brandName: string;
  colors: { name: string; hex: string }[];
  sizes: string[];
  priceNormal: number;
  priceWholesale: number;
  wholesaleMin: number;
  photoId: string | null;
  placement: DecalPlacement;
  scale: number;
  offsetY: number;
}

function encodeCatalog(p: SharedCatalogPayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(p));
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeCatalog(token: string): SharedCatalogPayload | null {
  try {
    const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    const parsed = JSON.parse(json) as SharedCatalogPayload;
    if (Array.isArray(parsed.colors) && parsed.colors.length > 0) return parsed;
  } catch {
    /* enlace inválido */
  }
  return null;
}

export function readSharedCatalogHash(): SharedCatalogPayload | null {
  const m = location.hash.match(/catalogo=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  return decodeCatalog(m[1]);
}

const PLACEMENTS: { id: DecalPlacement; label: string }[] = [
  { id: 'center', label: 'Pecho Centro' },
  { id: 'pocket', label: 'Logo Izq.' },
  { id: 'full', label: 'Frente Grande' },
  { id: 'back', label: 'Espalda' }
];

export default function Catalog3D() {
  const state = useAppState();
  const { stock } = useStock();
  const { settings } = state;
  const brands = activeBrands(state);

  const [brandId, setBrandId] = useState(brands[0]?.id || '');
  const brand = brands.find((b) => b.id === brandId) || brands[0];
  const colors = useMemo(() => (brand ? brandColors(state, brand.id) : []), [state, brand]);

  const [activeColorId, setActiveColorId] = useState(colors[0]?.id || '');
  const [enabledColorIds, setEnabledColorIds] = useState<string[]>(() => colors.map((c) => c.id));
  const [designUrl, setDesignUrl] = useState<string | null>(null);
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [placement, setPlacement] = useState<DecalPlacement>('center');
  const [scale, setScale] = useState(1);
  const [offsetY, setOffsetY] = useState(0);
  const [autoMotion, setAutoMotion] = useState(true);
  const [colorModal, setColorModal] = useState(false);
  const [previewClient, setPreviewClient] = useState<SharedCatalogPayload | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const ids = colors.map((c) => c.id);
    setEnabledColorIds(ids);
    if (!colors.some((c) => c.id === activeColorId)) {
      setActiveColorId(colors[0]?.id || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand?.id, colors.length]);

  const activeColor = colors.find((c) => c.id === activeColorId) || colors[0];

  const toggleColorIncluded = (id: string) => {
    setEnabledColorIds((prev) => {
      if (prev.includes(id)) {
        if (prev.length <= 1) {
          toast('Debe quedar al menos 1 color en el catálogo', 'info');
          return prev;
        }
        return prev.filter((x) => x !== id);
      }
      return [...prev, id];
    });
  };

  const selectOnlyInStock = () => {
    if (!brand) return;
    const withStock = colors
      .filter((c) =>
        settings.sizes.some((sz) => (stock.get(vkey(brand.id, c.id, sz)) || 0) > 0)
      )
      .map((c) => c.id);
    if (withStock.length === 0) {
      return toast('Ningún color tiene stock > 0 en esta marca', 'info');
    }
    setEnabledColorIds(withStock);
    if (!withStock.includes(activeColorId)) setActiveColorId(withStock[0]);
    toast(`${withStock.length} colores con stock seleccionados`);
  };

  const onUploadDesign = async (file: File | undefined) => {
    if (!file) return;
    try {
      const compressed = await compressImage(file, 560, 0.8);
      const id = uid();
      await savePhoto(id, compressed, 0);
      void uploadPhotoNow(id, compressed);
      setPhotoId(id);
      setDesignUrl(compressed);
      toast('Diseño aplicado a la camisa 3D');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const buildPayload = (): SharedCatalogPayload => {
    const selectedColors = colors
      .filter((c) => enabledColorIds.includes(c.id))
      .map((c) => ({ name: c.name, hex: c.hex }));
    return {
      storeName: settings.storeName,
      storePhone: settings.storePhone,
      brandName: brand?.name || 'Camisa',
      colors: selectedColors.length > 0 ? selectedColors : colors.map((c) => ({ name: c.name, hex: c.hex })),
      sizes: settings.sizes,
      priceNormal: normalPrice(settings, brand),
      priceWholesale: settings.priceWholesale,
      wholesaleMin: settings.wholesaleMin,
      photoId,
      placement,
      scale,
      offsetY
    };
  };

  const buildShareUrl = (): string => {
    const token = encodeCatalog(buildPayload());
    return `${location.origin}${location.pathname}#catalogo=${token}`;
  };

  const handleShareLink = async () => {
    if (photoId && designUrl) {
      await uploadPhotoNow(photoId, designUrl);
    }
    const url = buildShareUrl();
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${settings.storeName} · Catálogo 3D`,
          text: `Mira cómo luce tu diseño en nuestras camisas ${brand?.name || ''} en 3D:`,
          url
        });
        return;
      } catch {
        /* fallback a copiar */
      }
    }
    await copyText(url);
    toast('Enlace del Catálogo 3D copiado');
  };

  const handleShareWhatsApp = async () => {
    if (photoId && designUrl) {
      await uploadPhotoNow(photoId, designUrl);
    }
    const url = buildShareUrl();
    const text = `¡Hola! 👋 Mira nuestro *Catálogo 3D Interactivo* de *${settings.storeName}* (${brand?.name || ''}).\n\nPuedes girar la camisa en 3D y probar el diseño en los colores disponibles aquí:\n${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  };

  if (previewClient) {
    return (
      <CustomerCatalogView
        payload={previewClient}
        initialDesignUrl={designUrl}
        onExitPreview={() => setPreviewClient(null)}
      />
    );
  }

  return (
    <div className="space-y-4 pb-6">
      {/* Estudio 3D en vivo */}
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-b from-slate-100 via-white to-slate-100 p-4 shadow-sm">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-extrabold text-slate-900">✨ Estudio y Catálogo 3D Interactivo</h2>
            <p className="text-xs font-medium text-slate-500">
              Elige los colores permitidos, sube el diseño y compártelo con tu cliente
            </p>
          </div>
          <button
            type="button"
            className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
              autoMotion ? 'bg-sky-100 text-sky-900' : 'bg-slate-200 text-slate-700'
            }`}
            onClick={() => setAutoMotion((v) => !v)}
          >
            {autoMotion ? '🔄 Movimiento 3D Suave: ON' : '⏸ Movimiento 3D: Pausa'}
          </button>
        </div>

        <InteractiveShirt3D
          hex={activeColor?.hex || '#111827'}
          colorName={activeColor?.name || 'Negro'}
          brandName={brand?.name || ''}
          designUrl={designUrl}
          placement={placement}
          designScale={scale}
          designOffsetY={offsetY}
          autoMotion={autoMotion}
        />

        {/* Selector rápido de color para ver el diseño en cada tono */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
          {colors.map((c) => {
            const active = c.id === activeColor?.id;
            const included = enabledColorIds.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveColorId(c.id)}
                className={`group relative flex items-center gap-2 rounded-full border-2 px-3 py-1.5 text-xs font-bold transition ${
                  active
                    ? 'border-slate-900 bg-slate-900 text-white shadow-md scale-105'
                    : included
                    ? 'border-slate-200 bg-white text-slate-800 hover:border-slate-400'
                    : 'border-dashed border-slate-200 bg-slate-50 text-slate-400 opacity-60'
                }`}
              >
                <span
                  className="h-5 w-5 rounded-full border border-black/15"
                  style={{ background: c.hex }}
                />
                <span>{c.name}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Probar diseño sobre la camisa 3D */}
      <section className="card space-y-3">
        <h2 className="section-title mb-0">1 · Diseño sobre la Camisa 3D</h2>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onUploadDesign(e.target.files?.[0])}
        />
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary flex-1" onClick={() => fileRef.current?.click()}>
            📸 {designUrl ? 'Cambiar Diseño / Logo' : 'Subir Diseño / Logo'}
          </button>
          {designUrl && (
            <button
              className="btn-ghost text-red-600"
              onClick={() => {
                setDesignUrl(null);
                setPhotoId(null);
              }}
            >
              Quitar
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PLACEMENTS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`chip text-sm ${placement === p.id ? 'chip-on' : 'chip-off'}`}
              onClick={() => setPlacement(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>

        {designUrl && (
          <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2">
            <div>
              <label className="label">Tamaño del diseño ({Math.round(scale * 100)}%)</label>
              <input
                type="range"
                min="0.5"
                max="1.5"
                step="0.05"
                className="w-full accent-slate-900"
                value={scale}
                onChange={(e) => setScale(parseFloat(e.target.value))}
              />
            </div>
            <div>
              <label className="label">Altura en la camisa</label>
              <input
                type="range"
                min="-10"
                max="14"
                step="1"
                className="w-full accent-slate-900"
                value={offsetY}
                onChange={(e) => setOffsetY(parseFloat(e.target.value))}
              />
            </div>
          </div>
        )}
      </section>

      {/* Establecer Marca y Colores que verá el cliente */}
      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-title mb-0">2 · Marca y Colores Establecidos por Ti</h2>
          <div className="flex gap-1.5">
            <button
              type="button"
              className="btn-ghost min-h-[38px] px-2.5 text-xs"
              onClick={() => setEnabledColorIds(colors.map((c) => c.id))}
            >
              Todos ({colors.length})
            </button>
            <button
              type="button"
              className="btn-ghost min-h-[38px] px-2.5 text-xs"
              onClick={selectOnlyInStock}
            >
              Solo con stock
            </button>
            <button
              type="button"
              className="btn-soft min-h-[38px] px-2.5 text-xs"
              onClick={() => setColorModal(true)}
            >
              + Nuevo color
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {brands.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`chip ${b.id === brand?.id ? 'chip-on' : 'chip-off'}`}
              onClick={() => setBrandId(b.id)}
            >
              {b.name}
            </button>
          ))}
        </div>

        <p className="text-xs font-medium text-slate-500">
          Marca con ☑️ los colores que el cliente podrá elegir en el catálogo compartido:
        </p>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {colors.map((c) => {
            const checked = enabledColorIds.includes(c.id);
            return (
              <div
                key={c.id}
                className={`flex min-h-[52px] items-center justify-between gap-2 rounded-xl border-2 px-3 py-2 transition ${
                  checked ? 'border-slate-900 bg-slate-50' : 'border-slate-200 bg-white opacity-60'
                }`}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => setActiveColorId(c.id)}
                >
                  <span
                    className="h-6 w-6 shrink-0 rounded-full border border-black/15"
                    style={{ background: c.hex }}
                  />
                  <span className="truncate text-sm font-bold text-slate-900">{c.name}</span>
                </button>
                <input
                  type="checkbox"
                  className="h-5 w-5 cursor-pointer accent-slate-900"
                  checked={checked}
                  onChange={() => toggleColorIncluded(c.id)}
                  aria-label={`Incluir ${c.name}`}
                />
              </div>
            );
          })}
        </div>
      </section>

      {/* Compartir catálogo 3D */}
      <section className="card space-y-3">
        <h2 className="section-title mb-0">3 · Compartir Catálogo 3D con el Cliente</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <button className="btn-primary" onClick={handleShareLink}>
            🔗 Compartir / Copiar Enlace 3D
          </button>
          <button
            className="btn bg-[#25D366] text-white hover:bg-[#1ebe5b]"
            onClick={handleShareWhatsApp}
          >
            💬 Enviar por WhatsApp
          </button>
          <button className="btn-soft" onClick={() => setPreviewClient(buildPayload())}>
            👁 Ver como Cliente
          </button>
        </div>
      </section>

      {brand && (
        <NewColorModal
          open={colorModal}
          onClose={() => setColorModal(false)}
          brandId={brand.id}
        />
      )}
    </div>
  );
}

/** Vista interactiva limpia para el cliente cuando abre el enlace compartido (#catalogo=...). */
export function CustomerCatalogView({
  payload,
  initialDesignUrl = null,
  onExitPreview
}: {
  payload: SharedCatalogPayload;
  initialDesignUrl?: string | null;
  onExitPreview?: () => void;
}) {
  const [selectedColor, setSelectedColor] = useState(payload.colors[0]);
  const [designUrl, setDesignUrl] = useState<string | null>(initialDesignUrl);
  const [placement, setPlacement] = useState<DecalPlacement>(payload.placement || 'center');
  const [scale, setScale] = useState(payload.scale || 1);
  const [size, setSize] = useState(payload.sizes.includes('M') ? 'M' : payload.sizes[0] || 'M');
  const [qty, setQty] = useState(1);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!designUrl && payload.photoId) {
      void fetchSharedPhoto(payload.photoId).then((d) => {
        if (d) setDesignUrl(d);
      });
    }
  }, [payload.photoId, designUrl]);

  const unitPrice = qty >= payload.wholesaleMin ? payload.priceWholesale : payload.priceNormal;
  const total = qty * unitPrice;

  const onClientUpload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const compressed = await compressImage(file, 560, 0.8);
      setDesignUrl(compressed);
    } catch {
      /* ignorar */
    }
  };

  const placementLabel = PLACEMENTS.find((p) => p.id === placement)?.label || 'Pecho Centro';
  const orderText = `¡Hola ${payload.storeName}! 👋 Vi el Catálogo 3D y me gustaría cotizar/pedir:\n\n• Marca: ${payload.brandName}\n• Color: ${selectedColor?.name}\n• Talla: ${size}\n• Cantidad: ${qty} uds\n• Ubicación del diseño: ${placementLabel}\n• Total estimado: ${money(total)}`;

  return (
    <div className="min-h-screen bg-slate-100 pb-10">
      <header className="safe-top sticky top-0 z-40 bg-slate-900 text-white shadow-md">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-4">
          <div>
            <div className="text-base font-extrabold">{payload.storeName}</div>
            <div className="text-xs text-sky-200">Catálogo 3D Interactivo · {payload.brandName}</div>
          </div>
          {onExitPreview && (
            <button className="btn min-h-[40px] bg-white px-3 text-sm text-slate-900" onClick={onExitPreview}>
              ← Volver a Tienda
            </button>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 px-3 pt-4">
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-b from-slate-100 via-white to-slate-100 p-4 shadow-sm">
          <InteractiveShirt3D
            hex={selectedColor?.hex || '#111827'}
            colorName={selectedColor?.name || ''}
            brandName={payload.brandName}
            designUrl={designUrl}
            placement={placement}
            designScale={scale}
            designOffsetY={payload.offsetY || 0}
            autoMotion
          />

          <div className="mt-4">
            <div className="mb-2 text-center text-xs font-bold uppercase tracking-wide text-slate-500">
              Toca un color para ver cómo luce el diseño
            </div>
            <div className="flex flex-wrap justify-center gap-2.5">
              {payload.colors.map((c) => {
                const active = c.name === selectedColor?.name;
                return (
                  <button
                    key={c.name + c.hex}
                    type="button"
                    onClick={() => setSelectedColor(c)}
                    className={`flex min-h-[48px] items-center gap-2 rounded-full border-2 px-3.5 py-1.5 text-sm font-bold transition ${
                      active
                        ? 'border-slate-900 bg-slate-900 text-white shadow-md scale-105'
                        : 'border-slate-200 bg-white text-slate-800'
                    }`}
                  >
                    <span
                      className="h-6 w-6 rounded-full border border-black/15"
                      style={{ background: c.hex }}
                    />
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* Opciones de prueba de diseño para el cliente */}
        <section className="card space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onClientUpload(e.target.files?.[0])}
          />
          <div className="flex flex-wrap gap-2">
            <button className="btn-soft flex-1" onClick={() => fileRef.current?.click()}>
              📸 {designUrl ? 'Probar con otra imagen / logo' : 'Subir mi logo / diseño a la camisa'}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PLACEMENTS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`chip text-sm ${placement === p.id ? 'chip-on' : 'chip-off'}`}
                onClick={() => setPlacement(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
          {designUrl && (
            <div>
              <label className="label">Tamaño del diseño</label>
              <input
                type="range"
                min="0.5"
                max="1.5"
                step="0.05"
                className="w-full accent-slate-900"
                value={scale}
                onChange={(e) => setScale(parseFloat(e.target.value))}
              />
            </div>
          )}
        </section>

        {/* Selección de talla, cantidad y botón de pedido por WhatsApp */}
        <section className="card space-y-3">
          <div>
            <label className="label">Talla</label>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {payload.sizes.map((sz) => (
                <button
                  key={sz}
                  type="button"
                  className={`chip ${sz === size ? 'chip-on' : 'chip-off'}`}
                  onClick={() => setSize(sz)}
                >
                  {sz}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div>
              <label className="label">Cantidad</label>
              <Stepper value={qty} min={1} onCommit={setQty} ariaLabel="Cantidad" />
            </div>
            <div className="text-right">
              <div className="text-xs font-semibold text-slate-500">
                {qty >= payload.wholesaleMin ? 'Precio Mayorista' : 'Precio Unitario'}: {money(unitPrice)} c/u
              </div>
              <div className="text-2xl font-extrabold text-slate-900">{money(total)}</div>
            </div>
          </div>

          <a
            className="btn w-full bg-[#25D366] text-lg text-white hover:bg-[#1ebe5b]"
            href={
              payload.storePhone
                ? whatsappUrl(payload.storePhone, orderText)
                : `https://wa.me/?text=${encodeURIComponent(orderText)}`
            }
            target="_blank"
            rel="noreferrer"
          >
            💬 Pedir este Diseño por WhatsApp
          </a>
        </section>
      </div>
    </div>
  );
}
