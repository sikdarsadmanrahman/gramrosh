/**
 * -----------------------------------------------------------------------------
 *  admin/AdminApp.jsx — back-office router + auth gate + layout
 * -----------------------------------------------------------------------------
 *  Everything under /admin renders inside this shell: sidebar (desktop),
 *  bottom tab bar (mobile), and an auth gate that validates the stored JWT via
 *  /admin/auth/me before letting any screen mount. RBAC itself is enforced by
 *  the API — the client only hides what a role can't use.
 * -----------------------------------------------------------------------------
 */
import { useEffect } from 'react';
import { Routes, Route, NavLink, Navigate, Outlet, Link } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  LayoutDashboard, Package, ClipboardList, Users, Settings as SettingsIcon,
  LogOut, Leaf, Store,
} from 'lucide-react';
import { useAdminStore } from '../stores/adminStore';
import { Loading } from '../components/ui';
import Login from './Login';
import Dashboard from './Dashboard';
import Products from './Products';
import ProductForm from './ProductForm';
import Orders from './Orders';
import OrderDetail from './OrderDetail';
import Customers from './Customers';
import CustomerDetail from './CustomerDetail';
import Settings from './Settings';

const NAV = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/products', label: 'Products', icon: Package },
  { to: '/admin/orders', label: 'Orders', icon: ClipboardList },
  { to: '/admin/customers', label: 'Customers', icon: Users },
  { to: '/admin/settings', label: 'Settings', icon: SettingsIcon },
];

/** Auth gate: validates the stored token once, then guards the outlet. */
function RequireAuth() {
  const { status, refresh } = useAdminStore();

  useEffect(() => {
    if (status === 'idle') refresh();
  }, [status, refresh]);

  if (status === 'idle' || status === 'checking') return <Loading label="Checking your session…" />;
  if (status !== 'authed') return <Navigate to="/admin/login" replace />;
  return <AdminLayout />;
}

function AdminLayout() {
  const { admin, logout } = useAdminStore();

  return (
    <div className="flex min-h-screen bg-soil-50">
      {/* ---- sidebar (desktop) ---- */}
      <aside className="sticky top-0 hidden h-screen w-60 flex-col border-r border-soil-100 bg-white md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-leaf-600 text-white">
            <Leaf size={20} aria-hidden />
          </span>
          <div>
            <p className="text-sm font-extrabold text-soil-900">Gramrosh</p>
            <p className="text-[11px] text-soil-400">Back office</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3" aria-label="Admin">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors',
                  isActive ? 'bg-leaf-600 text-white' : 'text-soil-600 hover:bg-soil-50',
                )
              }
            >
              <Icon size={17} aria-hidden /> {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-soil-100 p-3">
          <Link to="/" className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-soil-600 hover:bg-soil-50">
            <Store size={16} aria-hidden /> View storefront
          </Link>
          <div className="mt-1 flex items-center justify-between gap-2 rounded-xl px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-bold text-soil-800">{admin?.name ?? admin?.email}</p>
              <p className="truncate text-[11px] text-soil-400">{admin?.role?.replace('_', ' ')}</p>
            </div>
            <button type="button" className="text-soil-400 hover:text-red-600" aria-label="Log out" onClick={logout}>
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* ---- main ---- */}
      <div className="min-w-0 flex-1 pb-20 md:pb-8">
        <Outlet />
      </div>

      {/* ---- bottom tabs (mobile) ---- */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-soil-100 bg-white md:hidden" aria-label="Admin mobile">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              clsx(
                'flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold',
                isActive ? 'text-leaf-700' : 'text-soil-400',
              )
            }
          >
            <Icon size={19} aria-hidden /> {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export default function AdminApp() {
  return (
    <Routes>
      <Route path="login" element={<Login />} />
      <Route element={<RequireAuth />}>
        <Route index element={<Dashboard />} />
        <Route path="products" element={<Products />} />
        <Route path="products/new" element={<ProductForm />} />
        <Route path="products/:id" element={<ProductForm />} />
        <Route path="orders" element={<Orders />} />
        <Route path="orders/:id" element={<OrderDetail />} />
        <Route path="customers" element={<Customers />} />
        <Route path="customers/:id" element={<CustomerDetail />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}
