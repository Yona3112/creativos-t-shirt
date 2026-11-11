import { useEffect, useMemo, useState } from 'react';
import { getState, useAppState, useStock, useSyncStatus } from '../lib/store';
import { activeBrands, brandColors, normalPrice, vkey } from '../lib/inventory';
import { updateSettings, deleteColor, updateColor } from '../lib/actions';
import { money } from '../lib/money';
import { uid } from '../lib/ids';
import { compressImage, applyBackgroundRemoval, removeBackgroundWithAI, upscaleImageTo4K } from '../lib/image';
import { db, savePhoto } from '../lib/db';
import { fetchSharedPhoto, uploadPhotoNow } from '../lib/sync';
import { subscribeLiveCatalogFirebase } from '../lib/firebaseSync';
import { copyText } from '../lib/csv';
import { whatsappUrl } from '../lib/whatsapp';
import { InteractiveShirt3D, type BoutiqueTheme, type DecalPlacement } from '../components/Shirt';
import { NewColorModal } from '../components/NewColorModal';
import { Modal, Stepper, toast } from '../components/ui';
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
  const [scale, setScale] = useState(2.0);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [boutiqueTheme, setBoutiqueTheme] = useState<BoutiqueTheme>(settings.storeTheme || 'ranchero');
  const [autoMotion] = useState(true);
  const [colorModal, setColorModal] = useState(false);
  const [editingColor, setEditingColor] = useState<{ id: string; name: string; hex: string } | null>(null);
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
      setScale(2.0);
      setOffsetX(0);
      setOffsetY(0);
      toast(
        removeBg
          ? 'Diseño sin fondo aplicado en Tamaño A3 (200%)'
          : 'Diseño aplicado a la camisa 3D en Tamaño A3 (200%)'
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
    const activeStoreSizes =
      settings.storeSizes && settings.storeSizes.length > 0
        ? settings.sizes.filter((sz) => settings.storeSizes!.includes(sz))
        : settings.sizes;

    return {
      storeName: settings.storeName,
      storePhone: settings.storePhone,
      brandId: brand?.id,
      brandName: brand?.name || 'Camisa',
      colors: finalColors,
      sizes: activeStoreSizes.length > 0 ? activeStoreSizes : settings.sizes,
      priceNormal: settings.priceNormal || 30000,
      priceCustom: settings.priceCustom || 35000,
      priceWholesale: normalPrice(settings, brand),
      wholesaleMin: 999999,
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
    const uploads: Promise<void>[] = [];
    if (photoId && designUrl) {
      uploads.push(uploadPhotoNow(photoId, designUrl));
    }
    // Asegurar que TODAS las imágenes de los diseños visibles del catálogo queden en la nube (Firestore)
    for (const d of allDesigns) {
      if (!d.photoId) continue;
      let imgData = d.imageUrl;
      if (!imgData) {
        try {
          const row = await db.photos.get(d.photoId);
          imgData = row?.data || null;
        } catch {}
      }
      if (imgData) {
        uploads.push(uploadPhotoNow(d.photoId, imgData));
      }
    }
    await Promise.all(uploads);
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
      {/* Cabecera minimalista del Estudio 3D */}
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-extrabold text-slate-900">Catálogo 3D</h2>
            {brands.length > 1 && (
              <div className="flex flex-wrap items-center gap-1 rounded-2xl bg-slate-100 p-1">
                {brands.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setBrandId(b.id)}
                    className={`rounded-xl px-2.5 py-1 text-xs font-extrabold transition ${
                      b.id === brand?.id
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'text-slate-700 hover:bg-white'
                    }`}
                  >
                    {b.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-800 hover:bg-slate-100"
              onClick={() => {
                void syncLiveCatalogSnapshot();
                setPreviewClient(buildPayload());
              }}
            >
              Vista Cliente
            </button>
            <button
              type="button"
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-800 hover:bg-slate-100"
              onClick={handleShareLink}
            >
              Copiar Enlace
            </button>
            <button
              type="button"
              className="rounded-full bg-[#25D366] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#1ebe5b]"
              onClick={handleShareWhatsApp}
            >
              WhatsApp
            </button>
            <button
              type="button"
              className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800"
              onClick={async () => {
                await syncLiveCatalogSnapshot();
                toast('Catálogo sincronizado', 'ok');
              }}
            >
              Sincronizar
            </button>
          </div>
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
          onEditColor={(id) => {
            const target = colors.find((c) => c.id === id);
            if (target) setEditingColor({ id: target.id, name: target.name, hex: target.hex });
          }}
          onDeleteColor={(id) => {
            deleteColor(id);
            toast('Color eliminado del sistema');
            void syncLiveCatalogSnapshot();
          }}
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
            setScale(2.0);
            setOffsetX(0);
            setOffsetY(0);
            toast(`"${d.name}" aplicado en la Espalda (Tamaño A3 - 200%)`);
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

      {/* Colores y Tallas Visibles en #tienda */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-extrabold text-slate-900">Visibilidad en Tienda (#tienda)</h2>
          <button
            type="button"
            onClick={() => setColorModal(true)}
            className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-800 hover:bg-slate-200"
          >
            + Color
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {settings.sizes.map((sz) => {
            const activeList = settings.storeSizes || settings.sizes;
            const isEnabled = activeList.includes(sz);
            return (
              <button
                key={sz}
                type="button"
                onClick={() => {
                  const next = isEnabled
                    ? activeList.filter((x) => x !== sz)
                    : [...activeList, sz];
                  const finalSizes = next.length > 0 ? next : [sz];
                  updateSettings({ storeSizes: finalSizes });
                  void syncLiveCatalogSnapshot();
                }}
                className={`rounded-lg border px-2.5 py-1 text-xs font-extrabold transition ${
                  isEnabled
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-slate-50 text-slate-400 line-through'
                }`}
              >
                {sz}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-1.5 border-t border-slate-100 pt-2.5">
          {colors.map((c) => {
            const isEnabled = enabledColorIds.includes(c.id);
            return (
              <div
                key={c.id}
                className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs font-bold transition ${
                  isEnabled
                    ? 'border-slate-300 bg-white text-slate-800'
                    : 'border-slate-200 bg-slate-50 text-slate-400'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    toggleColorIncluded(c.id);
                    void syncLiveCatalogSnapshot();
                  }}
                  className="flex items-center gap-1.5"
                >
                  <span
                    className="h-3.5 w-3.5 rounded-full border border-black/20"
                    style={{ backgroundColor: c.hex }}
                  />
                  <span className={isEnabled ? '' : 'line-through'}>{c.name}</span>
                </button>
                <button
                  type="button"
                  title={`Editar ${c.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingColor({ id: c.id, name: c.name, hex: c.hex });
                  }}
                  className="ml-0.5 text-slate-400 hover:text-slate-800"
                >
                  ✏️
                </button>
                <button
                  type="button"
                  title={`Eliminar ${c.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteColor(c.id);
                    toast(`Color ${c.name} eliminado`);
                    void syncLiveCatalogSnapshot();
                  }}
                  className="text-rose-500 hover:text-rose-700"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {brand && (
        <NewColorModal
          open={colorModal}
          onClose={() => setColorModal(false)}
          brandId={brand.id}
        />
      )}

      <Modal
        open={!!editingColor}
        onClose={() => setEditingColor(null)}
        title={`Editar Color · ${editingColor?.name || ''}`}
      >
        {editingColor && (
          <div className="space-y-3">
            <div>
              <label className="label">Nombre del color</label>
              <input
                className="input"
                value={editingColor.name}
                onChange={(e) => setEditingColor({ ...editingColor, name: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Tono Hexadecimal</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  className="h-11 w-14 cursor-pointer rounded-xl border border-slate-200 p-0.5"
                  value={editingColor.hex.startsWith('#') && editingColor.hex.length === 7 ? editingColor.hex : '#1A1A1C'}
                  onChange={(e) => setEditingColor({ ...editingColor, hex: e.target.value.toUpperCase() })}
                />
                <input
                  className="input font-mono uppercase"
                  value={editingColor.hex}
                  onChange={(e) => setEditingColor({ ...editingColor, hex: e.target.value.toUpperCase() })}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-ghost" onClick={() => setEditingColor(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  if (!editingColor.name.trim()) return toast('Escribe un nombre para el color', 'error');
                  updateColor(editingColor.id, {
                    name: editingColor.name.trim(),
                    hex: editingColor.hex.trim().toUpperCase()
                  });
                  setEditingColor(null);
                  toast('Color actualizado', 'ok');
                  void syncLiveCatalogSnapshot();
                }}
              >
                Guardar
              </button>
            </div>
          </div>
        )}
      </Modal>
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
  useSyncStatus();

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

    // Suscripción reactiva en tiempo real a Firebase para reflejar cambios y nuevos diseños al instante
    const unsub = subscribeLiveCatalogFirebase((latest) => {
      setCloudPayload(latest);
    });
    return () => unsub();
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
  const [scale, setScale] = useState(payload.scale || 2.0);
  const [offsetX, setOffsetX] = useState(payload.offsetX || 0);
  const [offsetY, setOffsetY] = useState(payload.offsetY ?? 0);
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

  // La tienda del cliente arranca de forma limpia en Camisa Lisa (L 300) sin auto-cargar estampados forzados

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
  const hasDesign = !!designUrl;

  const readyMadeMatch = useMemo(() => {
    const list = state.readyMadeStock || [];
    if (!hasDesign || !selectedColor) return null;
    return list.find(
      (r) =>
        r.qty > 0 &&
        r.size === size &&
        r.colorName.toLowerCase() === selectedColor.name.toLowerCase() &&
        selectedDesignName &&
        r.designName.toLowerCase() === selectedDesignName.toLowerCase()
    );
  }, [state.readyMadeStock, hasDesign, selectedColor, size, selectedDesignName]);

  const unitPrice = hasDesign ? (payload.priceCustom || 35000) : (payload.priceNormal || 30000);
  const total = qty * unitPrice;

  const isBackSide = placement === 'back';
  const sideLabelExplicit = !designUrl
    ? 'SIN ESTAMPADO (L 300)'
    : isBackSide
    ? 'ESPALDA (Personalizada - L 350)'
    : 'FRENTE (Personalizada - L 350)';

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
      ? `\n• Estilo: *Personalizada (${money(unitPrice)})*\n• Diseño / Texto: *${codePrefix}${selectedDesignName || 'Diseño personalizado'}* (${scale >= 1.85 ? 'Tamaño A3' : 'Tamaño A4'})\n• 📍 LADO DEL ESTAMPADO: *${sideLabelExplicit}*`
      : `\n• Estilo: *Normal (${money(unitPrice)})*`;

    const readyMadeNote = readyMadeMatch
      ? `\n⚡ *DISPONIBILIDAD:* ¡Prenda ya estampada lista para ENTREGA INMEDIATA!`
      : '';

    const orderText = `¡Hola ${payload.storeName}! 👋 Quiero hacer este pedido desde la Tienda 3D:\n${clientHeader}\n👕 *DETALLE DE LA CAMISA:*\n• Marca: ${payload.brandName}\n• Color: ${selectedColor?.name}\n• Talla: ${size} (${stockNote})\n• Cantidad: ${qty} uds (${money(unitPrice)} c/u)${designBlock}${readyMadeNote}\n• Total: *${money(total)}*\n\n📥 *Cargar este pedido en 1 clic en el sistema:*\n${importUrl}`;

    const targetHref = payload.storePhone
      ? whatsappUrl(payload.storePhone, orderText)
      : `https://wa.me/?text=${encodeURIComponent(orderText)}`;

    window.open(targetHref, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="min-h-screen bg-[#F5F5F7] pb-28 text-slate-900">
      {/* Barra superior cuando el administrador previsualiza la tienda */}
      {onExitPreview && (
        <div className="sticky top-0 z-50 border-b border-black/10 bg-slate-900 px-4 py-2 text-white">
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-2">
            <span className="text-xs font-medium text-white/80">Vista previa del cliente</span>
            <button
              type="button"
              onClick={onExitPreview}
              className="rounded-full bg-white px-3.5 py-1 text-xs font-semibold text-slate-900 transition hover:bg-slate-100"
            >
              ← Volver
            </button>
          </div>
        </div>
      )}

      {/* CABECERA MINIMALISTA ESTILO APPLE */}
      <header className="sticky top-0 z-30 border-b border-black/[0.06] bg-white/85 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <h1 className="truncate text-lg font-bold tracking-tight text-slate-900">
            {payload.storeName}
          </h1>

          {/* Selector segmentado limpio: Lisa (L 300) vs Personalizada (L 350) */}
          <div className="inline-flex rounded-full bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => {
                setDesignUrl(null);
                setActiveCatalogDesignId(null);
                setSelectedDesignName(null);
                setSelectedDesignCode(null);
                setSelectedDesignPhotoId(null);
              }}
              className={`rounded-full px-3.5 py-1 text-xs font-semibold transition ${
                !hasDesign
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Lisa · {money(payload.priceNormal || 30000)}
            </button>
            <button
              type="button"
              onClick={() => {
                if (clientDesigns.length > 0 && clientDesigns[0].imageUrl) {
                  const first = clientDesigns[0];
                  setDesignUrl(first.imageUrl);
                  setActiveCatalogDesignId(first.id);
                  setSelectedDesignName(first.name);
                  setSelectedDesignCode(first.code || null);
                  setSelectedDesignPhotoId(first.photoId);
                  setPlacement('back');
                  setScale(2.0);
                }
              }}
              className={`rounded-full px-3.5 py-1 text-xs font-semibold transition ${
                hasDesign
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Personalizada · {money(payload.priceCustom || 35000)}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 px-3 pt-4">
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
              available: totalC > 0
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
            setSelectedDesignCode(d.code || null);
            setSelectedDesignPhotoId(d.photoId);
            setPlacement('back');
            setScale(2.0);
            setOffsetX(0);
            setOffsetY(0);
          }}
          autoMotion
        />

        {/* SELECCIÓN DE TALLA MINIMALISTA */}
        <section className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-tight text-slate-900">Talla</h2>
            <span
              className={`text-xs font-medium ${
                selectedSizeStock > 0 ? 'text-emerald-600' : 'text-amber-600'
              }`}
            >
              {selectedSizeStock > 0 ? 'Disponible' : 'Bajo pedido'}
            </span>
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
                  className={`flex min-h-[54px] flex-col items-center justify-center rounded-2xl border transition ${
                    isSel
                      ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                      : st > 0
                      ? 'border-slate-200 bg-white text-slate-900 hover:border-slate-400'
                      : 'border-slate-100 bg-slate-50 text-slate-400'
                  }`}
                >
                  <span className="text-sm font-bold">{sz}</span>
                  <span
                    className={`text-[10px] font-medium ${
                      isSel
                        ? st > 0
                          ? 'text-emerald-300'
                          : 'text-white/70'
                        : st > 0
                        ? 'text-emerald-600'
                        : 'text-slate-400'
                    }`}
                  >
                    {st > 0 ? 'En stock' : 'Encargo'}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* DATOS DE ENTREGA Y CANTIDAD */}
        <section className="space-y-3 rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-tight text-slate-900">Datos de entrega</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500">Cantidad</span>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-0.5 text-slate-900">
                <Stepper value={qty} min={1} onCommit={setQty} ariaLabel="Cantidad" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <input
              type="text"
              maxLength={80}
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Nombre completo"
              className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-sm font-medium text-slate-900 placeholder-slate-400 focus:border-slate-900 focus:bg-white focus:outline-none"
            />
            <input
              type="tel"
              maxLength={24}
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="Teléfono / WhatsApp"
              className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-sm font-medium text-slate-900 placeholder-slate-400 focus:border-slate-900 focus:bg-white focus:outline-none"
            />
            <input
              type="text"
              maxLength={300}
              value={customerAddress}
              onChange={(e) => setCustomerAddress(e.target.value)}
              placeholder="Dirección o ciudad"
              className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-sm font-medium text-slate-900 placeholder-slate-400 focus:border-slate-900 focus:bg-white focus:outline-none"
            />
          </div>

          {readyMadeMatch && (
            <div className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
              ⚡ Disponible para entrega inmediata en talla {size}.
            </div>
          )}
        </section>
      </div>

      {/* BARRA INFERIOR FLOTANTE ESTILO APPLE */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-black/[0.06] bg-white/90 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-slate-500">
              {selectedColor?.name} · Talla {size} · {qty} {qty === 1 ? 'ud' : 'uds'}
              {designUrl ? ` · ${selectedDesignName || 'Personalizada'}` : ' · Lisa'}
            </div>
            <div className="text-lg font-bold tracking-tight text-slate-900">{money(total)}</div>
          </div>
          <button
            type="button"
            onClick={() => void handleSendOrderWhatsApp()}
            className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-full bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-slate-800 active:scale-95"
          >
            Pedir por WhatsApp
          </button>
        </div>
      </div>
    </div>
  );
}
