/**
 * -----------------------------------------------------------------------------
 *  admin/Customers.jsx — the CRM list
 * -----------------------------------------------------------------------------
 *  Search by name / phone, filter by segment, paginated server-side. Rows link
 *  to the profile drawer with full order history.
 * -----------------------------------------------------------------------------
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { clsx } from 'clsx';
import { admin } from '../lib/api';
import { taka, timeAgo } from '../lib/format';
import { Loading, ErrorBanner, Pagination } from '../components/ui';
import { PageHeader } from './shared';

const SEGMENTS = [
  { id: '', label: 'All' },
  { id: 'new', label: 'New' },
  { id: 'returning', label: 'Returning' },
  { id: 'vip', label: 'VIP' },
  { id: 'at_risk', label: 'At risk' },
  { id: 'blocked', label: 'Blocked' },
];

const SEGMENT_STYLES = {
  new: 'bg-blue-100 text-blue-800',
  returning: 'bg-leaf-100 text-leaf-800',
  vip: 'bg-honey-100 text-honey-800',
  at_risk: 'bg-soil-100 text-soil-600',
  blocked: 'bg-red-100 text-red-700',
};

export default function Customers() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const segment = params.get('segment') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);

  const [rows, setRows] = useState(null);
  const [pagination, setPagination] = useState(null);
  const [error, setError] = useState(null);
  const [searchText, setSearchText] = useState(q);
  const debounceRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setRows(null);
    admin.customers({ page, limit: 15, q: q || undefined, segment: segment || undefined })
      .then(({ items, pagination: pager }) => { if (alive) { setRows(items); setPagination(pager); } })
      .catch((err) => alive && setError(err));
    return () => { alive = false; };
  }, [page, q, segment]);

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

  return (
    <div>
      <PageHeader title="Customers" description={pagination ? `${pagination.total} in the database` : ' '} />

      <div className="space-y-4 px-4 sm:px-6">
        {/* toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-64">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-soil-400" aria-hidden />
            <input
              type="search" value={searchText} onChange={(e) => onSearch(e.target.value)}
              placeholder="Name or phone (01711…)" className="field !pl-9" aria-label="Search customers"
            />
          </div>
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
            {SEGMENTS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => updateParams({ segment: s.id })}
                className={clsx(
                  'shrink-0 rounded-xl px-3 py-2 text-xs font-bold transition-colors',
                  segment === s.id ? 'bg-leaf-600 text-white' : 'bg-white text-soil-600 border border-soil-200 hover:border-leaf-400',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <ErrorBanner error={error} />
        {!rows ? (
          <Loading label="Loading customers…" />
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[680px]">
              <thead className="border-b border-soil-100 bg-soil-50/60">
                <tr>
                  <th className="th">Customer</th>
                  <th className="th">Segment</th>
                  <th className="th">Orders</th>
                  <th className="th">Lifetime spend</th>
                  <th className="th">Avg order</th>
                  <th className="th">Last order</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-soil-50">
                {rows.map((customer) => (
                  <tr key={customer._id} className="hover:bg-soil-50/50">
                    <td className="td">
                      <Link to={`/admin/customers/${customer._id}`} className="block">
                        <p className="text-sm font-bold text-soil-900 hover:text-leaf-700">{customer.name}</p>
                        <p className="text-xs text-soil-400">{customer.phonePretty ?? customer.phone}{customer.address?.district ? ` · ${customer.address.district}` : ''}</p>
                      </Link>
                    </td>
                    <td className="td">
                      <span className={clsx('chip capitalize', SEGMENT_STYLES[customer.segment] ?? 'bg-soil-100 text-soil-600')}>
                        {customer.segment?.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="td text-sm tabular-nums">{customer.stats?.totalOrders ?? 0}</td>
                    <td className="td whitespace-nowrap text-sm font-bold">{taka(customer.stats?.totalSpent ?? 0)}</td>
                    <td className="td whitespace-nowrap text-sm">{taka(customer.stats?.avgOrderValue ?? 0)}</td>
                    <td className="td whitespace-nowrap text-xs text-soil-500">{timeAgo(customer.stats?.lastOrderAt)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="td py-10 text-center text-soil-400">No customers match.</td></tr>
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
