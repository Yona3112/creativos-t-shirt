import { useEffect, useMemo, useRef, useState } from 'react';
import type { CartLine, Customer, Order, Section } from '../lib/types';
import { getState, notifyPhotos, useAppState, useStock } from '../lib/store';
import { activeBrands, brandColors, isWholesale, normalPrice, repriceCart, tierPrice, vkey } from '../lib/inventory';
import { money } from '../lib/money';
import { uid, folioLabel } from '../lib/ids';
import { compressImage, applyBackgroundRemoval, removeBackgroundWithAI, upscaleImageTo4K } from '../lib/image';
import { savePhoto } from '../lib/db';
import { addressOneLine, createOrder, quickCustomer, updateBrand, updateSettings } from '../lib/actions';
import { ColorDot, Modal, MoneyInput, PhotoViewer, Stepper, toast } from '../components/ui';
import { InteractiveShirt3D, type DecalPlacement } from '../components/Shirt';
import { NewColorModal } from '../components/NewColorModal';
import { fillTemplate, whatsappUrl } from '../lib/whatsapp';
import { useCatalogDesigns } from '../lib/catalogDesigns';

const LS_CART = 'cgs_cart_v1';

const PLACEMENTS: { id: DecalPlacement; label: string }[] = [
  { id: 'center', label: 'Pecho Centro' },
  { id: 'pocket', label: 'Logo Izq.' },
  { id: 'full', label: 'Frente Grande' },
  { id: 'back', label: 'Espalda' }
];

interface Draft {
  lines: CartLine[];
  photo: string | null;
  rawPhoto?: string | null;
  removeBg?: boolean;
  placement?: DecalPlacement;
  designScale?: number;
  designOffsetX?: number;
  designOffsetY?: number;
  customerId: string | null;
  addressId: string | null;
  withShipping: boolean;
  shipping: number;
  paymentMethod: string;
  workType: string;
  deposit: number | null;
  notes: string;
}

function emptyDraft(): Draft {
  const s = getState().settings;
  return {
    lines: [],
    photo: null,
    rawPhoto: null,
    removeBg: true,
    placement: 'center',
    designScale: 2.75,
    designOffsetX: 0,
    designOffsetY: 2,
    customerId: null,
    addressId: null,
    withShipping: true,
    shipping: s.shipping,
    paymentMethod: s.paymentMethods[0] || 'Efectivo',
    workType: s.workTypes[0] || 'DTF Frontal',
    deposit: null,
    notes: ''
  };
}

function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(LS_CART);
    if (raw) return { ...emptyDraft(), ...(JSON.parse(raw) as Draft) };
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
  const [pendingColorName, setPendingColorName] = useState<string | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [done, setDone] = useState<Order | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
  const autoPrice = tierPrice(settings, brand, projectedQty);
  const unitPrice = manualPrice ?? autoPrice;
  const wholesaleNow = isWholesale(settings, projectedQty);

  const subtotal = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const shipping = draft.withShipping ? draft.shipping : 0;
  const total = subtotal + shipping;
  const deposit = draft.deposit && draft.deposit > 0 ? Math.min(draft.deposit, total) : total;
  const balance = total - deposit;

  const customer = state.customers.find((c) => c.id === draft.customerId) || null;

  const addLine = () => {
    if (!brand || !color) return toast('Elige marca y color', 'error');
    if (qty < 1) return;
    const isManual = manualPrice !== null;
    setDraft((d) => {
      const idx = d.lines.findIndex(
        (l) =>
          l.brandId === brand.id &&
          l.colorId === color.id &&
          l.size === size &&
          l.manualPrice === isManual &&
          (!isManual || l.unitPrice === unitPrice)
      );
      const next = [...d.lines];
      if (idx >= 0) next[idx] = { ...next[idx], qty: next[idx].qty + qty };
      else next.push({ id: uid(), brandId: brand.id, colorId: color.id, size, qty, unitPrice, manualPrice: isManual });
      return { ...d, lines: next };
    });
    const st = stock.get(vkey(brand.id, color.id, size)) || 0;
    toast(st >= qty ? `+${qty} ${brand.code} ${color.name} ${size}` : `+${qty} ${color.name} ${size} · bajo pedido`, st >= qty ? 'ok' : 'info');
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
    deleteDesign
  } = useCatalogDesigns();

  const onPhoto = async (f: File | undefined) => {
    if (!f) return;
    try {
      const shouldRemoveBg = draft.removeBg ?? true;
      const raw = await compressImage(f, 1400, 0.92, false);
      const processed = shouldRemoveBg ? await applyBackgroundRemoval(raw, true, 34) : raw;
      set({
        rawPhoto: raw,
        photo: processed,
        removeBg: shouldRemoveBg,
        designScale: 2.75,
        designOffsetX: 0,
        designOffsetY: 2
      });
      toast(
        shouldRemoveBg
          ? 'Diseño sin fondo agregado en Tamaño A3'
          : 'Diseño agregado a la camisa 3D en Tamaño A3'
      );
    } catch (e) {
      toast((e as Error).message, 'error');
    }
    if (fileRef.current) fileRef.current.value = '';
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
    let photoId: string | null = null;
    if (draft.photo) {
      photoId = uid();
      await savePhoto(photoId, draft.photo, 0);
      notifyPhotos();
    }
    const order = createOrder({
      lines,
      customer: cust,
      addressId,
      shipping,
      deposit: draft.deposit || 0,
      paymentMethod: draft.paymentMethod,
      workType: draft.workType,
      notes: draft.notes,
      photoId,
      status
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
            placement={draft.placement || 'center'}
            designScale={draft.designScale ?? 2.75}
            designOffsetX={draft.designOffsetX ?? 0}
            designOffsetY={draft.designOffsetY ?? 2}
            onDesignChange={(patch) => {
              const next: Partial<Draft> = {};
              if (patch.scale !== undefined) next.designScale = patch.scale;
              if (patch.offsetX !== undefined) next.designOffsetX = patch.offsetX;
              if (patch.offsetY !== undefined) next.designOffsetY = patch.offsetY;
              if (patch.placement !== undefined) next.placement = patch.placement;
              set(next);
            }}
            onUploadFile={(file) => void onPhoto(file)}
            onClearDesign={() => set({ photo: null, rawPhoto: null })}
            removeBg={draft.removeBg ?? true}
            onToggleRemoveBg={(next) => void toggleRemoveBg(next)}
            onAiRemoveBg={() => void handleAiBgNewOrder()}
            onUpscale4K={() => void handleUpscale4KNewOrder()}
            processingText={procMsg}
            isStoreOwner
            catalogDesigns={allDesigns}
            onSelectCatalogDesign={(d) => {
              if (!d.imageUrl) return;
              set({
                photo: d.imageUrl,
                rawPhoto: d.imageUrl,
                placement: d.placement || 'center',
                designScale: 2.75,
                designOffsetX: 0,
                designOffsetY: 2
              });
              toast(`"${d.name}" aplicado en Tamaño A3`);
            }}
            onSaveCurrentToCatalog={() => {
              if (!draft.photo) return;
              void saveCurrentToCatalog({
                dataUrl: draft.photo,
                placement: draft.placement || 'center'
              }).then((saved) => {
                toast(`"${saved.name}" guardado en el catálogo (visible al cliente)`);
              });
            }}
            onUploadCatalogFiles={(files) => {
              setProcMsg('Agregando diseños al catálogo...');
              void uploadFilesToCatalog(files, {
                removeBg: draft.removeBg ?? true,
                tolerance: 34,
                placement: draft.placement || 'center'
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

        <div className="flex flex-wrap gap-2">
          {colors.map((c) => {
            const totalC = brand
              ? settings.sizes.reduce((s, sz) => s + (stock.get(vkey(brand.id, c.id, sz)) || 0), 0)
              : 0;
            const active = c.id === color?.id;
            return (
              <button
                key={c.id}
                className={`flex min-h-[48px] items-center gap-2 rounded-2xl border-2 px-3 py-1.5 text-left transition ${
                  active ? 'border-brand-700 bg-brand-700 text-white shadow' : 'border-slate-200 bg-white text-slate-800'
                }`}
                onClick={() => setColorId(c.id)}
                aria-label={c.name}
                title={c.name}
              >
                <span className="h-6 w-6 shrink-0 rounded-full border border-black/15" style={{ background: c.hex }} />
                <div>
                  <div className="text-xs font-bold leading-tight">{c.name}</div>
                  <div
                    className={`text-[11px] font-semibold ${
                      active
                        ? totalC > 0
                          ? 'text-emerald-300'
                          : 'text-amber-300'
                        : totalC > 0
                        ? 'text-emerald-600'
                        : 'text-amber-600'
                    }`}
                  >
                    {totalC > 0 ? `${totalC} en stock` : 'Disponible pronto'}
                  </div>
                </div>
              </button>
            );
          })}
          <button className="flex min-h-[48px] items-center rounded-2xl border-2 border-dashed border-brand-300 px-3 text-sm font-bold text-brand-700" onClick={() => setColorModal(true)}>
            + Nuevo color
          </button>
        </div>
      </section>

      {/* 3. Foto del diseño + Quitar fondo JPG + Colocar y Escalar */}
      <section className="card space-y-3">
        <h2 className="section-title mb-0">3 · Diseño (Subir, Quitar Fondo y Colocar en 3D)</h2>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onPhoto(e.target.files?.[0])} />
        <div className="flex items-center gap-3">
          {draft.photo ? (
            <button
              className="h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-slate-200 p-1 shadow-inner"
              style={{ backgroundColor: color?.hex || '#f1f5f9' }}
              onClick={() => setViewer(draft.photo)}
              title="Ver diseño sobre el color de la camisa"
            >
              <img src={draft.photo} alt="Diseño" className="h-full w-full object-contain" />
            </button>
          ) : null}
          <div className="flex flex-1 flex-col gap-2">
            <button className="btn-soft w-full" onClick={() => fileRef.current?.click()}>
              📸 {draft.photo ? 'Cambiar Foto del Diseño (JPG / PNG)' : 'Subir Foto del Diseño (JPG / PNG)'}
            </button>
            {draft.photo && (
              <button
                className="btn-ghost w-full text-red-600"
                onClick={() => set({ photo: null, rawPhoto: null })}
              >
                Quitar foto
              </button>
            )}
          </div>
        </div>

        {/* Opción para quitar el fondo si es JPG y dejarlo igual al color de la camisa */}
        <label className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
          <input
            type="checkbox"
            className="h-5 w-5 accent-slate-900"
            checked={draft.removeBg ?? true}
            onChange={(e) => void toggleRemoveBg(e.target.checked)}
          />
          <span>🪄 Quitar fondo exterior (protege colores y letras internas del diseño)</span>
        </label>

        {procMsg && (
          <div className="flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-900">
            <span className="h-2.5 w-2.5 animate-ping rounded-full bg-sky-600" />
            <span>{procMsg}</span>
          </div>
        )}

        {draft.photo && (
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                className="btn-soft min-h-[42px] text-xs font-extrabold"
                onClick={() => void handleAiBgNewOrder()}
                disabled={!!procMsg}
              >
                🤖 Quitar Fondo con IA Pro
              </button>
              <button
                type="button"
                className="btn-soft min-h-[42px] text-xs font-extrabold"
                onClick={() => void handleUpscale4KNewOrder()}
                disabled={!!procMsg}
              >
                ✨ Escalar Diseño a 4K Ultra HD
              </button>
            </div>

            <div>
              <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                Ubicación en la camisa 3D
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {PLACEMENTS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`chip text-xs ${(draft.placement || 'center') === p.id ? 'chip-on' : 'chip-off'}`}
                    onClick={() => set({ placement: p.id, designOffsetX: 0, designOffsetY: 0 })}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-600">Tamaño rápido:</span>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  className="rounded-xl bg-white px-2.5 py-1 text-xs font-extrabold text-slate-800 shadow-sm ring-1 ring-slate-200"
                  onClick={() => set({ designScale: 1, designOffsetX: 0, designOffsetY: 0 })}
                >
                  📄 Estándar A4 (100%)
                </button>
                <button
                  type="button"
                  className="rounded-xl bg-sky-600 px-3 py-1 text-xs font-extrabold text-white shadow-sm"
                  onClick={() => set({ designScale: 2.75, designOffsetX: 0, designOffsetY: 2 })}
                >
                  📐 Tamaño A3 Completo (Máx)
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="label">
                  Tamaño ({(draft.designScale ?? 1) >= 2.5 ? `A3 · ${Math.round((draft.designScale ?? 1) * 100)}%` : `${Math.round((draft.designScale ?? 1) * 100)}%`})
                </label>
                <input
                  type="range"
                  min="0.30"
                  max="3.00"
                  step="0.05"
                  className="w-full accent-slate-900"
                  value={draft.designScale ?? 1}
                  onChange={(e) => set({ designScale: parseFloat(e.target.value) })}
                />
              </div>
              <div>
                <label className="label">Mover Izq. / Der.</label>
                <input
                  type="range"
                  min="-24"
                  max="24"
                  step="1"
                  className="w-full accent-slate-900"
                  value={draft.designOffsetX ?? 0}
                  onChange={(e) => set({ designOffsetX: parseFloat(e.target.value) })}
                />
              </div>
              <div>
                <label className="label">Mover Arriba / Abajo</label>
                <input
                  type="range"
                  min="-24"
                  max="26"
                  step="1"
                  className="w-full accent-slate-900"
                  value={draft.designOffsetY ?? 0}
                  onChange={(e) => set({ designOffsetY: parseFloat(e.target.value) })}
                />
              </div>
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

      {/* 4. Talla */}
      <section className="card">
        <h2 className="section-title">4 · Talla</h2>
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
          <div className={`rounded-xl border-2 p-2 ${!wholesaleNow ? 'border-brand-600 bg-brand-50' : 'border-slate-200'}`}>
            <div className="mb-1 text-xs font-bold text-slate-600">1–{settings.wholesaleMin - 1} uds</div>
            <MoneyInput
              ariaLabel="Precio normal"
              value={normalForBrand}
              onChange={(c) => {
                if (c === null) return;
                if (brand && brand.priceOverride !== null) updateBrand(brand.id, { priceOverride: c });
                else updateSettings({ priceNormal: c });
              }}
            />
          </div>
          <div className={`rounded-xl border-2 p-2 ${wholesaleNow ? 'border-brand-600 bg-brand-50' : 'border-slate-200'}`}>
            <div className="mb-1 text-xs font-bold text-slate-600">{settings.wholesaleMin}+ uds</div>
            <MoneyInput ariaLabel="Precio mayorista" value={settings.priceWholesale} onChange={(c) => c !== null && updateSettings({ priceWholesale: c })} />
          </div>
        </div>
        <div>
          <label className="label">Precio por camisa (L)</label>
          <div className="flex gap-2">
            <MoneyInput className="flex-1" ariaLabel="Precio por camisa" value={unitPrice} onChange={(c) => setManualPrice(c)} />
            {manualPrice !== null && (
              <button className="btn-ghost" onClick={() => setManualPrice(null)} title="Precio automático">
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
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${isWholesale(settings, cartQty) ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
              {cartQty} uds{isWholesale(settings, cartQty) ? ' · Mayorista' : ''}
            </span>
          )}
        </div>

        {draft.photo && (
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-2">
            <button className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border" onClick={() => setViewer(draft.photo)}>
              <img src={draft.photo} alt="Diseño" className="h-full w-full object-cover" />
            </button>
            <span className="text-sm font-semibold text-slate-700">{draft.workType}</span>
          </div>
        )}

        {lines.length === 0 ? (
          <p className="py-4 text-center text-slate-400">🛒 Vacío</p>
        ) : (
          <ul className="space-y-2">
            {lines.map((l) => {
              const b = state.brands.find((x) => x.id === l.brandId);
              const c = state.colors.find((x) => x.id === l.colorId);
              const st = stock.get(vkey(l.brandId, l.colorId, l.size)) || 0;
              return (
                <li key={l.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-center gap-2">
                    <ColorDot hex={c?.hex || '#999'} size={22} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-bold">
                        {b?.name} · {c?.name} · {l.size}
                      </div>
                      {st < l.qty && <div className="text-xs font-semibold text-amber-600">Bajo pedido: {l.qty - Math.min(st, l.qty)}</div>}
                    </div>
                    <button className="btn-icon h-10 w-10 text-lg text-red-500" onClick={() => removeLine(l.id)} aria-label="Quitar">
                      🗑
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Stepper size="sm" value={l.qty} min={1} onCommit={(n) => updateLine(l.id, { qty: n })} ariaLabel="Cantidad" />
                    <div className="flex min-w-[130px] flex-1 items-center gap-1">
                      <MoneyInput
                        className="flex-1"
                        ariaLabel="Precio de la línea"
                        value={l.unitPrice}
                        onChange={(cents) => cents !== null && updateLine(l.id, { unitPrice: cents, manualPrice: true })}
                      />
                      {l.manualPrice && (
                        <button className="btn-icon h-12 w-10 text-base text-slate-500" onClick={() => updateLine(l.id, { manualPrice: false })} title="Precio automático">
                          ↺
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 text-right text-sm font-bold">{money(l.qty * l.unitPrice)}</div>
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

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="pm">
              Método de pago
            </label>
            <select id="pm" className="input" value={draft.paymentMethod} onChange={(e) => set({ paymentMethod: e.target.value })}>
              {settings.paymentMethods.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Anticipo Recibido (L)</label>
            <MoneyInput ariaLabel="Anticipo recibido" value={draft.deposit} allowEmpty placeholder="Pagado 100%" onChange={(c) => set({ deposit: c })} />
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
              <Row k="Anticipo" v={money(deposit)} />
              <div className="flex items-center justify-between rounded-lg bg-red-50 px-2 py-1 text-red-700">
                <dt className="font-bold">Saldo pendiente a cobrar</dt>
                <dd className="text-lg font-extrabold">{money(balance)}</dd>
              </div>
            </>
          )}
        </dl>

        <button className="btn-success w-full text-lg" onClick={() => confirm('en_produccion')} disabled={!lines.length}>
          ✅ Confirmar Pedido · {money(total)}
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
