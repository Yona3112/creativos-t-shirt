import { useEffect, useState } from 'react';
import { Modal, toast } from './ui';
import { ShirtPreview } from './Shirt';
import { QUICK_PALETTE } from '../lib/seed';
import { addColor } from '../lib/actions';
import { activeBrands } from '../lib/inventory';
import { useAppState } from '../lib/store';

export function NewColorModal({
  open,
  onClose,
  brandId,
  onAdded
}: {
  open: boolean;
  onClose: () => void;
  brandId: string;
  onAdded?: (name: string) => void;
}) {
  const state = useAppState();
  const brands = activeBrands(state);
  const brand = brands.find((b) => b.id === brandId);
  const [name, setName] = useState('');
  const [hex, setHex] = useState('#EA580C');
  const [allBrands, setAllBrands] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setHex('#EA580C');
      setAllBrands(false);
    }
  }, [open]);

  const save = () => {
    if (!name.trim()) return toast('Escribe el nombre del color', 'error');
    const targets = allBrands ? brands.map((b) => b.id) : [brandId];
    const r = addColor(name, hex, targets);
    if (!r.added) return toast('Ese color ya existe', 'error');
    toast(r.added > 1 ? `Color agregado a ${r.added} marcas` : 'Color agregado');
    onAdded?.(name.trim());
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="+ Nuevo color"
      footer={
        <button className="btn-primary w-full" onClick={save}>
          Guardar color
        </button>
      }
    >
      <div className="flex items-center gap-4">
        <ShirtPreview hex={hex} size={120} />
        <div className="flex-1 space-y-3">
          <div>
            <label className="label" htmlFor="nc-name">
              Nombre
            </label>
            <input id="nc-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Naranja" />
          </div>
          <label className="flex min-h-[48px] items-center gap-3 rounded-xl border border-slate-300 px-3">
            <input type="color" className="h-9 w-12 cursor-pointer rounded" value={hex.toLowerCase()} onChange={(e) => setHex(e.target.value.toUpperCase())} />
            <span className="font-mono text-sm font-semibold">{hex}</span>
          </label>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-4 gap-2">
        {QUICK_PALETTE.map((p) => (
          <button
            key={p.hex + p.name}
            type="button"
            className={`flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-xl border-2 text-xs font-semibold ${
              hex === p.hex && name === p.name ? 'border-brand-700 bg-brand-50' : 'border-slate-200 bg-white'
            }`}
            onClick={() => {
              setHex(p.hex);
              setName(p.name);
            }}
          >
            <span className="h-7 w-7 rounded-full border border-black/15" style={{ background: p.hex }} />
            {p.name}
          </button>
        ))}
      </div>
      {brands.length > 1 && (
        <label className="mt-4 flex min-h-[48px] items-center gap-3 rounded-xl bg-slate-50 px-3 font-semibold">
          <input type="checkbox" className="h-6 w-6 accent-brand-700" checked={allBrands} onChange={(e) => setAllBrands(e.target.checked)} />
          Agregar a las {brands.length} marcas a la vez
        </label>
      )}
      {!allBrands && brand && <p className="mt-2 text-sm text-slate-500">Se agregará a {brand.name}</p>}
    </Modal>
  );
}
