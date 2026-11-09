import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Section } from './lib/types';
import { useAppState, useReady, useStock } from './lib/store';
import { lowColorStockList } from './lib/inventory';
import { Drawer, Header, SECTIONS } from './components/Shell';
import { toast, Toasts } from './components/ui';
import { subscribeLatestWebOrderFirebase } from './lib/firebaseSync';
import { notifyIncomingOrder, notifyLowStockColor, requestNotificationPermission } from './lib/soundNotification';
import type { CustomerWebOrderPayload } from './lib/publicCatalog';
import Home from './pages/Home';
import NewOrder from './pages/NewOrder';
import Catalog3D, { CustomerCatalogView, readSharedCatalogHash, readWebOrderImportHash } from './pages/Catalog3D';
import Workshop from './pages/Workshop';
import Inventory from './pages/Inventory';
import Brands from './pages/Brands';
import Orders from './pages/Orders';
import Customers from './pages/Customers';
import Reports from './pages/Reports';
import SettingsPage from './pages/Settings';

const VALID = new Set(SECTIONS.map((s) => s.id));

function initialSection(): Section {
  if (readWebOrderImportHash()) return 'vender';
  const s = sessionStorage.getItem('cgs_section') as Section | null;
  return s && VALID.has(s) ? s : 'inicio';
}

export default function App() {
  const ready = useReady();
  const state = useAppState();
  const stockInfo = useStock();
  const [section, setSection] = useState<Section>(initialSection);
  const [menu, setMenu] = useState(false);
  const [sharedCatalog, setSharedCatalog] = useState(readSharedCatalogHash);
  const [incomingOrder, setIncomingOrder] = useState<CustomerWebOrderPayload | null>(null);
  const seenOrderIds = useRef<Set<string>>(new Set());
  const mountTime = useRef<number>(Date.now());
  const prevColorTotalsRef = useRef<Map<string, number> | null>(null);

  const lowColors = useMemo(() => lowColorStockList(state, stockInfo), [state, stockInfo]);

  // Detector reactivo de stock bajo por color (1 a 10 unidades, excluyendo 0)
  useEffect(() => {
    if (!ready || sharedCatalog) return;
    const threshold = Math.max(1, state.settings.lowStock || 10);

    // Construir mapa actual de existencias por color (brandId:colorId -> total)
    const currentTotals = new Map<string, { total: number; brandName: string; colorName: string; sizesText: string }>();
    for (const b of state.brands) {
      if (b.deleted) continue;
      for (const c of state.colors) {
        if (c.deleted || c.brandId !== b.id) continue;
        let total = 0;
        const sizeParts: string[] = [];
        for (const sz of state.settings.sizes) {
          const val = stockInfo.stock.get(`${b.id}:${c.id}:${sz}`) || 0;
          total += val;
          if (val > 0) sizeParts.push(`${sz}:${val}`);
        }
        currentTotals.set(`${b.id}:${c.id}`, {
          total,
          brandName: b.name,
          colorName: c.name,
          sizesText: sizeParts.join(', ')
        });
      }
    }

    // En la primera carga solo guardamos la foto inicial sin bombardear, o mostramos un resumen discreto
    if (prevColorTotalsRef.current === null) {
      const initMap = new Map<string, number>();
      currentTotals.forEach((v, k) => initMap.set(k, v.total));
      prevColorTotalsRef.current = initMap;
      return;
    }

    const prevMap = prevColorTotalsRef.current;
    currentTotals.forEach((info, key) => {
      const prev = prevMap.get(key) ?? info.total;
      // Notificar únicamente cuando el stock está entre 1 y el umbral (ej. 1..10), NUNCA cuando es 0,
      // y cuando acaba de bajar o entrar en ese rango (ej. pasó de 11 a 10, o de 6 a 5, o se cargó de 0 a <=10)
      if (info.total >= 1 && info.total <= threshold && info.total !== prev && (info.total < prev || prev === 0)) {
        toast(
          `⚠️ Alerta de stock: ${info.brandName} · ${info.colorName} queda en ${info.total} ud${info.total === 1 ? '' : 's'} (${info.sizesText})`,
          'info'
        );
        notifyLowStockColor({
          brandName: info.brandName,
          colorName: info.colorName,
          totalStock: info.total,
          sizesText: info.sizesText
        });
      }
      prevMap.set(key, info.total);
    });
  }, [ready, sharedCatalog, state.brands, state.colors, state.settings.lowStock, state.settings.sizes, stockInfo]);

  useEffect(() => {
    if (sharedCatalog) return;
    void requestNotificationPermission();

    const unsub = subscribeLatestWebOrderFirebase((order) => {
      if (!order.id || seenOrderIds.current.has(order.id)) return;
      seenOrderIds.current.add(order.id);

      // Si el pedido fue generado en los últimos 15 minutos
      if (order.createdAt >= mountTime.current - 900000) {
        setIncomingOrder(order);
        notifyIncomingOrder({
          customerName: order.customerName,
          qty: order.qty,
          colorName: order.colorName,
          size: order.size,
          totalText: `L ${(order.qty * order.unitPrice) / 100}`,
          isCustom: !!order.designId || !!order.designName
        });
        toast(`🔔 ¡Nuevo Pedido de ${order.customerName}! (${order.qty}x ${order.colorName} ${order.size})`, 'ok');
      }
    });

    return unsub;
  }, [sharedCatalog]);

  useEffect(() => {
    const onHash = () => {
      if (readWebOrderImportHash()) {
        setSharedCatalog(null);
        setSection('vender');
        sessionStorage.setItem('cgs_section', 'vender');
        return;
      }
      setSharedCatalog(readSharedCatalogHash());
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = useCallback((s: Section) => {
    setSection(s);
    setMenu(false);
    sessionStorage.setItem('cgs_section', s);
    history.pushState({ section: s }, '');
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    if (sharedCatalog) return;
    history.replaceState({ section }, '');
    const onPop = (e: PopStateEvent) => {
      const s = (e.state?.section as Section) || 'inicio';
      setMenu(false);
      setSection(VALID.has(s) ? s : 'inicio');
      sessionStorage.setItem('cgs_section', s);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedCatalog]);

  const badges = useMemo(
    () => ({
      taller: state.orders.filter((o) => !o.deleted && o.status === 'en_produccion').length,
      inventario: lowColors.length
    }),
    [state.orders, lowColors.length]
  );

  if (sharedCatalog) {
    return (
      <>
        <CustomerCatalogView payload={sharedCatalog} />
        <Toasts />
      </>
    );
  }

  if (!ready) {
    return <div className="flex h-screen items-center justify-center text-4xl">👕</div>;
  }

  return (
    <div className="min-h-screen">
      <Header section={section} onMenu={() => setMenu(true)} onSell={() => navigate('vender')} />
      <Drawer open={menu} section={section} onClose={() => setMenu(false)} onNavigate={navigate} badges={badges} />

      {incomingOrder && (
        <div className="sticky top-14 z-40 mx-auto max-w-4xl px-3 pt-2">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-emerald-500 bg-emerald-50/95 p-3.5 shadow-xl backdrop-blur-md">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-xl text-white shadow">
                🔔
              </span>
              <div>
                <div className="text-xs font-black uppercase tracking-wider text-emerald-900">
                  ¡Nuevo Pedido Entrante de la Tienda Web!
                </div>
                <div className="text-sm font-extrabold text-slate-900">
                  {incomingOrder.customerName} · {incomingOrder.qty}x Camisa {incomingOrder.colorName} ({incomingOrder.size})
                  {incomingOrder.designName ? ` · Estampado: ${incomingOrder.designName}` : ' · Camisa Lisa'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  location.hash = `pedido=${incomingOrder.id}`;
                  setIncomingOrder(null);
                  navigate('vender');
                }}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white shadow transition hover:bg-emerald-700 active:scale-95"
              >
                📥 Cargar en 1 Clic
              </button>
              <button
                type="button"
                onClick={() => setIncomingOrder(null)}
                className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-900 hover:bg-emerald-100"
              >
                ✕ Descartar
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="safe-bottom mx-auto max-w-5xl px-3 pt-3">
        {section === 'inicio' && <Home navigate={navigate} />}
        {section === 'vender' && <NewOrder navigate={navigate} />}
        {section === 'catalogo' && <Catalog3D />}
        {section === 'taller' && <Workshop />}
        {section === 'inventario' && <Inventory />}
        {section === 'marcas' && <Brands />}
        {section === 'pedidos' && <Orders />}
        {section === 'clientes' && <Customers />}
        {section === 'reportes' && <Reports />}
        {section === 'ajustes' && <SettingsPage />}
      </main>
      <Toasts />
    </div>
  );
}
