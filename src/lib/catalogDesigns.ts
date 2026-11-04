import { useEffect, useMemo, useState } from 'react';
import { notifyPhotos, useAppState, usePhotoVersion } from './store';
import { addCatalogDesign, deleteCatalogDesign, updateCatalogDesign } from './actions';
import { savePhoto } from './db';
import { fetchSharedPhoto, uploadPhotoNow } from './sync';
import { applyBackgroundRemoval, compressImage } from './image';
import { uid } from './ids';
import type { CatalogQuickDesign, DecalPlacement } from '../components/Shirt';

export interface SharedCatalogDesignRef {
  id: string;
  name: string;
  photoId: string;
  placement: DecalPlacement;
}

export function useCatalogDesigns(fallbackRefs?: SharedCatalogDesignRef[]) {
  const state = useAppState();
  const photoVer = usePhotoVersion();
  const [urlMap, setUrlMap] = useState<Record<string, string>>({});

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
        if (deletedOrHidden) continue;
        map.set(ref.id, {
          id: ref.id,
          name: ref.name,
          photoId: ref.photoId,
          placement: ref.placement || 'center',
          clientVisible: true,
          createdAt: 0,
          updatedAt: 0
        });
      }
    }
    return Array.from(map.values());
  }, [state.catalogDesigns, fallbackRefs]);

  useEffect(() => {
    let cancelled = false;
    const loadAll = async () => {
      const next: Record<string, string> = {};
      for (const item of rawList) {
        if (!item.photoId) continue;
        const data = await fetchSharedPhoto(item.photoId);
        if (data) {
          try {
            // Garantizar que cualquier diseño previamente guardado limpie huecos internos (A, B, O) y bordes negros
            const cleaned = await applyBackgroundRemoval(data, true, 36);
            next[item.photoId] = cleaned;
          } catch {
            next[item.photoId] = data;
          }
        }
      }
      if (!cancelled) {
        setUrlMap((prev) => ({ ...prev, ...next }));
      }
    };
    void loadAll();
    return () => {
      cancelled = true;
    };
  }, [rawList, photoVer]);

  const allDesigns: CatalogQuickDesign[] = useMemo(
    () =>
      rawList.map((d) => ({
        id: d.id,
        name: d.name,
        photoId: d.photoId,
        imageUrl: urlMap[d.photoId] || null,
        placement: d.placement || 'center',
        clientVisible: d.clientVisible
      })),
    [rawList, urlMap]
  );

  const clientDesigns: CatalogQuickDesign[] = useMemo(
    () => allDesigns.filter((d) => d.clientVisible),
    [allDesigns]
  );

  const saveCurrentToCatalog = async (opts: {
    dataUrl: string;
    name?: string;
    placement?: DecalPlacement;
    existingPhotoId?: string | null;
  }) => {
    const pId = opts.existingPhotoId || uid();
    await savePhoto(pId, opts.dataUrl, 0);
    void uploadPhotoNow(pId, opts.dataUrl);
    notifyPhotos();
    setUrlMap((prev) => ({ ...prev, [pId]: opts.dataUrl }));
    const count = (state.catalogDesigns || []).filter((x) => !x.deleted).length + 1;
    return addCatalogDesign({
      name: opts.name?.trim() || `Diseño #${count}`,
      photoId: pId,
      clientVisible: true,
      placement: opts.placement || 'center'
    });
  };

  const uploadFilesToCatalog = async (
    files: FileList | File[],
    opts?: { removeBg?: boolean; tolerance?: number; placement?: DecalPlacement }
  ): Promise<number> => {
    const list = Array.from(files);
    if (!list.length) return 0;
    const shouldRemove = opts?.removeBg ?? true;
    const tol = opts?.tolerance ?? 34;
    let added = 0;

    for (const file of list) {
      const raw = await compressImage(file, 1400, 0.92, false);
      const processed = shouldRemove ? await applyBackgroundRemoval(raw, true, tol) : raw;
      const pId = uid();
      await savePhoto(pId, processed, 0);
      void uploadPhotoNow(pId, processed);
      setUrlMap((prev) => ({ ...prev, [pId]: processed }));

      const cleanFileName = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]+/g, ' ').trim();
      const count = (state.catalogDesigns || []).filter((x) => !x.deleted).length + added + 1;
      addCatalogDesign({
        name: cleanFileName ? cleanFileName.slice(0, 24) : `Diseño #${count}`,
        photoId: pId,
        clientVisible: true,
        placement: opts?.placement || 'center'
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
    deleteDesign: (id: string) => deleteCatalogDesign(id)
  };
}
