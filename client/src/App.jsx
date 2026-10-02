/**
 * -----------------------------------------------------------------------------
 *  App.jsx — route table + layout split
 * -----------------------------------------------------------------------------
 *  Two worlds share one SPA:
 *
 *    /            storefront (Header + Footer + CartDrawer + WhatsApp widget)
 *    /admin/*     back office (own layout, lazy-loaded so shoppers never pay
 *                 for the dashboard bundle)
 *
 *  `/api/config` is fetched once here and cached in the config store.
 * -----------------------------------------------------------------------------
 */
import { Suspense, lazy, useEffect } from 'react';
import { Routes, Route, Outlet, useLocation, Link } from 'react-router-dom';
import Header from './components/Header';
import Footer from './components/Footer';
import CartDrawer from './components/CartDrawer';
import FloatingContact from './components/FloatingContact';
import Home from './pages/Home';
import Shop from './pages/Shop';
import ProductDetail from './pages/ProductDetail';
import Checkout from './pages/Checkout';
import OrderConfirmation from './pages/OrderConfirmation';
import TrackOrder from './pages/TrackOrder';
import { Loading } from './components/ui';
import { useConfigStore } from './stores/configStore';

// The whole admin bundle is lazy: code-split away from the shopper path.
const AdminApp = lazy(() => import('./admin/AdminApp'));

/** Storefront chrome around every public page. */
function StorefrontLayout() {
  const { pathname } = useLocation();

  // New page → start at the top (browser default is preserved scroll).
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1 pb-10">
        <Outlet />
      </main>
      <Footer />
      <CartDrawer />
      <FloatingContact />
    </div>
  );
}

function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <p className="text-6xl font-extrabold text-leaf-200">404</p>
      <h1 className="mt-2 text-xl font-bold text-soil-900">That page has wandered off</h1>
      <p className="mt-2 text-sm text-soil-500">The link may be old, or the product was retired after the harvest.</p>
      <Link to="/" className="btn-primary mt-6">Back to the market</Link>
    </div>
  );
}

export default function App() {
  const loadConfig = useConfigStore((s) => s.load);
  useEffect(() => { loadConfig(); }, [loadConfig]);

  return (
    <Routes>
      {/* ---- back office ---- */}
      <Route
        path="/admin/*"
        element={
          <Suspense fallback={<Loading label="Opening the back office…" />}>
            <AdminApp />
          </Suspense>
        }
      />

      {/* ---- storefront ---- */}
      <Route element={<StorefrontLayout />}>
        <Route index element={<Home />} />
        <Route path="/shop" element={<Shop />} />
        <Route path="/product/:slug" element={<ProductDetail />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/order-confirmation/:orderNumber" element={<OrderConfirmation />} />
        <Route path="/track" element={<TrackOrder />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
