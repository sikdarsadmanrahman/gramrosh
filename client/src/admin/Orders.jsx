/**
 * -----------------------------------------------------------------------------
 *  admin/Orders.jsx — the order table with the status pipeline as tabs
 * -----------------------------------------------------------------------------
 *  Tabs show live counts from `meta.statusCounts`; search covers order number,
 *  customer name and phone; the CSV export streams from the API with the same
 *  filters applied.
 * -----------------------------------------------------------------------------
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, Download } from 'lucide-react';
import { clsx } from 'clsx';
import { admin } from '../lib/api';
import { taka, formatDate } from '../lib/format';
import { Loading, ErrorBanner, Pagination } from '../components/ui';
import { PageHeader, StatusChip, PaymentChip } from './shared';

const TABS = ['All', 'Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];

export default function Orders() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const q = params.get('q') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);

  const [rows, setRows] = useState(null);
  const [pagination, setPagination] = useState(null);
  const [statusCounts, setStatusCounts] = useState({});
  const [error, setError] = useState(null);
  const [searchText, setSearchText] = useState(q);
  const debounceRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setRows(null);
    admin.orders({ page, limit: 15, status: status || undefined, q: q || undefined })
      .then(({ items, pagination: pager, meta }) => {
        if (!alive) return;
        setRows(items);
        setPagination(pager);
        if (meta.statusCounts) setStatusCounts(meta.statusCounts);
      })
      .catch((err) => alive && setError(err));
    return () => { alive = false; };
  }, [page, status, q]);

  const updateParams = (patch, { resetPage = true } = {}) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (!value) next.delete(key);
      else next.set(key, String(value));
    }
    if (resetPage) next.delete('page');
    setParams(next);
  };

  const onSearch = (value) => {
    setSearchText(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => updateParams({ q: value.trim() }), 300);
  };

  const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);

  return (
    <div>
      <PageHeader
        title="Orders"
        description={pagination ? `${pagination.total} matching order(s)` : ' '}
        actions={
          <a
            href={admin.exportUrl(status ? `status=${encodeURIComponent(status)}` : '')}
            className="btn-outline"
            onClick={(e) => {
              // The export needs the bearer token, so fetch it as a blob.
              e.preventDefault();
              downloadCsv(status);
            }}
          >
            <Download size={15} aria-hidden /> Export CSV
          </a>
        }
      />

      <div className="space-y-4 px-4 sm:px-6">
        {/* ---- pipeline tabs ---- */}
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
          {TABS.map((tab) => {
            const value = tab === 'All' ? '' : tab;
            const active = status === value;
            const count = tab === 'All' ? total : statusCounts[tab] ?? 0;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => updateParams({ status: value })}
                className={clsx(
                  'flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors',
                  active ? 'bg-leaf-600 text-white' : 'bg-white text-soil-600 border border-soil-200 hover:border-leaf-400',
                )}
              >
                {tab}
                <span className={clsx('rounded-full px-1.5 text-xs tabular-nums', active ? 'bg-white/20' : 'bg-soil-100 text-soil-500')}>{count}</span>
              </button>
            );
          })}
        </div>

        {/* ---- search ---- */}
        <div className="relative max-w-md">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-soil-400" aria-hidden />
          <input
            type="search" value={searchText} onChange={(e) => onSearch(e.target.value)}
            placeholder="Order number, name or phone…" className="field !pl-9" aria-label="Search orders"
          />
        </div>

        <ErrorBanner error={error} />
        {!rows ? (
          <Loading label="Loading orders…" />
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[780px]">
              <thead className="border-b border-soil-100 bg-soil-50/60">
                <tr>
                  <th className="th">Order</th>
                  <th className="th">Customer</th>
                  <th className="th">Items</th>
                  <th className="th">Total</th>
                  <th className="th">Payment</th>
                  <th className="th">Status</th>
                  <th className="th">Placed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-soil-50">
                {rows.map((order) => (
                  <tr key={order._id} className="hover:bg-soil-50/50">
                    <td className="td">
                      <Link to={`/admin/orders/${order._id}`} className="font-mono text-xs font-bold text-leaf-700 hover:underline">
                        {order.orderNumber}
                      </Link>
                    </td>
                    <td className="td">
                      <p className="text-sm font-semibold text-soil-900">{order.contact?.name}</p>
                      <p className="text-xs text-soil-400">{order.contact?.phonePretty ?? order.contact?.phone} · {order.shippingAddress?.district}</p>
                    </td>
                    <td className="td text-sm tabular-nums">{order.totals?.itemCount}</td>
                    <td className="td whitespace-nowrap text-sm font-bold">{taka(order.pricing?.grandTotal)}</td>
                    <td className="td">
                      <div className="flex flex-col items-start gap-1">
                        <span className="text-xs font-semibold uppercase text-soil-500">{order.payment?.method}</span>
                        <PaymentChip status={order.payment?.status} />
                      </div>
                    </td>
                    <td className="td"><StatusChip status={order.status} /></td>
                    <td className="td whitespace-nowrap text-xs text-soil-500">{formatDate(order.createdAt)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={7} className="td py-10 text-center text-soil-400">No orders match this filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <Pagination pagination={pagination} onPage={(p) => updateParams({ page: p }, { resetPage: false })} />
      </div>
    </div>
  );
}

/** Authenticated CSV download: fetch as a blob, then trigger a save. */
async function downloadCsv(status) {
  const { adminApi } = await import('../lib/api');
  const response = await adminApi.get('/orders/export', {
    params: { format: 'csv', ...(status ? { status } : {}) },
    responseType: 'blob',
  });
  const url = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = `gramrosh-orders-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
