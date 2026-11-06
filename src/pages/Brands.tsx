import { useEffect, useState } from 'react';
import { useAppState, useStock } from '../lib/store';
import { activeBrands, brandColors, normalPrice, vkey } from '../lib/inventory';
import { setStockAbsolute, updateBrand, updateColor, updateSettings, deleteColor, addBrand, deleteBrand } from '../lib/actions';
import { MoneyInput, Stepper, toast } from '../components/ui';
import { ColorSwatchPicker, ShirtPreview } from '../components/Shirt';
import { NewColorModal } from '../components/NewColorModal';

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
  const [editingColor, setEditingColor] = useState<{ id: string; name: string; hex: string } | null>(null);
  const [confirmDeleteColor, setConfirmDeleteColor] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (!colors.some((c) => c.id === previewColorId)) {
      setPreviewColorId(colors[0]?.id || '');
    }
  }, [brand?.id, colors, previewColorId]);

  const activeColor = colors.find((c) => c.id === previewColorId) || colors[0];

  const brandTotalStock = colors.reduce(
    (sum, c) =>
      sum +
      settings.sizes.reduce((s, sz) => s + (stock.get(vkey(brand.id, c.id, sz)) || 0), 0),
    0
  );

  return (
    <div className="space-y-4">
      {/* Precios generales */}
      <section className="card space-y-3">
        <h2 className="section-title mb-0">Precios Generales</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="label">Normal 1–{settings.wholesaleMin - 1} uds</label>
            <MoneyInput
              ariaLabel="Precio normal general"
              value={settings.priceNormal}
              onChange={(c) => c !== null && updateSettings({ priceNormal: c })}
            />
          </div>
          <div>
            <label className="label">Mayorista {settings.wholesaleMin}+ uds</label>
            <MoneyInput
              ariaLabel="Precio mayorista general"
              value={settings.priceWholesale}
              onChange={(c) => c !== null && updateSettings({ priceWholesale: c })}
            />
          </div>
          <div>
            <label className="label">Envío</label>
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
          <div className="flex items-center gap-2">
            <h2 className="section-title mb-0">Marca</h2>
            {brand && (
              <button
                type="button"
                onClick={() => {
                  const newName = window.prompt(`Nuevo nombre para la marca "${brand.name}":`, brand.name);
                  if (newName && newName.trim() && newName.trim() !== brand.name) {
                    updateBrand(brand.id, { name: newName.trim() });
                    toast(`Marca renombrada a "${newName.trim()}"`);
                  }
                }}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
                title="Renombrar esta marca"
              >
                ✏️ Renombrar
              </button>
            )}
            {brands.length > 1 && brand && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`¿Eliminar la marca "${brand.name}"? Los colores asociados se ocultarán.`)) {
                    deleteBrand(brand.id);
                    toast(`Marca "${brand.name}" eliminada`);
                  }
                }}
                className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-bold text-rose-700 hover:bg-rose-100"
                title="Eliminar esta marca"
              >
                🗑️ Eliminar
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const name = window.prompt('Nombre de la nueva marca (ej. Gildan Softstyle):');
                if (!name || !name.trim()) return;
                const code = window.prompt('Código corto de 2 a 4 letras (ej. GIL):', name.slice(0, 3).toUpperCase());
                const newId = addBrand(name.trim(), code || name.slice(0, 3).toUpperCase());
                if (newId) {
                  setBrandId(newId);
                  toast(`Marca "${name.trim()}" agregada`, 'ok');
                } else {
                  toast('No se pudo crear la marca (nombre o código ya existe)', 'error');
                }
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

      {/* Vista previa de camisa + selector de colores */}
      {brand && (
        <section className="card">
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <ShirtPreview
              hex={activeColor?.hex || '#e5e7eb'}
              size={145}
              label={activeColor ? `${brand.name} · ${activeColor.name}` : brand.name}
            />
            <div className="flex-1 space-y-3">
              <div className="flex flex-wrap gap-2">
                {colors.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`inline-flex min-h-[48px] items-center gap-2 rounded-xl border-2 px-3 font-semibold ${
                      c.id === activeColor?.id
                        ? 'border-brand-700 bg-brand-50 text-brand-900'
                        : 'border-slate-200 bg-white text-slate-700'
                    }`}
                    onClick={() => setPreviewColorId(c.id)}
                  >
                    <span
                      className="h-5 w-5 rounded-full border border-black/15"
                      style={{ background: c.hex }}
                    />
                    {c.name}
                  </button>
                ))}
                <button
                  type="button"
                  className="btn-soft min-h-[48px]"
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
                        <button
                          type="button"
                          title={`Editar nombre y tono de ${c.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingColor({ id: c.id, name: c.name, hex: c.hex });
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

      {/* Modal para editar nombre y código hexadecimal de color */}
      {editingColor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-slate-900">Editar Color</h3>
              <button
                type="button"
                onClick={() => setEditingColor(null)}
                className="rounded-full p-1 text-slate-400 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>
            <div>
              <label className="label">Nombre del color</label>
              <input
                className="input"
                value={editingColor.name}
                onChange={(e) => setEditingColor({ ...editingColor, name: e.target.value })}
                placeholder="Ej. Negro Carbón, Azul Marino"
              />
            </div>
            <div>
              <label className="label">Tono Hexadecimal</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  className="h-10 w-12 cursor-pointer rounded-xl border border-slate-200 p-0.5"
                  value={editingColor.hex}
                  onChange={(e) => setEditingColor({ ...editingColor, hex: e.target.value })}
                />
                <input
                  className="input font-mono uppercase"
                  value={editingColor.hex}
                  onChange={(e) => setEditingColor({ ...editingColor, hex: e.target.value })}
                  placeholder="#000000"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
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
                  updateColor(editingColor.id, {
                    name: editingColor.name.trim(),
                    hex: editingColor.hex
                  });
                  toast('Color actualizado', 'ok');
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

      {/* Modal para confirmar eliminación de color */}
      {confirmDeleteColor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl">
            <h3 className="text-base font-extrabold text-slate-900">¿Eliminar este color?</h3>
            <p className="text-xs text-slate-600">
              ¿Deseas eliminar el color <strong>"{confirmDeleteColor.name}"</strong>?
              Se ocultará de la lista y del catálogo del cliente.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteColor(null)}
                className="btn-ghost text-xs"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  deleteColor(confirmDeleteColor.id);
                  toast(`Color "${confirmDeleteColor.name}" eliminado`);
                  setConfirmDeleteColor(null);
                }}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow hover:bg-rose-700"
              >
                Sí, eliminar color
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
