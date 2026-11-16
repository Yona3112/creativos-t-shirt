import { useRef, useState } from 'react';
import type { AppState } from '../lib/types';
import { firebaseEngine, getState, replaceState, useAppState, useStock } from '../lib/store';
import { purgeGarbageData, updateSettings } from '../lib/actions';
import { activeBrands, brandColors, skuOf, vkey } from '../lib/inventory';
import { downloadText, toCSV } from '../lib/csv';
import { dayKey } from '../lib/time';
import { Confirm, MoneyInput, toast } from '../components/ui';
import { authenticateBoxful, getBoxfulConfig, saveBoxfulConfig } from '../lib/boxful';

function isValidBackupPayload(raw: unknown): raw is AppState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const obj = raw as Record<string, unknown>;
  return (
    Array.isArray(obj.brands) &&
    Array.isArray(obj.colors) &&
    Array.isArray(obj.orders) &&
    Array.isArray(obj.customers) &&
    Array.isArray(obj.movements) &&
    Boolean(obj.settings) &&
    typeof obj.settings === 'object' &&
    !Array.isArray(obj.settings)
  );
}

const DEFAULT_CAMPAIGNS = ['Ranchero', 'Turístico', 'Cristiana'];

export default function SettingsPage() {
  const state = useAppState();
  const { stock } = useStock();
  const { settings } = state;

  const campaigns =
    settings.campaigns && settings.campaigns.length > 0
      ? settings.campaigns
      : DEFAULT_CAMPAIGNS;

  const [newCampaign, setNewCampaign] = useState('');
  const [newSize, setNewSize] = useState('');
  const [newCarrier, setNewCarrier] = useState('');
  const [newPaymentMethod, setNewPaymentMethod] = useState('');
  const [pendingBackup, setPendingBackup] = useState<{
    fileName: string;
    state: AppState;
  } | null>(null);
  const initialBoxful = getBoxfulConfig();
  const [boxfulEnv, setBoxfulEnv] = useState<'prod' | 'dev'>(initialBoxful?.env || 'prod');
  const [boxfulEmail, setBoxfulEmail] = useState(initialBoxful?.email || '');
  const [boxfulPass, setBoxfulPass] = useState('');
  const [boxfulCourierId, setBoxfulCourierId] = useState(initialBoxful?.courierId || '');
  const [boxfulConnected, setBoxfulConnected] = useState(Boolean(initialBoxful?.accessToken));
  const [busyBoxful, setBusyBoxful] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const connectBoxful = async () => {
    if (!boxfulEmail.trim()) return toast('Escribe tu correo de Boxful', 'error');
    if (!boxfulPass && !getBoxfulConfig()?.accessToken) {
      return toast('Escribe tu contraseña de Boxful para generar el token de acceso', 'error');
    }
    setBusyBoxful(true);
    try {
      const existing = getBoxfulConfig();
      const nextCfg = {
        env: boxfulEnv,
        email: boxfulEmail.trim(),
        password: boxfulPass || undefined,
        accessToken: boxfulPass ? undefined : existing?.accessToken,
        courierId: boxfulCourierId.trim() || undefined
      };
      const token = await authenticateBoxful(nextCfg);
      if (!boxfulPass) {
        saveBoxfulConfig({
          env: nextCfg.env,
          email: nextCfg.email,
          accessToken: token,
          courierId: nextCfg.courierId
        });
      }
      setBoxfulPass('');
      setBoxfulConnected(true);
      toast('📦 Boxful conectado en este dispositivo (sin guardar contraseña)');
    } catch (e) {
      toast((e as Error).message || 'No se pudo autenticar con Boxful', 'error');
    } finally {
      setBusyBoxful(false);
    }
  };

  const disconnectBoxful = () => {
    saveBoxfulConfig(null);
    setBoxfulPass('');
    setBoxfulConnected(false);
    toast('Boxful desconectado (modo asistido activo en Pedidos)');
  };

  const addCampaign = () => {
    const clean = newCampaign.trim();
    if (!clean) return;
    if (campaigns.some((c) => c.toLowerCase() === clean.toLowerCase())) {
      return toast('Esa campaña ya existe', 'error');
    }
    updateSettings({ campaigns: [...campaigns, clean] });
    setNewCampaign('');
    toast(`Campaña "${clean}" agregada`);
  };

  const removeCampaign = (camp: string) => {
    if (campaigns.length <= 1) return;
    const next = campaigns.filter((c) => c !== camp);
    updateSettings({
      campaigns: next,
      ...(settings.activeCampaign === camp ? { activeCampaign: 'all' } : {})
    });
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
    toast(`Transportista "${c}" agregado`);
  };

  const addPaymentMethod = () => {
    const v = newPaymentMethod.trim();
    if (!v) return;
    if (settings.paymentMethods.includes(v)) return toast('Ya existe ese método de pago', 'error');
    updateSettings({ paymentMethods: [...settings.paymentMethods, v] });
    setNewPaymentMethod('');
    toast(`Método "${v}" agregado`);
  };

  const exportJson = () => {
    const json = JSON.stringify(getState(), null, 2);
    downloadText(`respaldo-creativos-gift-${dayKey()}.json`, json, 'application/json');
    toast('Respaldo JSON descargado');
  };

  const importJson = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      if (!isValidBackupPayload(parsed)) {
        toast('El archivo no es un respaldo válido de Creativos Gift', 'error');
        return;
      }
      setPendingBackup({ fileName: file.name, state: parsed });
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
    <div className="space-y-4 pb-8">
      {/* 1. Datos de la Tienda y Precios */}
      <section className="space-y-4 rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold tracking-tight text-slate-900">Tienda y Precios</h2>
            <p className="text-xs text-slate-500">
              Información principal visible en el catálogo y recibos
            </p>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
              firebaseEngine.connected
                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                firebaseEngine.connected ? 'bg-emerald-500' : 'bg-slate-400'
              }`}
            />
            {firebaseEngine.connected ? 'Nube en vivo' : 'Modo local'}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              Nombre de la tienda
            </label>
            <input
              className="input"
              value={settings.storeName}
              onChange={(e) => updateSettings({ storeName: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              Teléfono / WhatsApp
            </label>
            <input
              className="input"
              value={settings.storePhone}
              onChange={(e) => updateSettings({ storePhone: e.target.value })}
              placeholder="+504 ..."
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Dirección</label>
            <input
              className="input"
              value={settings.storeAddress}
              onChange={(e) => updateSettings({ storeAddress: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              Ciudad / Departamento
            </label>
            <input
              className="input"
              value={settings.storeCity}
              onChange={(e) => updateSettings({ storeCity: e.target.value })}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              Precio Base (L)
            </label>
            <MoneyInput
              value={settings.priceNormal}
              onChange={(c) => c !== null && updateSettings({ priceNormal: c })}
            />
            <p className="mt-1 text-[11px] text-slate-400">Sin diseño (ej. L 300.00)</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              Precio con Diseño (L)
            </label>
            <MoneyInput
              value={settings.priceCustom || 35000}
              onChange={(c) => c !== null && updateSettings({ priceCustom: c })}
            />
            <p className="mt-1 text-[11px] text-slate-400">Con diseño A3/A4 (ej. L 350.00)</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Envío (L)</label>
            <MoneyInput
              value={settings.shipping}
              onChange={(c) => c !== null && updateSettings({ shipping: c })}
            />
            <p className="mt-1 text-[11px] text-slate-400">Tarifa estándar</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              Alerta Stock Bajo
            </label>
            <input
              type="number"
              min={1}
              max={100}
              className="input"
              value={settings.lowStock || 10}
              onChange={(e) => {
                const n = Math.max(1, Math.floor(Number(e.target.value) || 10));
                updateSettings({ lowStock: n });
              }}
            />
            <p className="mt-1 text-[11px] text-slate-400">
              De 1 a {settings.lowStock || 10} uds (0 no notifica)
            </p>
          </div>
        </div>
      </section>

      {/* 2. Campañas y Tallas */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <section className="space-y-3 rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-sm">
          <div>
            <h2 className="text-base font-bold tracking-tight text-slate-900">
              Campañas del Catálogo
            </h2>
            <p className="text-xs text-slate-500">
              Colecciones para clasificar diseños y compartir por WhatsApp
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {campaigns.map((camp) => (
              <span
                key={camp}
                className="inline-flex min-h-[36px] items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3.5 text-xs font-semibold text-slate-800"
              >
                {camp}
                {campaigns.length > 1 && (
                  <button
                    type="button"
                    className="text-slate-400 hover:text-rose-600"
                    onClick={() => removeCampaign(camp)}
                    aria-label={`Quitar ${camp}`}
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
              placeholder="Ej. Ranchero, Turístico, Cristiana..."
              value={newCampaign}
              onChange={(e) => setNewCampaign(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCampaign()}
            />
            <button
              type="button"
              className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              onClick={addCampaign}
            >
              + Agregar
            </button>
          </div>
        </section>

        <section className="space-y-3 rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-sm">
          <div>
            <h2 className="text-base font-bold tracking-tight text-slate-900">Tallas Activas</h2>
            <p className="text-xs text-slate-500">Tallas disponibles en inventario y tienda</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {settings.sizes.map((sz) => (
              <span
                key={sz}
                className="inline-flex min-h-[36px] items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3.5 text-xs font-bold text-slate-800"
              >
                {sz}
                {settings.sizes.length > 1 && (
                  <button
                    type="button"
                    className="text-slate-400 hover:text-rose-600"
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
              placeholder="Nueva talla (ej. 3XL, Niño M)"
              value={newSize}
              onChange={(e) => setNewSize(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addSize()}
            />
            <button
              type="button"
              className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              onClick={addSize}
            >
              + Agregar
            </button>
          </div>
        </section>
      </div>

      {/* 3. Métodos de Pago y Transportistas */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <section className="space-y-3 rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-sm">
          <div>
            <h2 className="text-base font-bold tracking-tight text-slate-900">Métodos de Pago</h2>
            <p className="text-xs text-slate-500">Opciones al registrar un pedido</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {settings.paymentMethods.map((m) => (
              <span
                key={m}
                className="inline-flex min-h-[36px] items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3.5 text-xs font-semibold text-slate-800"
              >
                {m}
                {settings.paymentMethods.length > 1 && (
                  <button
                    type="button"
                    className="text-slate-400 hover:text-rose-600"
                    onClick={() =>
                      updateSettings({
                        paymentMethods: settings.paymentMethods.filter((x) => x !== m)
                      })
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
              placeholder="Ej. Efectivo, Transferencia, BAC..."
              value={newPaymentMethod}
              onChange={(e) => setNewPaymentMethod(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addPaymentMethod()}
            />
            <button
              type="button"
              className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              onClick={addPaymentMethod}
            >
              + Agregar
            </button>
          </div>
        </section>

        <section className="space-y-3 rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-sm">
          <div>
            <h2 className="text-base font-bold tracking-tight text-slate-900">Transportistas</h2>
            <p className="text-xs text-slate-500">Empresas de envío para guías</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {settings.carriers.map((c) => (
              <span
                key={c}
                className="inline-flex min-h-[36px] items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3.5 text-xs font-semibold text-slate-800"
              >
                {c}
                {settings.carriers.length > 1 && (
                  <button
                    type="button"
                    className="text-slate-400 hover:text-rose-600"
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
              placeholder="Ej. Cargo Expreso, Forza, Rápido Cargo..."
              value={newCarrier}
              onChange={(e) => setNewCarrier(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCarrier()}
            />
            <button
              type="button"
              className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              onClick={addCarrier}
            >
              + Agregar
            </button>
          </div>
        </section>
      </div>

      {/* 4. Mensajes de WhatsApp */}
      <section className="space-y-3 rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-sm">
        <div>
          <h2 className="text-base font-bold tracking-tight text-slate-900">
            Mensajes Automáticos de WhatsApp
          </h2>
          <p className="text-xs text-slate-500">
            Plantillas para notificar al cliente desde Pedidos · Variables:{' '}
            <span className="font-mono text-[11px] text-slate-700">
              {'{cliente}'} {'{folio}'} {'{transportista}'} {'{guia}'} {'{rastreo}'} {'{total}'} {'{saldo}'} {'{unidades}'}
            </span>
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              Pedido enviado con guía
            </label>
            <textarea
              className="input min-h-[96px] py-2 text-xs"
              value={settings.waShipped}
              onChange={(e) => updateSettings({ waShipped: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              Pedido listo para entrega
            </label>
            <textarea
              className="input min-h-[96px] py-2 text-xs"
              value={settings.waReady}
              onChange={(e) => updateSettings({ waReady: e.target.value })}
            />
          </div>
        </div>
      </section>

      {/* 5. Envíos Automáticos con Boxful */}
      <section className="space-y-3 rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold tracking-tight text-slate-900">
              Envíos Automáticos (Boxful)
            </h2>
            <p className="text-xs text-slate-500">
              Credenciales guardadas solo en este navegador (se almacena el token temporal, no tu contraseña). Si no conectas API, Pedidos usará el modo asistido 1-clic.
            </p>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
              boxfulConnected
                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${boxfulConnected ? 'bg-emerald-500' : 'bg-slate-400'}`}
            />
            {boxfulConnected ? 'API conectada' : 'Modo asistido'}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Ambiente</label>
            <select
              className="input"
              value={boxfulEnv}
              onChange={(e) => setBoxfulEnv(e.target.value === 'dev' ? 'dev' : 'prod')}
            >
              <option value="prod">Producción (HN/SV)</option>
              <option value="dev">Pruebas (Sandbox)</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-semibold text-slate-600">Correo Boxful</label>
            <input
              type="email"
              className="input"
              placeholder="correo@negocio.com"
              value={boxfulEmail}
              onChange={(e) => setBoxfulEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              Courier ID (opc.)
            </label>
            <input
              className="input font-mono"
              placeholder="Opcional"
              value={boxfulCourierId}
              onChange={(e) => setBoxfulCourierId(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1">
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              Contraseña Boxful {boxfulConnected ? '(solo si deseas renovar token)' : ''}
            </label>
            <input
              type="password"
              autoComplete="new-password"
              className="input"
              placeholder={boxfulConnected ? '•••••••• (token activo en este dispositivo)' : 'Tu contraseña de Boxful'}
              value={boxfulPass}
              onChange={(e) => setBoxfulPass(e.target.value)}
            />
          </div>
          <button
            type="button"
            disabled={busyBoxful}
            onClick={() => void connectBoxful()}
            className="rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            {busyBoxful ? 'Conectando...' : boxfulConnected ? 'Actualizar conexión' : 'Conectar Boxful'}
          </button>
          {boxfulConnected && (
            <button
              type="button"
              onClick={disconnectBoxful}
              className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
            >
              Desconectar
            </button>
          )}
        </div>
      </section>

      {/* 6. Mantenimiento y Respaldo */}
      <section className="space-y-3 rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold tracking-tight text-slate-900">
              Mantenimiento y Respaldo
            </h2>
            <p className="text-xs text-slate-500">
              Limpieza de registros obsoletos y copia de seguridad del sistema
            </p>
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => void importJson(e.target.files?.[0])}
        />

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <button
            type="button"
            className="rounded-2xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-slate-800"
            onClick={exportJson}
          >
            💾 Descargar Respaldo
          </button>
          <button
            type="button"
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-800 transition hover:bg-slate-100"
            onClick={() => fileRef.current?.click()}
          >
            📂 Restaurar Respaldo
          </button>
          <button
            type="button"
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-800 transition hover:bg-slate-100"
            onClick={exportStockCsv}
          >
            📊 Exportar Stock CSV
          </button>
          <button
            type="button"
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
            onClick={() => {
              const res = purgeGarbageData();
              const totalRemoved =
                res.removedBrands +
                res.removedColors +
                res.removedDesigns +
                res.compactedMovements;
              if (totalRemoved > 0) {
                toast(
                  `Optimización lista: ${totalRemoved} registros redundantes limpiados`,
                  'ok'
                );
              } else {
                toast('El sistema ya está limpio y optimizado', 'ok');
              }
            }}
          >
            🧹 Optimizar Base de Datos
          </button>
        </div>
      </section>

      <Confirm
        open={Boolean(pendingBackup)}
        onClose={() => setPendingBackup(null)}
        title="Restaurar respaldo"
        text={
          pendingBackup
            ? `¿Reemplazar los datos actuales con "${pendingBackup.fileName}"? Contiene ${pendingBackup.state.orders.filter((o) => !o.deleted).length} pedidos, ${pendingBackup.state.customers.filter((c) => !c.deleted).length} clientes y ${pendingBackup.state.brands.filter((b) => !b.deleted).length} marcas.`
            : ''
        }
        confirmLabel="Sí, restaurar respaldo"
        danger
        onConfirm={() => {
          if (!pendingBackup) return;
          replaceState(pendingBackup.state);
          toast('Respaldo restaurado correctamente');
          setPendingBackup(null);
        }}
      />
    </div>
  );
}
