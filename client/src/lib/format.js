/**
 * -----------------------------------------------------------------------------
 *  lib/format.js — money, dates and small display helpers
 * -----------------------------------------------------------------------------
 */

/**
 * Bangladeshi Taka with lakh/crore digit grouping: 1234567 → "৳12,34,567".
 * Matches the server's invoice formatter so totals read identically everywhere.
 */
export function taka(amount, { decimals = false } = {}) {
  const value = Number(amount) || 0;
  const negative = value < 0;
  const [intPart, decPart] = Math.abs(value).toFixed(2).split('.');
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  const dec = decimals && decPart !== '00' ? `.${decPart}` : '';
  return `${negative ? '−' : ''}৳${grouped}${dec}`;
}

/** "24 Sep 2026, 12:30 PM" — compact but unambiguous for admin tables. */
export function formatDate(value, { time = true } = {}) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const opts = { day: 'numeric', month: 'short', year: 'numeric' };
  if (time) Object.assign(opts, { hour: 'numeric', minute: '2-digit', hour12: true });
  return date.toLocaleString('en-GB', opts);
}

/** Relative labels for dashboards: "just now", "3h ago", "2d ago". */
export function timeAgo(value) {
  if (!value) return '—';
  const seconds = Math.floor((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)}d ago`;
  return formatDate(value, { time: false });
}

/** Seconds → { days, hours, minutes, seconds } for the countdown timer. */
export function splitCountdown(totalSeconds) {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  return {
    days: Math.floor(clamped / 86400),
    hours: Math.floor((clamped % 86400) / 3600),
    minutes: Math.floor((clamped % 3600) / 60),
    seconds: clamped % 60,
  };
}

/** "+8801711223344" → "+880 1711-223344" (matches the server's phonePretty). */
export function prettyPhone(phone) {
  const match = String(phone ?? '').match(/^\+880(1\d{2})(\d{3})(\d{3,4})$/);
  return match ? `+880 ${match[1]}${match[2].slice(0, 1)}-${match[2].slice(1)}${match[3]}` : (phone || '—');
}

/** Order status → chip colour classes (Tailwind-safe static strings). */
export const STATUS_STYLES = {
  Pending: 'bg-honey-100 text-honey-800',
  Processing: 'bg-blue-100 text-blue-800',
  Shipped: 'bg-violet-100 text-violet-800',
  Delivered: 'bg-leaf-100 text-leaf-800',
  Cancelled: 'bg-red-100 text-red-700',
};

export const PAYMENT_STATUS_STYLES = {
  Unpaid: 'bg-soil-100 text-soil-700',
  'COD Due': 'bg-honey-100 text-honey-800',
  'Pending Verification': 'bg-blue-100 text-blue-800',
  Paid: 'bg-leaf-100 text-leaf-800',
  Refunded: 'bg-violet-100 text-violet-800',
  Failed: 'bg-red-100 text-red-700',
};

export const STOCK_LABELS = {
  in_stock: { label: 'In stock', className: 'bg-leaf-100 text-leaf-800' },
  low_stock: { label: 'Low stock', className: 'bg-honey-100 text-honey-800' },
  out_of_stock: { label: 'Out of stock', className: 'bg-red-100 text-red-700' },
};

/** Clamp + join for card summaries. */
export const truncate = (text, max = 120) => {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};
