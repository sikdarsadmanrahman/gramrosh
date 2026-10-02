/**
 * -----------------------------------------------------------------------------
 *  components/ui.jsx — tiny shared primitives
 * -----------------------------------------------------------------------------
 *  Price, badges, spinners, pagination, quantity stepper, star rating. Small
 *  enough to live in one file; anything with real behaviour gets its own.
 * -----------------------------------------------------------------------------
 */
import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight, Minus, Plus, Star, Loader2 } from 'lucide-react';
import { taka, STOCK_LABELS } from '../lib/format';

/** Current price + struck-through compare-at price. */
export function Price({ amount, compareAt, className, size = 'md' }) {
  const sizes = { sm: 'text-sm', md: 'text-base', lg: 'text-2xl' };
  return (
    <span className={clsx('inline-flex items-baseline gap-2', className)}>
      <span className={clsx('font-bold text-soil-900', sizes[size])}>{taka(amount)}</span>
      {compareAt > amount && (
        <span className="text-sm text-soil-400 line-through">{taka(compareAt)}</span>
      )}
    </span>
  );
}

/** in_stock / low_stock / out_of_stock chip. */
export function StockBadge({ status, className }) {
  const meta = STOCK_LABELS[status];
  if (!meta) return null;
  return <span className={clsx('chip', meta.className, className)}>{meta.label}</span>;
}

/** Discount bubble for product cards: "-18%". */
export function DiscountBadge({ percent }) {
  if (!percent) return null;
  return (
    <span className="chip bg-red-600 text-white shadow-sm">−{percent}%</span>
  );
}

/** Star rating with count — read-only display. */
export function Rating({ value = 0, count, className }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 text-sm', className)}>
      <Star size={15} className="fill-honey-400 text-honey-400" aria-hidden />
      <span className="font-semibold text-soil-800">{Number(value).toFixed(1)}</span>
      {count != null && <span className="text-soil-400">({count})</span>}
    </span>
  );
}

/** Centre spinner for route-level loading. */
export function Loading({ label = 'Loading…', className }) {
  return (
    <div className={clsx('flex flex-col items-center justify-center gap-3 py-24 text-soil-500', className)}>
      <Loader2 size={28} className="animate-spin text-leaf-600" aria-hidden />
      <p className="text-sm">{label}</p>
    </div>
  );
}

/** Friendly empty state with an optional action. */
export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      {Icon && <Icon size={40} className="text-soil-300" aria-hidden />}
      <h3 className="text-lg font-semibold text-soil-800">{title}</h3>
      {children && <div className="max-w-sm text-sm text-soil-500">{children}</div>}
      {action}
    </div>
  );
}

/** Grey shimmer block for skeleton screens. */
export function Skeleton({ className }) {
  return <div className={clsx('animate-pulse-soft rounded-xl bg-soil-100', className)} aria-hidden />;
}

/**
 * − 3 + stepper used in the cart and the PDP. `max` mirrors the server's
 * 99-per-line cap and the live variant stock when known.
 */
export function QuantityStepper({ value, onChange, min = 1, max = 99, small = false }) {
  const btn = clsx(
    'flex items-center justify-center rounded-lg border border-soil-200 text-soil-600 transition-colors',
    'hover:border-leaf-400 hover:text-leaf-700 disabled:opacity-40 disabled:hover:border-soil-200',
    small ? 'h-7 w-7' : 'h-9 w-9',
  );
  return (
    <div className="inline-flex items-center gap-2">
      <button type="button" className={btn} aria-label="Decrease quantity" disabled={value <= min} onClick={() => onChange(value - 1)}>
        <Minus size={small ? 13 : 15} />
      </button>
      <span className={clsx('min-w-[2ch] text-center font-semibold tabular-nums', small ? 'text-sm' : 'text-base')}>{value}</span>
      <button type="button" className={btn} aria-label="Increase quantity" disabled={value >= max} onClick={() => onChange(value + 1)}>
        <Plus size={small ? 13 : 15} />
      </button>
    </div>
  );
}

/**
 * Server-side pagination controls. `pagination` is the API's `meta.pagination`
 * object; `onPage` receives the 1-based page to fetch.
 */
export function Pagination({ pagination, onPage, className }) {
  if (!pagination || pagination.totalPages <= 1) return null;
  const { page, totalPages, hasPrevPage, hasNextPage, total } = pagination;

  // Windowed page list: 1 … 4 5 [6] 7 8 … 20
  const pages = [];
  for (let i = 1; i <= totalPages; i += 1) {
    if (i === 1 || i === totalPages || Math.abs(i - page) <= 1) pages.push(i);
    else if (pages[pages.length - 1] !== '…') pages.push('…');
  }

  return (
    <nav className={clsx('flex flex-wrap items-center justify-center gap-2', className)} aria-label="Pagination">
      <button type="button" className="btn-outline !px-2.5" disabled={!hasPrevPage} onClick={() => onPage(page - 1)} aria-label="Previous page">
        <ChevronLeft size={16} />
      </button>
      {pages.map((p, i) =>
        p === '…' ? (
          <span key={`gap-${i}`} className="px-1 text-soil-400">…</span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onPage(p)}
            aria-current={p === page ? 'page' : undefined}
            className={clsx(
              'h-9 min-w-[2.25rem] rounded-xl px-2 text-sm font-semibold transition-colors',
              p === page ? 'bg-leaf-600 text-white' : 'bg-white text-soil-700 border border-soil-200 hover:border-leaf-400',
            )}
          >
            {p}
          </button>
        ),
      )}
      <button type="button" className="btn-outline !px-2.5" disabled={!hasNextPage} onClick={() => onPage(page + 1)} aria-label="Next page">
        <ChevronRight size={16} />
      </button>
      <span className="ml-2 hidden text-xs text-soil-400 sm:inline">{total} items</span>
    </nav>
  );
}

/** Section heading used across the home page rails. */
export function SectionHeading({ eyebrow, title, action, className }) {
  return (
    <div className={clsx('mb-5 flex items-end justify-between gap-4', className)}>
      <div>
        {eyebrow && <p className="text-xs font-bold uppercase tracking-widest text-leaf-600">{eyebrow}</p>}
        <h2 className="mt-1 text-xl font-bold text-soil-900 sm:text-2xl">{title}</h2>
      </div>
      {action}
    </div>
  );
}

/** Inline error banner for forms and route failures. */
export function ErrorBanner({ error, className }) {
  if (!error) return null;
  return (
    <div className={clsx('rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700', className)} role="alert">
      <p className="font-semibold">{error.message ?? String(error)}</p>
      {Array.isArray(error.errors) && error.errors.length > 0 && (
        <ul className="mt-1 list-inside list-disc">
          {error.errors.map((e, i) => (
            <li key={i}>{e.path ? <strong>{e.path}: </strong> : null}{e.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
