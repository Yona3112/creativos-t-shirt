import { useEffect, useMemo, useState } from 'react';
import { getState, useAppState, useStock, useSyncStatus } from '../lib/store';
import { activeBrands, brandColors, normalPrice, vkey } from '../lib/inventory';
import { updateSettings } from '../lib/actions';
import { money } from '../lib/money';
import { uid } from '../lib/ids';
import { compressImage, applyBackgroundRemoval, removeBackgroundWithAI, upscaleImageTo4K } from '../lib/image';
import { savePhoto } from '../lib/db';
import { fetchSharedPhoto, uploadPhotoNow } from '../lib/sync';
import { copyText } from '../lib/csv';
import { whatsappUrl } from '../lib/whatsapp';
import { InteractiveShirt3D, type BoutiqueTheme, type DecalPlacement } from '../components/Shirt';
import { NewColorModal } from '../components/NewColorModal';
import { Stepper, toast } from '../components/ui';
import { useCatalogDesigns } from '../lib/catalogDesigns';
import {
  buildPublicCatalog,
  LIVE_CATALOG_KEY,
  WEB_ORDER_LATEST_KEY,
  type CustomerWebOrderPayload,
  type SharedCatalogColor,
  type SharedCatalogDesignRef,
  type SharedCatalogPayload
} from '../lib/publicCatalog';

export {
  LIVE_CATALOG_KEY,
  WEB_ORDER_LATEST_KEY,
  type CustomerWebOrderPayload,
  type SharedCatalogColor,
  type SharedCatalogDesignRef,
  type SharedCatalogPayload
};

export function readWebOrderImportHash(): string | null {
  const m = location.hash.match(/pedido=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

function buildDefaultLivePayload(): SharedCatalogPayload {
  return buildPublicCatalog(getState());
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
  const h = location.hash.replace(/^#\/?/, '').trim();
  if (!h) return null;
  // Enlace corto de Tienda Oficial (#tienda o #catalogo)
  if (h === 'tienda' || h === 'catalogo' || h.startsWith('c=')) {
    return buildDefaultLivePayload();
  }
  // Compatibilidad con enlaces anteriores (#catalogo=eyJ...)
  const m = location.hash.match(/catalogo=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  return decodeCatalog(m[1]) || buildDefaultLivePayload();
}

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
  const [placement, setPlacement] = useState<DecalPlacement>('back');
  const [scale, setScale] = useState(2.75);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(2);
  const [boutiqueTheme, setBoutiqueTheme] = useState<BoutiqueTheme>(settings.storeTheme || 'ranchero');
  const [autoMotion, setAutoMotion] = useState(true);
  const [colorModal, setColorModal] = useState(false);
  const [previewClient, setPreviewClient] = useState<SharedCatalogPayload | null>(null);

  const {
    allDesigns,
    clientDesigns,
    saveCurrentToCatalog,
    uploadFilesToCatalog,
    toggleVisible,
    renameDesign,
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
    const finalColors =
      selectedColors.length > 0
        ? selectedColors
        : colors.map((c) => ({ id: c.id, name: c.name, hex: c.hex }));
    const stockMap: Record<string, number> = {};
    if (brand) {
      for (const c of finalColors) {
        if (!c.id) continue;
        for (const sz of settings.sizes) {
          const n = stock.get(vkey(brand.id, c.id, sz)) || 0;
          if (n > 0) stockMap[`${c.id}|${sz}`] = n;
        }
      }
    }
    return {
      storeName: settings.storeName,
      storePhone: settings.storePhone,
      brandId: brand?.id,
      brandName: brand?.name || 'Camisa',
      colors: finalColors,
      sizes: settings.sizes,
      priceNormal: normalPrice(settings, brand),
      priceWholesale: settings.priceWholesale,
      wholesaleMin: settings.wholesaleMin,
      photoId,
      placement,
      scale,
      offsetX,
      offsetY,
      boutiqueTheme,
      designs: clientDesigns.map((d) => ({
        id: d.id,
        name: d.name,
        code: d.code,
        photoId: d.photoId,
        placement: d.placement
      })),
      stock: stockMap,
      publishedAt: Date.now()
    };
  };

  const buildShareUrl = (): string => {
    return `${location.origin}${location.pathname}#tienda`;
  };

  const syncLiveCatalogSnapshot = async () => {
    const payload = buildPayload();
    const rawJson = JSON.stringify(payload);
    await savePhoto(LIVE_CATALOG_KEY, rawJson, 0);
    await uploadPhotoNow(LIVE_CATALOG_KEY, rawJson);
    if (photoId && designUrl) {
      await uploadPhotoNow(photoId, designUrl);
    }
    // Asegurar que TODAS las imágenes de los diseños visibles del catálogo queden en la nube
    for (const d of allDesigns) {
      if (d.photoId && d.imageUrl) {
        void uploadPhotoNow(d.photoId, d.imageUrl);
      }
    }
  };

  const handleShareLink = async () => {
    void syncLiveCatalogSnapshot();
    const url = buildShareUrl();
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${settings.storeName} · Tienda 3D`,
          text: `Personaliza tu camisa en 3D y mira colores y tallas en vivo (${brand?.name || ''}):`,
          url
        });
        return;
      } catch {
        /* fallback a copiar */
      }
    }
    await copyText(url);
    toast('Enlace corto (#tienda) copiado');
  };

  const handleShareWhatsApp = async () => {
    void syncLiveCatalogSnapshot();
    const url = buildShareUrl();
    const text = `¡Hola! 👋 Entra a nuestra *Tienda 3D Interactiva* de *${settings.storeName}*:\n👉 ${url}\n\nAhí puedes girar la camisa en 3D, tocar los diseños disponibles, elegir color y talla en vivo y enviarnos tu pedido.`;
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
            setPlacement('back');
            setScale(2.75);
            setOffsetX(0);
            setOffsetY(2);
            toast(`"${d.name}" aplicado en la Espalda (Tamaño A3)`);
          }}
          boutiqueTheme={boutiqueTheme}
          onChangeBoutiqueTheme={(t) => {
            setBoutiqueTheme(t);
            updateSettings({ storeTheme: t });
          }}
          onRenameCatalogDesign={(id, name, code) => {
            renameDesign(id, name, code);
            toast('Nombre y código del diseño actualizados');
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

      {/* Compartir catálogo 3D con Enlace Corto */}
      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-title mb-0">Compartir Tienda 3D con el Cliente (Enlace Corto)</h2>
          <code className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-extrabold text-sky-800">
            {buildShareUrl()}
          </code>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <button className="btn-primary" onClick={handleShareLink}>
            🔗 Copiar Enlace Corto (#tienda)
          </button>
          <button
            className="btn bg-[#25D366] text-white hover:bg-[#1ebe5b]"
            onClick={handleShareWhatsApp}
          >
            💬 Enviar Link Corto por WhatsApp
          </button>
          <button
            className="btn-soft"
            onClick={() => {
              void syncLiveCatalogSnapshot();
              setPreviewClient(buildPayload());
            }}
          >
            🛍️ Ver Tienda del Cliente
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
 * TIENDA OFICIAL INTERACTIVA 3D PARA EL CLIENTE (#tienda).
 * Diseño visual tipo Boutique / Showroom completamente distinto al panel de administración
 * para evitar cualquier confusión y guiar al cliente paso a paso.
 */
export function CustomerCatalogView({
  payload: initialPayload,
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

  const [cloudPayload, setCloudPayload] = useState<SharedCatalogPayload | null>(null);

  // Al abrir el enlace corto #tienda, recuperar la configuración activa compartida por el administrador
  useEffect(() => {
    if (onExitPreview) return;
    void fetchSharedPhoto(LIVE_CATALOG_KEY).then((raw) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as SharedCatalogPayload;
        if (parsed && Array.isArray(parsed.colors) && parsed.colors.length > 0) {
          setCloudPayload(parsed);
        }
      } catch {
        /* usar estado en vivo */
      }
    });
  }, [onExitPreview]);

  // Combinar datos en vivo de Supabase con la configuración compartida
  const payload: SharedCatalogPayload = useMemo(() => {
    const base = cloudPayload || initialPayload;
    const liveBrands = activeBrands(state);
    const matchedBrand =
      liveBrands.find(
        (b) =>
          (base.brandId && b.id === base.brandId) ||
          b.name.toLowerCase() === base.brandName.toLowerCase()
      ) || liveBrands[0];

    const liveBrandColors = matchedBrand ? brandColors(state, matchedBrand.id) : [];
    const resolvedColors =
      cloudPayload || onExitPreview
        ? base.colors
        : liveBrandColors.length > 0
        ? liveBrandColors.map((c) => ({ id: c.id, name: c.name, hex: c.hex }))
        : base.colors;

    return {
      ...base,
      storeName: state.settings.storeName || base.storeName,
      storePhone: state.settings.storePhone || base.storePhone,
      brandId: matchedBrand?.id || base.brandId,
      brandName: matchedBrand?.name || base.brandName,
      colors: resolvedColors.length > 0 ? resolvedColors : base.colors,
      sizes: state.settings.sizes.length > 0 ? state.settings.sizes : base.sizes,
      priceNormal: matchedBrand ? normalPrice(state.settings, matchedBrand) : base.priceNormal,
      priceWholesale: state.settings.priceWholesale || base.priceWholesale,
      wholesaleMin: state.settings.wholesaleMin || base.wholesaleMin
    };
  }, [cloudPayload, initialPayload, onExitPreview, state]);

  const [selectedColor, setSelectedColor] = useState<SharedCatalogColor>(payload.colors[0]);
  const [designUrl, setDesignUrl] = useState<string | null>(initialDesignUrl);
  const [activeCatalogDesignId, setActiveCatalogDesignId] = useState<string | null>(null);
  const [selectedDesignName, setSelectedDesignName] = useState<string | null>(null);
  const [selectedDesignCode, setSelectedDesignCode] = useState<string | null>(null);
  const [selectedDesignPhotoId, setSelectedDesignPhotoId] = useState<string | null>(
    payload.photoId || null
  );
  const [placement, setPlacement] = useState<DecalPlacement>(payload.placement || 'back');
  const [scale, setScale] = useState(payload.scale || 2.75);
  const [offsetX, setOffsetX] = useState(payload.offsetX || 0);
  const [offsetY, setOffsetY] = useState(payload.offsetY ?? 2);
  const boutiqueTheme: BoutiqueTheme = payload.boutiqueTheme || 'ranchero';
  const [size, setSize] = useState(payload.sizes.includes('M') ? 'M' : payload.sizes[0] || 'M');
  const [qty, setQty] = useState(1);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');

  const { clientDesigns } = useCatalogDesigns(payload.designs);

  useEffect(() => {
    if (!payload.colors.some((c) => c.name === selectedColor?.name)) {
      setSelectedColor(payload.colors[0]);
    }
  }, [payload.colors, selectedColor]);

  useEffect(() => {
    if (!designUrl && payload.photoId) {
      void fetchSharedPhoto(payload.photoId).then((d) => {
        if (d) {
          setDesignUrl(d);
          setSelectedDesignPhotoId(payload.photoId);
        }
      });
    }
  }, [payload.photoId, designUrl]);

  // Si no hay diseño inicial pero hay diseños disponibles para el cliente, pre-cargar el primero automáticamente en la ESPALDA
  const [autoLoadedOnce, setAutoLoadedOnce] = useState(false);
  useEffect(() => {
    if (!autoLoadedOnce && !designUrl && !payload.photoId && clientDesigns.length > 0 && clientDesigns[0].imageUrl) {
      const first = clientDesigns[0];
      setAutoLoadedOnce(true);
      setDesignUrl(first.imageUrl);
      setActiveCatalogDesignId(first.id);
      setSelectedDesignName(first.name);
      setSelectedDesignCode(first.code || null);
      setSelectedDesignPhotoId(first.photoId);
      setPlacement('back');
      setScale(2.75);
      setOffsetX(0);
      setOffsetY(2);
    }
  }, [autoLoadedOnce, clientDesigns, designUrl, payload.photoId]);

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

  const getSizeStock = (c: SharedCatalogColor | undefined, sz: string): number => {
    if (!c) return 0;
    // En la vitrina pública usamos el snapshot saneado (sin exponer la base de datos privada)
    if (payload.stock && c.id && !onExitPreview) {
      return payload.stock[`${c.id}|${sz}`] || 0;
    }
    const cId = resolveColorId(c);
    if (!liveBrand || !cId) return 0;
    return stock.get(vkey(liveBrand.id, cId, sz)) || 0;
  };

  const getColorTotalStock = (c: SharedCatalogColor): number => {
    return payload.sizes.reduce((sum, sz) => sum + getSizeStock(c, sz), 0);
  };

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

  const isBackSide = placement === 'back';
  const sideLabelExplicit = !designUrl
    ? 'SIN ESTAMPADO (Camisa Lisa)'
    : isBackSide
    ? 'ESPALDA (Parte de Atrás de la Camisa)'
    : 'FRENTE (Pecho Delantero de la Camisa)';

  const stockNote =
    selectedSizeStock >= qty
      ? `Disponible en stock (${selectedSizeStock} uds)`
      : selectedSizeStock > 0
      ? `${selectedSizeStock} en stock inmediato + ${qty - selectedSizeStock} disponible pronto`
      : 'Bajo pedido (Disponible pronto)';

  const handleSendOrderWhatsApp = async () => {
    const orderId = uid().slice(0, 12);
    const cleanName = customerName.trim().slice(0, 80) || 'Cliente Tienda 3D';
    const cleanPhone = customerPhone.trim().slice(0, 24);
    const cleanAddr = customerAddress.trim().slice(0, 300);
    const webOrder: CustomerWebOrderPayload = {
      id: orderId,
      createdAt: Date.now(),
      customerName: cleanName,
      customerPhone: cleanPhone,
      customerAddress: cleanAddr,
      brandId: liveBrand?.id || payload.brandId,
      brandName: payload.brandName,
      colorId: resolveColorId(selectedColor) || selectedColor?.id,
      colorName: selectedColor?.name || 'Negro',
      colorHex: selectedColor?.hex || '#1A1A1C',
      size,
      qty,
      unitPrice,
      designId: activeCatalogDesignId,
      designName: designUrl ? selectedDesignName || 'Diseño personalizado' : null,
      designCode: designUrl ? selectedDesignCode : null,
      photoId: designUrl ? selectedDesignPhotoId : null,
      placement,
      scale
    };

    const rawOrderJson = JSON.stringify(webOrder);
    void savePhoto(WEB_ORDER_LATEST_KEY, rawOrderJson, 0);
    void savePhoto(`weborder_${orderId}`, rawOrderJson, 0);
    void uploadPhotoNow(WEB_ORDER_LATEST_KEY, rawOrderJson);
    void uploadPhotoNow(`weborder_${orderId}`, rawOrderJson);

    const importUrl = `${location.origin}${location.pathname}#pedido=${orderId}`;
    const clientHeader =
      cleanName || cleanPhone || cleanAddr
        ? `\n👤 *DATOS DEL CLIENTE:*\n• Nombre: ${cleanName}${
            cleanPhone ? `\n• Teléfono: ${cleanPhone}` : ''
          }${cleanAddr ? `\n• Dirección / Nota: ${cleanAddr}` : ''}\n`
        : '';

    const codePrefix = selectedDesignCode ? `[${selectedDesignCode}] ` : '';
    const designBlock = designUrl
      ? `\n• Diseño elegido: *${codePrefix}${selectedDesignName || 'Diseño del catálogo'}* (Tamaño A3)\n• 📍 LADO DEL ESTAMPADO: *${sideLabelExplicit}*`
      : `\n• Estilo: *Camisa Lisa (Sin estampado)*`;

    const orderText = `¡Hola ${payload.storeName}! 👋 Quiero hacer este pedido desde la Tienda 3D:\n${clientHeader}\n👕 *DETALLE DE LA CAMISA:*\n• Marca: ${payload.brandName}\n• Color: ${selectedColor?.name}\n• Talla: ${size} (${stockNote})\n• Cantidad: ${qty} uds${designBlock}\n• Total estimado: *${money(total)}*\n\n📥 *Cargar este pedido en 1 clic en el sistema:*\n${importUrl}`;

    const targetHref = payload.storePhone
      ? whatsappUrl(payload.storePhone, orderText)
      : `https://wa.me/?text=${encodeURIComponent(orderText)}`;

    window.open(targetHref, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="min-h-screen bg-[#140a04] pb-28 text-amber-50">
      {/* AVISO CLARO CUANDO EL ADMINISTRADOR ESTÁ PREVISUALIZANDO LA TIENDA DEL CLIENTE */}
      {onExitPreview && (
        <div className="sticky top-0 z-50 bg-amber-400 px-3 py-2 text-slate-950 shadow-md">
          <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-extrabold">
              <span className="rounded-md bg-slate-950 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-300">
                Modo Prueba
              </span>
              <span>Así ven tus clientes la Tienda (#tienda)</span>
            </div>
            <button
              type="button"
              onClick={onExitPreview}
              className="rounded-xl bg-slate-950 px-3 py-1.5 text-xs font-extrabold text-white shadow hover:bg-slate-800"
            >
              ← Volver al Panel Admin
            </button>
          </div>
        </div>
      )}

      {/* CABECERA EXCLUSIVA DE LA TIENDA DEL CLIENTE */}
      <header className="border-b border-amber-500/30 bg-gradient-to-r from-[#2b1407] via-[#3e1d0a] to-[#1f0e05] px-4 py-4 shadow-lg">
        <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-amber-400/20 px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wider text-amber-300 ring-1 ring-amber-400/40">
                👕 Catálogo Oficial 3D
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300 ring-1 ring-emerald-400/30">
                <span
                  className={`h-2 w-2 rounded-full ${
                    status === 'live' ? 'bg-emerald-400 animate-pulse' : 'bg-sky-400'
                  }`}
                />
                Existencias en Vivo
              </span>
            </div>
            <h1 className="mt-1 text-xl font-extrabold tracking-tight text-white">
              {payload.storeName}
            </h1>
            <p className="text-xs font-medium text-amber-200/85">
              Personalizador Interactivo · Camisas {payload.brandName}
            </p>
          </div>

          <div className="flex items-center gap-2 rounded-2xl border border-amber-400/25 bg-black/30 px-3 py-2 text-right backdrop-blur-sm">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-amber-200/70">
                Unidad
              </div>
              <div className="text-sm font-extrabold text-white">{money(payload.priceNormal)}</div>
            </div>
            <div className="h-7 w-px bg-amber-400/20" />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300">
                Mayorista ({payload.wholesaleMin}+)
              </div>
              <div className="text-sm font-extrabold text-amber-300">
                {money(payload.priceWholesale)}
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 px-3 pt-4">
        {/* ESCAPARATE 3D INTERACTIVO DEL CLIENTE */}
        <section className="rounded-3xl border border-amber-500/25 bg-[#211006]/90 p-3 shadow-xl">
          <InteractiveShirt3D
            hex={selectedColor?.hex || '#111827'}
            colorName={selectedColor?.name || ''}
            brandName={payload.brandName}
            designUrl={designUrl}
            placement={placement}
            designScale={scale}
            designOffsetX={offsetX}
            designOffsetY={offsetY}
            onDesignChange={(patch) => {
              if (patch.placement !== undefined) setPlacement(patch.placement);
              if (patch.scale !== undefined) setScale(patch.scale);
              if (patch.offsetX !== undefined) setOffsetX(patch.offsetX);
              if (patch.offsetY !== undefined) setOffsetY(patch.offsetY);
            }}
            onClearDesign={() => {
              setDesignUrl(null);
              setActiveCatalogDesignId(null);
              setSelectedDesignName(null);
              setSelectedDesignCode(null);
              setSelectedDesignPhotoId(null);
            }}
            boutiqueTheme={boutiqueTheme}
            colorOptions={payload.colors.map((c) => {
              const totalC = getColorTotalStock(c);
              return {
                id: c.name,
                name: c.name,
                hex: c.hex,
                available: totalC > 0,
                stockText: totalC > 0 ? '● Disponible' : '⏳ Pronto'
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
              // Siempre empieza en la ESPALDA y luego el cliente puede elegir Frontal o quitarlo
              setDesignUrl(d.imageUrl);
              setActiveCatalogDesignId(d.id);
              setSelectedDesignName(d.name);
              setSelectedDesignCode(d.code || null);
              setSelectedDesignPhotoId(d.photoId);
              setPlacement('back');
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

        {/* PASO 3: SELECCIÓN DE TALLA ESTILO TIENDA ONLINE */}
        <section className="rounded-3xl border border-amber-500/25 bg-[#211006]/90 p-4 shadow-xl">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-amber-400 px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-slate-950">
                📏 Paso 3
              </span>
              <h2 className="text-sm font-extrabold text-white">
                Elige tu Talla ({selectedColor?.name})
              </h2>
            </div>
            <span className="text-xs font-semibold text-emerald-300">● Inventario en tiempo real</span>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {payload.sizes.map((sz) => {
              const st = getSizeStock(selectedColor, sz);
              const isSel = sz === size;
              return (
                <button
                  key={sz}
                  type="button"
                  onClick={() => setSize(sz)}
                  className={`flex min-h-[62px] flex-col items-center justify-center rounded-2xl border-2 px-2 py-2 transition ${
                    isSel
                      ? 'scale-[1.03] border-amber-400 bg-amber-400 text-slate-950 shadow-lg'
                      : st > 0
                      ? 'border-white/15 bg-black/40 text-white hover:border-amber-300/60'
                      : 'border-white/5 bg-black/20 text-slate-400'
                  }`}
                >
                  <span className="text-base font-extrabold">{sz}</span>
                  {st > 0 ? (
                    <span
                      className={`text-[10px] font-extrabold ${
                        isSel ? 'text-slate-900' : st <= 5 ? 'text-amber-300' : 'text-emerald-300'
                      }`}
                    >
                      {st <= 5 ? `¡Últimas ${st}!` : `Disponible`}
                    </span>
                  ) : (
                    <span
                      className={`text-[10px] font-bold ${
                        isSel ? 'text-slate-800' : 'text-amber-400/90'
                      }`}
                    >
                      Pronto
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* PASO 4: DATOS DEL CLIENTE, CANTIDAD Y CONFIRMACIÓN DE LADO (ESPALDA / FRENTE) */}
        <section className="space-y-3 rounded-3xl border border-amber-500/25 bg-[#211006]/90 p-4 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-amber-400 px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-slate-950">
                👤 Paso 4
              </span>
              <h2 className="text-sm font-extrabold text-white">
                Tus Datos y Resumen de Estampado
              </h2>
            </div>
            <span className="rounded-lg bg-amber-400/20 px-2.5 py-1 text-xs font-extrabold text-amber-300">
              📍 {sideLabelExplicit}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-bold text-amber-200">
                Tu Nombre Completo *
              </label>
              <input
                type="text"
                maxLength={80}
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Ej. Juan Pérez"
                className="w-full rounded-xl border border-amber-500/30 bg-black/40 px-3 py-2.5 text-sm font-bold text-white placeholder-amber-200/40 focus:border-amber-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-amber-200">
                Tu Teléfono / WhatsApp
              </label>
              <input
                type="tel"
                maxLength={24}
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="Ej. 9999-8888"
                className="w-full rounded-xl border border-amber-500/30 bg-black/40 px-3 py-2.5 text-sm font-bold text-white placeholder-amber-200/40 focus:border-amber-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-amber-200">
                Dirección o Nota de Entrega
              </label>
              <input
                type="text"
                maxLength={300}
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
                placeholder="Barrio / Colonia / Ciudad"
                className="w-full rounded-xl border border-amber-500/30 bg-black/40 px-3 py-2.5 text-sm font-bold text-white placeholder-amber-200/40 focus:border-amber-400 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3">
            <div>
              <div className="mb-1 text-xs font-extrabold uppercase tracking-wider text-amber-300">
                Cantidad de Camisas
              </div>
              <div className="rounded-2xl bg-white p-1 text-slate-900">
                <Stepper value={qty} min={1} onCommit={setQty} ariaLabel="Cantidad" />
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs font-bold text-amber-100/80">
                {qty >= payload.wholesaleMin ? '✨ Precio Mayorista Aplicado' : 'Precio Unitario'}:{' '}
                <strong className="text-white">{money(unitPrice)} c/u</strong>
              </div>
              <div className="text-2xl font-extrabold text-amber-300">{money(total)}</div>
            </div>
          </div>

          {selectedSizeStock === 0 && (
            <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200">
              ⏳ La talla <strong>{size}</strong> en color <strong>{selectedColor?.name}</strong> está como{' '}
              <strong>Disponible pronto</strong>. Puedes apartarla o encargarla bajo pedido por WhatsApp.
            </div>
          )}
        </section>
      </div>

      {/* BARRA INFERIOR FIJA DE COMPRA (ESTILO TIENDA ONLINE) */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-amber-500/30 bg-[#1a0c04]/95 px-4 py-3 shadow-2xl backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-xs font-bold text-amber-100">
              {selectedColor?.name} · Talla {size} · {qty} {qty === 1 ? 'ud' : 'uds'} ·{' '}
              <span className="font-extrabold text-amber-300">
                {designUrl
                  ? `${selectedDesignName || 'Diseño'} (${isBackSide ? 'EN ESPALDA' : 'EN FRENTE'})`
                  : 'Camisa Lisa'}
              </span>
            </div>
            <div className="text-lg font-extrabold text-amber-300">{money(total)}</div>
          </div>
          <button
            type="button"
            onClick={() => void handleSendOrderWhatsApp()}
            className="inline-flex min-h-[48px] shrink-0 items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-5 py-2.5 text-sm font-extrabold text-white shadow-lg transition hover:bg-[#1ebe5b] active:scale-95"
          >
            <span>💬</span>
            <span>{selectedSizeStock > 0 ? 'Pedir por WhatsApp' : 'Encargar por WhatsApp'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
