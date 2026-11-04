import { useRef, useState } from 'react';
import type { AppState } from '../lib/types';
import { engine, firebaseEngine, getState, replaceState, useAppState, useStock, useSyncStatus } from '../lib/store';
import { updateSettings } from '../lib/actions';
import { getConfig, pairingLink, saveConfig, firebasePairingLink } from '../lib/sync';
import { getFirebaseConfig, saveFirebaseConfig, type FirebaseConfig } from '../lib/firebaseSync';
import { activeBrands, brandColors, skuOf, vkey } from '../lib/inventory';
import { copyText, downloadText, toCSV } from '../lib/csv';
import { authenticateBoxful, getBoxfulConfig, saveBoxfulConfig, type BoxfulConfig } from '../lib/boxful';
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

  // Firebase Cloud State
  const initialFb = getFirebaseConfig();
  const [fbApiKey, setFbApiKey] = useState(initialFb?.apiKey || '');
  const [fbAuthDomain, setFbAuthDomain] = useState(initialFb?.authDomain || '');
  const [fbProjectId, setFbProjectId] = useState(initialFb?.projectId || '');
  const [fbStorageBucket, setFbStorageBucket] = useState(initialFb?.storageBucket || '');
  const [fbMessagingSenderId, setFbMessagingSenderId] = useState(initialFb?.messagingSenderId || '');
  const [fbAppId, setFbAppId] = useState(initialFb?.appId || '');
  const [fbJsonInput, setFbJsonInput] = useState('');
  const [testingFb, setTestingFb] = useState(false);

  const parseFirebaseSnippet = (text: string) => {
    try {
      // Intentar JSON directo
      const parsed = JSON.parse(text);
      if (parsed.projectId || parsed.apiKey) {
        if (parsed.apiKey) setFbApiKey(parsed.apiKey);
        if (parsed.authDomain) setFbAuthDomain(parsed.authDomain);
        if (parsed.projectId) setFbProjectId(parsed.projectId);
        if (parsed.storageBucket) setFbStorageBucket(parsed.storageBucket);
        if (parsed.messagingSenderId) setFbMessagingSenderId(parsed.messagingSenderId);
        if (parsed.appId) setFbAppId(parsed.appId);
        toast('Configuración de Firebase detectada');
        return;
      }
    } catch {
      // Parsear formato JS (const firebaseConfig = { apiKey: "..." })
    }

    const extract = (key: string) => {
      const match = text.match(new RegExp(`${key}["']?\\s*:\\s*["']([^"']+)["']`));
      return match ? match[1] : '';
    };

    const kApiKey = extract('apiKey');
    const kAuthDomain = extract('authDomain');
    const kProjectId = extract('projectId');
    const kStorageBucket = extract('storageBucket');
    const kSenderId = extract('messagingSenderId');
    const kAppId = extract('appId');

    if (kApiKey || kProjectId) {
      if (kApiKey) setFbApiKey(kApiKey);
      if (kAuthDomain) setFbAuthDomain(kAuthDomain);
      if (kProjectId) setFbProjectId(kProjectId);
      if (kStorageBucket) setFbStorageBucket(kStorageBucket);
      if (kSenderId) setFbMessagingSenderId(kSenderId);
      if (kAppId) setFbAppId(kAppId);
      toast('Configuración de Firebase extraída');
    } else {
      toast('No se reconocieron las claves de Firebase en el texto pegado', 'error');
    }
  };

  const connectFirebase = async () => {
    const cfg: FirebaseConfig = {
      apiKey: fbApiKey.trim(),
      authDomain: fbAuthDomain.trim(),
      projectId: fbProjectId.trim(),
      storageBucket: fbStorageBucket.trim(),
      messagingSenderId: fbMessagingSenderId.trim(),
      appId: fbAppId.trim(),
    };
    if (!cfg.apiKey || !cfg.projectId) {
      return toast('Ingresa al menos apiKey y projectId de Firebase', 'error');
    }
    setTestingFb(true);
    const err = await firebaseEngine.testConnection(cfg);
    setTestingFb(false);
    if (err) return toast(`Error Firebase: ${err}`, 'error');

    saveFirebaseConfig(cfg);
    await firebaseEngine.start(cfg);
    toast('🔥 Conectado en vivo a Google Firebase Firestore');
  };

  const disconnectFirebase = async () => {
    saveFirebaseConfig(null);
    await firebaseEngine.stop();
    toast('Firebase desconectado. Modo local activado', 'info');
  };

  const copyFirebasePairing = async () => {
    const cfg: FirebaseConfig = {
      apiKey: fbApiKey.trim(),
      authDomain: fbAuthDomain.trim(),
      projectId: fbProjectId.trim(),
      storageBucket: fbStorageBucket.trim(),
      messagingSenderId: fbMessagingSenderId.trim(),
      appId: fbAppId.trim(),
    };
    if (!cfg.apiKey || !cfg.projectId) return toast('Guarda primero la conexión a Firebase', 'error');
    const link = firebasePairingLink(cfg);
    await copyText(link);
    toast('Enlace copiado para conectar el Taller vía Firebase');
  };

  const initialBoxful = getBoxfulConfig();
  const [bxEnv, setBxEnv] = useState<'prod' | 'dev'>(initialBoxful?.env || 'prod');
  const [bxEmail, setBxEmail] = useState(initialBoxful?.email || '');
  const [bxPass, setBxPass] = useState('');
  const [bxToken, setBxToken] = useState(initialBoxful?.accessToken || '');
  const [bxCourier, setBxCourier] = useState(initialBoxful?.courierId || '');
  const [testingBoxful, setTestingBoxful] = useState(false);

  const [newSize, setNewSize] = useState('');
  const [newCarrier, setNewCarrier] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleSaveBoxful = async () => {
    const cfg: BoxfulConfig = {
      env: bxEnv,
      email: bxEmail.trim(),
      password: bxPass.trim() || undefined,
      accessToken: bxToken.trim() || undefined,
      courierId: bxCourier.trim() || undefined
    };
    if (!cfg.email && !cfg.accessToken) {
      saveBoxfulConfig(null);
      return toast('Credenciales de Boxful eliminadas de este dispositivo', 'info');
    }
    setTestingBoxful(true);
    try {
      if (cfg.email && cfg.password) {
        const token = await authenticateBoxful(cfg);
        setBxToken(token);
        setBxPass('');
        toast('📦 Conectado a Boxful API correctamente (Token guardado localmente)');
      } else {
        saveBoxfulConfig(cfg);
        toast('📦 Configuración de Boxful guardada en este dispositivo');
      }
    } catch (e) {
      saveBoxfulConfig(cfg);
      toast((e as Error).message, 'error');
    } finally {
      setTestingBoxful(false);
    }
  };

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
      {/* Conexión en Vivo a Google Firebase */}
      <section className="card space-y-3 border-2 border-amber-300 bg-gradient-to-b from-amber-50/50 to-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🔥</span>
            <div>
              <h2 className="section-title mb-0">Google Firebase (Recomendado)</h2>
              <p className="text-xs text-slate-500">Sincronización en tiempo real sin límites de cobro ni banners de Netlify</p>
            </div>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-extrabold ${firebaseEngine.connected ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>
            {firebaseEngine.connected ? 'CONECTADO A FIREBASE' : 'NO CONECTADO'}
          </span>
        </div>

        {/* Pegado Rápido */}
        <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/40 p-3">
          <label className="text-xs font-bold text-amber-900 block mb-1">
            ⚡ Pegado Rápido (Copia el bloque 'firebaseConfig' desde Firebase Console)
          </label>
          <div className="flex gap-2">
            <textarea
              className="input font-mono text-xs flex-1 h-14 resize-none"
              placeholder={`const firebaseConfig = {\n  apiKey: "AIzaSy...",\n  projectId: "tu-proyecto",\n  ...\n};`}
              value={fbJsonInput}
              onChange={(e) => setFbJsonInput(e.target.value)}
            />
            <button
              type="button"
              className="btn-soft shrink-0 self-center text-xs py-2 px-3 font-bold"
              onClick={() => {
                if (!fbJsonInput.trim()) return toast('Pega primero el código en el recuadro', 'error');
                parseFirebaseSnippet(fbJsonInput);
              }}
            >
              Autocompletar
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="label text-xs">Project ID</label>
            <input
              className="input font-mono text-xs"
              placeholder="mi-tienda-firebase"
              value={fbProjectId}
              onChange={(e) => setFbProjectId(e.target.value)}
            />
          </div>
          <div>
            <label className="label text-xs">API Key</label>
            <input
              className="input font-mono text-xs"
              placeholder="AIzaSy..."
              value={fbApiKey}
              onChange={(e) => setFbApiKey(e.target.value)}
            />
          </div>
          <div>
            <label className="label text-xs">Auth Domain (opcional)</label>
            <input
              className="input font-mono text-xs"
              placeholder="mi-tienda.firebaseapp.com"
              value={fbAuthDomain}
              onChange={(e) => setFbAuthDomain(e.target.value)}
            />
          </div>
          <div>
            <label className="label text-xs">Storage Bucket (opcional)</label>
            <input
              className="input font-mono text-xs"
              placeholder="mi-tienda.appspot.com"
              value={fbStorageBucket}
              onChange={(e) => setFbStorageBucket(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 pt-1">
          <button className="btn-primary bg-amber-600 hover:bg-amber-700" onClick={connectFirebase} disabled={testingFb}>
            {testingFb ? 'Probando Firebase...' : '🔥 Conectar y Sincronizar'}
          </button>
          <button className="btn-soft" onClick={copyFirebasePairing}>
            🔗 Copiar Enlace Taller (Firebase)
          </button>
        </div>

        {firebaseEngine.connected && (
          <button className="btn-ghost w-full text-xs text-rose-600 font-semibold" onClick={disconnectFirebase}>
            Desconectar de Firebase
          </button>
        )}
      </section>

      {/* Conexión en Vivo a Supabase (Alternativa) */}
      <section className="card space-y-3 border border-slate-200">
        <div className="flex items-center justify-between">
          <h2 className="section-title mb-0 text-slate-700">⚡ Conexión a Supabase (Opcional)</h2>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-extrabold text-slate-700">
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

      {/* Integración Boxful API (Honduras / El Salvador) */}
      <section className="card space-y-3 border-2 border-indigo-200">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="section-title mb-0">📦 Integración Boxful API (Guías Automáticas)</h2>
            <p className="text-xs text-slate-500">
              Conecta tu cuenta de Boxful (`api.goboxful.com`) para generar guías en 1 clic desde Pedidos. Las credenciales se guardan solo en este dispositivo.
            </p>
          </div>
          <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-extrabold text-indigo-900">
            {bxToken || bxEmail ? 'CONFIGURADO' : 'OPCIONAL'}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Entorno Boxful</label>
            <select
              className="input"
              value={bxEnv}
              onChange={(e) => setBxEnv(e.target.value as 'prod' | 'dev')}
            >
              <option value="prod">Producción (api.goboxful.com)</option>
              <option value="dev">Sandbox / Pruebas (devapi.goboxful.com)</option>
            </select>
          </div>
          <div>
            <label className="label">ID de Paquetería (Opcional)</label>
            <input
              className="input"
              placeholder="Automático (mejor tarifa)"
              value={bxCourier}
              onChange={(e) => setBxCourier(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Correo de cuenta Boxful</label>
            <input
              type="email"
              className="input"
              placeholder="tucorreo@negocio.com"
              value={bxEmail}
              onChange={(e) => setBxEmail(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div>
            <label className="label">Contraseña Boxful (para obtener Token)</label>
            <input
              type="password"
              className="input"
              placeholder="••••••••"
              value={bxPass}
              onChange={(e) => setBxPass(e.target.value)}
              autoComplete="new-password"
            />
          </div>
        </div>

        <div>
          <label className="label">O pega directamente tu Bearer Access Token de Boxful</label>
          <input
            className="input font-mono text-xs"
            placeholder="eyJhbGciOi..."
            value={bxToken}
            onChange={(e) => setBxToken(e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary bg-indigo-600 hover:bg-indigo-700"
            disabled={testingBoxful}
            onClick={() => void handleSaveBoxful()}
          >
            {testingBoxful ? 'Autenticando con Boxful...' : '📦 Guardar / Conectar Boxful'}
          </button>
          {(bxEmail || bxToken) && (
            <button
              type="button"
              className="btn-ghost text-xs text-red-600"
              onClick={() => {
                setBxEmail('');
                setBxPass('');
                setBxToken('');
                setBxCourier('');
                saveBoxfulConfig(null);
                toast('Conexión Boxful desconectada');
              }}
            >
              Desconectar Boxful
            </button>
          )}
        </div>
      </section>

      {/* Auditoría de Seguridad y Privacidad */}
      <section className="card space-y-2 border border-emerald-200 bg-emerald-50/40">
        <div className="flex items-center justify-between">
          <h2 className="section-title mb-0 text-emerald-950">🛡️ Blindaje de Seguridad y Privacidad Activo</h2>
          <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-[11px] font-extrabold text-white">
            PROTEGIDO
          </span>
        </div>
        <ul className="space-y-1 text-xs font-medium text-slate-700">
          <li>• <strong>Aislamiento de Tienda Pública (`#tienda`):</strong> Los clientes que abren el catálogo 3D nunca descargan la base de datos de pedidos, teléfonos, direcciones ni costos (`app_state_sync`); solo reciben la vitrina pública (`cat_live`).</li>
          <li>• <strong>Fondo Boutique bloqueado para clientes:</strong> Solo el administrador puede cambiar el ambiente (`🤠 Ranchero`, `🪵 Establo`, `✨ Nocturno`, `☀️ Rodeo Arena`).</li>
          <li>• <strong>Credenciales locales:</strong> Las llaves de Boxful y emparejamiento se guardan únicamente en este dispositivo y jamás se exponen en enlaces públicos.</li>
        </ul>
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
