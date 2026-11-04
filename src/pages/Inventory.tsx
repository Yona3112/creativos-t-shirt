import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppState, useStock } from '../lib/store';
import { activeBrands, brandColors, normalPrice, skuOf, vkey } from '../lib/inventory';
import { setStockAbsolute } from '../lib/actions';
import { money } from '../lib/money';
import { ColorDot, Empty, Stepper } from '../components/ui';

export default function Inventory() {
  const state = useAppState();
  const { stock } = useStock();
  const { settings } = state;
  const brands = activeBrands(state);

  const [view, setView] = useState<'matriz' | 'tarjetas'>('matriz');
  const [query, setQuery] = useState('');
  const [brandFilter, setBrandFilter] = useState('all');
  const [colorFilter, setColorFilter] = useState('all');
  const [sizeFilter, setSizeFilter] = useState('all');

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

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="grid flex-1 grid-cols-2 gap-2">
            <button
              className={`chip ${view === 'matriz' ? 'chip-on' : 'chip-off'}`}
              onClick={() => setView('matriz')}
            >
              📊 Vista Matriz
            </button>
            <button
              className={`chip ${view === 'tarjetas' ? 'chip-on' : 'chip-off'}`}
              onClick={() => setView('tarjetas')}
            >
              🗂 Vista Tarjetas
            </button>
          </div>
          <div className="rounded-xl bg-brand-50 px-3 py-2 text-sm font-extrabold text-brand-900">
            Existencias: {totalUnits}
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

      {rows.length === 0 ? (
        <Empty icon="👕" text="Sin variantes que coincidan" />
      ) : view === 'matriz' ? (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase text-slate-600">
                <th className="sticky left-0 z-10 bg-slate-50 px-3 py-3">Marca · Color</th>
                {visibleSizes.map((sz) => (
                  <th key={sz} className="px-2 py-3 text-center">
                    {sz}
                  </th>
                ))}
                <th className="px-3 py-3 text-right">Total</th>
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
                      <div className="flex items-center gap-2">
                        <ColorDot hex={color.hex} size={20} />
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900">{brand.name}</div>
                          <div className="text-xs text-slate-500">
                            {color.name} · {money(normalPrice(settings, brand))}
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
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <ColorDot hex={color.hex} size={26} />
                    <div>
                      <div className="font-extrabold text-slate-900">
                        {brand.name} · {color.name}
                      </div>
                      <div className="text-xs font-semibold text-slate-500">
                        {money(normalPrice(settings, brand))} · Mayorista {money(settings.priceWholesale)}
                      </div>
                    </div>
                  </div>
                  <span className="rounded-xl bg-slate-100 px-3 py-1 text-sm font-extrabold text-slate-800">
                    {colorTotal} uds
                  </span>
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
