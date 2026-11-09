import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppState, useStock } from '../lib/store';
import { activeBrands, brandColors, normalPrice, skuOf, vkey } from '../lib/inventory';
import {
  addBrand,
  addReadyMadeShirt,
  deleteBrand,
  deleteColor,
  removeReadyMadeShirt,
  setStockAbsolute,
  updateBrand,
  updateColor,
  updateReadyMadeShirt
} from '../lib/actions';
import { fromCents, money, toCents } from '../lib/money';
import { Confirm, Empty, Modal, Stepper, toast } from '../components/ui';
import { ColorSwatchPicker } from '../components/Shirt';
import { NewColorModal } from '../components/NewColorModal';
import { BASE_COLORS, QUICK_PALETTE } from '../lib/seed';
import type { Brand, Color, ReadyMadeShirt } from '../lib/types';

export default function Inventory() {
  const state = useAppState();
  const { stock } = useStock();
  const { settings } = state;
  const brands = activeBrands(state);

  const [view, setView] = useState<'matriz' | 'tarjetas' | 'estampadas'>('matriz');
  const [query, setQuery] = useState('');
  const [brandFilter, setBrandFilter] = useState('all');
  const [colorFilter, setColorFilter] = useState('all');
  const [sizeFilter, setSizeFilter] = useState('all');

  // Modales de Color (Crear / Editar / Eliminar)
  const [showNewColor, setShowNewColor] = useState(false);
  const [newColorBrandId, setNewColorBrandId] = useState<string | undefined>(undefined);
  const [editingColor, setEditingColor] = useState<Color | null>(null);
  const [editColorName, setEditColorName] = useState('');
  const [editColorHex, setEditColorHex] = useState('#1A1A1C');
  const [editColorCode, setEditColorCode] = useState('');
  const [confirmDeleteColor, setConfirmDeleteColor] = useState<Color | null>(null);

  // Modales de Marca (Crear / Editar / Eliminar)
  const [showNewBrand, setShowNewBrand] = useState(false);
  const [newBrandName, setNewBrandName] = useState('');
  const [newBrandCode, setNewBrandCode] = useState('');
  const [newBrandSeedColors, setNewBrandSeedColors] = useState(true);
  const [editingBrand, setEditingBrand] = useState<Brand | null>(null);
  const [editBrandName, setEditBrandName] = useState('');
  const [editBrandCode, setEditBrandCode] = useState('');
  const [editBrandCost, setEditBrandCost] = useState('');
  const [editBrandPrice, setEditBrandPrice] = useState('');
  const [confirmDeleteBrand, setConfirmDeleteBrand] = useState<Brand | null>(null);

  // Modales de Prenda Ya Estampada (Crear / Editar)
  const [showReadyModal, setShowReadyModal] = useState(false);
  const [editingReady, setEditingReady] = useState<ReadyMadeShirt | null>(null);
  const [rmBrandId, setRmBrandId] = useState('');
  const [rmColorId, setRmColorId] = useState('');
  const [rmSize, setRmSize] = useState('M');
  const [rmDesignName, setRmDesignName] = useState('');
  const [rmPrice, setRmPrice] = useState('350');
  const [rmQty, setRmQty] = useState('1');
  const [rmNotes, setRmNotes] = useState('');

  const colorNames = useMemo(() => {
    const names = new Set<string>();
    for (const b of brands) {
      for (const c of brandColors(state, b.id)) names.add(c.name);
    }
    return Array.from(names);
  }, [brands, state]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: {
      brand: (typeof brands)[number];
      color: ReturnType<typeof brandColors>[number];
      sizes: string[];
    }[] = [];

    for (const brand of brands) {
      if (brandFilter !== 'all' && brand.id !== brandFilter) continue;
      for (const color of brandColors(state, brand.id)) {
        if (colorFilter !== 'all' && color.name !== colorFilter) continue;
        const sizes = settings.sizes.filter((sz) => {
          if (sizeFilter !== 'all' && sz !== sizeFilter) return false;
          if (!q) return true;
          const sku = skuOf(brand, color, sz).toLowerCase();
          return (
            brand.name.toLowerCase().includes(q) ||
            brand.code.toLowerCase().includes(q) ||
            color.name.toLowerCase().includes(q) ||
            sku.includes(q)
          );
        });
        if (sizes.length > 0) out.push({ brand, color, sizes });
      }
    }
    return out;
  }, [brands, state, settings.sizes, query, brandFilter, colorFilter, sizeFilter]);

  const visibleSizes = useMemo(
    () => (sizeFilter === 'all' ? settings.sizes : settings.sizes.filter((s) => s === sizeFilter)),
    [settings.sizes, sizeFilter]
  );

  const totalUnits = useMemo(() => {
    let sum = 0;
    for (const r of rows) {
      for (const sz of r.sizes) {
        sum += stock.get(vkey(r.brand.id, r.color.id, sz)) || 0;
      }
    }
    return sum;
  }, [rows, stock]);

  const readyMadeList = (state.readyMadeStock || []).filter((r) => !r.deleted && r.qty > 0);
  const readyMadeCount = readyMadeList.reduce((sum, r) => sum + r.qty, 0);

  const openEditColorModal = (c: Color) => {
    setEditingColor(c);
    setEditColorName(c.name);
    setEditColorHex(c.hex);
    setEditColorCode(c.code || '');
  };

  const handleSaveEditColor = () => {
    if (!editingColor) return;
    if (!editColorName.trim()) return toast('Escribe un nombre para el color', 'error');
    const cleanHex = editColorHex.trim().startsWith('#') ? editColorHex.trim().toUpperCase() : `#${editColorHex.trim().toUpperCase()}`;
    updateColor(editingColor.id, {
      name: editColorName.trim(),
      hex: cleanHex,
      ...(editColorCode.trim() ? { code: editColorCode.trim().toUpperCase().slice(0, 4) } : {})
    });
    toast(`Color "${editColorName.trim()}" actualizado`, 'ok');
    setEditingColor(null);
  };

  const openEditBrandModal = (b: Brand) => {
    setEditingBrand(b);
    setEditBrandName(b.name);
    setEditBrandCode(b.code);
    setEditBrandCost(String(fromCents(b.cost)));
    setEditBrandPrice(b.priceOverride === null ? '' : String(fromCents(b.priceOverride)));
  };

  const handleSaveEditBrand = () => {
    if (!editingBrand) return;
    if (!editBrandName.trim()) return toast('Escribe el nombre de la marca', 'error');
    updateBrand(editingBrand.id, {
      name: editBrandName.trim(),
      code: editBrandCode.trim().toUpperCase().slice(0, 4) || editingBrand.code,
      cost: toCents(editBrandCost),
      priceOverride: editBrandPrice.trim() === '' ? null : toCents(editBrandPrice)
    });
    toast(`Marca "${editBrandName.trim()}" actualizada`, 'ok');
    setEditingBrand(null);
  };

  const handleCreateBrand = () => {
    if (!newBrandName.trim()) return toast('Escribe el nombre de la marca', 'error');
    const id = addBrand(newBrandName, newBrandCode, newBrandSeedColors);
    if (!id) return toast('Esa marca o código ya existe', 'error');
    toast(`Marca "${newBrandName.trim()}" creada`, 'ok');
    setNewBrandName('');
    setNewBrandCode('');
    setShowNewBrand(false);
    setBrandFilter(id);
  };

  const openNewReadyModal = () => {
    const defaultBrand = brands[0];
    const defaultColors = defaultBrand ? brandColors(state, defaultBrand.id) : [];
    setEditingReady(null);
    setRmBrandId(defaultBrand?.id || '');
    setRmColorId(defaultColors[0]?.id || '');
    setRmSize(settings.sizes.includes('M') ? 'M' : settings.sizes[0] || 'M');
    setRmDesignName('');
    setRmPrice(String(fromCents(settings.priceCustom || 35000)));
    setRmQty('1');
    setRmNotes('');
    setShowReadyModal(true);
  };

  const openEditReadyModal = (r: ReadyMadeShirt) => {
    setEditingReady(r);
    setRmBrandId(r.brandId);
    setRmColorId(r.colorId);
    setRmSize(r.size);
    setRmDesignName(r.designName);
    setRmPrice(String(fromCents(r.price)));
    setRmQty(String(r.qty));
    setRmNotes(r.notes || '');
    setShowReadyModal(true);
  };

  const handleSaveReadyMade = () => {
    const qtyNum = Math.max(1, Math.floor(Number(rmQty) || 1));
    const priceCents = toCents(rmPrice);
    const brand = brands.find((b) => b.id === rmBrandId) || brands[0];
    const bColors = brand ? brandColors(state, brand.id) : [];
    const color = bColors.find((c) => c.id === rmColorId) || bColors[0];
    const designLabel = rmDesignName.trim() || 'Diseño Personalizado';

    if (editingReady) {
      updateReadyMadeShirt(editingReady.id, {
        brandId: brand?.id || editingReady.brandId,
        brandName: brand?.name || editingReady.brandName,
        colorId: color?.id || editingReady.colorId,
        colorName: color?.name || editingReady.colorName,
        colorHex: color?.hex || editingReady.colorHex,
        size: rmSize,
        designName: designLabel,
        price: priceCents,
        qty: qtyNum,
        notes: rmNotes.trim()
      });
      toast('Prenda estampada actualizada', 'ok');
    } else {
      addReadyMadeShirt({
        brandId: brand?.id || '',
        brandName: brand?.name || 'Marca',
        colorId: color?.id || '',
        colorName: color?.name || 'Color',
        colorHex: color?.hex || '#1A1A1C',
        size: rmSize,
        designName: designLabel,
        designCode: null,
        photoId: null,
        placement: 'back',
        price: priceCents,
        qty: qtyNum,
        notes: rmNotes.trim() || 'Agregada manualmente en inventario'
      });
      toast('Prenda ya estampada agregada al stock', 'ok');
    }
    setShowReadyModal(false);
  };

  const selectedBrandObj = brandFilter !== 'all' ? brands.find((b) => b.id === brandFilter) : null;

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="grid flex-1 grid-cols-3 gap-2">
            <button
              className={`chip ${view === 'matriz' ? 'chip-on' : 'chip-off'}`}
              onClick={() => setView('matriz')}
            >
              📊 Matriz
            </button>
            <button
              className={`chip ${view === 'tarjetas' ? 'chip-on' : 'chip-off'}`}
              onClick={() => setView('tarjetas')}
            >
              🗂 Tarjetas
            </button>
            <button
              className={`chip ${view === 'estampadas' ? 'chip-on' : 'chip-off'}`}
              onClick={() => setView('estampadas')}
            >
              ⚡ Ya Estampadas ({readyMadeCount})
            </button>
          </div>
          <div className="rounded-xl bg-brand-50 px-3 py-2 text-sm font-extrabold text-brand-900">
            {view === 'estampadas'
              ? `Listas para entrega: ${readyMadeCount} uds`
              : `En blanco: ${totalUnits} uds`}
          </div>
        </div>

        {/* Barra de acciones de gestión directa en Inventario y Matriz */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 p-2.5">
          <div className="text-xs font-bold text-slate-600">
            🎨 Gestión rápida de colores, marcas y existencias:
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-primary px-3 py-2 text-xs"
              onClick={() => {
                setNewColorBrandId(brandFilter !== 'all' ? brandFilter : brands[0]?.id);
                setShowNewColor(true);
              }}
            >
              + Nuevo Color
            </button>
            <button
              type="button"
              className="btn-ghost px-3 py-2 text-xs"
              onClick={() => setShowNewBrand(true)}
            >
              + Nueva Marca
            </button>
            {selectedBrandObj && (
              <button
                type="button"
                className="btn-ghost px-3 py-2 text-xs"
                onClick={() => openEditBrandModal(selectedBrandObj)}
              >
                ✏️ Editar {selectedBrandObj.name}
              </button>
            )}
            {view === 'estampadas' && (
              <button
                type="button"
                className="btn-amber px-3 py-2 text-xs"
                onClick={openNewReadyModal}
              >
                + Agregar Prenda Estampada
              </button>
            )}
          </div>
        </div>

        <input
          className="input"
          placeholder="Buscar por marca, color o SKU..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="grid grid-cols-3 gap-2">
          <select
            className="input px-2"
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            aria-label="Filtrar por marca"
          >
            <option value="all">Todas las marcas</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>

          <select
            className="input px-2"
            value={colorFilter}
            onChange={(e) => setColorFilter(e.target.value)}
            aria-label="Filtrar por color"
          >
            <option value="all">Todos los colores</option>
            {colorNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>

          <select
            className="input px-2"
            value={sizeFilter}
            onChange={(e) => setSizeFilter(e.target.value)}
            aria-label="Filtrar por talla"
          >
            <option value="all">Todas las tallas</option>
            {settings.sizes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {view === 'estampadas' ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-indigo-200 bg-indigo-50/70 p-3.5 text-xs text-indigo-950">
            <div className="max-w-2xl">
              <p className="font-extrabold">👕 Stock de Prendas Ya Estampadas (Disponibles para Entrega Inmediata)</p>
              <p className="mt-1 text-slate-600">
                Estas camisas ya tienen un diseño impreso (devoluciones contra entrega o prendas listas para vitrina). Puedes agregar nuevas, editar su precio/talla/cantidad o descontarlas al venderlas.
              </p>
            </div>
            <button
              type="button"
              onClick={openNewReadyModal}
              className="btn-primary px-3.5 py-2 text-xs"
            >
              + Agregar Prenda Estampada
            </button>
          </div>

          {readyMadeList.length === 0 ? (
            <Empty icon="👕" text="No hay prendas ya estampadas en stock" />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {readyMadeList.map((r) => (
                <div key={r.id} className="card space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-3">
                      <div
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-slate-200 shadow-inner"
                        style={{ backgroundColor: r.colorHex }}
                      >
                        <span className="text-xl">👕</span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="rounded-lg bg-slate-900 px-2 py-0.5 text-xs font-black text-white">
                            TALLA {r.size}
                          </span>
                          <span className="text-sm font-black text-slate-900">
                            {r.brandName} · {r.colorName}
                          </span>
                        </div>
                        <div className="mt-1 text-xs font-bold text-indigo-700">
                          Diseño: {r.designName}
                        </div>
                        {r.notes && (
                          <div className="mt-0.5 text-[11px] text-slate-400">
                            {r.notes}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-base font-black text-slate-900">{money(r.price)}</div>
                      <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-extrabold text-emerald-800">
                        {r.qty} ud{r.qty > 1 ? 's' : ''} disponible
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEditReadyModal(r)}
                        className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                      >
                        ✏️ Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          removeReadyMadeShirt(r.id, r.qty);
                          toast('Prenda descartada del inventario');
                        }}
                        className="rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100"
                        title="Eliminar del inventario"
                      >
                        🗑️ Borrar
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        removeReadyMadeShirt(r.id, 1);
                        toast(`1 ud de ${r.designName} (${r.size}) descontada por venta`, 'ok');
                      }}
                      className="rounded-xl bg-slate-900 px-3.5 py-1.5 text-xs font-extrabold text-white shadow hover:bg-slate-800"
                    >
                      ✓ Vendida (-1)
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : rows.length === 0 ? (
        <div className="card space-y-3 text-center">
          <Empty icon="👕" text="Sin colores o variantes que coincidan con el filtro" />
          <div className="flex justify-center gap-2">
            <button
              type="button"
              className="btn-primary px-4 py-2 text-xs"
              onClick={() => {
                setNewColorBrandId(brandFilter !== 'all' ? brandFilter : brands[0]?.id);
                setShowNewColor(true);
              }}
            >
              + Agregar Color Ahora
            </button>
          </div>
        </div>
      ) : view === 'matriz' ? (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase text-slate-600">
                <th className="sticky left-0 z-10 bg-slate-50 px-3 py-3">Marca · Color (Editable)</th>
                {visibleSizes.map((sz) => (
                  <th key={sz} className="px-2 py-3 text-center">
                    {sz}
                  </th>
                ))}
                <th className="px-3 py-3 text-right">Total</th>
                <th className="px-3 py-3 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(({ brand, color }) => {
                const rowTotal = visibleSizes.reduce(
                  (s, sz) => s + (stock.get(vkey(brand.id, color.id, sz)) || 0),
                  0
                );
                return (
                  <tr key={`${brand.id}-${color.id}`} className="hover:bg-slate-50/70">
                    <td className="sticky left-0 z-10 bg-white px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <ColorSwatchPicker
                          hex={color.hex}
                          title={`Cambiar tono de ${color.name}`}
                          onChange={(hex: string) => updateColor(color.id, { hex })}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openEditColorModal(color)}
                              className="truncate font-extrabold text-slate-900 hover:text-brand-700 hover:underline"
                              title="Clic para editar nombre o color"
                            >
                              {color.name}
                            </button>
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-500">
                              {color.code}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 text-xs text-slate-500">
                            <button
                              type="button"
                              onClick={() => openEditBrandModal(brand)}
                              className="font-semibold hover:text-slate-800 hover:underline"
                              title="Clic para editar marca"
                            >
                              {brand.name}
                            </button>
                            <span>· {money(normalPrice(settings, brand))}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    {visibleSizes.map((sz) => {
                      const k = vkey(brand.id, color.id, sz);
                      const val = stock.get(k) || 0;
                      return (
                        <td key={sz} className="px-1.5 py-2 text-center">
                          <CompactStockCell
                            value={val}
                            onCommit={(n) => setStockAbsolute(k, n)}
                            label={`${brand.name} ${color.name} ${sz}`}
                          />
                        </td>
                      );
                    })}
                    <td className="px-3 py-2.5 text-right font-extrabold text-slate-900">{rowTotal}</td>
                    <td className="px-2 py-2.5 text-center">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditColorModal(color)}
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
                          title={`Editar ${color.name}`}
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteColor(color)}
                          className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100"
                          title={`Eliminar ${color.name}`}
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map(({ brand, color, sizes }) => {
            const colorTotal = sizes.reduce(
              (s, sz) => s + (stock.get(vkey(brand.id, color.id, sz)) || 0),
              0
            );
            return (
              <div key={`${brand.id}-${color.id}`} className="card space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <ColorSwatchPicker
                      hex={color.hex}
                      title={`Cambiar tono de ${color.name}`}
                      onChange={(hex: string) => updateColor(color.id, { hex })}
                    />
                    <div>
                      <div className="flex items-center gap-2 font-extrabold text-slate-900">
                        <span>{brand.name} · {color.name}</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-500">
                          {color.code}
                        </span>
                      </div>
                      <div className="text-xs font-semibold text-slate-500">
                        {money(normalPrice(settings, brand))} · Mayorista {money(settings.priceWholesale)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="rounded-xl bg-slate-100 px-3 py-1.5 text-sm font-extrabold text-slate-800">
                      {colorTotal} uds
                    </span>
                    <button
                      type="button"
                      onClick={() => openEditColorModal(color)}
                      className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
                    >
                      ✏️ Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteColor(color)}
                      className="rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100"
                    >
                      🗑️ Eliminar
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                  {sizes.map((sz) => {
                    const k = vkey(brand.id, color.id, sz);
                    const val = stock.get(k) || 0;
                    const sku = skuOf(brand, color, sz);
                    return (
                      <div
                        key={sz}
                        className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2"
                      >
                        <div>
                          <div className="text-base font-extrabold text-slate-900">{sz}</div>
                          <div className="font-mono text-xs text-slate-400">{sku}</div>
                        </div>
                        <Stepper
                          size="sm"
                          value={val}
                          onCommit={(n) => setStockAbsolute(k, n)}
                          ariaLabel={`Stock ${sku}`}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Crear Nuevo Color */}
      <NewColorModal
        open={showNewColor}
        onClose={() => setShowNewColor(false)}
        brandId={newColorBrandId || brands[0]?.id || ''}
      />

      {/* Modal Editar Color (Viejos y Nuevos) */}
      <Modal
        open={!!editingColor}
        onClose={() => setEditingColor(null)}
        title={`Editar Color · ${editingColor?.name || ''}`}
      >
        {editingColor && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="label">Nombre del color</label>
                <input
                  className="input"
                  value={editColorName}
                  onChange={(e) => setEditColorName(e.target.value)}
                  placeholder="Ej. Negro, Beige Arena, Terracota..."
                />
              </div>
              <div>
                <label className="label">Código SKU</label>
                <input
                  className="input uppercase"
                  maxLength={4}
                  value={editColorCode}
                  onChange={(e) => setEditColorCode(e.target.value.toUpperCase())}
                  placeholder="NEG"
                />
              </div>
            </div>

            <div>
              <label className="label">Tono de la tela (Hex)</label>
              <div className="flex items-center gap-3">
                <label className="relative flex h-12 w-16 cursor-pointer items-center justify-center rounded-xl border border-slate-300 shadow-inner" style={{ backgroundColor: editColorHex }}>
                  <input
                    type="color"
                    className="sr-only"
                    value={editColorHex.startsWith('#') && editColorHex.length === 7 ? editColorHex : '#1A1A1C'}
                    onChange={(e) => setEditColorHex(e.target.value.toUpperCase())}
                  />
                </label>
                <input
                  className="input font-mono uppercase"
                  value={editColorHex}
                  onChange={(e) => setEditColorHex(e.target.value.toUpperCase())}
                  placeholder="#1A1A1C"
                />
              </div>
            </div>

            <div>
              <label className="label">Paleta rápida de tonos textiles</label>
              <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8">
                {[...BASE_COLORS, ...QUICK_PALETTE].map((p) => (
                  <button
                    key={`${p.name}-${p.hex}`}
                    type="button"
                    onClick={() => {
                      setEditColorHex(p.hex.toUpperCase());
                    }}
                    className={`flex flex-col items-center gap-1 rounded-xl border p-1.5 text-[10px] font-bold transition ${
                      editColorHex.toUpperCase() === p.hex.toUpperCase()
                        ? 'border-brand-700 bg-brand-50 ring-2 ring-brand-500/30'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                    title={`${p.name} (${p.hex})`}
                  >
                    <span
                      className="h-5 w-5 rounded-full border border-black/15"
                      style={{ backgroundColor: p.hex }}
                    />
                    <span className="w-full truncate text-center">{p.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                className="btn-danger px-3 py-2 text-xs"
                onClick={() => {
                  const target = editingColor;
                  setEditingColor(null);
                  setConfirmDeleteColor(target);
                }}
              >
                🗑️ Eliminar este color
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setEditingColor(null)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleSaveEditColor}
                >
                  Guardar cambios
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Confirmar Eliminar Color */}
      <Confirm
        open={!!confirmDeleteColor}
        onClose={() => setConfirmDeleteColor(null)}
        title="Eliminar color"
        text={
          confirmDeleteColor
            ? `¿Seguro que deseas eliminar el color "${confirmDeleteColor.name}"? Desaparecerá de la matriz, del inventario y del catálogo.`
            : ''
        }
        confirmLabel="Sí, eliminar color"
        danger
        onConfirm={() => {
          if (confirmDeleteColor) {
            deleteColor(confirmDeleteColor.id);
            toast(`Color "${confirmDeleteColor.name}" eliminado`, 'ok');
          }
        }}
      />

      {/* Modal Nueva Marca */}
      <Modal
        open={showNewBrand}
        onClose={() => setShowNewBrand(false)}
        title="Agregar Nueva Marca"
      >
        <div className="space-y-3">
          <div>
            <label className="label">Nombre de la marca</label>
            <input
              className="input"
              placeholder="Ej. Gildan Heavy Cotton"
              value={newBrandName}
              onChange={(e) => setNewBrandName(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Código corto (2 a 4 letras para SKU)</label>
            <input
              className="input uppercase"
              maxLength={4}
              placeholder="Ej. GL"
              value={newBrandCode}
              onChange={(e) => setNewBrandCode(e.target.value.toUpperCase())}
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-bold text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded accent-brand-700"
              checked={newBrandSeedColors}
              onChange={(e) => setNewBrandSeedColors(e.target.checked)}
            />
            <span>Incluir los 8 colores base iniciales (editables y eliminables)</span>
          </label>
          <button
            type="button"
            className="btn-primary w-full"
            onClick={handleCreateBrand}
          >
            Crear Marca
          </button>
        </div>
      </Modal>

      {/* Modal Editar Marca */}
      <Modal
        open={!!editingBrand}
        onClose={() => setEditingBrand(null)}
        title={`Editar Marca · ${editingBrand?.name || ''}`}
      >
        {editingBrand && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="label">Nombre de la marca</label>
                <input
                  className="input"
                  value={editBrandName}
                  onChange={(e) => setEditBrandName(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Código SKU</label>
                <input
                  className="input uppercase"
                  maxLength={4}
                  value={editBrandCode}
                  onChange={(e) => setEditBrandCode(e.target.value.toUpperCase())}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Costo unitario (L)</label>
                <input
                  type="number"
                  className="input"
                  value={editBrandCost}
                  onChange={(e) => setEditBrandCost(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Precio venta (vacío = general)</label>
                <input
                  type="number"
                  className="input"
                  placeholder={String(fromCents(settings.priceNormal))}
                  value={editBrandPrice}
                  onChange={(e) => setEditBrandPrice(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
              {brands.length > 1 ? (
                <button
                  type="button"
                  className="btn-danger px-3 py-2 text-xs"
                  onClick={() => {
                    const b = editingBrand;
                    setEditingBrand(null);
                    setConfirmDeleteBrand(b);
                  }}
                >
                  🗑️ Eliminar marca
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button type="button" className="btn-ghost" onClick={() => setEditingBrand(null)}>
                  Cancelar
                </button>
                <button type="button" className="btn-primary" onClick={handleSaveEditBrand}>
                  Guardar marca
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Confirmar Eliminar Marca */}
      <Confirm
        open={!!confirmDeleteBrand}
        onClose={() => setConfirmDeleteBrand(null)}
        title="Eliminar marca"
        text={
          confirmDeleteBrand
            ? `¿Eliminar la marca "${confirmDeleteBrand.name}"? El historial de pedidos se conservará.`
            : ''
        }
        confirmLabel="Eliminar marca"
        danger
        onConfirm={() => {
          if (confirmDeleteBrand) {
            deleteBrand(confirmDeleteBrand.id);
            if (brandFilter === confirmDeleteBrand.id) setBrandFilter('all');
            toast(`Marca "${confirmDeleteBrand.name}" eliminada`, 'ok');
          }
        }}
      />

      {/* Modal Crear / Editar Prenda Ya Estampada */}
      <Modal
        open={showReadyModal}
        onClose={() => setShowReadyModal(false)}
        title={editingReady ? 'Editar Prenda Ya Estampada' : 'Agregar Prenda Ya Estampada'}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Marca</label>
              <select
                className="input"
                value={rmBrandId}
                onChange={(e) => {
                  const nextBrandId = e.target.value;
                  setRmBrandId(nextBrandId);
                  const cols = brandColors(state, nextBrandId);
                  if (cols[0]) setRmColorId(cols[0].id);
                }}
              >
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Color</label>
              <select
                className="input"
                value={rmColorId}
                onChange={(e) => setRmColorId(e.target.value)}
              >
                {(rmBrandId ? brandColors(state, rmBrandId) : []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="label">Talla</label>
              <select className="input" value={rmSize} onChange={(e) => setRmSize(e.target.value)}>
                {settings.sizes.map((sz) => (
                  <option key={sz} value={sz}>
                    {sz}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Cantidad</label>
              <input
                type="number"
                min={1}
                className="input"
                value={rmQty}
                onChange={(e) => setRmQty(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Precio (L)</label>
              <input
                type="number"
                min={0}
                className="input"
                value={rmPrice}
                onChange={(e) => setRmPrice(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="label">Nombre del diseño estampado</label>
            <input
              className="input"
              placeholder="Ej. Rancho Sin Miedo al Sol (Espalda A3)"
              value={rmDesignName}
              onChange={(e) => setRmDesignName(e.target.value)}
            />
          </div>

          <div>
            <label className="label">Notas (opcional)</label>
            <input
              className="input"
              placeholder="Ej. Devolución contra entrega / Lista en vitrina"
              value={rmNotes}
              onChange={(e) => setRmNotes(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setShowReadyModal(false)}>
              Cancelar
            </button>
            <button type="button" className="btn-primary" onClick={handleSaveReadyMade}>
              Guardar prenda
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function CompactStockCell({
  value,
  onCommit,
  label
}: {
  value: number;
  onCommit: (n: number) => void;
  label: string;
}) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);

  const commit = (raw: string) => {
    const n = Math.max(0, Math.floor(Number(raw) || 0));
    setText(String(n));
    if (n !== value) onCommit(n);
  };

  return (
    <div className="inline-flex items-center gap-0.5">
      <button
        type="button"
        className="flex h-12 w-8 items-center justify-center rounded-l-lg bg-slate-100 font-bold text-slate-700 active:bg-slate-200 disabled:opacity-40"
        disabled={value <= 0}
        onClick={() => onCommit(Math.max(0, value - 1))}
        aria-label={`Restar ${label}`}
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        aria-label={label}
        className="h-12 w-12 border-y border-slate-200 bg-white text-center font-bold text-slate-900 outline-none focus:border-brand-600"
        value={text}
        onFocus={(e) => {
          focused.current = true;
          e.currentTarget.select();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => {
          focused.current = false;
          commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      <button
        type="button"
        className="flex h-12 w-8 items-center justify-center rounded-r-lg bg-brand-100 font-bold text-brand-900 active:bg-brand-200"
        onClick={() => onCommit(value + 1)}
        aria-label={`Sumar ${label}`}
      >
        +
      </button>
    </div>
  );
}
