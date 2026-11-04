import { useEffect, useMemo, useState } from 'react';
import { useAppState, useStock, useSyncStatus } from '../lib/store';
import { activeBrands, brandColors, normalPrice, vkey } from '../lib/inventory';
import { money } from '../lib/money';
import { uid } from '../lib/ids';
import { compressImage, applyBackgroundRemoval, removeBackgroundWithAI, upscaleImageTo4K } from '../lib/image';
import { savePhoto } from '../lib/db';
import { fetchSharedPhoto, uploadPhotoNow } from '../lib/sync';
import { copyText } from '../lib/csv';
import { whatsappUrl } from '../lib/whatsapp';
import { InteractiveShirt3D, type DecalPlacement } from '../components/Shirt';
import { NewColorModal } from '../components/NewColorModal';
import { Stepper, toast } from '../components/ui';
import { useCatalogDesigns, type SharedCatalogDesignRef } from '../lib/catalogDesigns';

export interface SharedCatalogColor {
  id?: string;
  name: string;
  hex: string;
}

export interface SharedCatalogPayload {
  storeName: string;
  storePhone: string;
  brandId?: string;
  brandName: string;
  colors: SharedCatalogColor[];
  sizes: string[];
  priceNormal: number;
  priceWholesale: number;
  wholesaleMin: number;
  photoId: string | null;
  placement: DecalPlacement;
  scale: number;
  offsetX?: number;
  offsetY: number;
  designs?: SharedCatalogDesignRef[];
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
  const [selectedSize, setSelectedSize] = useState(
    settings.sizes.includes('M') ? 'M' : settings.sizes[0] || 'M'
  );
  const [enabledColorIds, setEnabledColorIds] = useState<string[]>(() => colors.map((c) => c.id));
  const [rawDesignUrl, setRawDesignUrl] = useState<string | null>(null);
  const [designUrl, setDesignUrl] = useState<string | null>(null);
  const [removeBg, setRemoveBg] = useState(false);
  const [bgTolerance, setBgTolerance] = useState(32);
  const [processingMsg, setProcessingMsg] = useState<string | null>(null);
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [activeCatalogDesignId, setActiveCatalogDesignId] = useState<string | null>(null);
  const [placement, setPlacement] = useState<DecalPlacement>('center');
  const [scale, setScale] = useState(2.75);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(2);
  const [autoMotion, setAutoMotion] = useState(true);
  const [colorModal, setColorModal] = useState(false);
  const [previewClient, setPreviewClient] = useState<SharedCatalogPayload | null>(null);

  const {
    allDesigns,
    clientDesigns,
    saveCurrentToCatalog,
    uploadFilesToCatalog,
    toggleVisible,
    deleteDesign
  } = useCatalogDesigns();

  useEffect(() => {
    const ids = colors.map((c) => c.id);
    setEnabledColorIds(ids);
    if (!colors.some((c) => c.id === activeColorId)) {
      setActiveColorId(colors[0]?.id || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand?.id, colors.length]);

  const activeColor = colors.find((c) => c.id === activeColorId) || colors[0];

  const colorTotalStock = (cId: string): number => {
    if (!brand) return 0;
    return settings.sizes.reduce((s, sz) => s + (stock.get(vkey(brand.id, cId, sz)) || 0), 0);
  };

  const currentVariantStock =
    brand && activeColor ? stock.get(vkey(brand.id, activeColor.id, selectedSize)) || 0 : 0;

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

  const onUploadDesign = async (file: File | undefined) => {
    if (!file) return;
    try {
      const raw = await compressImage(file, 1400, 0.92, false);
      const processed = removeBg ? await applyBackgroundRemoval(raw, true, bgTolerance) : raw;
      const id = uid();
      await savePhoto(id, processed, 0);
      void uploadPhotoNow(id, processed);
      setPhotoId(id);
      setActiveCatalogDesignId(null);
      setRawDesignUrl(raw);
      setDesignUrl(processed);
      setScale(2.75);
      setOffsetX(0);
      setOffsetY(2);
      toast(
        removeBg
          ? 'Diseño sin fondo aplicado en Tamaño A3'
          : 'Diseño aplicado a la camisa 3D en Tamaño A3'
      );
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const handleToggleRemoveBg = async (next: boolean, tol = bgTolerance) => {
    setRemoveBg(next);
    setBgTolerance(tol);
    const base = rawDesignUrl || designUrl;
    if (!base) return;
    try {
      const updated = next ? await applyBackgroundRemoval(base, true, tol) : base;
      setDesignUrl(updated);
      if (photoId) {
        await savePhoto(photoId, updated, 0);
        void uploadPhotoNow(photoId, updated);
      }
    } catch {
      /* mantener actual */
    }
  };

  const handleAiRemoveBg = async () => {
    const base = rawDesignUrl || designUrl;
    if (!base) return;
    try {
      setProcessingMsg('Iniciando IA de recorte profesional...');
      const aiResult = await removeBackgroundWithAI(base, (msg) => setProcessingMsg(msg));
      setDesignUrl(aiResult);
      setRemoveBg(true);
      if (photoId) {
        await savePhoto(photoId, aiResult, 0);
        void uploadPhotoNow(photoId, aiResult);
      }
      toast('Fondo eliminado con IA preservando todos los detalles del diseño');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setProcessingMsg(null);
    }
  };

  const handleUpscale4K = async () => {
    if (!designUrl) return;
    try {
      setProcessingMsg('Escalando y enfocando diseño a 4K Ultra HD...');
      const { dataUrl, width, height } = await upscaleImageTo4K(designUrl, 2560);
      setDesignUrl(dataUrl);
      if (photoId) {
        await savePhoto(photoId, dataUrl, 0);
      }
      toast(`Diseño escalado a 4K Ultra HD (${width}×${height} px)`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setProcessingMsg(null);
    }
  };

  const buildPayload = (): SharedCatalogPayload => {
    const selectedColors = colors
      .filter((c) => enabledColorIds.includes(c.id))
      .map((c) => ({ id: c.id, name: c.name, hex: c.hex }));
    return {
      storeName: settings.storeName,
      storePhone: settings.storePhone,
      brandId: brand?.id,
      brandName: brand?.name || 'Camisa',
      colors:
        selectedColors.length > 0
          ? selectedColors
          : colors.map((c) => ({ id: c.id, name: c.name, hex: c.hex })),
      sizes: settings.sizes,
      priceNormal: normalPrice(settings, brand),
      priceWholesale: settings.priceWholesale,
      wholesaleMin: settings.wholesaleMin,
      photoId,
      placement,
      scale,
      offsetX,
      offsetY,
      designs: clientDesigns.map((d) => ({
        id: d.id,
        name: d.name,
        photoId: d.photoId,
        placement: d.placement
      }))
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
          text: `Mira en vivo nuestros colores y tallas disponibles en 3D (${brand?.name || ''}):`,
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
    const text = `¡Hola! 👋 Mira en vivo nuestro *Catálogo 3D Interactivo* de *${settings.storeName}* (${brand?.name || ''}).\n\nPuedes girar la camisa en 3D, ver qué colores y tallas están disponibles en tiempo real y probar el diseño aquí:\n${url}`;
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
          <div className="flex flex-wrap items-center gap-2">
            <div>
              <h2 className="text-base font-extrabold text-slate-900">✨ Estudio y Catálogo 3D en Vivo</h2>
              <p className="text-xs font-medium text-slate-500">
                Prenda 3D Real (WebGL 360°) · Stock en tiempo real por color y talla
              </p>
            </div>
            {brands.length > 1 && (
              <div className="flex flex-wrap items-center gap-1 rounded-2xl bg-slate-200/70 p-1">
                {brands.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setBrandId(b.id)}
                    className={`rounded-xl px-2.5 py-1 text-xs font-extrabold transition ${
                      b.id === brand?.id
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'text-slate-700 hover:bg-white/70'
                    }`}
                  >
                    {b.name}
                  </button>
                ))}
              </div>
            )}
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
          designOffsetX={offsetX}
          designOffsetY={offsetY}
          onDesignChange={(patch) => {
            if (patch.scale !== undefined) setScale(patch.scale);
            if (patch.offsetX !== undefined) setOffsetX(patch.offsetX);
            if (patch.offsetY !== undefined) setOffsetY(patch.offsetY);
            if (patch.placement !== undefined) setPlacement(patch.placement);
          }}
          onUploadFile={(file) => void onUploadDesign(file)}
          onClearDesign={() => {
            setDesignUrl(null);
            setRawDesignUrl(null);
            setPhotoId(null);
            setActiveCatalogDesignId(null);
          }}
          removeBg={removeBg}
          onToggleRemoveBg={(next) => void handleToggleRemoveBg(next, bgTolerance)}
          bgTolerance={bgTolerance}
          onChangeBgTolerance={(tol) => void handleToggleRemoveBg(true, tol)}
          onAiRemoveBg={() => void handleAiRemoveBg()}
          onUpscale4K={() => void handleUpscale4K()}
          processingText={processingMsg}
          colorOptions={colors.map((c) => {
            const totalC = colorTotalStock(c.id);
            return {
              id: c.id,
              name: c.name,
              hex: c.hex,
              available: totalC > 0,
              included: enabledColorIds.includes(c.id),
              stockText: totalC > 0 ? `${totalC} disp.` : 'Pronto'
            };
          })}
          activeColorId={activeColor?.id}
          onSelectColor={(id) => setActiveColorId(id)}
          onToggleColorIncluded={(id) => toggleColorIncluded(id)}
          onAddNewColor={() => setColorModal(true)}
          isStoreOwner
          catalogDesigns={allDesigns}
          activeCatalogDesignId={activeCatalogDesignId}
          onSelectCatalogDesign={(d) => {
            if (!d.imageUrl) return;
            setDesignUrl(d.imageUrl);
            setRawDesignUrl(d.imageUrl);
            setPhotoId(d.photoId);
            setActiveCatalogDesignId(d.id);
            setPlacement(d.placement || 'center');
            setScale(2.75);
            setOffsetX(0);
            setOffsetY(2);
            toast(`"${d.name}" aplicado en Tamaño A3`);
          }}
          onSaveCurrentToCatalog={() => {
            if (!designUrl) return;
            void saveCurrentToCatalog({
              dataUrl: designUrl,
              placement,
              existingPhotoId: photoId
            }).then((saved) => {
              setActiveCatalogDesignId(saved.id);
              toast(`"${saved.name}" guardado en el catálogo (visible al cliente)`);
            });
          }}
          onUploadCatalogFiles={(files) => {
            setProcessingMsg('Agregando diseños al catálogo...');
            void uploadFilesToCatalog(files, {
              removeBg,
              tolerance: bgTolerance,
              placement
            })
              .then((n) => {
                if (n > 0) toast(`${n} diseño(s) agregado(s) al catálogo en Tamaño A3`);
              })
              .finally(() => setProcessingMsg(null));
          }}
          onToggleCatalogDesignVisible={(id, nextVis) => {
            toggleVisible(id, nextVis);
            toast(
              nextVis
                ? 'Diseño habilitado para que el cliente lo vea'
                : 'Diseño oculto para el cliente'
            );
          }}
          onDeleteCatalogDesign={(id) => {
            deleteDesign(id);
            if (activeCatalogDesignId === id) setActiveCatalogDesignId(null);
            toast('Diseño eliminado del catálogo');
          }}
          autoMotion={autoMotion}
          stockBadge={{
            available: currentVariantStock > 0,
            text:
              currentVariantStock > 0
                ? `Talla ${selectedSize}: ${currentVariantStock} en stock`
                : `Talla ${selectedSize}: Disponible pronto`
          }}
        />

        {/* Vista rápida de tallas en vivo para el color activo */}
        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {settings.sizes.map((sz) => {
            const st = brand && activeColor ? stock.get(vkey(brand.id, activeColor.id, sz)) || 0 : 0;
            const isSel = sz === selectedSize;
            return (
              <button
                key={sz}
                type="button"
                onClick={() => setSelectedSize(sz)}
                className={`flex min-h-[54px] flex-col items-center justify-center rounded-xl border-2 px-2 py-1 transition ${
                  isSel
                    ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                    : st > 0
                    ? 'border-emerald-200 bg-white text-slate-900'
                    : 'border-slate-200 bg-slate-50 text-slate-500'
                }`}
              >
                <span className="text-sm font-extrabold">{sz}</span>
                <span
                  className={`text-[11px] font-bold ${
                    isSel
                      ? st > 0
                        ? 'text-emerald-300'
                        : 'text-amber-300'
                      : st > 0
                      ? 'text-emerald-600'
                      : 'text-amber-600'
                  }`}
                >
                  {st > 0 ? `${st} en stock` : 'Disponible pronto'}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Compartir catálogo 3D */}
      <section className="card space-y-3">
        <h2 className="section-title mb-0">Compartir Catálogo 3D con el Cliente</h2>
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

/**
 * Vista interactiva limpia para el cliente (#catalogo=...).
 * Conectada en tiempo real a Supabase para mostrar existencias en vivo por color y talla,
 * o "Disponible pronto" cuando una variante está en 0.
 */
export function CustomerCatalogView({
  payload,
  initialDesignUrl = null,
  onExitPreview
}: {
  payload: SharedCatalogPayload;
  initialDesignUrl?: string | null;
  onExitPreview?: () => void;
}) {
  const state = useAppState();
  const { stock } = useStock();
  const { status } = useSyncStatus();

  const [selectedColor, setSelectedColor] = useState<SharedCatalogColor>(payload.colors[0]);
  const [designUrl, setDesignUrl] = useState<string | null>(initialDesignUrl);
  const [activeCatalogDesignId, setActiveCatalogDesignId] = useState<string | null>(null);
  const [selectedDesignName, setSelectedDesignName] = useState<string | null>(null);
  const [placement, setPlacement] = useState<DecalPlacement>(payload.placement || 'center');
  const [scale, setScale] = useState(payload.scale || 2.75);
  const [offsetX, setOffsetX] = useState(payload.offsetX || 0);
  const [offsetY, setOffsetY] = useState(payload.offsetY ?? 2);
  const [size, setSize] = useState(payload.sizes.includes('M') ? 'M' : payload.sizes[0] || 'M');
  const [qty, setQty] = useState(1);

  const { clientDesigns } = useCatalogDesigns(payload.designs);

  useEffect(() => {
    if (!designUrl && payload.photoId) {
      void fetchSharedPhoto(payload.photoId).then((d) => {
        if (d) {
          setDesignUrl(d);
        }
      });
    }
  }, [payload.photoId, designUrl]);

  // Resolver la marca y colores en el estado sincronizado en vivo
  const liveBrand = useMemo(
    () =>
      state.brands.find(
        (b) =>
          (payload.brandId && b.id === payload.brandId) ||
          b.name.toLowerCase() === payload.brandName.toLowerCase()
      ),
    [state.brands, payload.brandId, payload.brandName]
  );

  const resolveColorId = (c: SharedCatalogColor): string | null => {
    if (c.id && state.colors.some((x) => x.id === c.id)) return c.id;
    if (!liveBrand) return null;
    const found = state.colors.find(
      (x) =>
        x.brandId === liveBrand.id &&
        !x.deleted &&
        (x.name.toLowerCase() === c.name.toLowerCase() || x.hex.toUpperCase() === c.hex.toUpperCase())
    );
    return found?.id || null;
  };

  const getSizeStock = (c: SharedCatalogColor, sz: string): number => {
    const cId = resolveColorId(c);
    if (!liveBrand || !cId) return 0;
    return stock.get(vkey(liveBrand.id, cId, sz)) || 0;
  };

  const getColorTotalStock = (c: SharedCatalogColor): number => {
    return payload.sizes.reduce((sum, sz) => sum + getSizeStock(c, sz), 0);
  };

  // Si el color seleccionado cambia y la talla actual está en 0 pero otra talla sí tiene stock, sugerir la primera con stock
  const handleSelectColor = (c: SharedCatalogColor) => {
    setSelectedColor(c);
    if (getSizeStock(c, size) === 0) {
      const firstAvail = payload.sizes.find((sz) => getSizeStock(c, sz) > 0);
      if (firstAvail) setSize(firstAvail);
    }
  };

  const selectedSizeStock = getSizeStock(selectedColor, size);
  const unitPrice = qty >= payload.wholesaleMin ? payload.priceWholesale : payload.priceNormal;
  const total = qty * unitPrice;

  const placementLabel = PLACEMENTS.find((p) => p.id === placement)?.label || 'Pecho Centro';
  const stockNote =
    selectedSizeStock >= qty
      ? `Disponible en stock (${selectedSizeStock} uds)`
      : selectedSizeStock > 0
      ? `${selectedSizeStock} en stock inmediato + ${qty - selectedSizeStock} disponible pronto`
      : 'Bajo pedido (Disponible pronto)';

  const designNote = selectedDesignName
    ? `\n• Diseño elegido: ${selectedDesignName} (${scale >= 2.4 ? 'Tamaño A3' : `${Math.round(scale * 100)}%`})`
    : '';
  const orderText = `¡Hola ${payload.storeName}! 👋 Vi el Catálogo 3D en vivo y quiero pedir:\n\n• Marca: ${payload.brandName}\n• Color: ${selectedColor?.name}\n• Talla: ${size} (${stockNote})\n• Cantidad: ${qty} uds${designNote}\n• Ubicación del diseño: ${placementLabel}\n• Total estimado: ${money(total)}`;

  return (
    <div className="min-h-screen bg-slate-100 pb-10">
      <header className="safe-top sticky top-0 z-40 bg-slate-900 text-white shadow-md">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-extrabold">{payload.storeName}</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-xs font-semibold text-emerald-300">
                <span
                  className={`h-2 w-2 rounded-full ${
                    status === 'live' ? 'bg-emerald-400 animate-pulse' : 'bg-sky-400'
                  }`}
                />
                Stock en vivo
              </span>
            </div>
            <div className="text-xs text-sky-200">Catálogo 3D Interactivo · {payload.brandName}</div>
          </div>
          {onExitPreview && (
            <button
              className="btn min-h-[40px] bg-white px-3 text-sm text-slate-900"
              onClick={onExitPreview}
            >
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
            designOffsetX={offsetX}
            designOffsetY={offsetY}
            colorOptions={payload.colors.map((c) => {
              const totalC = getColorTotalStock(c);
              return {
                id: c.name,
                name: c.name,
                hex: c.hex,
                available: totalC > 0,
                stockText: totalC > 0 ? '● Disp.' : '⏳ Pronto'
              };
            })}
            activeColorId={selectedColor?.name}
            onSelectColor={(cName) => {
              const found = payload.colors.find((x) => x.name === cName);
              if (found) handleSelectColor(found);
            }}
            catalogDesigns={clientDesigns}
            activeCatalogDesignId={activeCatalogDesignId}
            onSelectCatalogDesign={(d) => {
              if (!d.imageUrl) return;
              setDesignUrl(d.imageUrl);
              setActiveCatalogDesignId(d.id);
              setSelectedDesignName(d.name);
              setPlacement(d.placement || 'center');
              setScale(2.75);
              setOffsetX(0);
              setOffsetY(2);
            }}
            autoMotion
            stockBadge={{
              available: selectedSizeStock > 0,
              text:
                selectedSizeStock > 0
                  ? `Talla ${size}: Disponible (${selectedSizeStock})`
                  : `Talla ${size}: Disponible pronto`
            }}
          />
        </section>

        {/* Tallas en vivo con etiqueta "Disponible pronto" si está en 0 */}
        <section className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="section-title mb-0">1 · Elige tu Talla ({selectedColor?.name})</h2>
            <span className="text-xs font-semibold text-slate-500">Stock en tiempo real</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {payload.sizes.map((sz) => {
              const st = getSizeStock(selectedColor, sz);
              const isSel = sz === size;
              return (
                <button
                  key={sz}
                  type="button"
                  onClick={() => setSize(sz)}
                  className={`flex min-h-[60px] flex-col items-center justify-center rounded-xl border-2 px-3 py-2 transition ${
                    isSel
                      ? 'border-slate-900 bg-slate-900 text-white shadow'
                      : st > 0
                      ? 'border-emerald-200 bg-white text-slate-900 hover:border-emerald-400'
                      : 'border-slate-200 bg-slate-50 text-slate-500'
                  }`}
                >
                  <span className="text-base font-extrabold">{sz}</span>
                  {st > 0 ? (
                    <span
                      className={`text-xs font-bold ${
                        isSel ? 'text-emerald-300' : st <= 5 ? 'text-amber-600' : 'text-emerald-600'
                      }`}
                    >
                      {st <= 5 ? `¡Últimas ${st} disp.!` : `Disponible (${st})`}
                    </span>
                  ) : (
                    <span className={`text-xs font-bold ${isSel ? 'text-amber-300' : 'text-amber-600'}`}>
                      Disponible pronto
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* Cantidad y botón de pedido por WhatsApp */}
        <section className="card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
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

          {selectedSizeStock === 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
              ⏳ La talla <strong>{size}</strong> en color <strong>{selectedColor?.name}</strong> está marcada como{' '}
              <strong>Disponible pronto</strong>. Puedes apartarla o encargarla bajo pedido por WhatsApp.
            </div>
          )}

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
            💬 {selectedSizeStock > 0 ? 'Pedir Ahora por WhatsApp' : 'Encargar (Disponible pronto) por WhatsApp'}
          </a>
        </section>
      </div>
    </div>
  );
}
