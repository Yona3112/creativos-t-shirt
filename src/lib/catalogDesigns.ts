import { useEffect, useMemo, useState } from 'react';
import { notifyPhotos, useAppState, usePhotoVersion } from './store';
import { addCatalogDesign, deleteCatalogDesign, updateCatalogDesign } from './actions';
import { db, savePhoto } from './db';
import {
  ensureWebPreviewUploaded,
  fetchSharedPhoto,
  fetchWebPreviewsBatch,
  uploadPhotoNow
} from './sync';
import {
  applyBackgroundRemoval,
  analyzeDesignTone,
  compressImage,
  createWebPreviewImage,
  isJpgFile,
  webPreviewPhotoId
} from './image';
import { campaignsMatch } from './publicCatalog';
import { uid } from './ids';
import type { CatalogQuickDesign, DecalPlacement } from '../components/Shirt';
import type { SharedCatalogDesignRef } from './publicCatalog';
import type { AllowedColorMode, DesignTone } from './types';

export type { SharedCatalogDesignRef };

// Caché en memoria para evitar llamadas redundantes y permitir render instantáneo en 0ms
const MEM_PHOTO_CACHE = new Map<string, string>();
const MEM_WEB_CACHE = new Map<string, string>();
const MISSING_PHOTO_IDS = new Set<string>();

export interface UseCatalogDesignsOptions {
  preferWebPreview?: boolean;
  priorityCampaign?: string | null;
  lockedCampaign?: boolean;
}

export function useCatalogDesigns(
  fallbackRefs?: SharedCatalogDesignRef[],
  options?: UseCatalogDesignsOptions
) {
  const preferWeb = Boolean(options?.preferWebPreview);
  const priorityCampaign = options?.priorityCampaign || null;
  const lockedCampaign = Boolean(options?.lockedCampaign);

  const state = useAppState();
  const photoVer = usePhotoVersion();
  const [urlMap, setUrlMap] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    const src = preferWeb ? MEM_WEB_CACHE : MEM_PHOTO_CACHE;
    for (const [k, v] of src.entries()) {
      init[k] = v;
    }
    return init;
  });
  const [missingIds, setMissingIds] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const id of MISSING_PHOTO_IDS) init[id] = true;
    return init;
  });
  const [isLoadingDesigns, setIsLoadingDesigns] = useState(false);

  const soldByDesign = useMemo(() => {
    const map = new Map<string, number>();
    if (fallbackRefs) {
      for (const ref of fallbackRefs) {
        if (ref.soldCount && ref.soldCount > 0) {
          map.set(ref.id, ref.soldCount);
        }
      }
    }
    for (const o of state.orders || []) {
      if (o.deleted || o.status === 'cancelado') continue;
      const units = (o.items || []).reduce((s, it) => s + (it.qty || 0), 0) || 1;
      if (o.designId) {
        map.set(o.designId, (map.get(o.designId) || 0) + units);
      } else if (o.designCode || o.designName) {
        const match = (state.catalogDesigns || []).find(
          (d) =>
            !d.deleted &&
            ((o.designCode && d.code && d.code.toLowerCase() === o.designCode.toLowerCase()) ||
              (o.designName && d.name.toLowerCase() === o.designName.toLowerCase()))
        );
        if (match) {
          map.set(match.id, (map.get(match.id) || 0) + units);
        }
      }
    }
    return map;
  }, [state.orders, state.catalogDesigns, fallbackRefs]);

  const rawList = useMemo(() => {
    const fromState = (state.catalogDesigns || [])
      .filter((d) => !d.deleted && d.photoId);

    const map = new Map(fromState.map((d) => [d.id, d]));
    if (fallbackRefs && fallbackRefs.length > 0) {
      for (const ref of fallbackRefs) {
        if (!map.has(ref.id)) {
          const deletedOrHidden = (state.catalogDesigns || []).find((x) => x.id === ref.id);
          if (deletedOrHidden && (deletedOrHidden.deleted || deletedOrHidden.clientVisible === false)) {
            continue;
          }
          map.set(ref.id, {
            id: ref.id,
            name: ref.name,
            code: ref.code,
            campaign: ref.campaign,
            featured: ref.featured,
            photoId: ref.photoId,
            placement: ref.placement || 'back',
            tone: ref.tone,
            allowedColorMode: ref.allowedColorMode,
            allowedColorIds: ref.allowedColorIds,
            clientVisible: true,
            createdAt: 0,
            updatedAt: 0
          });
        }
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      const featA = Boolean(a.featured);
      const featB = Boolean(b.featured);
      if (featA !== featB) return featA ? -1 : 1;
      const soldA = soldByDesign.get(a.id) || 0;
      const soldB = soldByDesign.get(b.id) || 0;
      if (soldB !== soldA) return soldB - soldA;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }, [state.catalogDesigns, fallbackRefs, soldByDesign]);

  const rawListKey = useMemo(
    () => rawList.map((d) => `${d.id}:${d.photoId}`).join('|'),
    [rawList]
  );

  useEffect(() => {
    let cancelled = false;

    const loadAll = async () => {
      const hasCampFilter = Boolean(priorityCampaign && priorityCampaign !== 'all');
      const scopedList =
        preferWeb && lockedCampaign && hasCampFilter
          ? rawList.filter((d) => campaignsMatch(d.campaign, priorityCampaign))
          : hasCampFilter
          ? [
              ...rawList.filter((d) => campaignsMatch(d.campaign, priorityCampaign)),
              ...rawList.filter((d) => !campaignsMatch(d.campaign, priorityCampaign))
            ]
          : rawList;

      // 1. Cargar inmediatamente desde memoria si ya las tenemos
      const immediate: Record<string, string> = {};
      const missing: typeof scopedList = [];

      for (const item of scopedList) {
        if (!item.photoId) continue;
        const cached = preferWeb
          ? MEM_WEB_CACHE.get(item.photoId) || MEM_PHOTO_CACHE.get(item.photoId)
          : MEM_PHOTO_CACHE.get(item.photoId);
        if (cached) {
          immediate[item.photoId] = cached;
        } else {
          missing.push(item);
        }
      }

      if (Object.keys(immediate).length > 0 && !cancelled) {
        setUrlMap((prev) => ({ ...immediate, ...prev }));
      }

      if (missing.length === 0) {
        if (!cancelled) setIsLoadingDesigns(false);
        return;
      }

      if (!cancelled) setIsLoadingDesigns(true);
      try {
        const missingPhotoIds = Array.from(
          new Set(missing.map((m) => m.photoId).filter((id): id is string => Boolean(id)))
        );

        if (preferWeb) {
          // 2a. Revisar Dexie local en lote (__web o maestro local) para restauración instantánea en 0ms
          const webKeys = missingPhotoIds.map(webPreviewPhotoId);
          const localHits: Record<string, string> = {};
          try {
            const rows = await db.photos
              .where('id')
              .anyOf(Array.from(new Set([...webKeys, ...missingPhotoIds])))
              .toArray();
            const rowMap = new Map(rows.filter((r) => Boolean(r?.data)).map((r) => [r.id, r.data]));
            for (const pid of missingPhotoIds) {
              const wData = rowMap.get(webPreviewPhotoId(pid));
              if (wData) {
                MEM_WEB_CACHE.set(pid, wData);
                localHits[pid] = wData;
                continue;
              }
              const fullLocal = rowMap.get(pid);
              if (fullLocal) {
                try {
                  const webData = await createWebPreviewImage(fullLocal, 768);
                  MEM_WEB_CACHE.set(pid, webData);
                  localHits[pid] = webData;
                  void savePhoto(webPreviewPhotoId(pid), webData, 0);
                  void uploadPhotoNow(webPreviewPhotoId(pid), webData);
                } catch {
                  MEM_WEB_CACHE.set(pid, fullLocal);
                  localHits[pid] = fullLocal;
                }
              }
            }
          } catch {
            /* ignorar fallo de IndexedDB y seguir con red */
          }

          if (Object.keys(localHits).length > 0 && !cancelled) {
            setUrlMap((prev) => ({ ...prev, ...localHits }));
          }

          const afterLocal = missingPhotoIds.filter((id) => !MEM_WEB_CACHE.has(id));
          if (!afterLocal.length || cancelled) return;

          // 2b. Traer vistas ligeras (__web) en una sola consulta agrupada (hasta 30 por lote)
          const batchWeb = await fetchWebPreviewsBatch(afterLocal);
          const batchEntries = Object.entries(batchWeb);
          if (batchEntries.length > 0) {
            for (const [pid, data] of batchEntries) {
              MISSING_PHOTO_IDS.delete(pid);
              MEM_WEB_CACHE.set(pid, data);
            }
            if (!cancelled) {
              setUrlMap((prev) => ({ ...prev, ...batchWeb }));
            }
          }

          const legacyMissing = afterLocal.filter((id) => !MEM_WEB_CACHE.has(id));
          if (!legacyMissing.length || cancelled) return;

          // 2c. Solo para diseños heredados aún sin __web: descargar de 2 en 2, comprimir a WebP y auto-curar Firestore
          let cursor = 0;
          const worker = async () => {
            while (cursor < legacyMissing.length && !cancelled) {
              const pid = legacyMissing[cursor++];
              try {
                const fullData = await fetchSharedPhoto(pid);
                if (fullData) {
                  let webData = fullData;
                  try {
                    webData = await createWebPreviewImage(fullData, 768);
                    void savePhoto(webPreviewPhotoId(pid), webData, 0);
                    void uploadPhotoNow(webPreviewPhotoId(pid), webData);
                  } catch {
                    /* usar fullData como respaldo si el lienzo falla */
                  }
                  MISSING_PHOTO_IDS.delete(pid);
                  MEM_WEB_CACHE.set(pid, webData);
                  if (!cancelled) {
                    setUrlMap((prev) => ({ ...prev, [pid]: webData }));
                  }
                } else {
                  MISSING_PHOTO_IDS.add(pid);
                  if (!cancelled) {
                    setMissingIds((prev) => ({ ...prev, [pid]: true }));
                  }
                }
              } catch (err) {
                console.warn('[catalogDesigns] error cargando diseño ligero:', pid, err);
              }
            }
          };
          await Promise.all([worker(), worker()]);
          return;
        }

        // Modo Admin / Taller: mantener los archivos maestros completos para impresión DTF
        await Promise.all(
          missing.map(async (item) => {
            if (!item.photoId) return;
            try {
              const data = await fetchSharedPhoto(item.photoId);
              if (data) {
                MISSING_PHOTO_IDS.delete(item.photoId);
                MEM_PHOTO_CACHE.set(item.photoId, data);
                if (!cancelled) {
                  setUrlMap((prev) => ({ ...prev, [item.photoId]: data }));
                }
              } else {
                MISSING_PHOTO_IDS.add(item.photoId);
                if (!cancelled) {
                  setMissingIds((prev) => ({ ...prev, [item.photoId]: true }));
                }
              }
            } catch (err) {
              console.warn('[catalogDesigns] error cargando diseño:', item.name, err);
            }
          })
        );
      } finally {
        if (!cancelled) setIsLoadingDesigns(false);
      }
    };

    void loadAll();
    return () => {
      cancelled = true;
    };
  }, [rawListKey, photoVer, preferWeb, priorityCampaign, lockedCampaign]);

  const allDesigns: CatalogQuickDesign[] = useMemo(() => {
    // Filtrar diseños huérfanos sin imagen en la nube y deduplicar por nombre o contenido de imagen idéntico
    const seenNames = new Set<string>();
    const seenImageSigs = new Set<string>();
    const uniqueRaw = rawList.filter((d) => {
      if (!d.photoId) return false;
      const img =
        urlMap[d.photoId] ||
        (preferWeb ? MEM_WEB_CACHE.get(d.photoId) : undefined) ||
        MEM_PHOTO_CACHE.get(d.photoId) ||
        null;
      if (!img && (missingIds[d.photoId] || MISSING_PHOTO_IDS.has(d.photoId))) {
        return false;
      }
      const nameKey = `${(d.name || '').trim().toLowerCase()}|${d.placement || 'back'}`;
      if (seenNames.has(nameKey)) return false;
      if (img) {
        // Firma rápida de la imagen (longitud + muestra central) para detectar la misma foto subida dos veces
        const mid = Math.floor(img.length / 2);
        const imgSig = `${img.length}:${img.slice(mid, mid + 64)}`;
        if (seenImageSigs.has(imgSig)) return false;
        seenImageSigs.add(imgSig);
      }
      seenNames.add(nameKey);
      return true;
    });

    const anySoldOrFeatured = uniqueRaw.some(
      (d) => Boolean(d.featured) || (soldByDesign.get(d.id) || 0) > 0
    );
    let bestSellerRank = 0;
    return uniqueRaw.map((d, idx) => {
      const soldCount = soldByDesign.get(d.id) || 0;
      const featured = Boolean(d.featured);
      let isBestSeller = false;
      if (anySoldOrFeatured) {
        if (featured || (soldCount > 0 && bestSellerRank < 3)) {
          isBestSeller = true;
          bestSellerRank++;
        }
      } else if (idx < 2 && d.clientVisible !== false) {
        isBestSeller = true;
      }
      return {
        id: d.id,
        name: d.name,
        code: d.code,
        campaign: d.campaign,
        soldCount,
        featured,
        isBestSeller,
        photoId: d.photoId,
        imageUrl:
          urlMap[d.photoId] ||
          (preferWeb ? MEM_WEB_CACHE.get(d.photoId) : undefined) ||
          MEM_PHOTO_CACHE.get(d.photoId) ||
          null,
        placement: d.placement || 'back',
        clientVisible: d.clientVisible !== false,
        tone: d.tone,
        allowedColorMode: d.allowedColorMode,
        allowedColorIds: d.allowedColorIds
      };
    });
  }, [rawList, urlMap, missingIds, soldByDesign, preferWeb]);

  const clientDesigns: CatalogQuickDesign[] = useMemo(
    () => allDesigns.filter((d) => d.clientVisible !== false),
    [allDesigns]
  );

  const saveCurrentToCatalog = async (opts: {
    dataUrl: string;
    name?: string;
    code?: string;
    campaign?: string;
    clientVisible?: boolean;
    placement?: DecalPlacement;
    existingPhotoId?: string | null;
    skipPrompt?: boolean;
    tone?: DesignTone;
    allowedColorMode?: AllowedColorMode | 'auto';
    allowedColorIds?: string[];
  }) => {
    const pId = opts.existingPhotoId || uid();
    MEM_PHOTO_CACHE.set(pId, opts.dataUrl);
    await savePhoto(pId, opts.dataUrl, 0);
    await uploadPhotoNow(pId, opts.dataUrl);
    void ensureWebPreviewUploaded(pId, opts.dataUrl).then((webData) => {
      if (webData) MEM_WEB_CACHE.set(pId, webData);
    });
    notifyPhotos();
    setUrlMap((prev) => ({ ...prev, [pId]: opts.dataUrl }));
    const analysis = opts.tone ? null : await analyzeDesignTone(opts.dataUrl);
    const resolvedTone = opts.tone || analysis?.tone || 'mixed';
    const resolvedColorMode: AllowedColorMode =
      !opts.allowedColorMode || opts.allowedColorMode === 'auto'
        ? analysis?.suggestedColorMode || (resolvedTone === 'dark' ? 'light_fabrics' : resolvedTone === 'light' ? 'dark_fabrics' : 'all')
        : opts.allowedColorMode;

    const count = (state.catalogDesigns || []).filter((x) => !x.deleted).length + 1;
    const finalName = opts.name?.trim() || `Diseño #${count}`;
    const finalCode = opts.code?.trim().toUpperCase() || `D-${String(count).padStart(3, '0')}`;
    return addCatalogDesign({
      name: finalName,
      code: finalCode,
      campaign: opts.campaign && opts.campaign !== 'all' ? opts.campaign : undefined,
      photoId: pId,
      clientVisible: opts.clientVisible ?? true,
      placement: opts.placement || 'back',
      tone: resolvedTone,
      allowedColorMode: resolvedColorMode,
      allowedColorIds: resolvedColorMode === 'custom' ? opts.allowedColorIds : undefined
    });
  };

  const uploadFilesToCatalog = async (
    files: FileList | File[],
    opts?: {
      removeBg?: boolean;
      tolerance?: number;
      placement?: DecalPlacement;
      campaign?: string;
      clientVisible?: boolean;
      customName?: string;
      allowedColorMode?: AllowedColorMode | 'auto';
      allowedColorIds?: string[];
    }
  ): Promise<number> => {
    const list = Array.from(files);
    if (!list.length) return 0;
    const shouldRemove = opts?.removeBg ?? false;
    const tol = opts?.tolerance ?? 34;
    let added = 0;

    for (const file of list) {
      const autoRemoveForJpg = shouldRemove || isJpgFile(file);
      const raw = await compressImage(file, 1400, 0.92, false);
      const processed = autoRemoveForJpg ? await applyBackgroundRemoval(raw, true, tol) : raw;
      const analysis = await analyzeDesignTone(processed);
      const resolvedColorMode: AllowedColorMode =
        !opts?.allowedColorMode || opts.allowedColorMode === 'auto'
          ? analysis.suggestedColorMode
          : opts.allowedColorMode;

      const pId = uid();
      MEM_PHOTO_CACHE.set(pId, processed);
      await savePhoto(pId, processed, 0);
      await uploadPhotoNow(pId, processed);
      void ensureWebPreviewUploaded(pId, processed).then((webData) => {
        if (webData) MEM_WEB_CACHE.set(pId, webData);
      });
      setUrlMap((prev) => ({ ...prev, [pId]: processed }));

      const cleanFileName = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]+/g, ' ').trim();
      const count = (state.catalogDesigns || []).filter((x) => !x.deleted).length + added + 1;
      const itemName =
        list.length === 1 && opts?.customName?.trim()
          ? opts.customName.trim()
          : cleanFileName
          ? cleanFileName.slice(0, 28)
          : `Diseño #${count}`;
      addCatalogDesign({
        name: itemName,
        campaign: opts?.campaign && opts.campaign !== 'all' ? opts.campaign : undefined,
        photoId: pId,
        clientVisible: opts?.clientVisible ?? true,
        placement: opts?.placement || 'back',
        tone: analysis.tone,
        allowedColorMode: resolvedColorMode,
        allowedColorIds: resolvedColorMode === 'custom' ? opts?.allowedColorIds : undefined
      });
      added++;
    }
    notifyPhotos();
    return added;
  };

  return {
    allDesigns,
    clientDesigns,
    isLoadingDesigns,
    saveCurrentToCatalog,
    uploadFilesToCatalog,
    toggleVisible: (id: string, nextVisible: boolean) =>
      updateCatalogDesign(id, { clientVisible: nextVisible }),
    renameDesign: (id: string, name: string, code: string, campaign?: string) =>
      updateCatalogDesign(id, {
        name: name.trim() || 'Diseño',
        code: code.trim().toUpperCase(),
        ...(campaign !== undefined ? { campaign: campaign.trim() || undefined } : {})
      }),
    setDesignCampaign: (id: string, campaign: string) =>
      updateCatalogDesign(id, { campaign: campaign === 'all' ? undefined : campaign }),
    setDesignColors: (
      id: string,
      allowedColorMode: AllowedColorMode,
      allowedColorIds?: string[],
      tone?: DesignTone
    ) =>
      updateCatalogDesign(id, {
        allowedColorMode,
        allowedColorIds: allowedColorMode === 'custom' ? allowedColorIds : undefined,
        ...(tone ? { tone } : {})
      }),
    toggleFeatured: (id: string, nextFeatured: boolean) =>
      updateCatalogDesign(id, { featured: nextFeatured }),
    deleteDesign: (id: string) => deleteCatalogDesign(id)
  };
}
