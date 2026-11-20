import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CartLine, Customer, Order, Section } from '../lib/types';
import { getState, notifyPhotos, useAppState, useStock } from '../lib/store';
import { activeBrands, brandColors, isCustomOrderSpec, normalPrice, repriceCart, tierPrice, vkey } from '../lib/inventory';
import { money } from '../lib/money';
import { uid, folioLabel } from '../lib/ids';
import { compressImage, applyBackgroundRemoval, removeBackgroundWithAI, upscaleImageTo4K, isJpgFile } from '../lib/image';
import { savePhoto } from '../lib/db';
import { fetchSharedPhoto } from '../lib/sync';
import { addressOneLine, createOrder, deleteColor, quickCustomer, saveCustomer, updateBrand, updateColor, updateSettings } from '../lib/actions';
import { ColorDot, Modal, MoneyInput, PhotoViewer, Stepper, toast } from '../components/ui';
import { InteractiveShirt3D, type DecalPlacement } from '../components/Shirt';
import { NewColorModal } from '../components/NewColorModal';
import { WorkshopPdfModal } from '../components/WorkshopPdfModal';
import { fillTemplate, whatsappUrl } from '../lib/whatsapp';
import { useCatalogDesigns } from '../lib/catalogDesigns';
import { sanitizeWebOrder } from '../lib/publicCatalog';
import { WEB_ORDER_LATEST_KEY, readWebOrderImportHash, type CustomerWebOrderPayload } from './Catalog3D';

function cleanHnPhoneDigits(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '');
  return digits.length > 8 && digits.startsWith('504') ? digits.slice(3) : digits;
}

const POS_WIZARD_STEPS = [
  {
    short: 'Color',
    title: 'Escoge color de camiseta',
    subtitle: 'Elige la marca y el color de la camiseta en la vista 3D'
  },
  {
    short: 'Diseño',
    title: 'Escoge tu diseño y dónde irá',
    subtitle: 'Indica si va en espalda o frente y selecciona o sube el diseño'
  },
  {
    short: 'Tallas',
    title: 'Escoge la cantidad y tallas',
    subtitle: 'Pide varias unidades de la misma talla o combina tallas para este diseño'
  },
  {
    short: 'Carrito',
    title: 'Carrito y datos',
    subtitle: 'Revisa las prendas, selecciona el cliente y registra el pago'
  }
] as const;
const POS_WIZARD_LAST = 3 as const;

const LS_CART = 'cgs_cart_v1';
const LS_LAST_IMPORTED_WEB_ORDER = 'cgs_last_imported_weborder_v1';

interface Draft {
  lines: CartLine[];
  photo: string | null;
  rawPhoto?: string | null;
  removeBg?: boolean;
  placement?: DecalPlacement;
  designScale?: number;
  designOffsetX?: number;
  designOffsetY?: number;
  designId?: string | null;
  designName?: string | null;
  designCode?: string | null;
  customerId: string | null;
  addressId: string | null;
  withShipping: boolean;
  shipping: number;
  paymentMethod: string;
  paymentMode?: 'full' | 'pending' | 'partial';
  workType: string;
  deposit: number | null;
  notes: string;
}

function emptyDraft(): Draft {
  const s = getState().settings;
  const nonPendingMethod =
    s.paymentMethods.find((p) => !p.toLowerCase().includes('pendiente')) ||
    s.paymentMethods[0] ||
    'Efectivo';
  const plainWork = s.workTypes.find((w) => w.toLowerCase().includes('lisa')) || 'Camisa Lisa';
  return {
    lines: [],
    photo: null,
    rawPhoto: null,
    removeBg: false,
    placement: 'back',
    designScale: 2.0,
    designOffsetX: 0,
    designOffsetY: 0,
    customerId: null,
    addressId: null,
    withShipping: true,
    shipping: s.shipping,
    paymentMethod: nonPendingMethod,
    paymentMode: 'full',
    workType: plainWork,
    deposit: null,
    notes: ''
  };
}

function loadDraft(): Draft {
  const base = emptyDraft();
  try {
    const raw = localStorage.getItem(LS_CART);
    if (raw) {
      const parsed = JSON.parse(raw) as Draft;
      if (parsed.designScale && parsed.designScale > 2.2) {
        parsed.designScale = 2.0;
        parsed.designOffsetY = 0;
      }
      const merged = { ...base, ...parsed };
      if (!merged.photo && !merged.designName && !merged.designId && merged.lines.length === 0) {
        merged.workType = base.workType;
      }
      return merged;
    }
  } catch {
    /* ignorar */
  }
  return base;
}

export default function NewOrder({ navigate }: { navigate: (s: Section) => void }) {
  const state = useAppState();
  const { stock } = useStock();
  const { settings } = state;
  const brands = activeBrands(state);

  const [draft, setDraft] = useState<Draft>(loadDraft);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  useEffect(() => {
    try {
      localStorage.setItem(LS_CART, JSON.stringify(draft));
    } catch {
      try {
        const compactDraft: Draft = {
          ...draft,
          rawPhoto: null,
          photo: draft.photo && draft.photo.length > 150000 ? null : draft.photo,
          lines: draft.lines.map((l) => ({
            ...l,
            rawPhoto: null,
            photo: l.photo && l.photo.length > 150000 ? null : l.photo
          }))
        };
        localStorage.setItem(LS_CART, JSON.stringify(compactDraft));
      } catch {
        /* foto muy grande para localStorage: se mantiene en memoria */
      }
    }
  }, [draft]);

  // Selección actual
  const [brandId, setBrandId] = useState(brands[0]?.id || '');
  const colors = brandColors(state, brandId);
  const [colorId, setColorId] = useState(colors[0]?.id || '');
  const defaultSize = settings.sizes.includes('M') ? 'M' : settings.sizes[0] || 'M';
  const [sizeQtys, setSizeQtys] = useState<Record<string, number>>(() => ({ [defaultSize]: 1 }));
  const [manualPrice, setManualPrice] = useState<number | null>(null);
  const [colorModal, setColorModal] = useState(false);
  const [editingColor, setEditingColor] = useState<{ id: string; name: string; hex: string } | null>(null);
  const [pendingColorName, setPendingColorName] = useState<string | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [done, setDone] = useState<Order | null>(null);

  const brand = brands.find((b) => b.id === brandId);
  const color = colors.find((c) => c.id === colorId) || colors[0];

  const setSizeQty = (sz: string, nextQty: number) => {
    const clamped = Math.max(0, Math.min(999, nextQty));
    setSizeQtys((prev) => ({ ...prev, [sz]: clamped }));
    setJustAddedLine(false);
  };

  const selectedSizeEntries = useMemo(
    () =>
      settings.sizes
        .filter((sz) => (sizeQtys[sz] || 0) > 0)
        .map((sz) => ({ size: sz, qty: sizeQtys[sz] || 0 })),
    [settings.sizes, sizeQtys]
  );
  const currentDraftQty = selectedSizeEntries.reduce((s, e) => s + e.qty, 0);

  useEffect(() => {
    if (!colors.some((c) => c.id === colorId)) setColorId(colors[0]?.id || '');
  }, [brandId, colors, colorId]);

  // Seleccionar automáticamente el color recién creado
  useEffect(() => {
    if (!pendingColorName) return;
    const c = colors.find((x) => x.name.toLowerCase() === pendingColorName.toLowerCase());
    if (c) {
      setColorId(c.id);
      setPendingColorName(null);
    }
  }, [colors, pendingColorName]);

  const lines = useMemo(() => repriceCart(draft.lines, settings, state.brands), [draft.lines, settings, state.brands]);
  const cartQty = lines.reduce((s, l) => s + l.qty, 0);
  const projectedQty = cartQty + Math.max(1, currentDraftQty);
  const plainWorkTypeDefault =
    settings.workTypes.find((w) => w.toLowerCase().includes('lisa')) || 'Camisa Lisa';
  const customWorkTypeDefault =
    settings.workTypes.find((w) => w.toLowerCase().includes('espalda')) ||
    settings.workTypes.find((w) => !w.toLowerCase().includes('lisa')) ||
    'DTF Espalda';
  const isCustomWork = isCustomOrderSpec({
    workType: draft.workType,
    photo: draft.photo,
    designId: draft.designId,
    designName: draft.designName
  });
  const clearDraftDesign = () =>
    set({
      photo: null,
      rawPhoto: null,
      designId: null,
      designName: null,
      designCode: null,
      workType: plainWorkTypeDefault
    });
  const autoPrice = isCustomWork
    ? (settings.priceCustom || 35000)
    : tierPrice(settings, brand, projectedQty);
  const unitPrice = manualPrice ?? autoPrice;

  const subtotal = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const shipping = draft.withShipping ? draft.shipping : 0;
  const total = subtotal + shipping;
  const paymentMode: 'full' | 'pending' | 'partial' =
    draft.paymentMode ||
    (draft.paymentMethod?.toLowerCase().includes('pendiente')
      ? 'pending'
      : draft.deposit !== null && draft.deposit > 0 && draft.deposit < total
      ? 'partial'
      : 'full');
  const deposit =
    paymentMode === 'pending'
      ? 0
      : paymentMode === 'partial'
      ? Math.min(Math.max(0, draft.deposit || 0), total)
      : draft.deposit && draft.deposit > 0
      ? Math.min(draft.deposit, total)
      : total;
  const balance = Math.max(0, total - deposit);

  const customer = state.customers.find((c) => c.id === draft.customerId) || null;

  const commitCurrentLineToCart = (silent = false): boolean => {
    if (!brand || !color) {
      if (!silent) toast('Elige marca y color', 'error');
      return false;
    }
    const entriesToAdd =
      selectedSizeEntries.length > 0
        ? selectedSizeEntries
        : silent
        ? [{ size: defaultSize, qty: 1 }]
        : [];
    if (entriesToAdd.length === 0) {
      if (!silent) toast('Elige al menos una talla', 'error');
      return false;
    }
    const isManual = manualPrice !== null;
    const hasDesignForLine = isCustomWork && Boolean(draft.photo || draft.designId || draft.designName);
    const curDesignId = hasDesignForLine ? draft.designId || null : null;
    const curDesignName = hasDesignForLine ? draft.designName || 'Diseño personalizado' : null;
    const curDesignCode = hasDesignForLine ? draft.designCode || null : null;
    const curPlacement = hasDesignForLine ? draft.placement || 'back' : null;
    const curPhoto = hasDesignForLine ? draft.photo || null : null;
    const curRawPhoto = hasDesignForLine ? draft.rawPhoto || null : null;
    const curScale = draft.designScale || 2.0;
    const curOffsetX = draft.designOffsetX || 0;
    const curOffsetY = draft.designOffsetY || 0;

    setDraft((d) => {
      const next = [...d.lines];
      for (const entry of entriesToAdd) {
        const idx = next.findIndex(
          (l) =>
            l.brandId === brand.id &&
            l.colorId === color.id &&
            l.size === entry.size &&
            l.manualPrice === isManual &&
            (!isManual || l.unitPrice === unitPrice) &&
            (l.designId || null) === curDesignId &&
            (l.designName || null) === curDesignName &&
            (l.placement || null) === curPlacement
        );
        if (idx >= 0) {
          next[idx] = { ...next[idx], qty: next[idx].qty + entry.qty };
        } else {
          next.push({
            id: uid(),
            brandId: brand.id,
            colorId: color.id,
            size: entry.size,
            qty: entry.qty,
            unitPrice,
            manualPrice: isManual,
            designId: curDesignId,
            designName: curDesignName,
            designCode: curDesignCode,
            photo: curPhoto,
            rawPhoto: curRawPhoto,
            placement: curPlacement,
            scale: curScale,
            offsetX: curOffsetX,
            offsetY: curOffsetY,
            workType: draft.workType
          });
        }
      }
      return { ...d, lines: next };
    });
    if (!silent) {
      const sizeSummary = entriesToAdd.map((e) => `${e.qty}×${e.size}`).join(', ');
      toast(`Agregado: ${sizeSummary} (${color.name})`, 'ok');
    }
    setSizeQtys({ [defaultSize]: 1 });
    setManualPrice(null);
    setJustAddedLine(true);
    return true;
  };

  const updateLine = (id: string, patch: Partial<CartLine>) =>
    setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  const removeLine = (id: string) => setDraft((d) => ({ ...d, lines: d.lines.filter((l) => l.id !== id) }));

  const [procMsg, setProcMsg] = useState<string | null>(null);
  const {
    allDesigns,
    saveCurrentToCatalog,
    uploadFilesToCatalog,
    toggleVisible,
    renameDesign,
    setDesignCampaign,
    setDesignColors,
    deleteDesign
  } = useCatalogDesigns();

  const onPhoto = async (f: File | undefined) => {
    if (!f) return;
    try {
      const autoJpgToPng = isJpgFile(f);
      const shouldRemoveBg = autoJpgToPng || (draft.removeBg ?? false);
      const raw = await compressImage(f, 2400, 0.96, false);
      const processed = shouldRemoveBg ? await applyBackgroundRemoval(raw, true, 34) : raw;
      const cleanFileName = f.name.replace(/\.[^/.]+$/, '').replace(/[-_]+/g, ' ').trim();
      set({
        rawPhoto: raw,
        photo: processed,
        removeBg: shouldRemoveBg,
        designId: null,
        designName: cleanFileName ? cleanFileName.slice(0, 32) : 'Diseño personalizado',
        designCode: draft.designCode || 'CUSTOM',
        designScale: 2.0,
        designOffsetX: 0,
        designOffsetY: 0,
        workType: draft.workType.toLowerCase().includes('lisa') ? customWorkTypeDefault : draft.workType
      });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const toggleRemoveBg = async (nextRemove: boolean) => {
    const base = draft.rawPhoto || draft.photo;
    if (!base) {
      set({ removeBg: nextRemove });
      return;
    }
    try {
      const updated = nextRemove ? await applyBackgroundRemoval(base, true, 34) : base;
      set({ removeBg: nextRemove, photo: updated });
    } catch {
      set({ removeBg: nextRemove });
    }
  };

  const handleAiBgNewOrder = async () => {
    const base = draft.rawPhoto || draft.photo;
    if (!base) return;
    try {
      setProcMsg('Procesando recorte IA profesional...');
      const res = await removeBackgroundWithAI(base, (m) => setProcMsg(m));
      set({ photo: res, removeBg: true });
      toast('Fondo eliminado con IA preservando todos los colores');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setProcMsg(null);
    }
  };

  const handleUpscale4KNewOrder = async () => {
    if (!draft.photo) return;
    try {
      setProcMsg('Escalando diseño a 4K Ultra HD...');
      const { dataUrl, width, height } = await upscaleImageTo4K(draft.photo, 2560);
      set({ photo: dataUrl });
      toast(`Diseño escalado a 4K Ultra HD (${width}×${height} px)`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setProcMsg(null);
    }
  };

  // Cliente rápido / Consumidor Final
  const [custMode, setCustMode] = useState<'buscar' | 'nuevo' | 'consumidor'>('buscar');
  const [q, setQ] = useState('');
  const [qc, setQc] = useState({ name: '', phone: '', address: '' });
  const [existingPhone, setExistingPhone] = useState('');
  const [consumidorNote, setConsumidorNote] = useState('');
  const [customerError, setCustomerError] = useState<string | null>(null);
  const customerSectionRef = useRef<HTMLDivElement>(null);
  const [wizardStep, setWizardStep] = useState<0 | 1 | 2 | 3>(() =>
    draft.lines.length > 0 ? 3 : 0
  );
  const [maxStepReached, setMaxStepReached] = useState<number>(() =>
    draft.lines.length > 0 ? 3 : 0
  );
  const [justAddedLine, setJustAddedLine] = useState<boolean>(() => draft.lines.length > 0);
  const [pdfModalOrder, setPdfModalOrder] = useState<Order | null>(null);

  const goToWizardStep = (next: number) => {
    const clamped = Math.max(0, Math.min(POS_WIZARD_LAST, next)) as 0 | 1 | 2 | 3;
    if (clamped === POS_WIZARD_LAST && (!justAddedLine || lines.length === 0)) {
      commitCurrentLineToCart(true);
    }
    setWizardStep(clamped);
    setMaxStepReached((prev) => Math.max(prev, clamped));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAddAnotherShirt = (fromStep3 = false) => {
    if (!fromStep3 || !justAddedLine || lines.length === 0) {
      if (!commitCurrentLineToCart(false)) return;
    }
    clearDraftDesign();
    setSizeQtys({ [defaultSize]: 1 });
    setManualPrice(null);
    setJustAddedLine(true);
    setWizardStep(0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const [latestWebOrder, setLatestWebOrder] = useState<CustomerWebOrderPayload | null>(null);
  const [importingWebOrder, setImportingWebOrder] = useState(false);

  const importCustomerWebOrder = useCallback(
    async (webOrder: CustomerWebOrderPayload) => {
      setImportingWebOrder(true);
      try {
        const cleanPhone = (webOrder.customerPhone || '').replace(/\D/g, '');
        const existingCustomer = cleanPhone
          ? state.customers.find((c) => !c.deleted && c.phone.replace(/\D/g, '').endsWith(cleanPhone.slice(-8)))
          : null;

        if (existingCustomer) {
          setCustMode('buscar');
          const defAddr = existingCustomer.addresses.find((a) => a.isDefault) || existingCustomer.addresses[0];
          setDraft((prev) => ({
            ...prev,
            customerId: existingCustomer.id,
            addressId: defAddr?.id || null
          }));
        } else if (webOrder.customerName || webOrder.customerPhone || webOrder.customerAddress) {
          setCustMode('nuevo');
          setQc({
            name: webOrder.customerName || '',
            phone: (webOrder.customerPhone || '').replace(/^\+?504\s*/, ''),
            address: webOrder.customerAddress || ''
          });
        }

        const rawItems = webOrder.items && webOrder.items.length > 0
          ? webOrder.items
          : [
              {
                id: uid(),
                brandId: webOrder.brandId,
                brandName: webOrder.brandName,
                colorId: webOrder.colorId,
                colorName: webOrder.colorName,
                colorHex: webOrder.colorHex,
                size: webOrder.size,
                qty: webOrder.qty,
                unitPrice: webOrder.unitPrice,
                designId: webOrder.designId,
                designName: webOrder.designName,
                designCode: webOrder.designCode,
                photoId: webOrder.photoId,
                designThumb: webOrder.designThumb,
                placement: webOrder.placement,
                scale: webOrder.scale
              }
            ];

        const importedLines: CartLine[] = [];
        let firstLoadedPhoto: string | null = null;
        let firstPlacement: DecalPlacement = webOrder.placement || 'back';
        let firstDesignId: string | null = webOrder.designId || null;
        let firstDesignName: string | null = webOrder.designName || null;
        let firstDesignCode: string | null = webOrder.designCode || null;

        for (const it of rawItems) {
          const matchedB =
            state.brands.find((b) => !b.deleted && b.id === it.brandId) ||
            state.brands.find((b) => !b.deleted && b.name.toLowerCase() === (it.brandName || '').toLowerCase()) ||
            brands[0];

          const bCols = matchedB ? brandColors(state, matchedB.id) : colors;
          const matchedC =
            bCols.find((c) => c.id === it.colorId) ||
            bCols.find((c) => c.name.toLowerCase() === (it.colorName || '').toLowerCase()) ||
            bCols[0];

          const matchedCatalogDesign = (state.catalogDesigns || []).find(
            (d) =>
              !d.deleted &&
              d.photoId &&
              ((it.designId && d.id === it.designId) ||
                (it.designCode && d.code && d.code.toLowerCase() === it.designCode.toLowerCase()) ||
                (it.designName && d.name.toLowerCase() === it.designName.toLowerCase()))
          );
          let itemPhoto: string | null = null;
          let resolvedItemPhotoId = it.photoId || null;
          if (matchedCatalogDesign?.photoId) {
            itemPhoto = await fetchSharedPhoto(matchedCatalogDesign.photoId);
            if (itemPhoto) resolvedItemPhotoId = matchedCatalogDesign.photoId;
          }
          if (!itemPhoto && it.photoId) {
            itemPhoto = await fetchSharedPhoto(it.photoId);
          }
          if (!itemPhoto && it.designThumb) {
            itemPhoto = it.designThumb;
          }
          if (!firstLoadedPhoto && itemPhoto) {
            firstLoadedPhoto = itemPhoto;
            firstPlacement = it.placement || 'back';
            firstDesignId = it.designId || null;
            firstDesignName = it.designName || null;
            firstDesignCode = it.designCode || null;
          }

          if (matchedB && matchedC) {
            const lineHasDesign = Boolean(it.designId || it.designName || it.photoId || it.designThumb || itemPhoto);
            const lineIsBack = (it.placement || 'back') === 'back';
            const lineWorkType = lineHasDesign
              ? (settings.workTypes.find((w) =>
                  lineIsBack
                    ? w.toLowerCase().includes('espalda')
                    : w.toLowerCase().includes('frontal') || w.toLowerCase().includes('pecho')
                ) || customWorkTypeDefault)
              : plainWorkTypeDefault;
            importedLines.push({
              id: uid(),
              brandId: matchedB.id,
              colorId: matchedC.id,
              size: it.size || 'M',
              qty: Math.max(1, it.qty || 1),
              unitPrice: it.unitPrice || (lineHasDesign ? (settings.priceCustom || 35000) : tierPrice(settings, matchedB, it.qty || 1)),
              manualPrice: false,
              designId: it.designId || matchedCatalogDesign?.id || null,
              designName: it.designName || matchedCatalogDesign?.name || null,
              designCode: it.designCode || matchedCatalogDesign?.code || null,
              photoId: resolvedItemPhotoId,
              photo: itemPhoto,
              rawPhoto: itemPhoto,
              placement: lineHasDesign ? (it.placement || 'back') : null,
              scale: it.scale || 2.0,
              offsetX: 0,
              offsetY: 0,
              workType: lineWorkType
            });
          }
        }

        const anyImportedDesign = importedLines.some((l) =>
          Boolean(l.photo || l.designId || l.designName || l.photoId)
        );
        const isBack = firstPlacement === 'back';
        const sideExplicit = isBack ? 'Espalda' : 'Frente';
        const matchedWorkType = anyImportedDesign
          ? (settings.workTypes.find((w) =>
              isBack
                ? w.toLowerCase().includes('espalda')
                : w.toLowerCase().includes('frontal') || w.toLowerCase().includes('pecho')
            ) || customWorkTypeDefault)
          : plainWorkTypeDefault;

        const noteParts = [
          webOrder.customerAddress ? `Nota/Dirección cliente: ${webOrder.customerAddress}` : '',
          importedLines.length > 1
            ? `Pedido de ${importedLines.length} prendas con diseños variados desde la Tienda 3D`
            : firstDesignName
            ? `Diseño: ${firstDesignCode ? `[${firstDesignCode}] ` : ''}${firstDesignName} (${sideExplicit})`
            : 'Camisa lisa'
        ].filter(Boolean);

        const isPendingPay = Boolean(
          webOrder.paymentPending ||
            (webOrder.paymentMethod || '').toLowerCase().includes('pendiente')
        );
        const pendingMethodName =
          settings.paymentMethods.find((p) => p.toLowerCase().includes('pendiente')) ||
          'Pago Pendiente en Tienda';

        setDraft((prev) => ({
          ...prev,
          lines: importedLines.length > 0 ? importedLines : prev.lines,
          photo: firstLoadedPhoto,
          rawPhoto: firstLoadedPhoto,
          removeBg: false,
          placement: firstPlacement,
          designScale: 2.0,
          designOffsetX: 0,
          designOffsetY: 0,
          designId: firstDesignId,
          designName: firstDesignName,
          designCode: firstDesignCode,
          workType: matchedWorkType,
          paymentMode: isPendingPay ? 'pending' : 'full',
          deposit: isPendingPay ? 0 : null,
          paymentMethod: isPendingPay
            ? pendingMethodName
            : webOrder.paymentMethod || prev.paymentMethod,
          customerId: existingCustomer ? existingCustomer.id : null,
          addressId: existingCustomer
            ? (existingCustomer.addresses.find((a) => a.isDefault) || existingCustomer.addresses[0])?.id || null
            : null,
          notes: noteParts.join(' | ')
        }));

        try {
          localStorage.setItem(LS_LAST_IMPORTED_WEB_ORDER, webOrder.id);
        } catch {
          /* ignorar */
        }
        setLatestWebOrder(null);
        setJustAddedLine(true);
        setWizardStep(3);
        setMaxStepReached(3);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        toast(`✅ Pedido de ${webOrder.customerName || 'Cliente'} (${importedLines.length} prendas) cargado`);
      } catch (e) {
        toast((e as Error).message || 'No se pudo cargar el pedido web', 'error');
      } finally {
        setImportingWebOrder(false);
      }
    },
    [brands, colors, customWorkTypeDefault, plainWorkTypeDefault, settings, state]
  );

  const importWebOrderRef = useRef(importCustomerWebOrder);
  importWebOrderRef.current = importCustomerWebOrder;

  // Cargar pedido repetido desde Pedidos ("🔄 Repetir")
  useEffect(() => {
    let cancelled = false;
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem('cgs_repeat_order_v1');
      if (raw) sessionStorage.removeItem('cgs_repeat_order_v1');
    } catch {}
    if (!raw) return;

    void (async () => {
      try {
        const src = JSON.parse(raw) as Order;
        if (!src || !Array.isArray(src.items) || src.items.length === 0) return;
        const repeatLines: CartLine[] = [];
        let firstPhoto: string | null = null;
        for (const it of src.items) {
          const matchedCat = (state.catalogDesigns || []).find(
            (d) =>
              !d.deleted &&
              d.photoId &&
              ((it.designId && d.id === it.designId) ||
                (it.designCode && d.code && d.code.toLowerCase() === it.designCode.toLowerCase()) ||
                (it.designName && d.name.toLowerCase() === it.designName.toLowerCase()))
          );
          const pid = matchedCat?.photoId || it.photoId || (src.items.length === 1 ? src.photoId : null);
          const loaded = pid ? await fetchSharedPhoto(pid) : null;
          if (!firstPhoto && loaded) firstPhoto = loaded;
          repeatLines.push({
            id: uid(),
            brandId: it.brandId,
            colorId: it.colorId,
            size: it.size,
            qty: Math.max(1, it.qty || 1),
            unitPrice: it.unitPrice,
            manualPrice: it.manualPrice,
            designId: it.designId || matchedCat?.id || null,
            designName: it.designName || matchedCat?.name || null,
            designCode: it.designCode || matchedCat?.code || null,
            photoId: pid || null,
            photo: loaded,
            rawPhoto: loaded,
            placement: it.placement || (loaded ? src.placement || 'back' : null),
            scale: 2.0,
            offsetX: 0,
            offsetY: 0,
            workType: src.workType
          });
        }
        if (cancelled) return;

        const existingCust =
          (src.customerId && state.customers.find((c) => !c.deleted && c.id === src.customerId)) || null;
        const isConsFinal =
          !existingCust &&
          ((src.shipTo?.name || '').toLowerCase().includes('consumidor final') ||
            (src.shipTo?.phone || '').toLowerCase().includes('consumidor'));
        if (existingCust) {
          setCustMode('buscar');
        } else if (isConsFinal) {
          setCustMode('consumidor');
        } else if (src.shipTo?.name) {
          setCustMode('nuevo');
          setQc({
            name: src.shipTo.name,
            phone: (src.shipTo.phone || '').replace(/^\+?504\s*/, ''),
            address: src.shipTo.address || ''
          });
        }

        setDraft((prev) => ({
          ...prev,
          lines: repeatLines,
          photo: firstPhoto,
          rawPhoto: firstPhoto,
          placement: src.placement || 'back',
          designId: src.designId || null,
          designName: src.designName || null,
          designCode: src.designCode || null,
          workType: src.workType || prev.workType,
          customerId: existingCust ? existingCust.id : null,
          addressId: existingCust ? src.addressId || existingCust.addresses[0]?.id || null : null,
          withShipping: (src.shipping || 0) > 0,
          shipping: (src.shipping || 0) > 0 ? src.shipping : prev.shipping,
          paymentMethod: src.paymentMethod || prev.paymentMethod,
          paymentMode: 'full',
          deposit: null,
          notes: src.notes || ''
        }));
        setJustAddedLine(true);
        setWizardStep(3);
        setMaxStepReached(3);
        toast(`🔄 Pedido ${folioLabel(src.folio)} cargado para repetir`, 'ok');
      } catch {
        /* ignorar */
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cargar pedido automáticamente si viene del link #pedido=<id> o mostrar banner del último pedido web
  useEffect(() => {
    let cancelled = false;
    const checkWebOrder = async () => {
      const hashOrderId = readWebOrderImportHash();
      if (hashOrderId) {
        const raw =
          (await fetchSharedPhoto(`weborder_${hashOrderId}`)) ||
          (await fetchSharedPhoto(WEB_ORDER_LATEST_KEY));
        if (!cancelled && raw) {
          try {
            const parsed = sanitizeWebOrder(JSON.parse(raw));
            if (parsed) {
              history.replaceState({ section: 'vender' }, '', location.pathname);
              await importWebOrderRef.current(parsed);
              return;
            }
          } catch {
            /* ignorar */
          }
        }
      }

      // Verificar si hay un pedido reciente desde la Tienda 3D aún no importado
      const latestRaw = await fetchSharedPhoto(WEB_ORDER_LATEST_KEY);
      if (!cancelled && latestRaw) {
        try {
          const parsed = sanitizeWebOrder(JSON.parse(latestRaw));
          const lastImported = localStorage.getItem(LS_LAST_IMPORTED_WEB_ORDER);
          if (parsed && parsed.id && parsed.id !== lastImported) {
            setLatestWebOrder(parsed);
          }
        } catch {
          /* ignorar */
        }
      }
    };
    void checkWebOrder();
    const onHash = () => {
      if (readWebOrderImportHash()) {
        void checkWebOrder();
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => {
      cancelled = true;
      window.removeEventListener('hashchange', onHash);
    };
  }, []);

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return state.customers
      .filter((c) => !c.deleted && (c.name.toLowerCase().includes(t) || c.phone.replace(/\D/g, '').includes(t.replace(/\D/g, '') || '~')))
      .slice(0, 6);
  }, [q, state.customers]);

  const customerCheck = useMemo(() => {
    if (custMode === 'consumidor') {
      return { ok: true, reason: '' };
    }
    if (custMode === 'nuevo') {
      if (qc.name.trim().length < 2) {
        return { ok: false, reason: 'Ingresa el nombre del cliente o elige Consumidor Final' };
      }
      if (cleanHnPhoneDigits(qc.phone).length < 8) {
        return { ok: false, reason: 'Ingresa un número de teléfono válido (mín. 8 dígitos) o elige Consumidor Final' };
      }
      return { ok: true, reason: '' };
    }
    if (!customer) {
      return { ok: false, reason: 'Selecciona un cliente con teléfono o elige Consumidor Final' };
    }
    const storedDigits = cleanHnPhoneDigits(customer.phone || '');
    const typedDigits = cleanHnPhoneDigits(existingPhone);
    if (storedDigits.length < 8 && typedDigits.length < 8) {
      return { ok: false, reason: `El cliente "${customer.name}" necesita un teléfono válido (mín. 8 dígitos)` };
    }
    return { ok: true, reason: '' };
  }, [custMode, customer, qc.name, qc.phone, existingPhone]);

  const confirm = async (status: 'en_produccion' | 'borrador') => {
    if (!lines.length) return toast('Agrega al menos una camisa', 'error');
    if (status !== 'borrador' && !customerCheck.ok) {
      setWizardStep(3);
      setMaxStepReached(3);
      setCustomerError(customerCheck.reason);
      setTimeout(() => customerSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 40);
      toast(customerCheck.reason, 'error');
      return;
    }
    setCustomerError(null);
    let cust: Customer | null = customer;
    let addressId = draft.addressId;
    let walkIn: { name: string; phone?: string; address?: string } | null = null;
    if (custMode === 'consumidor') {
      cust = null;
      addressId = null;
      const alias = consumidorNote.trim();
      walkIn = {
        name: alias ? `Consumidor Final (${alias})` : 'Consumidor Final',
        phone: 'Consumidor Final',
        address: 'Entrega en tienda'
      };
    } else if (!cust && custMode === 'nuevo' && qc.name.trim()) {
      const digits = cleanHnPhoneDigits(qc.phone);
      cust = quickCustomer(qc.name, digits ? `+504 ${digits}` : '', qc.address);
      addressId = cust.addresses[0]?.id || null;
    } else if (cust && cleanHnPhoneDigits(cust.phone || '').length < 8 && cleanHnPhoneDigits(existingPhone).length >= 8) {
      const updatedPhone = `+504 ${cleanHnPhoneDigits(existingPhone)}`;
      cust = { ...cust, phone: updatedPhone };
      saveCustomer(cust);
    }
    if (cust && !addressId) addressId = cust.addresses.find((a) => a.isDefault)?.id || cust.addresses[0]?.id || null;

    let mainPhotoId: string | null = null;
    if (draft.photo) {
      mainPhotoId = uid();
      await savePhoto(mainPhotoId, draft.photo, 0);
    }

    // Persistir las fotos de cada línea en alta resolución localmente para Taller PDF
    const linesWithPhotos: CartLine[] = [];
    for (const l of lines) {
      let lPhotoId = l.photoId || null;
      if (l.photo && (!lPhotoId || lPhotoId.startsWith('photo_'))) {
        if (!lPhotoId) lPhotoId = uid();
        await savePhoto(lPhotoId, l.photo, 0);
      }
      linesWithPhotos.push({
        ...l,
        photoId: lPhotoId || (l.photo ? mainPhotoId : null)
      });
    }
    notifyPhotos();

    const orderDesignNames = Array.from(
      new Set(linesWithPhotos.map((l) => l.designName?.trim()).filter((x): x is string => Boolean(x)))
    );
    const designSummary =
      orderDesignNames.length > 0
        ? `[DISEÑOS: ${orderDesignNames.join(' + ')}]`
        : draft.photo
        ? `[DISEÑO: ${draft.designName || 'Personalizado'}]`
        : '';
    const finalNotes = [designSummary, draft.notes.trim()].filter(Boolean).join(' · ');

    const order = createOrder({
      lines: linesWithPhotos,
      customer: cust,
      addressId,
      walkIn,
      shipping,
      deposit: paymentMode === 'pending' ? 0 : draft.deposit || 0,
      paymentPending: paymentMode === 'pending',
      paymentMethod: draft.paymentMethod,
      workType: draft.workType,
      notes: finalNotes,
      photoId: linesWithPhotos.find((l) => l.photoId)?.photoId || mainPhotoId,
      status,
      designId: linesWithPhotos.find((l) => l.designId)?.designId || draft.designId || null,
      designName: orderDesignNames.length > 0 ? orderDesignNames.join(' + ') : draft.designName || null,
      designCode: draft.designCode || null,
      placement: linesWithPhotos.find((l) => l.placement)?.placement || draft.placement || 'back'
    });
    const keep = { paymentMethod: draft.paymentMethod };
    setDraft({ ...emptyDraft(), ...keep });
    setQc({ name: '', phone: '', address: '' });
    setExistingPhone('');
    setConsumidorNote('');
    setCustomerError(null);
    setQ('');
    setCustMode('buscar');
    setWizardStep(0);
    setMaxStepReached(0);
    setJustAddedLine(false);
    setDone(order);
  };

  const normalForBrand = normalPrice(settings, brand);
  const currentDraftLabel = `${color?.name || 'Color'} · ${(draft.placement || 'back') === 'back' ? 'Espalda' : 'Frente'} · ${
    selectedSizeEntries.length > 0
      ? selectedSizeEntries.map((e) => `${e.qty}×${e.size}`).join(', ')
      : 'Sin talla'
  }${draft.designName ? ` · ${draft.designName}` : ''}`;
  const bottomBarTotal =
    wizardStep === POS_WIZARD_LAST
      ? total
      : justAddedLine && lines.length > 0
      ? subtotal
      : subtotal + currentDraftQty * unitPrice;

  return (
    <div className="space-y-4 pb-36 sm:pb-32">
      {/* Banner 1-Clic cuando un cliente envía un pedido desde la Tienda 3D */}
      {latestWebOrder && (
        <section className="rounded-[24px] border border-white/10 bg-slate-900/95 p-4 text-white shadow-lg backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {latestWebOrder.designThumb && (
                <div
                  className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/25 p-1 shadow"
                  style={{ backgroundColor: latestWebOrder.colorHex || '#111827' }}
                >
                  <img
                    src={latestWebOrder.designThumb}
                    alt={latestWebOrder.designName || 'Diseño'}
                    className="h-full w-full object-contain"
                  />
                </div>
              )}
              <div className="space-y-0.5">
                <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/20 px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wider text-amber-300">
                  🤠 Nuevo Pedido desde Catálogo 3D
                </div>
                <div className="text-base font-black text-white">
                  {latestWebOrder.customerName || 'Cliente'} {latestWebOrder.customerPhone ? `· ${latestWebOrder.customerPhone}` : ''}
                </div>
                <div className="text-xs font-semibold text-amber-100/90">
                  {latestWebOrder.items && latestWebOrder.items.length > 1
                    ? `${latestWebOrder.items.reduce((s, it) => s + it.qty, 0)} prendas (${latestWebOrder.items.length} variantes)`
                    : `${latestWebOrder.qty}× ${latestWebOrder.brandName} · Color ${latestWebOrder.colorName} · Talla ${latestWebOrder.size}`}{' '}
                  ·{' '}
                  <span className="rounded bg-amber-400 px-1.5 py-0.5 font-black text-stone-950">
                    {latestWebOrder.designName
                      ? `${latestWebOrder.designName} en ${latestWebOrder.placement === 'back' ? 'ESPALDA (Atrás)' : 'FRENTE (Pecho)'}`
                      : money(latestWebOrder.unitPrice || normalForBrand)}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={importingWebOrder}
                onClick={() => void importCustomerWebOrder(latestWebOrder)}
                className="rounded-xl bg-amber-400 px-4 py-2.5 text-xs font-black text-stone-950 shadow-md transition hover:bg-amber-300 active:scale-95"
              >
                {importingWebOrder ? '⏳ Cargando...' : '⚡ Cargar automáticamente al Pedido'}
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    localStorage.setItem(LS_LAST_IMPORTED_WEB_ORDER, latestWebOrder.id);
                  } catch {
                    /* ignorar */
                  }
                  setLatestWebOrder(null);
                }}
                className="rounded-xl border border-white/20 px-2.5 py-2 text-xs font-bold text-stone-300 hover:bg-white/10"
                title="Ocultar aviso"
              >
                ✕
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Barra de progreso e instrucción clara del paso actual */}
      <div className="rounded-[22px] border border-slate-200/80 bg-white px-4 py-3.5 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-slate-900 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
              Paso {wizardStep + 1} de {POS_WIZARD_LAST + 1}
            </span>
            <div className="hidden items-center gap-1 sm:flex">
              {POS_WIZARD_STEPS.map((stInfo, i) => {
                const unlocked = i <= maxStepReached || (i === POS_WIZARD_LAST && lines.length > 0);
                const active = i === wizardStep;
                return (
                  <button
                    key={stInfo.short}
                    type="button"
                    disabled={!unlocked && i > wizardStep}
                    aria-label={`Ir al paso ${i + 1}: ${stInfo.title}`}
                    onClick={() => (unlocked || i <= wizardStep) && goToWizardStep(i)}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition disabled:cursor-default ${
                      active
                        ? 'bg-slate-900/10 text-slate-900'
                        : unlocked || i <= wizardStep
                        ? 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                        : 'text-slate-300'
                    }`}
                  >
                    {i + 1}. {stInfo.short}
                  </button>
                );
              })}
            </div>
          </div>
          {cartQty > 0 && (
            <button
              type="button"
              onClick={() => goToWizardStep(3)}
              className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-0.5 text-[11px] font-bold text-white shadow-sm hover:bg-slate-800"
              title="Ir al resumen y cobro"
            >
              <span>🛒 {cartQty}</span>
              <span>· {money(subtotal)}</span>
            </button>
          )}
        </div>
        <h2 className="text-base font-extrabold tracking-tight text-slate-900 sm:text-lg">
          {POS_WIZARD_STEPS[wizardStep].title}
        </h2>
        <p className="mt-0.5 text-xs text-slate-500">
          {POS_WIZARD_STEPS[wizardStep].subtitle}
        </p>
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          {POS_WIZARD_STEPS.map((stInfo, i) => {
            const unlocked = i <= maxStepReached || (i === POS_WIZARD_LAST && lines.length > 0);
            const active = i === wizardStep;
            return (
              <button
                key={stInfo.short}
                type="button"
                disabled={!unlocked && i > wizardStep}
                aria-label={`Ir al paso ${i + 1}: ${stInfo.title}`}
                onClick={() => (unlocked || i <= wizardStep) && goToWizardStep(i)}
                className="group flex flex-col items-start gap-1 text-left disabled:cursor-default"
              >
                <span
                  className={`h-1.5 w-full rounded-full transition-colors ${
                    i <= wizardStep
                      ? 'bg-slate-900'
                      : unlocked
                      ? 'bg-slate-400'
                      : 'bg-slate-200'
                  }`}
                />
                <span
                  className={`truncate text-[10px] font-semibold sm:hidden ${
                    active
                      ? 'text-slate-900'
                      : unlocked || i <= wizardStep
                      ? 'text-slate-500'
                      : 'text-slate-300'
                  }`}
                >
                  {i + 1}. {stInfo.short}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* PASOS 1 y 2: VISOR 3D + COLOR O DISEÑO Y UBICACIÓN */}
      {wizardStep <= 1 && (
        <div className="space-y-4">
          {wizardStep === 0 && brands.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
              <span className="px-2 text-xs font-bold text-slate-500">Marca:</span>
              {brands.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className={`rounded-xl px-3 py-1.5 text-xs font-extrabold transition ${
                    b.id === brandId ? 'bg-slate-900 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                  onClick={() => {
                    setBrandId(b.id);
                    setJustAddedLine(false);
                  }}
                >
                  {b.name}
                </button>
              ))}
            </div>
          )}

          {wizardStep === 1 && (
            <section className="rounded-[22px] border border-slate-200/80 bg-white p-3.5 shadow-sm">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-800">¿Dónde irá el diseño?</span>
                <span className="text-[11px] font-medium text-slate-400">Toca para girar la camisa</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-slate-100 p-1">
                {([['back', 'Espalda (Atrás)'], ['center', 'Frente (Pecho)']] as const).map(([k, lbl]) => {
                  const active = (draft.placement || 'back') === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => {
                        set({ placement: k });
                        setJustAddedLine(false);
                      }}
                      className={`min-h-[40px] rounded-xl text-xs font-bold transition sm:text-sm ${
                        active
                          ? 'bg-slate-900 text-white shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {lbl}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <InteractiveShirt3D
            hex={color?.hex || '#e5e7eb'}
            colorName={color?.name || ''}
            brandName={brand?.name || ''}
            designUrl={draft.photo}
            placement={draft.placement || 'back'}
            designScale={draft.designScale ?? 2.0}
            designOffsetX={draft.designOffsetX ?? 0}
            designOffsetY={draft.designOffsetY ?? 0}
            wizardStep={wizardStep === 0 ? 'color' : 'design'}
            onDesignChange={(patch) => {
              const next: Partial<Draft> = {};
              if (patch.scale !== undefined) next.designScale = patch.scale;
              if (patch.offsetX !== undefined) next.designOffsetX = patch.offsetX;
              if (patch.offsetY !== undefined) next.designOffsetY = patch.offsetY;
              if (patch.placement !== undefined) {
                next.placement = patch.placement;
                setJustAddedLine(false);
              }
              set(next);
            }}
            onUploadFile={(file) => {
              setJustAddedLine(false);
              void onPhoto(file);
            }}
            onClearDesign={() => {
              clearDraftDesign();
              setJustAddedLine(false);
            }}
            removeBg={draft.removeBg ?? false}
            onToggleRemoveBg={(next) => void toggleRemoveBg(next)}
            onAiRemoveBg={() => void handleAiBgNewOrder()}
            onUpscale4K={() => void handleUpscale4KNewOrder()}
            processingText={procMsg}
            colorOptions={colors.map((c) => {
              const totalC = brand
                ? settings.sizes.reduce((s, sz) => s + (stock.get(vkey(brand.id, c.id, sz)) || 0), 0)
                : 0;
              return {
                id: c.id,
                name: c.name,
                hex: c.hex,
                available: totalC > 0,
                stockText: totalC > 0 ? `${totalC} disp.` : 'Pronto'
              };
            })}
            activeColorId={color?.id}
            onSelectColor={(id) => {
              setColorId(id);
              setJustAddedLine(false);
            }}
            onAddNewColor={() => setColorModal(true)}
            onEditColor={(id) => {
              const target = colors.find((c) => c.id === id);
              if (target) setEditingColor({ id: target.id, name: target.name, hex: target.hex });
            }}
            onDeleteColor={(id) => {
              deleteColor(id);
              toast('Color eliminado');
            }}
            isStoreOwner
            catalogDesigns={allDesigns}
            activeCatalogDesignId={draft.designId || null}
            onSelectCatalogDesign={(d) => {
              if (!d.imageUrl) return;
              const curSide = draft.placement || 'back';
              const sideWork = settings.workTypes.find((w) =>
                curSide === 'back'
                  ? w.toLowerCase().includes('espalda')
                  : w.toLowerCase().includes('frontal') || w.toLowerCase().includes('pecho')
              ) || customWorkTypeDefault;
              set({
                photo: d.imageUrl,
                rawPhoto: d.imageUrl,
                designId: d.id,
                designName: d.name,
                designCode: d.code || 'D-001',
                placement: curSide,
                designScale: 2.0,
                designOffsetX: 0,
                designOffsetY: 0,
                workType: draft.workType.toLowerCase().includes('lisa')
                  ? sideWork
                  : draft.workType
              });
              setJustAddedLine(false);
            }}
            onRenameCatalogDesign={(id, name, code) => {
              renameDesign(id, name, code);
              if (draft.designId === id) {
                set({ designName: name, designCode: code });
              }
              toast('Nombre y código del diseño actualizados');
            }}
            campaigns={settings.campaigns}
            onChangeDesignCampaign={(id, camp) => {
              setDesignCampaign(id, camp);
              toast(camp === 'all' ? 'Campaña actualizada a General' : `Movido a campaña ${camp}`);
            }}
            onChangeDesignColors={(id, mode, ids, tone) => {
              setDesignColors(id, mode, ids, tone);
              toast('Colores disponibles actualizados para este diseño');
            }}
            onSaveCurrentToCatalog={(opts) => {
              if (!draft.photo) return;
              const o = typeof opts === 'string' ? { campaign: opts } : opts || {};
              void saveCurrentToCatalog({
                dataUrl: draft.photo,
                name: o.name || draft.designName || undefined,
                code: draft.designCode || undefined,
                campaign: o.campaign,
                placement: draft.placement || 'back',
                allowedColorMode: o.allowedColorMode,
                allowedColorIds: o.allowedColorIds,
                tone: o.tone
              }).then((saved) => {
                set({ designId: saved.id, designName: saved.name, designCode: saved.code });
                toast(`"${saved.name}" guardado en el catálogo (visible al cliente)`);
              });
            }}
            onUploadCatalogFiles={(files, opts) => {
              const o = typeof opts === 'string' ? { campaign: opts } : opts || {};
              setProcMsg('Agregando diseños al catálogo...');
              void uploadFilesToCatalog(files, {
                removeBg: draft.removeBg ?? false,
                tolerance: 32,
                placement: 'back',
                campaign: o.campaign,
                customName: o.customName,
                allowedColorMode: o.allowedColorMode,
                allowedColorIds: o.allowedColorIds
              })
                .then((n) => {
                  if (n > 0) toast(`${n} diseño(s) agregado(s) al catálogo en Tamaño A3`);
                })
                .finally(() => setProcMsg(null));
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
              toast('Diseño eliminado del catálogo');
            }}
            stockBadge={
              brand && color
                ? (() => {
                    const totalColorStock = settings.sizes.reduce(
                      (s, sz) => s + (stock.get(vkey(brand.id, color.id, sz)) || 0),
                      0
                    );
                    return {
                      available: totalColorStock > 0,
                      text:
                        totalColorStock > 0
                          ? `${color.name}: ${totalColorStock} disp.`
                          : `${color.name}: Bajo pedido`
                    };
                  })()
                : null
            }
          />

          {wizardStep === 1 && (
            <section className="card space-y-3">
              {draft.photo && (
                <div className="grid grid-cols-1 gap-2 rounded-xl border border-amber-200 bg-amber-50/70 p-2.5 sm:grid-cols-3">
                  <div>
                    <label className="label text-xs">Código de Diseño (Reporte)</label>
                    <input
                      className="input font-mono font-bold uppercase"
                      placeholder="Ej. D-001, TORO-01"
                      value={draft.designCode || ''}
                      onChange={(e) => {
                        set({ designCode: e.target.value.toUpperCase() });
                        setJustAddedLine(false);
                      }}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="label text-xs">Nombre del Diseño / Estilo de Camisa (Reporte)</label>
                    <input
                      className="input font-bold"
                      placeholder="Ej. Establo Silla, Toro Honduras..."
                      value={draft.designName || ''}
                      onChange={(e) => {
                        set({ designName: e.target.value });
                        setJustAddedLine(false);
                      }}
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="label" htmlFor="wt">
                  Tipo de trabajo
                </label>
                <select
                  id="wt"
                  className="input"
                  value={draft.workType}
                  onChange={(e) => {
                    set({ workType: e.target.value });
                    setJustAddedLine(false);
                  }}
                >
                  {settings.workTypes.map((w) => (
                    <option key={w}>{w}</option>
                  ))}
                </select>
              </div>
            </section>
          )}
        </div>
      )}

      {/* PASO 3: TALLA, PRECIO Y CANTIDAD */}
      {wizardStep === 2 && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-[22px] border border-slate-200/80 bg-white p-3 shadow-sm">
            <div
              className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-black/10 p-1.5 shadow-inner"
              style={{ backgroundColor: color?.hex || '#111827' }}
            >
              {draft.photo ? (
                <img
                  src={draft.photo}
                  alt={draft.designName || 'Diseño'}
                  className="h-full w-full object-contain"
                />
              ) : (
                <span className="text-2xl">👕</span>
              )}
              <span className="absolute inset-x-0 bottom-0 bg-black/65 py-0.5 text-center text-[9px] font-bold text-white">
                {(draft.placement || 'back') === 'back' ? 'Espalda' : 'Frente'}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Prenda actual
              </div>
              <div className="truncate text-sm font-bold text-slate-900">
                {brand?.name} · {color?.name || 'Color'} · {(draft.placement || 'back') === 'back' ? 'Espalda' : 'Frente'}
              </div>
              <div className="truncate text-xs text-slate-500">
                {draft.photo ? `${draft.designCode ? `[${draft.designCode}] ` : ''}${draft.designName || 'Diseño personalizado'}` : 'Camisa lisa (sin diseño)'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => goToWizardStep(1)}
              className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-100 active:scale-95"
            >
              Editar 3D
            </button>
          </div>

          <section className="card space-y-3">
            <div>
              <h2 className="section-title mb-0.5">Cantidad por talla</h2>
              <p className="text-xs text-slate-500">
                Toca <strong className="text-slate-700">+</strong> en la misma talla o en varias tallas para este mismo diseño.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {settings.sizes.map((sz) => {
                const st = brand && color ? stock.get(vkey(brand.id, color.id, sz)) || 0 : 0;
                const q = sizeQtys[sz] || 0;
                const active = q > 0;
                return (
                  <div
                    key={sz}
                    onClick={() => {
                      if (q === 0) setSizeQty(sz, 1);
                    }}
                    className={`flex items-center justify-between gap-2 rounded-2xl border px-3 py-2.5 transition ${
                      active
                        ? 'border-slate-900 bg-slate-900/[0.03] ring-1 ring-slate-900/10'
                        : 'cursor-pointer border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/70'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-extrabold text-slate-900">{sz}</div>
                      <div
                        className={`text-[10px] font-bold ${
                          st > 0 ? 'text-emerald-600' : 'text-amber-600'
                        }`}
                      >
                        {st > 0 ? `${st} disp.` : 'Encargo'}
                      </div>
                    </div>
                    <div
                      className="flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        disabled={q <= 0}
                        onClick={() => setSizeQty(sz, q - 1)}
                        aria-label={`Restar talla ${sz}`}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-700 transition hover:bg-slate-100 active:scale-95 disabled:opacity-30"
                      >
                        −
                      </button>
                      <span
                        className={`min-w-[20px] text-center text-xs font-extrabold tabular-nums ${
                          active ? 'text-slate-900' : 'text-slate-400'
                        }`}
                      >
                        {q}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSizeQty(sz, q + 1)}
                        aria-label={`Sumar talla ${sz}`}
                        className={`flex h-7 w-7 items-center justify-center rounded-lg text-sm font-bold transition active:scale-95 ${
                          active
                            ? 'bg-slate-900 text-white hover:bg-slate-800'
                            : 'border border-slate-200 bg-white text-slate-800 hover:bg-slate-100'
                        }`}
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card space-y-3">
            <h2 className="section-title">Precio y resumen</h2>
            <div className="grid grid-cols-2 gap-2">
              <div
                role="button"
                tabIndex={0}
                className={`cursor-pointer rounded-xl border-2 p-2.5 transition ${
                  !isCustomWork ? 'border-brand-600 bg-brand-50 shadow-sm ring-1 ring-brand-600/20' : 'border-slate-200 hover:border-slate-300'
                }`}
                onClick={() => {
                  setManualPrice(null);
                  clearDraftDesign();
                  setJustAddedLine(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setManualPrice(null);
                    clearDraftDesign();
                    setJustAddedLine(false);
                  }
                }}
              >
                <div className="mb-1 flex items-center justify-between text-xs font-bold text-slate-700">
                  <span>👕 Camisa Lisa</span>
                  {!isCustomWork && (
                    <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-bold text-white">
                      Activo
                    </span>
                  )}
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  <MoneyInput
                    ariaLabel="Precio camisa lisa"
                    value={normalForBrand}
                    onChange={(c) => {
                      if (c === null) return;
                      if (brand && brand.priceOverride !== null) updateBrand(brand.id, { priceOverride: c });
                      else updateSettings({ priceNormal: c });
                    }}
                  />
                </div>
              </div>
              <div
                role="button"
                tabIndex={0}
                className={`cursor-pointer rounded-xl border-2 p-2.5 transition ${
                  isCustomWork ? 'border-brand-600 bg-brand-50 shadow-sm ring-1 ring-brand-600/20' : 'border-slate-200 hover:border-slate-300'
                }`}
                onClick={() => {
                  setManualPrice(null);
                  set({ workType: customWorkTypeDefault });
                  setJustAddedLine(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setManualPrice(null);
                    set({ workType: customWorkTypeDefault });
                    setJustAddedLine(false);
                  }
                }}
              >
                <div className="mb-1 flex items-center justify-between text-xs font-bold text-slate-700">
                  <span>✨ Personalizada A3</span>
                  {isCustomWork && (
                    <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-bold text-white">
                      Activo
                    </span>
                  )}
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  <MoneyInput
                    ariaLabel="Precio personalizada"
                    value={settings.priceCustom || 35000}
                    onChange={(c) => c !== null && updateSettings({ priceCustom: c })}
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="label">Precio aplicado a esta prenda (L)</label>
              <div className="flex gap-2">
                <MoneyInput
                  className="flex-1"
                  ariaLabel="Precio por camisa"
                  value={unitPrice}
                  onChange={(c) => {
                    setManualPrice(c);
                    setJustAddedLine(false);
                  }}
                />
                {manualPrice !== null && (
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => setManualPrice(null)}
                    title="Restablecer precio sugerido"
                  >
                    ↺
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200/80 bg-slate-50/80 px-3.5 py-2.5">
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-900">
                  {currentDraftQty > 0
                    ? selectedSizeEntries.map((e) => `${e.qty}× ${e.size}`).join(' · ')
                    : 'Ninguna talla seleccionada'}
                </div>
                <div className="text-[11px] text-slate-500">
                  {currentDraftQty} {currentDraftQty === 1 ? 'prenda' : 'prendas'} × {money(unitPrice)}
                </div>
              </div>
              <div className="text-lg font-extrabold tabular-nums text-slate-900">
                {money(currentDraftQty * unitPrice)}
              </div>
            </div>
          </section>

          <div className="rounded-[22px] border border-dashed border-slate-300 bg-white/80 p-3 text-center">
            <button
              type="button"
              onClick={() => handleAddAnotherShirt(false)}
              disabled={!brand || !color || currentDraftQty <= 0}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-full border border-slate-300 bg-slate-50 px-4 text-xs font-extrabold text-slate-900 shadow-sm transition hover:bg-slate-100 active:scale-[0.99] disabled:opacity-40"
            >
              + Agregar al carrito y elegir otro color o diseño
            </button>
            <p className="mt-1.5 text-[11px] text-slate-500">
              ¿El cliente lleva otro color o diseño en el mismo pedido? Agrégalo aquí y pasa al siguiente.
            </p>
          </div>
        </div>
      )}

      {/* PASO 4: RESUMEN, CLIENTE Y PAGO */}
      {wizardStep === 3 && (
      <section className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="section-title mb-0">Tu pedido</h2>
            {lines.length > 0 && (
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
                {cartQty} {cartQty === 1 ? 'unidad' : 'unidades'}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => handleAddAnotherShirt(true)}
            className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-extrabold text-slate-800 hover:bg-slate-100"
          >
            + Agregar otra prenda
          </button>
        </div>

        {lines.length === 0 ? (
          <p className="py-4 text-center text-slate-400">🛒 Vacío</p>
        ) : (
          <ul className="space-y-2.5">
            {lines.map((l) => {
              const b = state.brands.find((x) => x.id === l.brandId);
              const c = state.colors.find((x) => x.id === l.colorId);
              const st = stock.get(vkey(l.brandId, l.colorId, l.size)) || 0;
              const hasLineDesign = Boolean(l.photo || l.designName);
              const sideLabel = l.placement === 'back' ? 'Espalda' : 'Frente';

              return (
                <li key={l.id} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="flex items-start gap-2.5">
                    {/* Miniatura del diseño de esta prenda */}
                    {l.photo ? (
                      <button
                        type="button"
                        onClick={() => l.photo && setViewer(l.photo)}
                        title="Ver diseño completo"
                        className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-black/10 p-1 shadow-sm"
                        style={{ backgroundColor: c?.hex || '#111827' }}
                      >
                        <img src={l.photo} alt={l.designName || 'Diseño'} className="h-full w-full object-contain" />
                        <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[8px] font-bold text-white text-center">
                          {sideLabel}
                        </span>
                      </button>
                    ) : (
                      <div
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-black/10 text-xs font-bold text-slate-700 shadow-sm"
                        style={{ backgroundColor: c?.hex || '#F1F5F9' }}
                      >
                        <span className="drop-shadow-sm">👕</span>
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <ColorDot hex={c?.hex || '#999'} size={14} />
                        <span className="truncate font-extrabold text-slate-900">
                          {b?.name} · {c?.name} · Talla {l.size}
                        </span>
                      </div>

                      {hasLineDesign ? (
                        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs">
                          <span className="font-semibold text-slate-800">
                            {l.designCode ? `[${l.designCode}] ` : ''}{l.designName || 'Diseño estampado'}
                          </span>
                          <span className="rounded bg-slate-100 px-1.5 py-0.2 text-[10px] font-bold text-slate-600">
                            📍 {sideLabel}
                          </span>
                        </div>
                      ) : (
                        <div className="mt-0.5 text-xs font-medium text-slate-500">
                          👕 Camisa Lisa (Sin diseño)
                        </div>
                      )}

                      {st < l.qty && (
                        <div className="mt-0.5 text-[11px] font-semibold text-amber-600">
                          Bajo pedido: {l.qty - Math.min(st, l.qty)}
                        </div>
                      )}
                    </div>

                    <button
                      className="btn-icon h-9 w-9 text-base text-rose-500 hover:bg-rose-50 rounded-xl"
                      onClick={() => removeLine(l.id)}
                      aria-label="Quitar prenda"
                      title="Quitar prenda"
                    >
                      🗑
                    </button>
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
                    <Stepper size="sm" value={l.qty} min={1} onCommit={(n) => updateLine(l.id, { qty: n })} ariaLabel="Cantidad" />
                    <div className="flex min-w-[130px] flex-1 items-center gap-1">
                      <MoneyInput
                        className="flex-1"
                        ariaLabel="Precio de la línea"
                        value={l.unitPrice}
                        onChange={(cents) => cents !== null && updateLine(l.id, { unitPrice: cents, manualPrice: true })}
                      />
                      {l.manualPrice && (
                        <button className="btn-icon h-10 w-9 text-base text-slate-500" onClick={() => updateLine(l.id, { manualPrice: false })} title="Precio automático">
                          ↺
                        </button>
                      )}
                    </div>
                    <div className="text-right text-sm font-extrabold text-slate-900">{money(l.qty * l.unitPrice)}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Cliente */}
        <div
          ref={customerSectionRef}
          className={`rounded-2xl transition ${
            customerError ? 'bg-red-50/70 p-2.5 -m-1 ring-2 ring-red-500' : ''
          }`}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Cliente o Consumidor Final *
            </span>
            {!customerCheck.ok && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                🔒 Requerido para confirmar
              </span>
            )}
          </div>
          <div className="mb-2 grid grid-cols-3 gap-1.5">
            <button
              type="button"
              className={`chip text-xs ${custMode === 'buscar' ? 'chip-on' : 'chip-off'}`}
              onClick={() => {
                setCustMode('buscar');
                setCustomerError(null);
              }}
            >
              👥 Cliente
            </button>
            <button
              type="button"
              className={`chip text-xs ${custMode === 'nuevo' ? 'chip-on' : 'chip-off'}`}
              onClick={() => {
                setCustMode('nuevo');
                set({ customerId: null, addressId: null });
                setCustomerError(null);
              }}
            >
              ➕ Nuevo
            </button>
            <button
              type="button"
              className={`chip text-xs ${custMode === 'consumidor' ? 'chip-on' : 'chip-off'}`}
              onClick={() => {
                setCustMode('consumidor');
                set({ customerId: null, addressId: null });
                setCustomerError(null);
              }}
            >
              🧾 Cons. Final
            </button>
          </div>
          {custMode === 'consumidor' ? (
            <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/80 p-3 text-sm text-emerald-950">
              <div className="flex items-center gap-2 font-bold">
                <span>🧾 Consumidor Final seleccionado</span>
              </div>
              <p className="text-xs text-emerald-800">
                Venta directa en mostrador / sin registro de teléfono obligatorio.
              </p>
              <input
                className="input bg-white text-sm"
                placeholder="Referencia rápida opcional (ej. Mesa 2 o Nombre corto)"
                value={consumidorNote}
                onChange={(e) => setConsumidorNote(e.target.value)}
                autoComplete="off"
              />
            </div>
          ) : custMode === 'buscar' ? (
            customer ? (
              <div className="rounded-xl bg-brand-50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold">{customer.name}</div>
                    <div className="text-sm text-slate-600">{customer.phone || 'Sin teléfono registrado'}</div>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost min-h-[40px] px-3 text-sm"
                    onClick={() => {
                      set({ customerId: null, addressId: null });
                      setExistingPhone('');
                    }}
                  >
                    Cambiar
                  </button>
                </div>
                {cleanHnPhoneDigits(customer.phone || '').length < 8 && (
                  <div className="mt-2 rounded-xl border border-amber-300 bg-amber-50 p-2">
                    <div className="mb-1 text-xs font-bold text-amber-900">
                      ⚠️ Este cliente no tiene teléfono válido (mín. 8 dígitos). Complétalo para confirmar:
                    </div>
                    <div className="flex">
                      <span className="flex items-center rounded-l-xl border border-r-0 border-amber-300 bg-white px-2.5 text-xs font-bold text-slate-600">
                        +504
                      </span>
                      <input
                        className="input rounded-l-none bg-white text-sm"
                        placeholder="9999-9999"
                        type="tel"
                        inputMode="tel"
                        value={existingPhone}
                        onChange={(e) => {
                          setExistingPhone(e.target.value);
                          setCustomerError(null);
                        }}
                      />
                    </div>
                  </div>
                )}
                {customer.addresses.length > 0 && (
                  <select
                    className="input mt-2"
                    value={draft.addressId || ''}
                    onChange={(e) => set({ addressId: e.target.value || null })}
                    aria-label="Dirección"
                  >
                    {customer.addresses.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}: {addressOneLine(a)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ) : (
              <div>
                <input
                  className="input"
                  placeholder="Buscar por nombre o teléfono"
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setCustomerError(null);
                  }}
                />
                {matches.length > 0 && (
                  <ul className="mt-1 divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {matches.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          className="flex min-h-[52px] w-full flex-col justify-center px-3 text-left"
                          onClick={() => {
                            const def = c.addresses.find((a) => a.isDefault) || c.addresses[0];
                            set({ customerId: c.id, addressId: def?.id || null });
                            setExistingPhone('');
                            setCustomerError(null);
                            setQ('');
                          }}
                        >
                          <span className="font-semibold">{c.name}</span>
                          <span className="text-xs text-slate-500">{c.phone || 'Sin teléfono'}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          ) : (
            <div className="space-y-2">
              <input
                className="input"
                placeholder="Nombre completo *"
                value={qc.name}
                onChange={(e) => {
                  setQc({ ...qc, name: e.target.value });
                  setCustomerError(null);
                }}
                autoComplete="off"
              />
              <div className="flex">
                <span className="flex items-center rounded-l-xl border border-r-0 border-slate-300 bg-slate-50 px-3 font-semibold text-slate-600">+504</span>
                <input
                  className="input rounded-l-none"
                  placeholder="Teléfono / WhatsApp (mín. 8 dígitos) *"
                  type="tel"
                  inputMode="tel"
                  value={qc.phone}
                  onChange={(e) => {
                    setQc({ ...qc, phone: e.target.value });
                    setCustomerError(null);
                  }}
                />
              </div>
              <textarea
                className="input min-h-[72px] py-2"
                placeholder="Dirección o referencia (opcional)"
                value={qc.address}
                onChange={(e) => setQc({ ...qc, address: e.target.value })}
              />
            </div>
          )}
          {customerError && (
            <p className="mt-2 rounded-xl bg-red-100 px-3 py-2 text-xs font-bold text-red-700">
              🔒 {customerError}
            </p>
          )}
        </div>

        {/* Envío, pago, anticipo */}
        <div className="flex items-center gap-2">
          <label className="flex min-h-[48px] flex-1 items-center gap-3 rounded-xl border border-slate-300 px-3 font-semibold">
            <input type="checkbox" className="h-6 w-6 accent-brand-700" checked={draft.withShipping} onChange={(e) => set({ withShipping: e.target.checked })} />
            Envío
          </label>
          <MoneyInput
            className="w-36"
            ariaLabel="Costo de envío"
            value={draft.withShipping ? draft.shipping : 0}
            onChange={(c) => c !== null && set({ shipping: c, withShipping: c > 0 ? true : draft.withShipping })}
          />
        </div>

        {/* Estado de pago estilo Apple (Pagado / Pago Pendiente / Anticipo) */}
        <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
          <div className="text-xs font-bold text-slate-700">Estado del pago</div>
          <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-slate-200/70 p-1">
            {(
              [
                ['full', '✓ Pagado 100%'],
                ['pending', '⏳ Pago Pendiente'],
                ['partial', '½ Anticipo']
              ] as const
            ).map(([m, lbl]) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  const pendingOption =
                    settings.paymentMethods.find((p) => p.toLowerCase().includes('pendiente')) ||
                    'Pago Pendiente en Tienda';
                  const paidOption =
                    settings.paymentMethods.find((p) => !p.toLowerCase().includes('pendiente')) ||
                    settings.paymentMethods[0] ||
                    'Efectivo';
                  if (m === 'pending') {
                    set({
                      paymentMode: 'pending',
                      deposit: 0,
                      paymentMethod: pendingOption
                    });
                  } else if (m === 'full') {
                    set({
                      paymentMode: 'full',
                      deposit: null,
                      paymentMethod: draft.paymentMethod.toLowerCase().includes('pendiente')
                        ? paidOption
                        : draft.paymentMethod
                    });
                  } else {
                    set({
                      paymentMode: 'partial',
                      deposit: draft.deposit && draft.deposit > 0 ? draft.deposit : Math.round(total * 0.5),
                      paymentMethod: draft.paymentMethod.toLowerCase().includes('pendiente')
                        ? paidOption
                        : draft.paymentMethod
                    });
                  }
                }}
                className={`rounded-lg px-2 py-2 text-xs font-bold transition ${
                  paymentMode === m
                    ? m === 'pending'
                      ? 'bg-amber-500 text-stone-950 shadow-sm'
                      : 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="pm">
                Método de pago
              </label>
              <select
                id="pm"
                className="input bg-white"
                value={draft.paymentMethod}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val.toLowerCase().includes('pendiente')) {
                    set({ paymentMethod: val, paymentMode: 'pending', deposit: 0 });
                  } else {
                    set({
                      paymentMethod: val,
                      paymentMode: paymentMode === 'pending' ? 'full' : paymentMode,
                      deposit: paymentMode === 'pending' ? null : draft.deposit
                    });
                  }
                }}
              >
                {settings.paymentMethods.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Anticipo Recibido (L)</label>
              {paymentMode === 'pending' ? (
                <div className="flex min-h-[44px] items-center justify-between rounded-xl border border-amber-300 bg-amber-50 px-3 text-xs font-bold text-amber-900">
                  <span>⏳ Paga al llegar a tienda</span>
                  <span>L 0.00</span>
                </div>
              ) : (
                <MoneyInput
                  ariaLabel="Anticipo recibido"
                  value={draft.deposit}
                  allowEmpty
                  placeholder="Pagado 100%"
                  onChange={(c) => {
                    if (c === 0) {
                      set({ paymentMode: 'pending', deposit: 0 });
                    } else if (c !== null && c < total) {
                      set({ paymentMode: 'partial', deposit: c });
                    } else {
                      set({ paymentMode: 'full', deposit: c });
                    }
                  }}
                />
              )}
            </div>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="nt">
            Instrucción para el taller
          </label>
          <textarea id="nt" className="input min-h-[80px] py-2" value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
        </div>

        <dl className="space-y-1 rounded-xl bg-slate-50 p-3 text-base">
          <Row k="Subtotal" v={money(subtotal)} />
          <Row k="Envío" v={money(shipping)} />
          <Row k="Total" v={money(total)} strong />
          {balance > 0 && (
            <>
              <Row k={deposit === 0 ? 'Anticipo (Pago Pendiente)' : 'Anticipo'} v={money(deposit)} />
              <div className="flex items-center justify-between rounded-lg bg-red-50 px-2 py-1 text-red-700">
                <dt className="font-bold">
                  {deposit === 0 ? 'Pago pendiente total en tienda' : 'Saldo pendiente a cobrar'}
                </dt>
                <dd className="text-lg font-extrabold">{money(balance)}</dd>
              </div>
            </>
          )}
        </dl>

        <div className="grid grid-cols-2 gap-2">
          <button className="btn-ghost" onClick={() => confirm('borrador')} disabled={!lines.length}>
            Guardar borrador
          </button>
          <button
            className="btn-ghost text-red-600"
            onClick={() => {
              setDraft({ ...emptyDraft(), paymentMethod: draft.paymentMethod });
              setJustAddedLine(false);
              setMaxStepReached(0);
              setWizardStep(0);
            }}
            disabled={!lines.length && !draft.photo}
          >
            Vaciar
          </button>
        </div>
      </section>
      )}

      {/* BARRA INFERIOR FIJA DEL ASISTENTE (ATRÁS / SIGUIENTE / CONFIRMAR) */}
      <div
        className="fixed inset-x-0 bottom-0 z-40 border-t border-black/[0.08] bg-white/95 px-3 py-2.5 shadow-[0_-8px_30px_rgba(0,0,0,0.08)] backdrop-blur-xl sm:px-4 sm:py-3"
        style={{ paddingBottom: 'max(0.65rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto max-w-2xl space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 truncate text-xs font-medium text-slate-500">
              {wizardStep === POS_WIZARD_LAST
                ? `${cartQty} ${cartQty === 1 ? 'prenda' : 'prendas'} en el pedido`
                : currentDraftLabel}
            </div>
            <div className="shrink-0 text-base font-bold tracking-tight text-slate-900 sm:text-lg">
              {money(bottomBarTotal)}
            </div>
          </div>

          <div className="grid grid-cols-[auto_1fr] gap-2">
            <button
              type="button"
              onClick={() => goToWizardStep(wizardStep - 1)}
              disabled={wizardStep === 0}
              className="inline-flex min-h-[48px] items-center justify-center rounded-full border border-slate-300 bg-white px-5 text-sm font-bold text-slate-800 shadow-sm transition active:scale-95 disabled:opacity-30"
            >
              ← Atrás
            </button>
            {wizardStep < POS_WIZARD_LAST ? (
              <button
                type="button"
                onClick={() => goToWizardStep(wizardStep + 1)}
                className="inline-flex min-h-[48px] items-center justify-center rounded-full bg-slate-900 px-5 text-sm font-bold text-white shadow-md transition hover:bg-slate-800 active:scale-95"
              >
                {wizardStep === 1 && !draft.photo ? 'Seguir sin diseño (Lisa) →' : 'Siguiente →'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void confirm('en_produccion')}
                disabled={!lines.length}
                className={`inline-flex min-h-[48px] items-center justify-center rounded-full px-5 text-sm font-extrabold shadow-md transition active:scale-95 ${
                  customerCheck.ok
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                    : 'bg-amber-500 text-stone-950 hover:bg-amber-400'
                }`}
              >
                {!customerCheck.ok
                  ? '🔒 Falta cliente / teléfono o Cons. Final'
                  : paymentMode === 'pending'
                  ? `⏳ Confirmar (Pago Pendiente) · ${money(total)}`
                  : `✅ Confirmar Pedido · ${money(total)}`}
              </button>
            )}
          </div>
        </div>
      </div>

      <NewColorModal open={colorModal} onClose={() => setColorModal(false)} brandId={brandId} onAdded={(n) => setPendingColorName(n)} />
      <PhotoViewer src={viewer} onClose={() => setViewer(null)} />

      <Modal
        open={!!done}
        onClose={() => setDone(null)}
        title={done ? `Pedido ${folioLabel(done.folio)}` : ''}
        footer={
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-ghost" onClick={() => setDone(null)}>
              ➕ Otro pedido
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                setDone(null);
                navigate(done?.status === 'en_produccion' ? 'taller' : 'pedidos');
              }}
            >
              {done?.status === 'en_produccion' ? '🔨 Ver taller' : '📦 Ver pedidos'}
            </button>
          </div>
        }
      >
        {done && (
          <div className="space-y-3 text-center">
            <div className="text-5xl">✅</div>
            <div className="text-2xl font-extrabold">{money(done.total)}</div>
            {done.balance > 0 && <div className="font-bold text-red-600">Saldo pendiente: {money(done.balance)}</div>}
            <button
              type="button"
              onClick={() => setPdfModalOrder(done)}
              className="btn-primary w-full"
            >
              🧾 Ver / Descargar PDF de Taller
            </button>
            {done.shipTo.phone && done.shipTo.phone.replace(/\D/g, '').length >= 8 && (
              <a
                className="btn w-full bg-[#25D366] text-white"
                href={whatsappUrl(done.shipTo.phone, fillTemplate(settings.waConfirm, done, settings))}
                target="_blank"
                rel="noreferrer"
              >
                💬 Enviar confirmación por WhatsApp
              </a>
            )}
          </div>
        )}
      </Modal>

      {pdfModalOrder && (
        <WorkshopPdfModal
          open
          onClose={() => setPdfModalOrder(null)}
          orders={[pdfModalOrder]}
          settings={settings}
          title={`Orden Taller ${folioLabel(pdfModalOrder.folio)}`}
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

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${strong ? 'border-t border-slate-200 pt-1 text-lg font-extrabold' : 'text-slate-600'}`}>
      <dt>{k}</dt>
      <dd className={strong ? '' : 'font-semibold text-slate-800'}>{v}</dd>
    </div>
  );
}
