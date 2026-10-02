/**
 * -----------------------------------------------------------------------------
 *  admin/CustomerDetail.jsx — one customer: lifetime stats + order history
 * -----------------------------------------------------------------------------
 *  The API returns `{ customer, orders, orderTotal }` in one call; the order
 *  history is paginated independently for heavy buyers.
 * -----------------------------------------------------------------------------
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, PhoneCall, Mail, MapPin, Wallet, ShoppingBag, CalendarClock } from 'lucide-react';
import { clsx } from 'clsx';
import { admin } from '../lib/api';
import { taka, formatDate, timeAgo, prettyPhone } from '../lib/format';
import { Loading, ErrorBanner } from '../components/ui';
import { PageHeader, StatusChip, PaymentChip, StatCard } from './shared';

export default function CustomerDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    admin.customer(id)
      .then((d) => alive && setData(d))
      .catch((err) => alive && setError(err));
    return () => { alive = false; };
  }, [id]);

  if (error) return <div className="p-6"><ErrorBanner error={error} /></div>;
  if (!data) return <Loading label="Loading the profile…" />;

  const { customer, orders, orderTotal } = data;
  const stats = customer.stats ?? {};

  return (
    <div>
      <PageHeader
        title={customer.name}
        description={`Customer since ${formatDate(customer.createdAt, { time: false })} · segment: ${customer.segment?.replace('_', ' ')}`}
        actions={<Link to="/admin/customers" className="btn-ghost"><ArrowLeft size={15} aria-hidden /> Customers</Link>}
      />

      <div className="space-y-6 px-4 sm:px-6">
        {/* ---- stat tiles ---- */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Lifetime spend" value={taka(stats.totalSpent ?? 0)} icon={Wallet} />
          <StatCard label="Orders" value={stats.totalOrders ?? 0} sub={`${stats.itemsPurchased ?? 0} items`} icon={ShoppingBag} tone="blue" />
          <StatCard label="Avg order value" value={taka(stats.avgOrderValue ?? 0)} icon={Wallet} tone="honey" />
          <StatCard label="Last order" value={timeAgo(stats.lastOrderAt)} sub={stats.firstOrderAt ? `first ${formatDate(stats.firstOrderAt, { time: false })}` : undefined} icon={CalendarClock} />
        </div>

        <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
          {/* ---- contact card ---- */}
          <section className="card h-fit p-5">
            <h2 className="text-sm font-bold text-soil-900">Contact</h2>
            <ul className="mt-3 space-y-2.5 text-sm">
              <li className="flex items-center gap-2 text-soil-700">
                <PhoneCall size={14} className="shrink-0 text-leaf-600" aria-hidden />
                <a href={`tel:${customer.phone}`} className="hover:text-leaf-700">{prettyPhone(customer.phone)}</a>
              </li>
              {customer.email && (
                <li className="flex items-center gap-2 text-soil-700">
                  <Mail size={14} className="shrink-0 text-leaf-600" aria-hidden />
                  <a href={`mailto:${customer.email}`} className="hover:text-leaf-700">{customer.email}</a>
                </li>
              )}
              {customer.address?.line1 && (
                <li className="flex items-start gap-2 text-soil-700">
                  <MapPin size={14} className="mt-0.5 shrink-0 text-leaf-600" aria-hidden />
                  <span>{[customer.address.line1, customer.address.area, customer.address.district, customer.address.postalCode].filter(Boolean).join(', ')}</span>
                </li>
              )}
            </ul>

            {customer.addresses?.length > 1 && (
              <>
                <h3 className="mt-4 text-xs font-bold uppercase tracking-wide text-soil-500">Address book</h3>
                <ul className="mt-2 space-y-2 text-xs text-soil-600">
                  {customer.addresses.map((address, i) => (
                    <li key={address._id ?? i} className={clsx('rounded-lg border px-2.5 py-2', address.isDefault ? 'border-leaf-300 bg-leaf-50/50' : 'border-soil-100')}>
                      {[address.line1, address.area, address.district].filter(Boolean).join(', ')}
                      {address.isDefault && <span className="ml-1 font-bold text-leaf-700">· default</span>}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {customer.tags?.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {customer.tags.map((tag) => <span key={tag} className="chip bg-soil-100 text-soil-600">{tag}</span>)}
              </div>
            )}
            {customer.notes && (
              <p className="mt-4 rounded-lg bg-honey-50 px-3 py-2 text-xs text-honey-800">{customer.notes}</p>
            )}
          </section>

          {/* ---- order history ---- */}
          <section className="card overflow-x-auto">
            <div className="flex items-center justify-between px-4 pt-4">
              <h2 className="text-sm font-bold text-soil-900">Order history</h2>
              <span className="text-xs text-soil-400">{orderTotal} total</span>
            </div>
            <table className="mt-2 w-full min-w-[560px]">
              <thead className="border-b border-soil-100 bg-soil-50/60">
                <tr>
                  <th className="th">Order</th>
                  <th className="th">Placed</th>
                  <th className="th">Items</th>
                  <th className="th">Payment</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-soil-50">
                {orders?.map((order) => (
                  <tr key={order._id} className="hover:bg-soil-50/50">
                    <td className="td">
                      <Link to={`/admin/orders/${order._id}`} className="font-mono text-xs font-bold text-leaf-700 hover:underline">
                        {order.orderNumber}
                      </Link>
                    </td>
                    <td className="td whitespace-nowrap text-xs text-soil-500">{formatDate(order.createdAt)}</td>
                    <td className="td text-sm tabular-nums">{order.totals?.itemCount}</td>
                    <td className="td"><PaymentChip status={order.payment?.status} /></td>
                    <td className="td"><StatusChip status={order.status} /></td>
                    <td className="td whitespace-nowrap text-right text-sm font-bold">{taka(order.pricing?.grandTotal)}</td>
                  </tr>
                ))}
                {(!orders || orders.length === 0) && (
                  <tr><td colSpan={6} className="td py-8 text-center text-soil-400">No orders yet.</td></tr>
                )}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>
  );
}
