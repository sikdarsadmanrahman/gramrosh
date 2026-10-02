/**
 * -----------------------------------------------------------------------------
 *  admin/Dashboard.jsx — the overview screen
 * -----------------------------------------------------------------------------
 *  One API call (`/admin/stats/overview`) paints everything: revenue KPIs with
 *  period deltas, the order-status pipeline, top products, stock alerts and
 *  the latest orders.
 * -----------------------------------------------------------------------------
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Banknote, ClipboardList, Users, ShoppingCart, AlertTriangle, ArrowRight, PackageX,
} from 'lucide-react';
import { admin } from '../lib/api';
import { taka, timeAgo, STATUS_STYLES } from '../lib/format';
import { Loading, ErrorBanner } from '../components/ui';
import { PageHeader, StatCard, StatusChip } from './shared';
import { clsx } from 'clsx';

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

export default function Dashboard() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    admin.overview({ days })
      .then((d) => alive && setData(d))
      .catch((err) => alive && setError(err));
    return () => { alive = false; };
  }, [days]);

  if (error) return <div className="p-6"><ErrorBanner error={error} /></div>;
  if (!data) return <Loading label="Crunching the numbers…" />;

  const { kpis, ordersByStatus, topProducts, recentOrders, stockAlerts, attention } = data;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={`Store performance over the last ${days} days`}
        actions={
          <div className="flex rounded-xl border border-soil-200 bg-white p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.days}
                type="button"
                onClick={() => setDays(r.days)}
                className={clsx(
                  'rounded-[10px] px-3 py-1.5 text-xs font-bold transition-colors',
                  days === r.days ? 'bg-leaf-600 text-white' : 'text-soil-500 hover:text-soil-800',
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="space-y-6 px-4 sm:px-6">
        {/* ---- needs attention strip ---- */}
        {(attention?.pendingOrders > 0 || attention?.paymentsToVerify > 0 || (attention?.lowStockProducts ?? 0) + (attention?.outOfStockProducts ?? 0) > 0) && (
          <div className="flex flex-wrap gap-2">
            {attention.pendingOrders > 0 && (
              <Link to="/admin/orders?status=Pending" className="chip bg-honey-100 text-honey-800 hover:bg-honey-200">
                <AlertTriangle size={12} aria-hidden /> {attention.pendingOrders} pending order{attention.pendingOrders > 1 ? 's' : ''}
              </Link>
            )}
            {attention.paymentsToVerify > 0 && (
              <Link to="/admin/orders" className="chip bg-blue-100 text-blue-800 hover:bg-blue-200">
                <Banknote size={12} aria-hidden /> {attention.paymentsToVerify} payment{attention.paymentsToVerify > 1 ? 's' : ''} to verify
              </Link>
            )}
            {(attention.lowStockProducts ?? 0) + (attention.outOfStockProducts ?? 0) > 0 && (
              <Link to="/admin/products" className="chip bg-red-100 text-red-700 hover:bg-red-200">
                <PackageX size={12} aria-hidden /> {attention.lowStockProducts + attention.outOfStockProducts} stock alert{attention.lowStockProducts + attention.outOfStockProducts > 1 ? 's' : ''}
              </Link>
            )}
          </div>
        )}

        {/* ---- KPI tiles ---- */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Revenue"
            value={taka(kpis.revenue.period)}
            change={kpis.revenue.change}
            sub={`today ${taka(kpis.revenue.today)}`}
            icon={Banknote}
          />
          <StatCard
            label="Orders"
            value={kpis.orders.period}
            change={kpis.orders.change}
            sub={`lifetime ${kpis.orders.lifetime}`}
            icon={ClipboardList}
            tone="blue"
          />
          <StatCard
            label="Avg order value"
            value={taka(kpis.averageOrderValue.period || kpis.averageOrderValue.lifetime)}
            sub={`lifetime ${taka(kpis.averageOrderValue.lifetime)}`}
            icon={ShoppingCart}
            tone="honey"
          />
          <StatCard
            label="Customers"
            value={kpis.customers.total}
            sub={`+${kpis.customers.newInPeriod} new in period`}
            icon={Users}
          />
        </div>

        {/* ---- status pipeline ---- */}
        <div className="card p-4">
          <h2 className="text-sm font-bold text-soil-900">Order pipeline</h2>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {Object.entries(ordersByStatus ?? {}).map(([status, count]) => (
              <Link
                key={status}
                to={`/admin/orders?status=${encodeURIComponent(status)}`}
                className={clsx('flex items-center justify-between rounded-xl px-3.5 py-3 transition-transform hover:scale-[1.02]', STATUS_STYLES[status])}
              >
                <span className="text-xs font-bold">{status}</span>
                <span className="text-lg font-extrabold tabular-nums">{count}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* ---- top products ---- */}
          <div className="card p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-soil-900">Top products</h2>
              <Link to="/admin/products" className="flex items-center gap-1 text-xs font-semibold text-leaf-700">
                Catalogue <ArrowRight size={12} aria-hidden />
              </Link>
            </div>
            <ul className="mt-3 space-y-2.5">
              {(topProducts ?? []).map((p, i) => (
                <li key={p.productId ?? i} className="flex items-center gap-3">
                  <span className="w-5 text-center text-xs font-bold text-soil-300">{i + 1}</span>
                  {p.image && <img src={p.image} alt="" width={36} height={36} className="h-9 w-9 rounded-lg object-cover" loading="lazy" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-soil-800">{p.title}</p>
                    <p className="text-xs text-soil-400">{p.units} units</p>
                  </div>
                  <span className="text-sm font-bold text-soil-900">{taka(p.revenue)}</span>
                </li>
              ))}
              {(!topProducts || topProducts.length === 0) && <p className="text-sm text-soil-400">No sales in this period yet.</p>}
            </ul>
          </div>

          {/* ---- recent orders ---- */}
          <div className="card p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-soil-900">Latest orders</h2>
              <Link to="/admin/orders" className="flex items-center gap-1 text-xs font-semibold text-leaf-700">
                All orders <ArrowRight size={12} aria-hidden />
              </Link>
            </div>
            <ul className="mt-3 divide-y divide-soil-100">
              {(recentOrders ?? []).map((order) => (
                <li key={order._id}>
                  <Link to={`/admin/orders/${order._id}`} className="flex items-center gap-3 py-2.5 hover:bg-soil-50">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-xs font-bold text-soil-800">{order.orderNumber}</p>
                      <p className="truncate text-xs text-soil-400">{order.contact?.name} · {timeAgo(order.createdAt)}</p>
                    </div>
                    <StatusChip status={order.status} />
                    <span className="text-sm font-bold">{taka(order.pricing?.grandTotal)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ---- stock alerts ---- */}
        {stockAlerts?.length > 0 && (
          <div className="card p-4">
            <h2 className="flex items-center gap-2 text-sm font-bold text-soil-900">
              <PackageX size={15} className="text-red-500" aria-hidden /> Stock alerts
            </h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {stockAlerts.map((alert) => (
                <Link
                  key={`${alert.productId}:${alert.variantId}`}
                  to={`/admin/products/${alert.productId}`}
                  className="flex items-center justify-between gap-2 rounded-xl border border-soil-100 px-3.5 py-2.5 hover:border-red-300"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-soil-800">{alert.title}</span>
                    <span className="block text-xs text-soil-400">{alert.variantLabel} · {alert.sku}</span>
                  </span>
                  <span className={clsx('chip shrink-0', alert.stock === 0 ? 'bg-red-100 text-red-700' : 'bg-honey-100 text-honey-800')}>
                    {alert.stock === 0 ? 'Out' : `${alert.stock} left`}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
