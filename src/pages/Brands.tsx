import { useEffect, useState } from 'react';
import { useAppState, useStock } from '../lib/store';
import { activeBrands, brandColors, normalPrice, vkey } from '../lib/inventory';
import { setStockAbsolute, updateBrand, updateColor, updateSettings, deleteColor, addBrand, deleteBrand } from '../lib/actions';
import { Confirm, Modal, MoneyInput, Stepper, toast } from '../components/ui';
import { ColorSwatchPicker, ShirtPreview } from '../components/Shirt';
import { NewColorModal } from '../components/NewColorModal';
import { BASE_COLORS, QUICK_PALETTE } from '../lib/seed';

export default function Brands() {
  const state = useAppState();
  const { stock } = useStock();
  const { settings } = state;
  const brands = activeBrands(state);

  const [brandId, setBrandId] = useState(brands[0]?.id || '');
  const brand = brands.find((b) => b.id === brandId) || brands[0];
  const colors = brand ? brandColors(state, brand.id) : [];

  const [previewColorId, setPreviewColorId] = useState(colors[0]?.id || '');
  const [colorModal, setColorModal] = useState(false);
  const [editingColor, setEditingColor] = useState<{ id: string; name: string; hex: string; code: string } | null>(null);
  const [confirmDeleteColor, setConfirmDeleteColor] = useState<{ id: string; name: string } | null>(null);

  // Modales de Marca (sin depender de window.prompt bloqueado en móviles/navegadores)
  const [showNewBrand, setShowNewBrand] = useState(false);
  const [newBrandName, setNewBrandName] = useState('');
  const [newBrandCode, setNewBrandCode] = useState('');
  const [newBrandSeedColors, setNewBrandSeedColors] = useState(true);
  const [editingBrand, setEditingBrand] = useState<{ id: string; name: string; code: string } | null>(null);
  const [confirmDeleteBrand, setConfirmDeleteBrand] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (!colors.some((c) => c.id === previewColorId)) {
      setPreviewColorId(colors[0]?.id || '');
    }
  }, [brand?.id, colors, previewColorId]);

  const activeColor = colors.find((c) => c.id === previewColorId) || colors[0];

  const brandTotalStock = brand
    ? colors.reduce(
        (sum, c) =>
          sum +
          settings.sizes.reduce((s, sz) => s + (stock.get(vkey(brand.id, c.id, sz)) || 0), 0),
        0
      )
    : 0;

  return (
    <div className="space-y-4">
      {/* Precios generales */}
      <section className="card space-y-3">
        <h2 className="section-title mb-0">Precios Generales</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div>
            <label className="label">Normal 1–{settings.wholesaleMin - 1} uds (L)</label>
            <MoneyInput
              ariaLabel="Precio normal general"
              value={settings.priceNormal}
              onChange={(c) => c !== null && updateSettings({ priceNormal: c })}
            />
          </div>
          <div>
            <label className="label">Personalizada (L)</label>
            <MoneyInput
              ariaLabel="Precio personalizada"
              value={settings.priceCustom || 35000}
              onChange={(c) => c !== null && updateSettings({ priceCustom: c })}
            />
          </div>
          <div>
            <label className="label">Mayorista {settings.wholesaleMin}+ uds (L)</label>
            <MoneyInput
              ariaLabel="Precio mayorista general"
              value={settings.priceWholesale}
              onChange={(c) => c !== null && updateSettings({ priceWholesale: c })}
            />
          </div>
          <div>
            <label className="label">Envío (L)</label>
            <MoneyInput
              ariaLabel="Precio de envío"
              value={settings.shipping}
              onChange={(c) => c !== null && updateSettings({ shipping: c })}
            />
          </div>
        </div>
      </section>

      {/* Selector y administración de marca */}
      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="section-title mb-0">Marca</h2>
            {brand && (
              <button
                type="button"
                onClick={() => setEditingBrand({ id: brand.id, name: brand.name, code: brand.code })}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-100"
                title="Editar nombre y código de esta marca"
              >
                ✏️ Editar Marca
              </button>
            )}
            {brands.length > 1 && brand && (
              <button
                type="button"
                onClick={() => setConfirmDeleteBrand({ id: brand.id, name: brand.name })}
                className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700 hover:bg-rose-100"
                title="Eliminar esta marca"
              >
                🗑️ Eliminar Marca
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setNewBrandName('');
                setNewBrandCode('');
                setNewBrandSeedColors(true);
                setShowNewBrand(true);
              }}
              className="btn-soft text-xs font-bold"
            >
              + Nueva Marca
            </button>
            <span className="rounded-xl bg-brand-50 px-3 py-1 text-sm font-extrabold text-brand-900">
              Existencias: {brandTotalStock}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {brands.map((b) => (
            <button
              key={b.id}
              className={`chip ${b.id === brand?.id ? 'chip-on' : 'chip-off'}`}
              onClick={() => setBrandId(b.id)}
            >
              {b.name}
            </button>
          ))}
        </div>

        {brand && (
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <label className="label">Precio {brand.name} (L)</label>
              <MoneyInput
                ariaLabel={`Precio ${brand.name}`}
                value={normalPrice(settings, brand)}
                onChange={(c) => c !== null && updateBrand(brand.id, { priceOverride: c })}
              />
            </div>
            <div>
              <label className="label">Costo {brand.name} (L)</label>
              <MoneyInput
                ariaLabel={`Costo ${brand.name}`}
                value={brand.cost}
                onChange={(c) => c !== null && updateBrand(brand.id, { cost: c })}
              />
            </div>
          </div>
        )}
      </section>

      {/* Vista previa de camisa + selector y edición directa de colores */}
      {brand && (
        <section className="card">
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <ShirtPreview
              hex={activeColor?.hex || '#e5e7eb'}
              size={145}
              label={activeColor ? `${brand.name} · ${activeColor.name}` : brand.name}
            />
            <div className="flex-1 space-y-3 w-full">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                  Colores de {brand.name} ({colors.length})
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {activeColor && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          setEditingColor({
                            id: activeColor.id,
                            name: activeColor.name,
                            hex: activeColor.hex,
                            code: activeColor.code || ''
                          })
                        }
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-800 hover:bg-slate-100"
                      >
                        ✏️ Editar "{activeColor.name}"
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteColor({ id: activeColor.id, name: activeColor.name })}
                        className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100"
                      >
                        🗑️ Borrar "{activeColor.name}"
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="btn-primary px-3 py-1.5 text-xs"
                    onClick={() => setColorModal(true)}
                  >
                    + Nuevo color
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {colors.map((c) => {
                  const isSelected = c.id === activeColor?.id;
                  return (
                    <div
                      key={c.id}
                      className={`inline-flex min-h-[46px] items-center gap-1.5 rounded-xl border-2 pl-2.5 pr-1.5 font-semibold transition ${
                        isSelected
                          ? 'border-brand-700 bg-brand-50 text-brand-900 shadow-sm'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setPreviewColorId(c.id)}
                        className="inline-flex items-center gap-2 py-1 text-left text-sm font-bold"
                      >
                        <span
                          className="h-5 w-5 shrink-0 rounded-full border border-black/15"
                          style={{ background: c.hex }}
                        />
                        <span>{c.name}</span>
                      </button>
                      <button
                        type="button"
                        title={`Editar ${c.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewColorId(c.id);
                          setEditingColor({ id: c.id, name: c.name, hex: c.hex, code: c.code || '' });
                        }}
                        className="ml-1 rounded-lg p-1 text-xs text-slate-500 hover:bg-slate-200/70 hover:text-slate-900"
                      >
                        ✏️
                      </button>
                      <button
                        type="button"
                        title={`Eliminar ${c.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteColor({ id: c.id, name: c.name });
                        }}
                        className="rounded-lg p-1 text-xs text-rose-500 hover:bg-rose-100 hover:text-rose-700"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
                <button
                  type="button"
                  className="btn-soft min-h-[46px]"
                  onClick={() => setColorModal(true)}
                >
                  + Nuevo color
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Colores y casillas de stock por talla */}
      {brand && (
        <div className="space-y-3">
          {colors.map((c) => {
            const colorStock = settings.sizes.reduce(
              (s, sz) => s + (stock.get(vkey(brand.id, c.id, sz)) || 0),
              0
            );
            return (
              <section
                key={c.id}
                className="card space-y-3"
                onClick={() => setPreviewColorId(c.id)}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-3">
                    <ColorSwatchPicker
                      hex={c.hex}
                      title={`Cambiar tono de ${c.name}`}
                      onChange={(newHex) => {
                        updateColor(c.id, { hex: newHex });
                        setPreviewColorId(c.id);
                        toast(`Tono actualizado: ${c.name}`);
                      }}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-base font-extrabold text-slate-900">{c.name}</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-500">
                          {c.code}
                        </span>
                        <button
                          type="button"
                          title={`Editar nombre y tono de ${c.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingColor({ id: c.id, name: c.name, hex: c.hex, code: c.code || '' });
                          }}
                          className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
                        >
                          ✏️ Editar
                        </button>
                      </div>
                      <div className="font-mono text-xs text-slate-500">{c.hex}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-xl bg-slate-100 px-3 py-1 text-sm font-extrabold text-slate-800">
                      {colorStock} uds
                    </span>
                    <button
                      type="button"
                      title={`Eliminar color ${c.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteColor({ id: c.id, name: c.name });
                      }}
                      className="rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700 hover:bg-rose-100"
                    >
                      🗑️ Eliminar
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                  {settings.sizes.map((sz) => {
                    const k = vkey(brand.id, c.id, sz);
                    const val = stock.get(k) || 0;
                    return (
                      <div
                        key={sz}
                        className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2"
                      >
                        <span className="text-base font-extrabold text-slate-900">{sz}</span>
                        <Stepper
                          size="sm"
                          value={val}
                          onCommit={(n) => setStockAbsolute(k, n)}
                          ariaLabel={`${brand.name} ${c.name} ${sz}`}
                        />
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {brand && (
        <NewColorModal
          open={colorModal}
          onClose={() => setColorModal(false)}
          brandId={brand.id}
        />
      )}

      {/* Modal para editar nombre, código y tono hexadecimal de cualquier color */}
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
                  value={editingColor.name}
                  onChange={(e) => setEditingColor({ ...editingColor, name: e.target.value })}
                  placeholder="Ej. Negro Carbón, Azul Marino"
                />
              </div>
              <div>
                <label className="label">Código SKU</label>
                <input
                  className="input uppercase"
                  maxLength={4}
                  value={editingColor.code}
                  onChange={(e) => setEditingColor({ ...editingColor, code: e.target.value.toUpperCase() })}
                  placeholder="NEG"
                />
              </div>
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
                    onClick={() => setEditingColor({ ...editingColor, hex: p.hex.toUpperCase() })}
                    className={`flex flex-col items-center gap-1 rounded-xl border p-1.5 text-[10px] font-bold transition ${
                      editingColor.hex.toUpperCase() === p.hex.toUpperCase()
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
            <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => {
                  const target = { id: editingColor.id, name: editingColor.name };
                  setEditingColor(null);
                  setConfirmDeleteColor(target);
                }}
                className="btn-danger px-3 py-2 text-xs"
              >
                🗑️ Eliminar color
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditingColor(null)}
                  className="btn-ghost text-xs"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!editingColor.name.trim()) return toast('El nombre no puede estar vacío', 'error');
                    const cleanHex = editingColor.hex.trim().startsWith('#')
                      ? editingColor.hex.trim().toUpperCase()
                      : `#${editingColor.hex.trim().toUpperCase()}`;
                    updateColor(editingColor.id, {
                      name: editingColor.name.trim(),
                      hex: cleanHex,
                      ...(editingColor.code.trim() ? { code: editingColor.code.trim().toUpperCase().slice(0, 4) } : {})
                    });
                    toast(`Color "${editingColor.name.trim()}" actualizado`, 'ok');
                    setEditingColor(null);
                  }}
                  className="btn-primary text-xs"
                >
                  Guardar Cambios
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal para confirmar eliminación de color */}
      <Confirm
        open={!!confirmDeleteColor}
        onClose={() => setConfirmDeleteColor(null)}
        title="¿Eliminar este color?"
        text={
          confirmDeleteColor
            ? `¿Deseas eliminar el color "${confirmDeleteColor.name}"? Se ocultará de la matriz, del inventario y del catálogo del cliente.`
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
        title="Nueva Marca"
      >
        <div className="space-y-3">
          <div>
            <label className="label">Nombre de la nueva marca</label>
            <input
              className="input"
              placeholder="Ej. Gildan Softstyle"
              value={newBrandName}
              onChange={(e) => setNewBrandName(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Código corto (2 a 4 letras)</label>
            <input
              className="input uppercase"
              maxLength={4}
              placeholder="Ej. GIL"
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
            <span>Crear con los 8 colores base iniciales (listos para editar o borrar)</span>
          </label>
          <button
            type="button"
            className="btn-primary w-full"
            onClick={() => {
              if (!newBrandName.trim()) return toast('Escribe el nombre de la marca', 'error');
              const id = addBrand(
                newBrandName.trim(),
                newBrandCode.trim() || newBrandName.trim().slice(0, 3).toUpperCase(),
                newBrandSeedColors
              );
              if (!id) return toast('No se pudo crear la marca (nombre o código ya existe)', 'error');
              setBrandId(id);
              setShowNewBrand(false);
              toast(`Marca "${newBrandName.trim()}" agregada`, 'ok');
            }}
          >
            Crear Marca
          </button>
        </div>
      </Modal>

      {/* Modal Editar Marca */}
      <Modal
        open={!!editingBrand}
        onClose={() => setEditingBrand(null)}
        title="Editar Marca"
      >
        {editingBrand && (
          <div className="space-y-3">
            <div>
              <label className="label">Nombre de la marca</label>
              <input
                className="input"
                value={editingBrand.name}
                onChange={(e) => setEditingBrand({ ...editingBrand, name: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Código corto SKU</label>
              <input
                className="input uppercase"
                maxLength={4}
                value={editingBrand.code}
                onChange={(e) => setEditingBrand({ ...editingBrand, code: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-ghost" onClick={() => setEditingBrand(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  if (!editingBrand.name.trim()) return toast('Escribe un nombre válido', 'error');
                  updateBrand(editingBrand.id, {
                    name: editingBrand.name.trim(),
                    code: editingBrand.code.trim().toUpperCase().slice(0, 4) || 'MK'
                  });
                  toast(`Marca "${editingBrand.name.trim()}" actualizada`, 'ok');
                  setEditingBrand(null);
                }}
              >
                Guardar
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Confirmar Eliminar Marca */}
      <Confirm
        open={!!confirmDeleteBrand}
        onClose={() => setConfirmDeleteBrand(null)}
        title="Eliminar Marca"
        text={
          confirmDeleteBrand
            ? `¿Eliminar la marca "${confirmDeleteBrand.name}"? Los colores asociados se ocultarán.`
            : ''
        }
        confirmLabel="Eliminar marca"
        danger
        onConfirm={() => {
          if (confirmDeleteBrand) {
            deleteBrand(confirmDeleteBrand.id);
            toast(`Marca "${confirmDeleteBrand.name}" eliminada`, 'ok');
          }
        }}
      />
    </div>
  );
}
