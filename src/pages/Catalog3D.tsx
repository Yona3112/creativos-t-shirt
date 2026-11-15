import { useEffect, useMemo, useRef, useState } from 'react';
import { getState, useAppState, useStock, useSyncStatus } from '../lib/store';
import { activeBrands, brandColors, normalPrice, vkey } from '../lib/inventory';
import { updateSettings, deleteColor, updateColor } from '../lib/actions';
import { money } from '../lib/money';
import { uid } from '../lib/ids';
import {
  compressImage,
  applyBackgroundRemoval,
  removeBackgroundWithAI,
  upscaleImageTo4K,
  isJpgFile,
  createDesignThumbnail
} from '../lib/image';
import { db, savePhoto } from '../lib/db';
import { fetchSharedPhoto, uploadPhotoNow } from '../lib/sync';
import { subscribeLiveCatalogFirebase } from '../lib/firebaseSync';
import { copyText, downloadBlob } from '../lib/csv';
import {
  buildCatalogOrderPdfFile,
  renderCatalogOrderCardCanvas,
  sharePdfFileNative,
  type CatalogOrderCardInput
} from '../lib/pdf';
import { whatsappUrl } from '../lib/whatsapp';
import { InteractiveShirt3D, type BoutiqueTheme, type DecalPlacement } from '../components/Shirt';
import { NewColorModal } from '../components/NewColorModal';
import { Modal, Stepper, toast } from '../components/ui';
import { useCatalogDesigns } from '../lib/catalogDesigns';
import {
  buildPublicCatalog,
  LIVE_CATALOG_KEY,
  WEB_ORDER_LATEST_KEY,
  type CustomerWebOrderItem,
  type CustomerWebOrderPayload,
  type SharedCatalogColor,
  type SharedCatalogDesignRef,
  type SharedCatalogPayload
} from '../lib/publicCatalog';

const WIZARD_KEYS = ['color', 'design', 'size', 'data'] as const;
const WIZARD_TITLES = ['Color y lado', 'Diseño', 'Talla y cantidad', 'Finalizar'];
const WIZARD_LAST = WIZARD_KEYS.length - 1;

const SIZE_CHART: Array<{ size: string; chest: string; length: string }> = [
  { size: 'XS', chest: '43 cm', length: '66 cm' },
  { size: 'S', chest: '46 cm', length: '69 cm' },
  { size: 'M', chest: '50 cm', length: '72 cm' },
  { size: 'L', chest: '54 cm', length: '74 cm' },
  { size: 'XL', chest: '58 cm', length: '77 cm' },
  { size: 'XXL', chest: '62 cm', length: '80 cm' }
];

export interface CustomerCartItem {
  id: string;
  brandName: string;
  colorName: string;
  colorHex: string;
  size: string;
  qty: number;
  unitPrice: number;
  designId?: string | null;
  designName?: string | null;
  designCode?: string | null;
  photoUrl?: string | null;
  photoId?: string | null;
  designThumb?: string | null;
  placement: DecalPlacement;
  scale: number;
}

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
  // Enlace corto de Tienda Oficial (#tienda, #tienda?camp=Ranchero, #catalogo)
  if (h === 'tienda' || h.startsWith('tienda?') || h === 'catalogo' || h.startsWith('c=')) {
    const base = buildDefaultLivePayload();
    const campMatch = h.match(/[?&]camp=([^&]+)/);
    if (campMatch && campMatch[1]) {
      base.activeCampaign = decodeURIComponent(campMatch[1]);
    }
    return base;
  }
  // Compatibilidad con enlaces anteriores (#catalogo=eyJ...)
  const m = location.hash.match(/catalogo=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  return decodeCatalog(m[1]) || buildDefaultLivePayload();
}

const DEFAULT_CAMPAIGNS = ['Ranchero', 'Turístico', 'Cristiana'];

export default function Catalog3D() {
  const state = useAppState();
  const { stock } = useStock();
  const { settings } = state;
  const brands = activeBrands(state);

  const campaigns = useMemo(() => {
    const list = settings.campaigns && settings.campaigns.length > 0 ? settings.campaigns : DEFAULT_CAMPAIGNS;
    return Array.from(new Set(list));
  }, [settings.campaigns]);

  const [activeCampaign, setActiveCampaign] = useState<string>(settings.activeCampaign || 'all');

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
    toggleFeatured,
    renameDesign,
    setDesignCampaign,
    setDesignColors,
    deleteDesign
  } = useCatalogDesigns();

  const handleAddCampaign = () => {
    const name = window.prompt('Nombre de la nueva campaña (ej. Ranchero, Turístico, Cristiana, Deportiva):');
    if (!name || !name.trim()) return;
    const clean = name.trim();
    const next = Array.from(new Set([...campaigns, clean]));
    updateSettings({ campaigns: next, activeCampaign: clean });
    setActiveCampaign(clean);
    toast(`Campaña "${clean}" creada`, 'ok');
  };

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
      const autoRemove = removeBg || isJpgFile(file);
      const raw = await compressImage(file, 1400, 0.92, false);
      const processed = autoRemove ? await applyBackgroundRemoval(raw, true, bgTolerance) : raw;
      const id = uid();
      await savePhoto(id, processed, 0);
      void uploadPhotoNow(id, processed);
      setPhotoId(id);
      setActiveCatalogDesignId(null);
      setRawDesignUrl(raw);
      setDesignUrl(processed);
      setRemoveBg(autoRemove);
      setScale(2.0);
      setOffsetX(0);
      setOffsetY(0);
      toast(
        isJpgFile(file)
          ? 'JPG convertido automáticamente a PNG sin fondo (Tamaño A3)'
          : autoRemove
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
      activeCampaign,
      designs: clientDesigns.map((d) => ({
        id: d.id,
        name: d.name,
        code: d.code,
        campaign: d.campaign,
        soldCount: d.soldCount,
        featured: d.featured,
        photoId: d.photoId,
        placement: d.placement
      })),
      stock: stockMap,
      publishedAt: Date.now()
    };
  };

  const buildShareUrl = (camp = activeCampaign): string => {
    const base = `${location.origin}${location.pathname}#tienda`;
    if (camp && camp !== 'all') {
      return `${base}?camp=${encodeURIComponent(camp)}`;
    }
    return base;
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
    const url = buildShareUrl(activeCampaign);
    const campLabel = activeCampaign !== 'all' ? ` · Campaña ${activeCampaign}` : '';
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${settings.storeName}${campLabel}`,
          text: `Mira nuestro catálogo 3D${campLabel}:`,
          url
        });
        return;
      } catch {
        /* fallback a copiar */
      }
    }
    await copyText(url);
    toast(
      activeCampaign !== 'all'
        ? `Enlace de campaña "${activeCampaign}" copiado`
        : 'Enlace corto (#tienda) copiado'
    );
  };

  const handleShareWhatsApp = async () => {
    void syncLiveCatalogSnapshot();
    const url = buildShareUrl(activeCampaign);
    const campLine =
      activeCampaign !== 'all' ? `\n✨ *Colección / Campaña: ${activeCampaign}*` : '';
    const text = `¡Hola! 👋 Entra a nuestro *Catálogo 3D* de *${settings.storeName}*:${campLine}\n👉 ${url}\n\nElige tu diseño, color y talla en vivo y envíanos tu pedido.`;
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
            {/* Selector de Campaña para enviar por WhatsApp */}
            <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
              <span className="text-[11px] font-semibold text-slate-500">Campaña:</span>
              <select
                value={activeCampaign}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '__new__') {
                    handleAddCampaign();
                    return;
                  }
                  setActiveCampaign(val);
                  updateSettings({ activeCampaign: val });
                }}
                className="bg-transparent text-xs font-bold text-slate-900 outline-none"
              >
                <option value="all">Todas</option>
                {campaigns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value="__new__">+ Nueva campaña...</option>
              </select>
            </div>

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
              {activeCampaign !== 'all' ? `WhatsApp · ${activeCampaign}` : 'WhatsApp'}
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
          campaigns={campaigns}
          activeCampaign={activeCampaign}
          onChangeActiveCampaign={(camp) => {
            setActiveCampaign(camp);
            updateSettings({ activeCampaign: camp });
          }}
          onAddCampaign={handleAddCampaign}
          onChangeDesignCampaign={(id, camp) => {
            setDesignCampaign(id, camp);
            toast(camp === 'all' ? 'Diseño asignado a Todas' : `Diseño asignado a "${camp}"`);
            void syncLiveCatalogSnapshot();
          }}
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
          onChangeDesignColors={(id, mode, ids, tone) => {
            setDesignColors(id, mode, ids, tone);
            toast('Colores disponibles del diseño actualizados');
            setTimeout(() => void syncLiveCatalogSnapshot(), 150);
          }}
          onSaveCurrentToCatalog={(chosen) => {
            if (!designUrl) return;
            const opts = typeof chosen === 'string' ? { campaign: chosen } : chosen || {};
            const targetCamp = opts.campaign || activeCampaign;
            void saveCurrentToCatalog({
              dataUrl: designUrl,
              name: opts.name,
              placement,
              campaign: targetCamp,
              existingPhotoId: photoId,
              allowedColorMode: opts.allowedColorMode,
              allowedColorIds: opts.allowedColorIds,
              tone: opts.tone
            }).then((saved) => {
              setActiveCatalogDesignId(saved.id);
              toast(
                `Diseño "${saved.name}" publicado en ${
                  targetCamp === 'all' ? 'Todas las campañas' : targetCamp
                } y visible al cliente`
              );
              setTimeout(() => void syncLiveCatalogSnapshot(), 150);
            });
          }}
          onUploadCatalogFiles={(files, chosen) => {
            const opts = typeof chosen === 'string' ? { campaign: chosen } : chosen || {};
            const targetCamp = opts.campaign || activeCampaign;
            setProcessingMsg('Procesando diseños (JPG → PNG transparente)...');
            void uploadFilesToCatalog(files, {
              removeBg,
              tolerance: bgTolerance,
              placement,
              campaign: targetCamp,
              customName: opts.customName,
              allowedColorMode: opts.allowedColorMode,
              allowedColorIds: opts.allowedColorIds,
              clientVisible: true
            })
              .then((n) => {
                if (n > 0) {
                  toast(
                    `${n} diseño(s) publicado(s) en ${
                      targetCamp === 'all' ? 'Todas las campañas' : targetCamp
                    } y visible(s) al cliente`
                  );
                  setTimeout(() => void syncLiveCatalogSnapshot(), 150);
                }
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
            setTimeout(() => void syncLiveCatalogSnapshot(), 150);
          }}
          onToggleCatalogDesignFeatured={(id, nextFeat) => {
            toggleFeatured(id, nextFeat);
            toast(
              nextFeat
                ? '★ Diseño destacado al inicio como Más vendido'
                : 'Diseño quitado de destacados'
            );
            setTimeout(() => void syncLiveCatalogSnapshot(), 150);
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
      wholesaleMin: state.settings.wholesaleMin || base.wholesaleMin,
      activeCampaign: initialPayload.activeCampaign || base.activeCampaign
    };
  }, [cloudPayload, initialPayload, onExitPreview, state]);

  const [selectedColor, setSelectedColor] = useState<SharedCatalogColor>(payload.colors[0]);
  const [designUrl, setDesignUrl] = useState<string | null>(initialDesignUrl);
  const [clientCampaign, setClientCampaign] = useState<string>(
    initialPayload.activeCampaign || payload.activeCampaign || 'all'
  );
  const [activeCatalogDesignId, setActiveCatalogDesignId] = useState<string | null>(null);
  const [selectedDesignName, setSelectedDesignName] = useState<string | null>(null);
  const [selectedDesignCode, setSelectedDesignCode] = useState<string | null>(null);
  const [selectedDesignPhotoId, setSelectedDesignPhotoId] = useState<string | null>(
    initialDesignUrl ? payload.photoId || null : null
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
  const [paymentPending, setPaymentPending] = useState(false);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);
  const deliverySectionRef = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0);
  const [maxStepReached, setMaxStepReached] = useState(0);
  const [showSizeGuide, setShowSizeGuide] = useState(false);
  const [justAddedToCart, setJustAddedToCart] = useState(false);

  const goToStep = (next: number) => {
    const clamped = Math.max(0, Math.min(WIZARD_LAST, next));
    setStep(clamped);
    setMaxStepReached((prev) => Math.max(prev, clamped));
  };

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step]);

  const phoneDigitsOnly = customerPhone.replace(/\D/g, '');
  const isNameValid = customerName.trim().length >= 2;
  const isPhoneValid = phoneDigitsOnly.length >= 8;
  const isDeliveryReady = isNameValid && isPhoneValid;

  // Carrito de compras para el cliente: permite agregar múltiples prendas y diferentes diseños
  const [customerCart, setCustomerCart] = useState<CustomerCartItem[]>([]);
  const [isCartModalOpen, setIsCartModalOpen] = useState(false);

  const [orderSheetModal, setOrderSheetModal] = useState<{
    orderId: string;
    previewUrl: string;
    pdfFile: File;
    whatsappHref: string;
  } | null>(null);

  const { clientDesigns } = useCatalogDesigns(payload.designs);

  const availableCampaigns = useMemo(() => {
    const fromDesigns = clientDesigns
      .map((d) => d.campaign?.trim())
      .filter((c): c is string => Boolean(c) && c !== 'all');
    const fromState = state.settings.campaigns || [];
    return Array.from(new Set([...DEFAULT_CAMPAIGNS, ...fromState, ...fromDesigns]));
  }, [clientDesigns, state.settings.campaigns]);

  useEffect(() => {
    if (initialPayload.activeCampaign) {
      setClientCampaign(initialPayload.activeCampaign);
    } else if (payload.activeCampaign && clientCampaign === 'all') {
      setClientCampaign(payload.activeCampaign);
    }
  }, [initialPayload.activeCampaign, payload.activeCampaign]);

  useEffect(() => {
    if (!payload.colors.some((c) => c.name === selectedColor?.name)) {
      setSelectedColor(payload.colors[0]);
    }
  }, [payload.colors, selectedColor]);

  // La tienda del cliente permite escoger libremente entre L 300.00 y L 350.00 sin bloquearse

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
    setJustAddedToCart(false);
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

  // Precio único simplificado para el cliente en Tienda 3D (L 350.00)
  const unitPrice = payload.priceCustom || 35000;
  const total = qty * unitPrice;

  const currentDraftItem: CustomerCartItem = {
    id: '__draft__',
    brandName: payload.brandName,
    colorName: selectedColor?.name || 'Negro',
    colorHex: selectedColor?.hex || '#111827',
    size,
    qty,
    unitPrice,
    designId: designUrl ? activeCatalogDesignId : null,
    designName: designUrl ? selectedDesignName || 'Diseño personalizado' : null,
    designCode: designUrl ? selectedDesignCode : null,
    photoUrl: designUrl,
    photoId: selectedDesignPhotoId,
    placement,
    scale
  };

  const mergeCartItems = (
    base: CustomerCartItem[],
    incoming: CustomerCartItem,
    preserveIncomingId = false
  ): CustomerCartItem[] => {
    const idx = base.findIndex(
      (it) =>
        it.colorName === incoming.colorName &&
        it.size === incoming.size &&
        it.unitPrice === incoming.unitPrice &&
        (it.designId || null) === (incoming.designId || null) &&
        (it.designName || null) === (incoming.designName || null) &&
        it.placement === incoming.placement
    );
    if (idx >= 0) {
      const next = [...base];
      next[idx] = { ...next[idx], qty: next[idx].qty + incoming.qty };
      return next;
    }
    return [...base, preserveIncomingId ? incoming : { ...incoming, id: uid() }];
  };

  const effectiveOrderItems: CustomerCartItem[] =
    customerCart.length === 0
      ? [currentDraftItem]
      : justAddedToCart
      ? customerCart
      : mergeCartItems(customerCart, currentDraftItem, true);

  const effectiveTotalQty = effectiveOrderItems.reduce((sum, it) => sum + it.qty, 0);
  const effectiveTotalPrice = effectiveOrderItems.reduce((sum, it) => sum + it.qty * it.unitPrice, 0);

  const cartTotalQty = customerCart.reduce((sum, it) => sum + it.qty, 0);
  const cartTotalPrice = customerCart.reduce((sum, it) => sum + it.qty * it.unitPrice, 0);

  const handleAddToCart = (startNextShirt = false) => {
    const itemToSave: CustomerCartItem = {
      ...currentDraftItem,
      designName: designUrl ? selectedDesignName || 'Diseño estampado' : null
    };
    setCustomerCart((prev) => mergeCartItems(prev, itemToSave));
    setJustAddedToCart(true);

    toast(
      `✓ +${qty} ${selectedColor?.name} (${size}) ${
        designUrl ? `"${selectedDesignName || 'Diseño'}"` : 'Lisa'
      } agregada al pedido`,
      'ok'
    );

    if (startNextShirt) {
      setDesignUrl(null);
      setActiveCatalogDesignId(null);
      setSelectedDesignName(null);
      setSelectedDesignCode(null);
      setSelectedDesignPhotoId(null);
      setQty(1);
      goToStep(0);
    }
  };

  const handleUpdateCartQty = (id: string, delta: number) => {
    setCustomerCart((prev) =>
      prev
        .map((it) => (it.id === id ? { ...it, qty: it.qty + delta } : it))
        .filter((it) => it.qty > 0)
    );
  };

  const handleRemoveFromCart = (id: string) => {
    setCustomerCart((prev) => prev.filter((it) => it.id !== id));
  };

  const handleOrderItemQty = (id: string, delta: number) => {
    if (id === '__draft__') {
      if (delta < 0 && qty <= 1) {
        if (customerCart.length > 0) setJustAddedToCart(true);
        return;
      }
      setQty((q) => Math.max(1, q + delta));
      setJustAddedToCart(false);
      return;
    }
    const inCart = customerCart.find((c) => c.id === id);
    const eff = effectiveOrderItems.find((c) => c.id === id);
    if (
      delta < 0 &&
      !justAddedToCart &&
      customerCart.length > 0 &&
      inCart &&
      eff &&
      eff.qty > inCart.qty
    ) {
      if (qty <= 1) setJustAddedToCart(true);
      else setQty((q) => Math.max(1, q - 1));
      return;
    }
    if (delta < 0 && inCart && inCart.qty <= 1 && effectiveOrderItems.length <= 1) {
      return;
    }
    handleUpdateCartQty(id, delta);
  };

  const handleRemoveOrderItem = (id: string) => {
    if (effectiveOrderItems.length <= 1) return;
    if (id === '__draft__') {
      setJustAddedToCart(true);
      return;
    }
    const inCart = customerCart.find((c) => c.id === id);
    const eff = effectiveOrderItems.find((c) => c.id === id);
    if (!justAddedToCart && customerCart.length > 0 && inCart && eff && eff.qty > inCart.qty) {
      setJustAddedToCart(true);
    }
    handleRemoveFromCart(id);
  };

  const handleSendOrderWhatsApp = async () => {
    const cleanName = customerName.trim().slice(0, 80);
    const cleanPhone = customerPhone.trim().slice(0, 24);
    const cleanAddr = customerAddress.trim().slice(0, 300);
    const phoneDigits = cleanPhone.replace(/\D/g, '');
    if (cleanName.length < 2 || phoneDigits.length < 8) {
      const msg =
        cleanName.length < 2 && phoneDigits.length < 8
          ? 'Ingresa tu nombre completo y número de teléfono / WhatsApp para enviar el pedido'
          : cleanName.length < 2
          ? 'Ingresa tu nombre completo para confirmar el pedido'
          : 'Ingresa tu número de teléfono / WhatsApp válido (mín. 8 dígitos)';
      goToStep(WIZARD_LAST);
      setDeliveryError(msg);
      setTimeout(() => {
        deliverySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 60);
      toast(msg, 'error');
      return;
    }
    setDeliveryError(null);
    const orderId = uid().slice(0, 12);

    const finalCartItems: CustomerCartItem[] = effectiveOrderItems.map((it) => ({
      ...it,
      id: it.id === '__draft__' ? uid() : it.id
    }));

    const finalTotal = finalCartItems.reduce((s, it) => s + it.qty * it.unitPrice, 0);
    const finalUnits = finalCartItems.reduce((s, it) => s + it.qty, 0);

    // Preparar y subir miniaturas / fotos para que Taller las tenga disponibles al instante
    const webOrderItems: CustomerWebOrderItem[] = [];
    let mainThumbUrl: string | null = null;
    let mainPhotoId: string | null = null;

    for (let i = 0; i < finalCartItems.length; i++) {
      const it = finalCartItems[i];
      let itemThumb: string | null = null;
      let itemPid = it.photoId || null;

      if (it.photoUrl) {
        try {
          itemThumb = await createDesignThumbnail(it.photoUrl, 240);
        } catch {
          itemThumb = null;
        }
        if (!itemPid) {
          itemPid = `photo_${orderId}_${i}`;
        }
        void savePhoto(itemPid, it.photoUrl, 0);
        void uploadPhotoNow(itemPid, it.photoUrl);
      }

      if (!mainThumbUrl && itemThumb) mainThumbUrl = itemThumb;
      if (!mainPhotoId && itemPid) mainPhotoId = itemPid;

      webOrderItems.push({
        id: it.id,
        brandName: it.brandName,
        colorName: it.colorName,
        colorHex: it.colorHex,
        size: it.size,
        qty: it.qty,
        unitPrice: it.unitPrice,
        designId: it.designId,
        designName: it.designName,
        designCode: it.designCode,
        photoId: itemPid,
        designThumb: itemThumb,
        placement: it.placement,
        scale: it.scale
      });
    }

    const firstItem = webOrderItems[0];
    const webOrder: CustomerWebOrderPayload = {
      id: orderId,
      createdAt: Date.now(),
      customerName: cleanName,
      customerPhone: cleanPhone,
      customerAddress: cleanAddr,
      brandId: liveBrand?.id || payload.brandId,
      brandName: payload.brandName,
      colorId: resolveColorId(selectedColor) || selectedColor?.id,
      colorName: firstItem.colorName,
      colorHex: firstItem.colorHex,
      size: firstItem.size,
      qty: finalUnits,
      unitPrice: firstItem.unitPrice,
      designId: firstItem.designId,
      designName: firstItem.designName,
      designCode: firstItem.designCode,
      photoId: mainPhotoId,
      designThumb: mainThumbUrl,
      campaign: clientCampaign !== 'all' ? clientCampaign : null,
      paymentMethod: paymentPending ? 'Pago Pendiente en Tienda' : 'Transferencia / Anticipo',
      paymentPending,
      placement: firstItem.placement || 'back',
      scale: firstItem.scale || 2.0,
      items: webOrderItems
    };

    const rawOrderJson = JSON.stringify(webOrder);
    void savePhoto(WEB_ORDER_LATEST_KEY, rawOrderJson, 0);
    void savePhoto(`weborder_${orderId}`, rawOrderJson, 0);
    void uploadPhotoNow(WEB_ORDER_LATEST_KEY, rawOrderJson);
    void uploadPhotoNow(`weborder_${orderId}`, rawOrderJson);

    const importUrl = `${location.origin}${location.pathname}#pedido=${orderId}`;
    const paymentLine = paymentPending
      ? '⏳ Pago pendiente (Paga al llegar a la tienda)'
      : '💳 Transferencia / Anticipo';
    const clientHeader =
      cleanName || cleanPhone || cleanAddr || paymentPending
        ? `\n👤 *DATOS DEL CLIENTE:*${cleanName ? `\n• Nombre: ${cleanName}` : ''}${
            cleanPhone ? `\n• Teléfono: ${cleanPhone}` : ''
          }${cleanAddr ? `\n• Dirección / Nota: ${cleanAddr}` : ''}\n• Forma de pago: *${paymentLine}*\n`
        : '';

    let itemsDetailsText = '';
    if (webOrderItems.length > 1) {
      itemsDetailsText = `\n👕 *DETALLE DEL PEDIDO (${finalUnits} prendas en total):*\n${webOrderItems
        .map((it, idx) => {
          const side = it.placement === 'back' ? 'Espalda' : 'Frente';
          const dPart = it.designName
            ? ` · Diseño: *${it.designCode ? `[${it.designCode}] ` : ''}${it.designName}* (${side})`
            : ' · Lisa';
          return `${idx + 1}. *${it.qty}x ${it.brandName} ${it.colorName} (${it.size})*${dPart} — ${money(
            it.qty * it.unitPrice
          )}`;
        })
        .join('\n')}\n• Total: *${money(finalTotal)}*`;
    } else {
      const codePrefix = firstItem.designCode ? `[${firstItem.designCode}] ` : '';
      const sideText = firstItem.placement === 'back' ? 'ESPALDA' : 'FRENTE';
      const dBlock = firstItem.designName
        ? `\n• Precio: *${money(firstItem.unitPrice)}*\n• Diseño: *${codePrefix}${firstItem.designName}* (${
            firstItem.scale && firstItem.scale >= 1.85 ? 'Tamaño A3' : 'Tamaño A4'
          })\n• 📍 LADO: *${sideText}*`
        : `\n• Precio: *${money(firstItem.unitPrice)}*`;
      itemsDetailsText = `\n👕 *DETALLE DE LA CAMISA:*\n• Marca: ${firstItem.brandName}\n• Color: ${firstItem.colorName}\n• Talla: ${firstItem.size}\n• Cantidad: ${firstItem.qty} uds (${money(firstItem.unitPrice)} c/u)${dBlock}\n• Total: *${money(finalTotal)}*`;
    }

    const campaignLine =
      clientCampaign && clientCampaign !== 'all' ? `\n✨ *Colección / Campaña:* ${clientCampaign}` : '';
    const orderText = `¡Hola ${payload.storeName}! 👋 Quiero hacer este pedido desde la Tienda 3D:\n${clientHeader}${campaignLine}${itemsDetailsText}\n\n🖼️ *Ver pedido con foto de diseño en 1 clic (Taller):*\n${importUrl}`;

    const targetHref = payload.storePhone
      ? whatsappUrl(payload.storePhone, orderText)
      : `https://wa.me/?text=${encodeURIComponent(orderText)}`;

    try {
      const cardInput: CatalogOrderCardInput = {
        storeName: payload.storeName,
        orderId,
        customerName: cleanName,
        customerPhone: cleanPhone,
        customerAddress: cleanAddr,
        brandName: firstItem.brandName,
        colorName: firstItem.colorName,
        colorHex: firstItem.colorHex,
        size: firstItem.size,
        qty: finalUnits,
        unitPrice: firstItem.unitPrice,
        total: finalTotal,
        designName:
          webOrderItems.length > 1
            ? `${webOrderItems.length} prendas variadas`
            : firstItem.designName || 'Camisa Lisa',
        designCode: firstItem.designCode,
        designUrl: firstItem.designThumb || finalCartItems[0]?.photoUrl || null,
        placement: firstItem.placement,
        paymentLabel: paymentPending ? 'Pagar al recoger en tienda' : 'Transferencia / Anticipo',
        stockNote: clientCampaign !== 'all' ? `Colección: ${clientCampaign}` : undefined,
        items: webOrderItems.map((it, idx) => ({
          brandName: it.brandName,
          colorName: it.colorName,
          colorHex: it.colorHex,
          size: it.size,
          qty: it.qty,
          unitPrice: it.unitPrice,
          designName: it.designName,
          designCode: it.designCode,
          designUrl: it.designThumb || finalCartItems[idx]?.photoUrl || null,
          placement: it.placement
        }))
      };
      const [canvas, pdfFile] = await Promise.all([
        renderCatalogOrderCardCanvas(cardInput),
        buildCatalogOrderPdfFile(cardInput)
      ]);
      const previewUrl = canvas.toDataURL('image/jpeg', 0.9);
      // Limpiar el carrito al quedar confirmado para evitar pedidos repetidos por accidente
      setCustomerCart([]);
      setJustAddedToCart(true);
      setOrderSheetModal({
        orderId,
        previewUrl,
        pdfFile,
        whatsappHref: targetHref
      });
    } catch {
      window.open(targetHref, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#F5F5F7] pb-44 text-slate-900 sm:pb-28">
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
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold tracking-tight text-slate-900">
              {payload.storeName}
            </h1>
            {clientCampaign && clientCampaign !== 'all' && (
              <p className="truncate text-[11px] font-medium text-slate-500">
                Colección {clientCampaign}
              </p>
            )}
          </div>

          {/* Precio único minimalista estilo Apple (L 350.00) + Botón Carrito */}
          <div className="flex items-center gap-2">
            {customerCart.length > 0 && (
              <button
                type="button"
                onClick={() => setIsCartModalOpen(true)}
                className="flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1 text-xs font-bold text-white shadow-sm transition hover:bg-slate-800 active:scale-95"
                title="Ver prendas de mi pedido"
              >
                <span>🛒</span>
                <span>{cartTotalQty}</span>
              </button>
            )}

            <div className="inline-flex shrink-0 items-center rounded-full bg-slate-900 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm">
              {money(unitPrice)}
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 px-3 pt-4">
        {/* PROGRESO DEL ASISTENTE */}
        <div className="px-1">
          <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-slate-500">
            <span>Paso {step + 1} de {WIZARD_LAST + 1}</span>
            <span className="font-bold text-slate-900">{WIZARD_TITLES[step]}</span>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {WIZARD_TITLES.map((title, i) => {
              const unlocked = i <= maxStepReached;
              const active = i === step;
              return (
                <button
                  key={title}
                  type="button"
                  disabled={!unlocked}
                  aria-label={`Ir al paso ${i + 1}: ${title}`}
                  onClick={() => unlocked && goToStep(i)}
                  className="group flex flex-col items-start gap-1 text-left disabled:cursor-default"
                >
                  <span
                    className={`h-1.5 w-full rounded-full transition-colors ${
                      i <= step
                        ? 'bg-slate-900'
                        : unlocked
                        ? 'bg-slate-400'
                        : 'bg-slate-200'
                    }`}
                  />
                  <span
                    className={`hidden truncate text-[10px] font-semibold sm:block ${
                      active
                        ? 'text-slate-900'
                        : unlocked
                        ? 'text-slate-500 group-hover:text-slate-800'
                        : 'text-slate-300'
                    }`}
                  >
                    {i + 1}. {title}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {step <= 1 ? (
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
              if (patch.placement !== undefined) {
                setPlacement(patch.placement);
                setJustAddedToCart(false);
              }
              if (patch.scale !== undefined) setScale(patch.scale);
              if (patch.offsetX !== undefined) setOffsetX(patch.offsetX);
              if (patch.offsetY !== undefined) setOffsetY(patch.offsetY);
              if (patch.designUrl !== undefined) {
                setDesignUrl(patch.designUrl);
                setJustAddedToCart(false);
              }
              if (patch.designName !== undefined) setSelectedDesignName(patch.designName);
              if (patch.photoId !== undefined) setSelectedDesignPhotoId(patch.photoId);
            }}
            onClearDesign={() => {
              setDesignUrl(null);
              setActiveCatalogDesignId(null);
              setSelectedDesignName(null);
              setSelectedDesignCode(null);
              setSelectedDesignPhotoId(null);
              setJustAddedToCart(false);
            }}
            onUploadFile={async (file) => {
              try {
                const autoJpg = isJpgFile(file);
                const raw = await compressImage(file, 1400, 0.92, false);
                const processed = autoJpg ? await applyBackgroundRemoval(raw, true, 34) : raw;
                const customPid = `photo_client_${uid()}`;
                const cleanName = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]+/g, ' ').trim();
                setDesignUrl(processed);
                setActiveCatalogDesignId(null);
                setSelectedDesignName(cleanName ? `Personalizado: ${cleanName.slice(0, 24)}` : 'Imagen personalizada');
                setSelectedDesignCode('CLIENTE');
                setSelectedDesignPhotoId(customPid);
                setJustAddedToCart(false);

                setScale(2.0);
                setOffsetX(0);
                setOffsetY(0);
                toast('Tu imagen se aplicó a la camisa');
              } catch (e) {
                toast((e as Error).message, 'error');
              }
            }}
            boutiqueTheme={boutiqueTheme}
            colorOptions={payload.colors.map((c) => {
              const totalC = getColorTotalStock(c);
              return {
                id: resolveColorId(c) || c.id || c.name,
                name: c.name,
                hex: c.hex,
                available: totalC > 0
              };
            })}
            activeColorId={resolveColorId(selectedColor) || selectedColor?.id || selectedColor?.name}
            onSelectColor={(cid) => {
              const found = payload.colors.find(
                (x) => (resolveColorId(x) || x.id || x.name) === cid || x.name === cid
              );
              if (found) handleSelectColor(found);
            }}
            catalogDesigns={clientDesigns}
            activeCatalogDesignId={activeCatalogDesignId}
            campaigns={availableCampaigns}
            activeCampaign={clientCampaign}
            onChangeActiveCampaign={setClientCampaign}
            onSelectCatalogDesign={(d) => {
              if (!d.imageUrl) return;
              setDesignUrl(d.imageUrl);
              setActiveCatalogDesignId(d.id);
              setSelectedDesignName(d.name);
              setSelectedDesignCode(d.code || null);
              setSelectedDesignPhotoId(d.photoId);
              setJustAddedToCart(false);

              setScale(2.0);
              setOffsetX(0);
              setOffsetY(0);
            }}
            autoMotion
            wizardStep={WIZARD_KEYS[step]}
          />
        ) : step === 2 ? (
          <div className="flex items-center gap-3 rounded-[22px] border border-slate-200/80 bg-white p-3 shadow-sm">
            <div
              className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-black/10 p-1.5 shadow-inner"
              style={{ backgroundColor: selectedColor?.hex || '#111827' }}
            >
              {designUrl ? (
                <img
                  src={designUrl}
                  alt={selectedDesignName || 'Diseño'}
                  className="h-full w-full object-contain"
                />
              ) : (
                <span className="text-2xl">👕</span>
              )}
              <span className="absolute inset-x-0 bottom-0 bg-black/65 py-0.5 text-center text-[9px] font-bold text-white">
                {placement === 'back' ? 'Espalda' : 'Frente'}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Tu camisa actual
              </div>
              <div className="truncate text-sm font-bold text-slate-900">
                {selectedColor?.name || 'Color'} · {placement === 'back' ? 'Espalda' : 'Frente'}
              </div>
              <div className="truncate text-xs text-slate-500">
                {designUrl
                  ? selectedDesignName || 'Diseño seleccionado'
                  : 'Camisa lisa (sin diseño)'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => goToStep(1)}
              className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100 active:scale-95"
            >
              Editar 3D
            </button>
          </div>
        ) : null}

        {/* PASO 1: UBICACIÓN DEL DISEÑO */}
        {step === 0 && (
          <section className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-sm">
            <h2 className="mb-1 text-sm font-semibold tracking-tight text-slate-900">¿Dónde irá el diseño?</h2>
            <p className="mb-3 text-xs text-slate-500">Elige el color de la camisa arriba y la ubicación aquí.</p>
            <div className="grid grid-cols-2 gap-2">
              {([['back', 'Espalda'], ['center', 'Frente']] as const).map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setPlacement(k);
                    setJustAddedToCart(false);
                  }}
                  className={`min-h-[52px] rounded-2xl border text-sm font-bold transition ${
                    placement === k
                      ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                      : 'border-slate-200 bg-white text-slate-800 hover:border-slate-400'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* PASO 3: SELECCIÓN DE TALLA, GUÍA Y CANTIDAD */}
        {step === 2 && (
          <div className="space-y-3">
            <section className="space-y-4 rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold tracking-tight text-slate-900">Talla</h2>
                  <span
                    className={`text-xs font-medium ${
                      selectedSizeStock > 0 ? 'text-emerald-600' : 'text-amber-600'
                    }`}
                  >
                    · {selectedSizeStock > 0 ? 'Disponible' : 'Bajo pedido'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSizeGuide((v) => !v)}
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-bold text-slate-700 transition hover:bg-slate-100"
                >
                  {showSizeGuide ? 'Ocultar medidas' : '📏 Ver guía de medidas'}
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {payload.sizes.map((sz) => {
                  const st = getSizeStock(selectedColor, sz);
                  const isSel = sz === size;
                  return (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => {
                        setSize(sz);
                        setJustAddedToCart(false);
                      }}
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

              {showSizeGuide && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">Guía de medidas (Corte Unisex)</span>
                    <span className="text-[11px] text-slate-500">Aprox. ±1.5 cm</span>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100/80 text-[11px] font-bold text-slate-600">
                        <tr>
                          <th className="px-3 py-1.5">Talla</th>
                          <th className="px-3 py-1.5">Ancho de pecho</th>
                          <th className="px-3 py-1.5">Largo</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700">
                        {SIZE_CHART.map((row) => (
                          <tr
                            key={row.size}
                            className={row.size === size ? 'bg-slate-900/5 font-bold text-slate-900' : ''}
                          >
                            <td className="px-3 py-1.5">{row.size}</td>
                            <td className="px-3 py-1.5">{row.chest}</td>
                            <td className="px-3 py-1.5">{row.length}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500">
                    Tip: mide una camisa tuya sobre una mesa de axila a axila para comparar el ancho.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Cantidad</div>
                  <div className="text-[11px] text-slate-500">{money(unitPrice)} por prenda</div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-0.5 text-slate-900">
                    <Stepper
                      value={qty}
                      min={1}
                      onCommit={(v) => {
                        setQty(v);
                        setJustAddedToCart(false);
                      }}
                      ariaLabel="Cantidad"
                    />
                  </div>
                  <div className="min-w-[76px] text-right text-sm font-extrabold text-slate-900">
                    {money(total)}
                  </div>
                </div>
              </div>
            </section>

            <div className="rounded-[22px] border border-dashed border-slate-300 bg-white/75 p-3 text-center">
              <button
                type="button"
                onClick={() => handleAddToCart(true)}
                className="inline-flex min-h-[42px] w-full items-center justify-center gap-1.5 rounded-full border border-slate-300 bg-slate-50 px-4 text-xs font-bold text-slate-900 shadow-sm transition hover:border-slate-400 hover:bg-slate-100 active:scale-[0.99]"
              >
                + Agregar al pedido y elegir otra prenda
              </button>
              <p className="mt-1.5 text-[11px] text-slate-500">
                ¿Llevas otra talla, color o diseño? Agrégala aquí antes de finalizar.
              </p>
            </div>
          </div>
        )}

        {/* PASO 4: RESUMEN DEL PEDIDO Y DATOS DE ENTREGA */}
        {step === 3 && (
          <div className="space-y-3">
            {/* RESUMEN VISIBLE DEL PEDIDO */}
            <section className="space-y-3 rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold tracking-tight text-slate-900">
                    Tu pedido ({effectiveTotalQty} {effectiveTotalQty === 1 ? 'prenda' : 'prendas'})
                  </h2>
                  <p className="text-[11px] text-slate-500">Revisa los detalles antes de confirmar</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (justAddedToCart) goToStep(0);
                    else handleAddToCart(true);
                  }}
                  className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-800 transition hover:bg-slate-100 active:scale-95"
                >
                  + Agregar otra
                </button>
              </div>

              <ul className="divide-y divide-slate-100">
                {effectiveOrderItems.map((it) => {
                  const isBack = it.placement === 'back';
                  return (
                    <li key={it.id} className="flex items-center gap-3 py-2.5">
                      <div
                        className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-black/10 p-1 shadow-sm"
                        style={{ backgroundColor: it.colorHex || '#111827' }}
                      >
                        {it.photoUrl ? (
                          <img
                            src={it.photoUrl}
                            alt={it.designName || 'Diseño'}
                            className="h-full w-full object-contain"
                          />
                        ) : (
                          <span className="text-lg">👕</span>
                        )}
                        <span className="absolute inset-x-0 bottom-0 bg-black/65 text-center text-[8px] font-bold text-white">
                          {isBack ? 'Espalda' : 'Frente'}
                        </span>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-xs font-bold text-slate-900">
                            {it.colorName} · Talla {it.size}
                          </span>
                          {it.id === '__draft__' && (
                            <button
                              type="button"
                              onClick={() => goToStep(1)}
                              className="text-[11px] font-semibold text-slate-500 underline hover:text-slate-900"
                            >
                              Editar
                            </button>
                          )}
                        </div>
                        <div className="truncate text-[11px] text-slate-500">
                          {it.designName
                            ? `${it.designCode ? `[${it.designCode}] ` : ''}${it.designName}`
                            : 'Camisa Lisa'}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                          <button
                            type="button"
                            onClick={() => handleOrderItemQty(it.id, -1)}
                            aria-label="Restar unidad"
                            className="flex h-6 w-6 items-center justify-center rounded-md bg-white text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-100"
                          >
                            −
                          </button>
                          <span className="px-1.5 text-xs font-extrabold text-slate-900">{it.qty}</span>
                          <button
                            type="button"
                            onClick={() => handleOrderItemQty(it.id, 1)}
                            aria-label="Sumar unidad"
                            className="flex h-6 w-6 items-center justify-center rounded-md bg-white text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-100"
                          >
                            +
                          </button>
                        </div>
                        <div className="min-w-[68px] text-right text-xs font-extrabold text-slate-900">
                          {money(it.qty * it.unitPrice)}
                        </div>
                        {effectiveOrderItems.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveOrderItem(it.id)}
                            className="p-1 text-xs font-bold text-rose-500 hover:text-rose-700"
                            title="Quitar prenda"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="flex items-center justify-between border-t border-slate-100 pt-2.5 text-sm">
                <span className="font-semibold text-slate-600">Total del pedido</span>
                <span className="text-lg font-extrabold text-slate-900">{money(effectiveTotalPrice)}</span>
              </div>
            </section>

            {/* DATOS DE CONTACTO Y ENTREGA */}
            <section
              ref={deliverySectionRef}
              className={`space-y-3 rounded-[24px] border bg-white p-4 shadow-sm transition ${
                deliveryError ? 'border-red-400 ring-2 ring-red-500/40' : 'border-slate-200/80'
              }`}
            >
              <div>
                <h2 className="text-sm font-semibold tracking-tight text-slate-900">
                  Tus datos de contacto <span className="text-red-500">*</span>
                </h2>
                <p className="text-[11px] text-slate-500">Nombre y WhatsApp obligatorios para confirmar</p>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                <input
                  type="text"
                  autoComplete="name"
                  maxLength={80}
                  value={customerName}
                  onChange={(e) => {
                    setCustomerName(e.target.value);
                    setDeliveryError(null);
                  }}
                  placeholder="Nombre completo *"
                  className={`w-full rounded-xl border bg-slate-50/70 px-3.5 py-2.5 text-sm font-medium text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none ${
                    deliveryError && !isNameValid
                      ? 'border-red-400 bg-red-50/40 focus:border-red-500'
                      : 'border-slate-200 focus:border-slate-900'
                  }`}
                />
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={24}
                  value={customerPhone}
                  onChange={(e) => {
                    setCustomerPhone(e.target.value);
                    setDeliveryError(null);
                  }}
                  placeholder="Teléfono / WhatsApp (ej. 9999-9999) *"
                  className={`w-full rounded-xl border bg-slate-50/70 px-3.5 py-2.5 text-sm font-medium text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none ${
                    deliveryError && !isPhoneValid
                      ? 'border-red-400 bg-red-50/40 focus:border-red-500'
                      : 'border-slate-200 focus:border-slate-900'
                  }`}
                />
                <input
                  type="text"
                  autoComplete="street-address"
                  maxLength={300}
                  value={customerAddress}
                  onChange={(e) => setCustomerAddress(e.target.value)}
                  placeholder="Dirección o ciudad (opcional)"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-sm font-medium text-slate-900 placeholder-slate-400 focus:border-slate-900 focus:bg-white focus:outline-none"
                />
              </div>

              {deliveryError && (
                <div className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
                  🔒 {deliveryError}
                </div>
              )}

              <div className="space-y-1.5">
                <div className="text-xs font-medium text-slate-500">Forma de pago preferida</div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentPending(false)}
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                      !paymentPending
                        ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    💳 Transferencia / Anticipo
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentPending(true)}
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                      paymentPending
                        ? 'border-amber-500 bg-amber-500 text-stone-950 shadow-sm'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    ⏳ Pagar al recoger en tienda
                  </button>
                </div>
              </div>

              <div className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] font-medium text-slate-600">
                📦 Confirmamos tiempo de producción y costo de envío por WhatsApp antes de despachar.
              </div>

              {customerCart.length === 0 && readyMadeMatch && (
                <div className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
                  ⚡ Disponible para entrega inmediata en talla {size}.
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      {/* BARRA INFERIOR DEL ASISTENTE (ATRÁS / SIGUIENTE / CONFIRMAR) */}
      <div
        className="fixed inset-x-0 bottom-0 z-40 border-t border-black/[0.08] bg-white/95 px-3 py-2.5 shadow-[0_-8px_30px_rgba(0,0,0,0.08)] backdrop-blur-xl sm:px-4 sm:py-3"
        style={{ paddingBottom: 'max(0.65rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto max-w-2xl space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 truncate text-xs font-medium text-slate-500">
              {effectiveOrderItems.length === 1
                ? `${effectiveOrderItems[0].colorName} · ${
                    effectiveOrderItems[0].placement === 'back' ? 'Espalda' : 'Frente'
                  } · Talla ${effectiveOrderItems[0].size} · ${effectiveTotalQty} ${
                    effectiveTotalQty === 1 ? 'ud' : 'uds'
                  }${
                    effectiveOrderItems[0].designName ? ` · ${effectiveOrderItems[0].designName}` : ''
                  }`
                : `${effectiveOrderItems.length} diseños/prendas · ${effectiveTotalQty} uds en tu pedido`}
            </div>
            <div className="shrink-0 text-base font-bold tracking-tight text-slate-900 sm:text-lg">
              {money(effectiveTotalPrice)}
            </div>
          </div>

          <div className="grid grid-cols-[auto_1fr] gap-2">
            <button
              type="button"
              onClick={() => goToStep(step - 1)}
              disabled={step === 0}
              className="inline-flex min-h-[48px] items-center justify-center rounded-full border border-slate-300 bg-white px-5 text-sm font-bold text-slate-800 shadow-sm transition active:scale-95 disabled:opacity-30"
            >
              ← Atrás
            </button>
            {step < WIZARD_LAST ? (
              <button
                type="button"
                onClick={() => goToStep(step + 1)}
                className="inline-flex min-h-[48px] items-center justify-center rounded-full bg-slate-900 px-5 text-sm font-bold text-white shadow-md transition hover:bg-slate-800 active:scale-95"
              >
                {step === 1 && !designUrl ? 'Seguir sin diseño →' : 'Siguiente →'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleSendOrderWhatsApp()}
                className="inline-flex min-h-[48px] items-center justify-center rounded-full bg-[#25D366] px-5 text-sm font-bold text-white shadow-md transition hover:bg-[#1ebe5b] active:scale-95"
              >
                {isDeliveryReady ? '✅ Confirmar y Enviar a WhatsApp' : '🔒 Completa nombre y WhatsApp'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* MODAL DE MI PEDIDO / CARRITO (Permite ordenar múltiples diseños y prendas) */}
      <Modal
        open={isCartModalOpen}
        onClose={() => setIsCartModalOpen(false)}
        title={`Mi Pedido (${cartTotalQty} ${cartTotalQty === 1 ? 'prenda' : 'prendas'})`}
      >
        <div className="space-y-3.5">
          {customerCart.length === 0 ? (
            <div className="py-8 text-center text-slate-400">
              <span className="text-3xl">🛒</span>
              <p className="mt-2 text-xs font-medium">Aún no has agregado prendas al pedido</p>
            </div>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto pr-1">
              {customerCart.map((it) => {
                const isBack = it.placement === 'back';
                const sideText = isBack ? 'Espalda' : 'Frente';
                return (
                  <li key={it.id} className="flex items-start gap-3 py-3">
                    {/* Miniatura de la prenda y diseño */}
                    <div
                      className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-black/10 p-1 shadow-sm"
                      style={{ backgroundColor: it.colorHex || '#111827' }}
                    >
                      {it.photoUrl ? (
                        <img
                          src={it.photoUrl}
                          alt={it.designName || 'Diseño'}
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <span className="text-xl">👕</span>
                      )}
                      <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[8px] font-bold text-white text-center">
                        {sideText}
                      </span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-extrabold text-slate-900">
                          {it.colorName} · Talla {it.size}
                        </span>
                      </div>

                      <div className="mt-0.5 truncate text-xs font-semibold text-slate-700">
                        {it.designName ? `${it.designCode ? `[${it.designCode}] ` : ''}${it.designName}` : 'Camisa Lisa'}
                      </div>

                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                          <button
                            type="button"
                            onClick={() => handleUpdateCartQty(it.id, -1)}
                            className="flex h-6 w-6 items-center justify-center rounded-md bg-white text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-100"
                          >
                            −
                          </button>
                          <span className="px-2 text-xs font-extrabold text-slate-900">{it.qty}</span>
                          <button
                            type="button"
                            onClick={() => handleUpdateCartQty(it.id, 1)}
                            className="flex h-6 w-6 items-center justify-center rounded-md bg-white text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-100"
                          >
                            +
                          </button>
                        </div>

                        <div className="text-right">
                          <span className="text-xs font-extrabold text-slate-900">
                            {money(it.qty * it.unitPrice)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRemoveFromCart(it.id)}
                      className="text-xs font-semibold text-rose-500 hover:text-rose-700 p-1"
                      title="Quitar"
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {customerCart.length > 0 && (
            <div className="border-t border-slate-100 pt-3 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold text-slate-600">Total acumulado:</span>
                <span className="text-xl font-extrabold text-slate-900">{money(cartTotalPrice)}</span>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => {
                    setIsCartModalOpen(false);
                    goToStep(0);
                  }}
                  className="flex-1 rounded-full border border-slate-200 bg-slate-50 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
                >
                  + Agregar otra prenda
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsCartModalOpen(false);
                    if (isDeliveryReady) {
                      void handleSendOrderWhatsApp();
                    } else {
                      goToStep(WIZARD_LAST);
                    }
                  }}
                  className="flex-1 rounded-full bg-slate-900 py-2.5 text-xs font-bold text-white shadow-md hover:bg-slate-800"
                >
                  {isDeliveryReady ? 'Confirmar por WhatsApp' : 'Ir a finalizar →'}
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (window.confirm('¿Deseas vaciar todas las prendas del pedido?')) {
                    setCustomerCart([]);
                    setIsCartModalOpen(false);
                  }
                }}
                className="w-full text-center text-[11px] font-semibold text-slate-400 hover:text-rose-600"
              >
                Vaciar lista de pedido
              </button>
            </div>
          )}
        </div>
      </Modal>

      {/* MODAL DE FICHA VISUAL / PDF CON FOTITO DEL DISEÑO */}
      <Modal
        open={!!orderSheetModal}
        onClose={() => setOrderSheetModal(null)}
        title="¡Pedido listo para enviar!"
      >
        {orderSheetModal && (
          <div className="space-y-3">
            <div className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
              <strong>✅ Registrado en Taller.</strong> Toca el botón verde para enviarlo por WhatsApp. Si quieres una copia, guarda o comparte tu PDF abajo.
            </div>
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
              <img
                src={orderSheetModal.previewUrl}
                alt="Ficha del pedido"
                className="w-full object-contain"
              />
            </div>
            <div className="space-y-2">
              <a
                href={orderSheetModal.whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[50px] w-full items-center justify-center rounded-full bg-[#25D366] px-4 py-3 text-sm font-bold text-white shadow-md transition hover:bg-[#1ebe5b] active:scale-[0.99]"
              >
                💬 Enviar Pedido por WhatsApp
              </a>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const f = orderSheetModal.pdfFile;
                    downloadBlob(f.name, f);
                    toast(`PDF guardado (${f.name})`, 'ok');
                  }}
                  className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs font-bold text-slate-800 shadow-sm hover:bg-slate-50"
                >
                  📥 Guardar PDF
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const f = orderSheetModal.pdfFile;
                    const res = await sharePdfFileNative(f, {
                      title: f.name,
                      text: `Pedido #${orderSheetModal.orderId.slice(0, 6).toUpperCase()}`
                    });
                    if (res === 'downloaded') {
                      toast(`PDF descargado (${f.name}) — ya puedes enviarlo por WhatsApp`, 'ok');
                    }
                  }}
                  className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs font-bold text-slate-800 shadow-sm hover:bg-slate-50"
                >
                  📤 Compartir PDF
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
