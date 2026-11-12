import { useEffect, useMemo, useState } from 'react';
import { notifyPhotos, useAppState, usePhotoVersion } from './store';
import { addCatalogDesign, deleteCatalogDesign, updateCatalogDesign } from './actions';
import { savePhoto } from './db';
import { fetchSharedPhoto, uploadPhotoNow } from './sync';
import { applyBackgroundRemoval, compressImage, isJpgFile } from './image';
import { uid } from './ids';
import type { CatalogQuickDesign, DecalPlacement } from '../components/Shirt';
import type { SharedCatalogDesignRef } from './publicCatalog';

export type { SharedCatalogDesignRef };

// Caché en memoria para evitar llamadas redundantes y permitir render instantáneo en 0ms
const MEM_PHOTO_CACHE = new Map<string, string>();

export function useCatalogDesigns(fallbackRefs?: SharedCatalogDesignRef[]) {
  const state = useAppState();
  const photoVer = usePhotoVersion();
  const [urlMap, setUrlMap] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const [k, v] of MEM_PHOTO_CACHE.entries()) {
      init[k] = v;
    }
    return init;
  });

  const rawList = useMemo(() => {
    const fromState = (state.catalogDesigns || [])
      .filter((d) => !d.deleted && d.photoId)
      .sort((a, b) => b.createdAt - a.createdAt);

    if (!fallbackRefs || fallbackRefs.length === 0) {
      return fromState;
    }

    const map = new Map(fromState.map((d) => [d.id, d]));
    for (const ref of fallbackRefs) {
      if (!map.has(ref.id)) {
        // Si el estado en vivo ya tiene ese diseño marcado como deleted o clientVisible=false, respetarlo
        const deletedOrHidden = (state.catalogDesigns || []).find((x) => x.id === ref.id);
        if (deletedOrHidden && (deletedOrHidden.deleted || deletedOrHidden.clientVisible === false)) {
          continue;
        }
        map.set(ref.id, {
          id: ref.id,
          name: ref.name,
          code: ref.code,
          campaign: ref.campaign,
          photoId: ref.photoId,
          placement: ref.placement || 'back',
          clientVisible: true,
          createdAt: 0,
          updatedAt: 0
        });
      }
    }
    return Array.from(map.values());
  }, [state.catalogDesigns, fallbackRefs]);

  const rawListKey = useMemo(
    () => rawList.map((d) => `${d.id}:${d.photoId}`).join('|'),
    [rawList]
  );

  useEffect(() => {
    let cancelled = false;

    const loadAll = async () => {
      // 1. Cargar inmediatamente de memoria si ya las tenemos
      const immediate: Record<string, string> = {};
      const missing: typeof rawList = [];

      for (const item of rawList) {
        if (!item.photoId) continue;
        const cached = MEM_PHOTO_CACHE.get(item.photoId);
        if (cached) {
          immediate[item.photoId] = cached;
        } else {
          missing.push(item);
        }
      }

      if (Object.keys(immediate).length > 0 && !cancelled) {
        setUrlMap((prev) => ({ ...immediate, ...prev }));
      }

      if (missing.length === 0) return;

      // 2. Descargar las que falten en paralelo y actualizar la UI progresivamente según lleguen
      await Promise.all(
        missing.map(async (item) => {
          if (!item.photoId) return;
          try {
            const data = await fetchSharedPhoto(item.photoId);
            if (data) {
              MEM_PHOTO_CACHE.set(item.photoId, data);
              if (!cancelled) {
                setUrlMap((prev) => ({ ...prev, [item.photoId]: data }));
              }
            }
          } catch (err) {
            console.warn('[catalogDesigns] error cargando diseño:', item.name, err);
          }
        })
      );
    };

    void loadAll();
    return () => {
      cancelled = true;
    };
  }, [rawListKey, photoVer]);

  const allDesigns: CatalogQuickDesign[] = useMemo(
    () =>
      rawList.map((d) => ({
        id: d.id,
        name: d.name,
        code: d.code,
        campaign: d.campaign,
        photoId: d.photoId,
        imageUrl: urlMap[d.photoId] || MEM_PHOTO_CACHE.get(d.photoId) || null,
        placement: d.placement || 'back',
        clientVisible: d.clientVisible !== false
      })),
    [rawList, urlMap]
  );

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
  }) => {
    const pId = opts.existingPhotoId || uid();
    MEM_PHOTO_CACHE.set(pId, opts.dataUrl);
    await savePhoto(pId, opts.dataUrl, 0);
    await uploadPhotoNow(pId, opts.dataUrl);
    notifyPhotos();
    setUrlMap((prev) => ({ ...prev, [pId]: opts.dataUrl }));
    const count = (state.catalogDesigns || []).filter((x) => !x.deleted).length + 1;
    const defaultName = opts.name?.trim() || `Diseño #${count}`;
    const defaultCode = opts.code?.trim().toUpperCase() || `D-${String(count).padStart(3, '0')}`;
    let finalName = defaultName;
    let finalCode = defaultCode;
    if (!opts.skipPrompt && !opts.name) {
      const promptedName = window.prompt('Nombre del diseño (para identificar en pedidos y reportes):', defaultName);
      if (promptedName !== null && promptedName.trim()) finalName = promptedName.trim();
      const promptedCode = window.prompt('Código del diseño (ej. D-001, TORO-01):', defaultCode);
      if (promptedCode !== null && promptedCode.trim()) finalCode = promptedCode.trim().toUpperCase();
    }
    return addCatalogDesign({
      name: finalName,
      code: finalCode,
      campaign: opts.campaign && opts.campaign !== 'all' ? opts.campaign : undefined,
      photoId: pId,
      clientVisible: opts.clientVisible ?? true,
      placement: opts.placement || 'back'
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
      const pId = uid();
      MEM_PHOTO_CACHE.set(pId, processed);
      await savePhoto(pId, processed, 0);
      await uploadPhotoNow(pId, processed);
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
        placement: opts?.placement || 'back'
      });
      added++;
    }
    notifyPhotos();
    return added;
  };

  return {
    allDesigns,
    clientDesigns,
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
    deleteDesign: (id: string) => deleteCatalogDesign(id)
  };
}
