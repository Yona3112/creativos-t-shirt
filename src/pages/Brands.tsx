import { useEffect, useState } from 'react';
import { useAppState, useStock } from '../lib/store';
import { activeBrands, brandColors, normalPrice, vkey } from '../lib/inventory';
import { setStockAbsolute, updateBrand, updateColor, updateSettings } from '../lib/actions';
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

      {/* Selector de marca */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="section-title mb-0">Marca</h2>
          <span className="rounded-xl bg-brand-50 px-3 py-1 text-sm font-extrabold text-brand-900">
            Existencias: {brandTotalStock}
          </span>
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
                <div className="flex items-center justify-between gap-2">
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
                      <div className="text-base font-extrabold text-slate-900">{c.name}</div>
                      <div className="font-mono text-xs text-slate-500">{c.hex}</div>
                    </div>
                  </div>
                  <span className="rounded-xl bg-slate-100 px-3 py-1 text-sm font-extrabold text-slate-800">
                    {colorStock} uds
                  </span>
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
    </div>
  );
}
