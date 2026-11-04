import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Section } from './lib/types';
import { useAppState, useReady } from './lib/store';
import { Drawer, Header, SECTIONS } from './components/Shell';
import { Toasts } from './components/ui';
import Home from './pages/Home';
import NewOrder from './pages/NewOrder';
import Catalog3D, { CustomerCatalogView, readSharedCatalogHash } from './pages/Catalog3D';
import Workshop from './pages/Workshop';
import Inventory from './pages/Inventory';
import Brands from './pages/Brands';
import Orders from './pages/Orders';
import Customers from './pages/Customers';
import Reports from './pages/Reports';
import SettingsPage from './pages/Settings';

const VALID = new Set(SECTIONS.map((s) => s.id));

function initialSection(): Section {
  const s = sessionStorage.getItem('cgs_section') as Section | null;
  return s && VALID.has(s) ? s : 'inicio';
}

export default function App() {
  const ready = useReady();
  const state = useAppState();
  const [section, setSection] = useState<Section>(initialSection);
  const [menu, setMenu] = useState(false);
  const [sharedCatalog, setSharedCatalog] = useState(readSharedCatalogHash);

  useEffect(() => {
    const onHash = () => setSharedCatalog(readSharedCatalogHash());
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
      taller: state.orders.filter((o) => !o.deleted && o.status === 'en_produccion').length
    }),
    [state.orders]
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
