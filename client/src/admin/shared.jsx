/**
 * -----------------------------------------------------------------------------
 *  admin/shared.jsx — back-office building blocks
 * -----------------------------------------------------------------------------
 *  Page header, KPI stat card, status chips and a toast hook shared by every
 *  admin screen.
 * -----------------------------------------------------------------------------
 */
import { useCallback, useState } from 'react';
import { clsx } from 'clsx';
import { TrendingDown, TrendingUp, CheckCircle2, AlertTriangle } from 'lucide-react';
import { STATUS_STYLES, PAYMENT_STATUS_STYLES } from '../lib/format';

/** Consistent page top: title + optional description + action buttons. */
export function PageHeader({ title, description, actions }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-4 pb-4 pt-6 sm:px-6">
      <div>
        <h1 className="text-xl font-extrabold text-soil-900 sm:text-2xl">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-soil-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Dashboard KPI tile with an optional period-over-period delta. */
export function StatCard({ label, value, sub, change, icon: Icon, tone = 'leaf' }) {
  const tones = {
    leaf: 'bg-leaf-50 text-leaf-700',
    honey: 'bg-honey-50 text-honey-700',
    blue: 'bg-blue-50 text-blue-700',
    red: 'bg-red-50 text-red-700',
  };
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-soil-500">{label}</p>
        {Icon && <span className={clsx('rounded-lg p-1.5', tones[tone])}><Icon size={15} aria-hidden /></span>}
      </div>
      <p className="mt-2 text-2xl font-extrabold text-soil-900">{value}</p>
      <div className="mt-1 flex items-center gap-2 text-xs">
        {change != null && (
          <span className={clsx('inline-flex items-center gap-0.5 font-bold', change >= 0 ? 'text-leaf-700' : 'text-red-600')}>
            {change >= 0 ? <TrendingUp size={12} aria-hidden /> : <TrendingDown size={12} aria-hidden />}
            {Math.abs(change)}%
          </span>
        )}
        {sub && <span className="text-soil-400">{sub}</span>}
      </div>
    </div>
  );
}

/** Order status chip — colours come from lib/format so they match everywhere. */
export function StatusChip({ status }) {
  return <span className={clsx('chip', STATUS_STYLES[status] ?? 'bg-soil-100 text-soil-600')}>{status}</span>;
}

export function PaymentChip({ status }) {
  return <span className={clsx('chip', PAYMENT_STATUS_STYLES[status] ?? 'bg-soil-100 text-soil-600')}>{status}</span>;
}

/**
 * Minimal toast: `const { toast, ToastHost } = useToast()` — mount `<ToastHost/>`
 * once per page, call `toast('Saved')` / `toast(message, 'error')` anywhere.
 */
export function useToast() {
  const [items, setItems] = useState([]);

  const toast = useCallback((message, kind = 'success') => {
    const id = Math.random().toString(36).slice(2);
    setItems((current) => [...current, { id, message, kind }]);
    setTimeout(() => setItems((current) => current.filter((t) => t.id !== id)), 3200);
  }, []);

  const ToastHost = useCallback(() => (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6" aria-live="polite">
      {items.map((t) => (
        <div
          key={t.id}
          className={clsx(
            'pointer-events-auto flex animate-rise-in items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-pop',
            t.kind === 'error' ? 'bg-red-600' : 'bg-soil-900',
          )}
        >
          {t.kind === 'error' ? <AlertTriangle size={15} aria-hidden /> : <CheckCircle2 size={15} className="text-leaf-400" aria-hidden />}
          {t.message}
        </div>
      ))}
    </div>
  ), [items]);

  return { toast, ToastHost };
}

/** Simple debounce hook for admin search boxes. */
export function useDebouncedCallback(fn, delay = 300) {
  const [timer, setTimer] = useState(null);
  return useCallback((...args) => {
    clearTimeout(timer);
    setTimer(setTimeout(() => fn(...args), delay));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn, delay, timer]);
}
