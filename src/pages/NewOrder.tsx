import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CartLine, Customer, Order, Section } from '../lib/types';
import { getState, notifyPhotos, useAppState, useStock } from '../lib/store';
import { activeBrands, brandColors, normalPrice, repriceCart, tierPrice, vkey } from '../lib/inventory';
import { money } from '../lib/money';
import { uid, folioLabel } from '../lib/ids';
import { compressImage, applyBackgroundRemoval, removeBackgroundWithAI, upscaleImageTo4K, isJpgFile } from '../lib/image';
import { savePhoto } from '../lib/db';
import { fetchSharedPhoto } from '../lib/sync';
import { addressOneLine, createOrder, deleteColor, quickCustomer, updateBrand, updateColor, updateSettings } from '../lib/actions';
import { ColorDot, Modal, MoneyInput, PhotoViewer, Stepper, toast } from '../components/ui';
import { InteractiveShirt3D, type DecalPlacement } from '../components/Shirt';
import { NewColorModal } from '../components/NewColorModal';
import { fillTemplate, whatsappUrl } from '../lib/whatsapp';
import { useCatalogDesigns } from '../lib/catalogDesigns';
import { sanitizeWebOrder } from '../lib/publicCatalog';
import { WEB_ORDER_LATEST_KEY, readWebOrderImportHash, type CustomerWebOrderPayload } from './Catalog3D';

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
    workType: s.workTypes.find((w) => w.toLowerCase().includes('espalda')) || s.workTypes[0] || 'DTF Frontal',
    deposit: null,
    notes: ''
  };
}

function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(LS_CART);
    if (raw) {
      const parsed = JSON.parse(raw) as Draft;
      if (parsed.designScale && parsed.designScale > 2.2) {
        parsed.designScale = 2.0;
        parsed.designOffsetY = 0;
      }
      return { ...emptyDraft(), ...parsed };
    }
  } catch {
    /* ignorar */
  }
  return emptyDraft();
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
      /* foto muy grande para localStorage: se mantiene en memoria */
    }
  }, [draft]);

  // Selección actual
  const [brandId, setBrandId] = useState(brands[0]?.id || '');
  const colors = brandColors(state, brandId);
  const [colorId, setColorId] = useState(colors[0]?.id || '');
  const [size, setSize] = useState<string>(settings.sizes.includes('M') ? 'M' : settings.sizes[0]);
  const [qty, setQty] = useState(1);
  const [manualPrice, setManualPrice] = useState<number | null>(null);
  const [colorModal, setColorModal] = useState(false);
  const [editingColor, setEditingColor] = useState<{ id: string; name: string; hex: string } | null>(null);
  const [pendingColorName, setPendingColorName] = useState<string | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [done, setDone] = useState<Order | null>(null);

  const brand = brands.find((b) => b.id === brandId);
  const color = colors.find((c) => c.id === colorId) || colors[0];

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
  const projectedQty = cartQty + qty;
  const isLisaExplicit = Boolean(draft.workType && draft.workType.toLowerCase().includes('lisa'));
  const isCustomWork = isLisaExplicit
    ? false
    : Boolean(draft.photo || draft.designName || draft.workType);
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

  const addLine = () => {
    if (!brand || !color) return toast('Elige marca y color', 'error');
    if (qty < 1) return;
    const isManual = manualPrice !== null;
    const hasDesignForLine = isCustomWork && Boolean(draft.photo);
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
      // Para saber si ya existe esta misma línea en el carrito:
      // Debe coincidir prenda (marca, color, talla, precio) Y el diseño (designId, designName y ubicación)
      const idx = d.lines.findIndex(
        (l) =>
          l.brandId === brand.id &&
          l.colorId === color.id &&
          l.size === size &&
          l.manualPrice === isManual &&
          (!isManual || l.unitPrice === unitPrice) &&
          (l.designId || null) === curDesignId &&
          (l.designName || null) === curDesignName &&
          (l.placement || null) === curPlacement
      );
      const next = [...d.lines];
      if (idx >= 0) {
        // Mismo diseño y misma prenda: sumamos unidades a esa línea existente
        next[idx] = { ...next[idx], qty: next[idx].qty + qty };
      } else {
        // Diseño diferente o prenda diferente: se agrega como línea individual
        next.push({
          id: uid(),
          brandId: brand.id,
          colorId: color.id,
          size,
          qty,
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
      return { ...d, lines: next };
    });
    const st = stock.get(vkey(brand.id, color.id, size)) || 0;
    const designLabel = curDesignName ? ` · ${curDesignName}` : ' · Lisa';
    toast(
      st >= qty
        ? `+${qty} ${brand.code} ${color.name} ${size}${designLabel}`
        : `+${qty} ${color.name} ${size}${designLabel} (Bajo pedido)`,
      st >= qty ? 'ok' : 'info'
    );
    setQty(1);
    setManualPrice(null);
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

  const customWorkTypeDefault =
    settings.workTypes.find((w) => w.toLowerCase().includes('espalda')) ||
    settings.workTypes.find((w) => !w.toLowerCase().includes('lisa')) ||
    'DTF Espalda';

  const onPhoto = async (f: File | undefined) => {
    if (!f) return;
    try {
      const autoJpgToPng = isJpgFile(f);
      const shouldRemoveBg = autoJpgToPng || (draft.removeBg ?? false);
      const raw = await compressImage(f, 1400, 0.92, false);
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
      toast(
        autoJpgToPng
          ? 'JPG convertido automáticamente a PNG transparente en Tamaño A3'
          : shouldRemoveBg
          ? 'Diseño sin fondo agregado en Tamaño A3'
          : 'Diseño agregado a la camisa 3D en Tamaño A3'
      );
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

  // Cliente rápido
  const [custMode, setCustMode] = useState<'buscar' | 'nuevo'>('buscar');
  const [q, setQ] = useState('');
  const [qc, setQc] = useState({ name: '', phone: '', address: '' });
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

          let itemPhoto: string | null = null;
          if (it.photoId) {
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
            importedLines.push({
              id: uid(),
              brandId: matchedB.id,
              colorId: matchedC.id,
              size: it.size || 'M',
              qty: Math.max(1, it.qty || 1),
              unitPrice: it.unitPrice || tierPrice(settings, matchedB, it.qty || 1),
              manualPrice: false,
              designId: it.designId || null,
              designName: it.designName || null,
              designCode: it.designCode || null,
              photoId: it.photoId || null,
              photo: itemPhoto,
              rawPhoto: itemPhoto,
              placement: it.placement || 'back',
              scale: it.scale || 2.0,
              offsetX: 0,
              offsetY: 0
            });
          }
        }

        const isBack = firstPlacement === 'back';
        const sideExplicit = isBack ? 'Espalda' : 'Frente';
        const matchedWorkType =
          settings.workTypes.find((w) =>
            isBack
              ? w.toLowerCase().includes('espalda')
              : w.toLowerCase().includes('frontal') || w.toLowerCase().includes('pecho')
          ) || settings.workTypes[0] || 'DTF Frontal';

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
        toast(`✅ Pedido de ${webOrder.customerName || 'Cliente'} (${importedLines.length} prendas) cargado`);
      } catch (e) {
        toast((e as Error).message || 'No se pudo cargar el pedido web', 'error');
      } finally {
        setImportingWebOrder(false);
      }
    },
    [brands, colors, settings, state]
  );

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
              await importCustomerWebOrder(parsed);
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
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return state.customers
      .filter((c) => !c.deleted && (c.name.toLowerCase().includes(t) || c.phone.replace(/\D/g, '').includes(t.replace(/\D/g, '') || '~')))
      .slice(0, 6);
  }, [q, state.customers]);

  const confirm = async (status: 'en_produccion' | 'borrador') => {
    if (!lines.length) return toast('Agrega al menos una camisa', 'error');
    let cust: Customer | null = customer;
    let addressId = draft.addressId;
    if (!cust && custMode === 'nuevo' && qc.name.trim()) {
      cust = quickCustomer(qc.name, qc.phone ? `+504 ${qc.phone.replace(/^\+?504\s*/, '')}` : '', qc.address);
      addressId = cust.addresses[0]?.id || null;
    }
    if (cust && !addressId) addressId = cust.addresses.find((a) => a.isDefault)?.id || cust.addresses[0]?.id || null;

    let mainPhotoId: string | null = null;
    if (draft.photo) {
      mainPhotoId = uid();
      await savePhoto(mainPhotoId, draft.photo, 0);
    }

    // Persistir las fotos de cada línea individual si el pedido contiene múltiples diseños
    const linesWithPhotos: CartLine[] = [];
    for (const l of lines) {
      let lPhotoId = l.photoId || null;
      if (l.photo && !lPhotoId) {
        lPhotoId = uid();
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
    const keep = { paymentMethod: draft.paymentMethod, workType: draft.workType };
    setDraft({ ...emptyDraft(), ...keep });
    setQc({ name: '', phone: '', address: '' });
    setQ('');
    setCustMode('buscar');
    setDone(order);
  };

  const normalForBrand = normalPrice(settings, brand);

  return (
    <div className="space-y-4 pb-6">
      {/* Banner 1-Clic cuando un cliente envía un pedido desde la Tienda 3D */}
      {latestWebOrder && (
        <section className="rounded-2xl border-2 border-amber-400 bg-gradient-to-r from-amber-950 via-stone-900 to-amber-950 p-3.5 text-white shadow-lg">
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
                  {latestWebOrder.qty}× {latestWebOrder.brandName} · Color {latestWebOrder.colorName} · Talla {latestWebOrder.size} ·{' '}
                  <span className="rounded bg-amber-400 px-1.5 py-0.5 font-black text-stone-950">
                    {latestWebOrder.designName
                      ? `${latestWebOrder.designName} en ${latestWebOrder.placement === 'back' ? 'ESPALDA (Atrás)' : 'FRENTE (Pecho)'}`
                      : 'L 300.00'}
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

      {/* 1. Marca */}
      <section className="card">
        <h2 className="section-title">1 · Marca</h2>
        <div className="grid grid-cols-2 gap-2">
          {brands.map((b) => (
            <button key={b.id} className={`chip ${b.id === brandId ? 'chip-on' : 'chip-off'}`} onClick={() => setBrandId(b.id)}>
              {b.name}
            </button>
          ))}
        </div>
      </section>

      {/* 2. Color + Visor 3D Real */}
      <section className="card space-y-3">
        <h2 className="section-title mb-0">2 · Color y Vista 3D Real</h2>
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-100 via-white to-slate-100 p-3">
          <InteractiveShirt3D
            hex={color?.hex || '#e5e7eb'}
            colorName={color?.name || ''}
            brandName={brand?.name || ''}
            designUrl={draft.photo}
            placement={draft.placement || 'back'}
            designScale={draft.designScale ?? 2.0}
            designOffsetX={draft.designOffsetX ?? 0}
            designOffsetY={draft.designOffsetY ?? 0}
            onDesignChange={(patch) => {
              const next: Partial<Draft> = {};
              if (patch.scale !== undefined) next.designScale = patch.scale;
              if (patch.offsetX !== undefined) next.designOffsetX = patch.offsetX;
              if (patch.offsetY !== undefined) next.designOffsetY = patch.offsetY;
              if (patch.placement !== undefined) next.placement = patch.placement;
              set(next);
            }}
            onUploadFile={(file) => void onPhoto(file)}
            onClearDesign={() => set({ photo: null, rawPhoto: null, designId: null, designName: null, designCode: null })}
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
            onSelectColor={(id) => setColorId(id)}
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
              set({
                photo: d.imageUrl,
                rawPhoto: d.imageUrl,
                designId: d.id,
                designName: d.name,
                designCode: d.code || 'D-001',
                placement: 'back',
                designScale: 2.0,
                designOffsetX: 0,
                designOffsetY: 0,
                workType: draft.workType.toLowerCase().includes('lisa')
                  ? customWorkTypeDefault
                  : draft.workType
              });
              toast(`"${d.code ? `[${d.code}] ` : ''}${d.name}" colocado en ESPALDA (Tamaño A3)`);
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
                ? {
                    available: (stock.get(vkey(brand.id, color.id, size)) || 0) > 0,
                    text:
                      (stock.get(vkey(brand.id, color.id, size)) || 0) > 0
                        ? `Talla ${size}: ${stock.get(vkey(brand.id, color.id, size)) || 0} disp.`
                        : `Talla ${size}: Disponible pronto`
                  }
                : null
            }
          />
        </div>

        {draft.photo && (
          <div className="grid grid-cols-1 gap-2 rounded-xl border border-amber-200 bg-amber-50/70 p-2.5 sm:grid-cols-3">
            <div>
              <label className="label text-xs">Código de Diseño (Reporte)</label>
              <input
                className="input font-mono font-bold uppercase"
                placeholder="Ej. D-001, TORO-01"
                value={draft.designCode || ''}
                onChange={(e) => set({ designCode: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label text-xs">Nombre del Diseño / Estilo de Camisa (Reporte)</label>
              <input
                className="input font-bold"
                placeholder="Ej. Establo Silla, Toro Honduras..."
                value={draft.designName || ''}
                onChange={(e) => set({ designName: e.target.value })}
              />
            </div>
          </div>
        )}

        <div>
          <label className="label" htmlFor="wt">
            Tipo de trabajo
          </label>
          <select id="wt" className="input" value={draft.workType} onChange={(e) => set({ workType: e.target.value })}>
            {settings.workTypes.map((w) => (
              <option key={w}>{w}</option>
            ))}
          </select>
        </div>
      </section>

      {/* 3. Talla */}
      <section className="card">
        <h2 className="section-title">3 · Talla</h2>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {settings.sizes.map((sz) => {
            const st = brand && color ? stock.get(vkey(brand.id, color.id, sz)) || 0 : 0;
            const active = sz === size;
            return (
              <button key={sz} className={`chip flex-col gap-0.5 py-2 ${active ? 'chip-on' : 'chip-off'}`} onClick={() => setSize(sz)}>
                <span className="text-lg font-extrabold leading-tight">{sz}</span>
                <span
                  className={`text-[11px] font-bold ${
                    active
                      ? st > 0
                        ? 'text-emerald-300'
                        : 'text-amber-300'
                      : st > 0
                      ? 'text-emerald-600'
                      : 'text-amber-600'
                  }`}
                >
                  {st > 0 ? `${st} disp.` : 'Disponible pronto'}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 5. Precio y 6. Cantidad */}
      <section className="card space-y-3">
        <h2 className="section-title">5 · Precio</h2>
        <div className="grid grid-cols-2 gap-2">
          <div
            role="button"
            tabIndex={0}
            className={`cursor-pointer rounded-xl border-2 p-2.5 transition ${
              !isCustomWork ? 'border-brand-600 bg-brand-50 shadow-sm ring-1 ring-brand-600/20' : 'border-slate-200 hover:border-slate-300'
            }`}
            onClick={() => {
              setManualPrice(null);
              set({ workType: 'Camisa Lisa' });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setManualPrice(null);
                set({ workType: 'Camisa Lisa' });
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
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setManualPrice(null);
                set({ workType: customWorkTypeDefault });
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
            <MoneyInput className="flex-1" ariaLabel="Precio por camisa" value={unitPrice} onChange={(c) => setManualPrice(c)} />
            {manualPrice !== null && (
              <button className="btn-ghost" onClick={() => setManualPrice(null)} title="Restablecer precio sugerido">
                ↺
              </button>
            )}
          </div>
        </div>
        <h2 className="section-title pt-1">6 · Cantidad</h2>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Stepper value={qty} min={1} onCommit={setQty} ariaLabel="Cantidad" />
          <div className="text-right">
            <div className="text-xs text-slate-500">{qty} × {money(unitPrice)}</div>
            <div className="text-lg font-extrabold">{money(qty * unitPrice)}</div>
          </div>
        </div>
        <button className="btn-primary w-full text-lg" onClick={addLine} disabled={!brand || !color}>
          ➕ Agregar al Pedido
        </button>
      </section>

      {/* Resumen */}
      <section className="card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="section-title mb-0">Resumen del pedido</h2>
          {lines.length > 0 && (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
              {cartQty} {cartQty === 1 ? 'unidad' : 'unidades'}
            </span>
          )}
        </div>

        {draft.photo && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/70 p-2.5">
            <div className="flex items-center gap-3">
              <button className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-amber-300 bg-white" onClick={() => setViewer(draft.photo)}>
                <img src={draft.photo} alt="Diseño" className="h-full w-full object-contain" />
              </button>
              <div>
                <div className="text-sm font-extrabold text-slate-800">{draft.workType}</div>
                <div className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-amber-500 px-2.5 py-0.5 text-[11px] font-black text-stone-950">
                  📍 Ubicación: {(draft.placement || 'back') === 'back' ? 'ESPALDA (Parte de Atrás)' : 'FRENTE (Pecho Delantero)'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => set({ placement: 'back' })}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-extrabold transition ${
                  (draft.placement || 'back') === 'back'
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                🔄 Espalda
              </button>
              <button
                type="button"
                onClick={() => set({ placement: 'center' })}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-extrabold transition ${
                  draft.placement && draft.placement !== 'back'
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                👕 Frente
              </button>
              <button
                type="button"
                onClick={() => set({ photo: null, rawPhoto: null })}
                className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-extrabold text-rose-600 hover:bg-rose-100"
              >
                🚫 Quitar
              </button>
            </div>
          </div>
        )}

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
        <div>
          <div className="mb-2 grid grid-cols-2 gap-2">
            <button className={`chip ${custMode === 'buscar' ? 'chip-on' : 'chip-off'}`} onClick={() => setCustMode('buscar')}>
              👥 Cliente
            </button>
            <button
              className={`chip ${custMode === 'nuevo' ? 'chip-on' : 'chip-off'}`}
              onClick={() => {
                setCustMode('nuevo');
                set({ customerId: null, addressId: null });
              }}
            >
              ➕ Nuevo
            </button>
          </div>
          {custMode === 'buscar' ? (
            customer ? (
              <div className="rounded-xl bg-brand-50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold">{customer.name}</div>
                    <div className="text-sm text-slate-600">{customer.phone}</div>
                  </div>
                  <button className="btn-ghost min-h-[40px] px-3 text-sm" onClick={() => set({ customerId: null, addressId: null })}>
                    Cambiar
                  </button>
                </div>
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
                <input className="input" placeholder="Buscar por nombre o teléfono" value={q} onChange={(e) => setQ(e.target.value)} />
                {matches.length > 0 && (
                  <ul className="mt-1 divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {matches.map((c) => (
                      <li key={c.id}>
                        <button
                          className="flex min-h-[52px] w-full flex-col justify-center px-3 text-left"
                          onClick={() => {
                            const def = c.addresses.find((a) => a.isDefault) || c.addresses[0];
                            set({ customerId: c.id, addressId: def?.id || null });
                            setQ('');
                          }}
                        >
                          <span className="font-semibold">{c.name}</span>
                          <span className="text-xs text-slate-500">{c.phone}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          ) : (
            <div className="space-y-2">
              <input className="input" placeholder="Nombre" value={qc.name} onChange={(e) => setQc({ ...qc, name: e.target.value })} autoComplete="off" />
              <div className="flex">
                <span className="flex items-center rounded-l-xl border border-r-0 border-slate-300 bg-slate-50 px-3 font-semibold text-slate-600">+504</span>
                <input
                  className="input rounded-l-none"
                  placeholder="Teléfono"
                  type="tel"
                  inputMode="tel"
                  value={qc.phone}
                  onChange={(e) => setQc({ ...qc, phone: e.target.value })}
                />
              </div>
              <textarea className="input min-h-[80px] py-2" placeholder="Dirección" value={qc.address} onChange={(e) => setQc({ ...qc, address: e.target.value })} />
            </div>
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

        <button className="btn-success w-full text-lg" onClick={() => confirm('en_produccion')} disabled={!lines.length}>
          {paymentMode === 'pending'
            ? `⏳ Confirmar (Pago Pendiente) · ${money(total)}`
            : `✅ Confirmar Pedido · ${money(total)}`}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-ghost" onClick={() => confirm('borrador')} disabled={!lines.length}>
            Guardar borrador
          </button>
          <button
            className="btn-ghost text-red-600"
            onClick={() => setDraft({ ...emptyDraft(), paymentMethod: draft.paymentMethod, workType: draft.workType })}
            disabled={!lines.length && !draft.photo}
          >
            Vaciar
          </button>
        </div>
      </section>

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
            {done.shipTo.phone && (
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
