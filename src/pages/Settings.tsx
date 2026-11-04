import { useRef, useState } from 'react';
import type { AppState } from '../lib/types';
import { engine, getState, replaceState, useAppState, useStock, useSyncStatus } from '../lib/store';
import { updateSettings } from '../lib/actions';
import { getConfig, pairingLink, saveConfig } from '../lib/sync';
import { activeBrands, brandColors, skuOf, vkey } from '../lib/inventory';
import { copyText, downloadText, toCSV } from '../lib/csv';
import { dayKey } from '../lib/time';
import { MoneyInput, toast } from '../components/ui';

export default function SettingsPage() {
  const state = useAppState();
  const { stock } = useStock();
  const { status, detail } = useSyncStatus();
  const { settings } = state;

  const initialCfg = getConfig();
  const [supaUrl, setSupaUrl] = useState(initialCfg?.url || '');
  const [supaKey, setSupaKey] = useState(initialCfg?.key || '');
  const [testing, setTesting] = useState(false);

  const [newSize, setNewSize] = useState('');
  const [newCarrier, setNewCarrier] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const connectSupabase = async () => {
    const url = supaUrl.trim().replace(/\/+$/, '');
    const key = supaKey.trim();
    if (!url || !key) return toast('Ingresa URL y Anon Key de Supabase', 'error');
    setTesting(true);
    const err = await engine.testConnection({ url, key });
    setTesting(false);
    if (err) return toast(`Error Supabase: ${err}`, 'error');
    saveConfig({ url, key });
    await engine.start({ url, key });
    toast('Conectado en vivo a Supabase');
  };

  const disconnectSupabase = async () => {
    saveConfig(null);
    await engine.stop();
    toast('Modo local activado', 'info');
  };

  const copyPairing = async () => {
    const url = supaUrl.trim().replace(/\/+$/, '');
    const key = supaKey.trim();
    if (!url || !key) return toast('Guarda primero la conexión a Supabase', 'error');
    const link = pairingLink({ url, key });
    await copyText(link);
    toast('Enlace copiado para conectar el Taller');
  };

  const addSize = () => {
    const sz = newSize.trim().toUpperCase();
    if (!sz) return;
    if (settings.sizes.includes(sz)) return toast('Esa talla ya existe', 'error');
    updateSettings({ sizes: [...settings.sizes, sz] });
    setNewSize('');
    toast(`Talla ${sz} agregada`);
  };

  const removeSize = (sz: string) => {
    if (settings.sizes.length <= 1) return;
    updateSettings({ sizes: settings.sizes.filter((s) => s !== sz) });
  };

  const addCarrier = () => {
    const c = newCarrier.trim();
    if (!c) return;
    if (settings.carriers.includes(c)) return toast('Ese transportista ya existe', 'error');
    updateSettings({ carriers: [...settings.carriers, c] });
    setNewCarrier('');
  };

  const exportJson = () => {
    const json = JSON.stringify(getState(), null, 2);
    downloadText(`respaldo-camisas-gift-${dayKey()}.json`, json, 'application/json');
    toast('Respaldo JSON descargado');
  };

  const importJson = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as AppState;
      replaceState(parsed);
      toast('Respaldo restaurado correctamente');
    } catch (e) {
      toast(`Archivo inválido: ${(e as Error).message}`, 'error');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const exportStockCsv = () => {
    const rows: (string | number)[][] = [['Marca', 'Color', 'Hex', 'Talla', 'SKU', 'Existencias']];
    for (const b of activeBrands(state)) {
      for (const c of brandColors(state, b.id)) {
        for (const sz of settings.sizes) {
          rows.push([
            b.name,
            c.name,
            c.hex,
            sz,
            skuOf(b, c, sz),
            stock.get(vkey(b.id, c.id, sz)) || 0
          ]);
        }
      }
    }
    downloadText(`inventario-${dayKey()}.csv`, toCSV(rows));
    toast('Inventario CSV descargado');
  };

  return (
    <div className="space-y-4 pb-6">
      {/* Conexión en Vivo a Supabase */}
      <section className="card space-y-3 border-2 border-brand-200">
        <div className="flex items-center justify-between">
          <h2 className="section-title mb-0">⚡ Conexión en Vivo a Supabase</h2>
          <span className="rounded-full bg-brand-100 px-3 py-1 text-xs font-extrabold text-brand-900">
            {status.toUpperCase()}
          </span>
        </div>
        {detail && <div className="text-xs font-semibold text-red-600">{detail}</div>}

        <div>
          <label className="label">Supabase Project URL</label>
          <input
            className="input font-mono text-sm"
            placeholder="https://xxxx.supabase.co"
            value={supaUrl}
            onChange={(e) => setSupaUrl(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Supabase Anon Public Key</label>
          <input
            className="input font-mono text-sm"
            placeholder="eyJhbGciOi..."
            value={supaKey}
            onChange={(e) => setSupaKey(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button className="btn-primary" onClick={connectSupabase} disabled={testing}>
            {testing ? 'Probando...' : '⚡ Conectar y Sincronizar'}
          </button>
          <button className="btn-soft" onClick={copyPairing}>
            🔗 Copiar Enlace para Conectar el Taller
          </button>
        </div>

        {engine.connected && (
          <button className="btn-ghost w-full text-sm text-slate-600" onClick={disconnectSupabase}>
            Desconectar de la nube
          </button>
        )}
      </section>

      {/* Tienda y Precios */}
      <section className="card space-y-3">
        <h2 className="section-title mb-0">Tienda</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Nombre de la tienda</label>
            <input
              className="input"
              value={settings.storeName}
              onChange={(e) => updateSettings({ storeName: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Teléfono</label>
            <input
              className="input"
              value={settings.storePhone}
              onChange={(e) => updateSettings({ storePhone: e.target.value })}
              placeholder="+504 ..."
            />
          </div>
          <div>
            <label className="label">Dirección</label>
            <input
              className="input"
              value={settings.storeAddress}
              onChange={(e) => updateSettings({ storeAddress: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Ciudad / Departamento</label>
            <input
              className="input"
              value={settings.storeCity}
              onChange={(e) => updateSettings({ storeCity: e.target.value })}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-3">
          <div>
            <label className="label">Precio Normal (L)</label>
            <MoneyInput
              value={settings.priceNormal}
              onChange={(c) => c !== null && updateSettings({ priceNormal: c })}
            />
          </div>
          <div>
            <label className="label">Precio Mayorista (L)</label>
            <MoneyInput
              value={settings.priceWholesale}
              onChange={(c) => c !== null && updateSettings({ priceWholesale: c })}
            />
          </div>
          <div>
            <label className="label">Envío (L)</label>
            <MoneyInput
              value={settings.shipping}
              onChange={(c) => c !== null && updateSettings({ shipping: c })}
            />
          </div>
        </div>
      </section>

      {/* Tallas */}
      <section className="card space-y-3">
        <h2 className="section-title mb-0">Tallas Activas</h2>
        <div className="flex flex-wrap gap-2">
          {settings.sizes.map((sz) => (
            <span
              key={sz}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 font-extrabold"
            >
              {sz}
              {settings.sizes.length > 1 && (
                <button
                  type="button"
                  className="text-slate-400 hover:text-red-600"
                  onClick={() => removeSize(sz)}
                  aria-label={`Quitar ${sz}`}
                >
                  ✕
                </button>
              )}
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="Nueva talla (ej. 3XL, 4XL, Niño M)"
            value={newSize}
            onChange={(e) => setNewSize(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addSize()}
          />
          <button className="btn-primary" onClick={addSize}>
            + Agregar
          </button>
        </div>
      </section>

      {/* Transportistas */}
      <section className="card space-y-3">
        <h2 className="section-title mb-0">Transportistas</h2>
        <div className="flex flex-wrap gap-2">
          {settings.carriers.map((c) => (
            <span
              key={c}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold"
            >
              {c}
              {settings.carriers.length > 1 && (
                <button
                  type="button"
                  className="text-slate-400 hover:text-red-600"
                  onClick={() =>
                    updateSettings({ carriers: settings.carriers.filter((x) => x !== c) })
                  }
                >
                  ✕
                </button>
              )}
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="Nuevo transportista"
            value={newCarrier}
            onChange={(e) => setNewCarrier(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCarrier()}
          />
          <button className="btn-soft" onClick={addCarrier}>
            + Agregar
          </button>
        </div>
      </section>

      {/* Plantillas de WhatsApp */}
      <section className="card space-y-3">
        <h2 className="section-title mb-0">Plantillas de WhatsApp</h2>
        <div>
          <label className="label">Pedido enviado con guía</label>
          <textarea
            className="input min-h-[110px] py-2"
            value={settings.waShipped}
            onChange={(e) => updateSettings({ waShipped: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Pedido listo</label>
          <textarea
            className="input min-h-[90px] py-2"
            value={settings.waReady}
            onChange={(e) => updateSettings({ waReady: e.target.value })}
          />
        </div>
      </section>

      {/* Respaldo JSON y CSV */}
      <section className="card space-y-3">
        <h2 className="section-title mb-0">Respaldo y Exportación</h2>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => importJson(e.target.files?.[0])}
        />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <button className="btn-primary" onClick={exportJson}>
            💾 Exportar JSON
          </button>
          <button className="btn-soft" onClick={() => fileRef.current?.click()}>
            📂 Restaurar JSON
          </button>
          <button className="btn-ghost" onClick={exportStockCsv}>
            📊 Exportar Stock CSV
          </button>
        </div>
      </section>
    </div>
  );
}
