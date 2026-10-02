/**
 * -----------------------------------------------------------------------------
 *  pages/TrackOrder.jsx — public order tracking
 * -----------------------------------------------------------------------------
 *  Gated by orderNumber + the phone used at checkout (the API enforces the
 *  match). Shows the status timeline and a link to the printable invoice.
 * -----------------------------------------------------------------------------
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PackageSearch, Printer, Loader2, CheckCircle2, Circle } from 'lucide-react';
import { clsx } from 'clsx';
import { storefront } from '../lib/api';
import { taka, formatDate, STATUS_STYLES } from '../lib/format';
import { ErrorBanner } from '../components/ui';

const PIPELINE = ['Pending', 'Processing', 'Shipped', 'Delivered'];

export default function TrackOrder() {
  const [params] = useSearchParams();
  const [orderNumber, setOrderNumber] = useState(params.get('orderNumber') ?? '');
  const [phone, setPhone] = useState(params.get('phone') ?? '');
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const lookup = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setOrder(null);
    try {
      const data = await storefront.trackOrder(orderNumber.trim(), phone.trim());
      setOrder(data.order ?? data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  const reachedIndex = order ? PIPELINE.indexOf(order.status) : -1;
  const cancelled = order?.status === 'Cancelled';

  return (
    <div className="mx-auto max-w-2xl px-4 pt-8">
      <div className="text-center">
        <PackageSearch size={40} className="mx-auto text-leaf-600" aria-hidden />
        <h1 className="mt-3 text-2xl font-extrabold text-soil-900">Track your order</h1>
        <p className="mt-1 text-sm text-soil-500">
          Enter your order number and the mobile number you used at checkout.
        </p>
      </div>

      <form onSubmit={lookup} className="card mt-6 grid gap-3 p-5 sm:grid-cols-[1fr_1fr_auto]">
        <div>
          <label className="field-label" htmlFor="tr-number">Order number</label>
          <input id="tr-number" required className="field font-mono" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value.toUpperCase())} placeholder="GR-2026-123456" />
        </div>
        <div>
          <label className="field-label" htmlFor="tr-phone">Mobile number</label>
          <input id="tr-phone" required className="field" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01711223344" />
        </div>
        <div className="self-end">
          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? <Loader2 size={16} className="animate-spin" aria-hidden /> : 'Track'}
          </button>
        </div>
      </form>

      <ErrorBanner error={error} className="mt-4" />

      {order && (
        <div className="card mt-6 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-mono text-sm font-bold text-soil-900">{order.orderNumber}</h2>
            <span className={clsx('chip', STATUS_STYLES[order.status])}>{order.status}</span>
          </div>

          {/* ---- pipeline ---- */}
          {!cancelled ? (
            <ol className="mt-5 flex items-center" aria-label="Order progress">
              {PIPELINE.map((step, i) => {
                const reached = i <= reachedIndex;
                return (
                  <li key={step} className="flex flex-1 items-center last:flex-none">
                    <div className="flex flex-col items-center">
                      {reached
                        ? <CheckCircle2 size={22} className="text-leaf-600" aria-hidden />
                        : <Circle size={22} className="text-soil-200" aria-hidden />}
                      <span className={clsx('mt-1 text-[10px] font-semibold', reached ? 'text-leaf-700' : 'text-soil-400')}>{step}</span>
                    </div>
                    {i < PIPELINE.length - 1 && (
                      <div className={clsx('mx-1 h-0.5 flex-1 rounded', i < reachedIndex ? 'bg-leaf-500' : 'bg-soil-100')} aria-hidden />
                    )}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              This order was cancelled{order.cancellation?.reason ? ` — ${order.cancellation.reason}` : ''}. Reserved stock has been released.
            </p>
          )}

          {/* ---- timeline ---- */}
          {order.statusHistory?.length > 0 && (
            <ul className="mt-5 space-y-2 border-t border-soil-100 pt-4 text-sm">
              {[...order.statusHistory].reverse().map((entry, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3">
                  <span>
                    <span className="font-semibold text-soil-800">{entry.status}</span>
                    {entry.note && <span className="text-soil-500"> — {entry.note}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-soil-400">{formatDate(entry.at)}</span>
                </li>
              ))}
            </ul>
          )}

          {/* ---- items + total ---- */}
          <ul className="mt-4 divide-y divide-soil-100 border-t border-soil-100 text-sm">
            {order.items?.map((item, i) => (
              <li key={i} className="flex justify-between gap-3 py-2">
                <span className="text-soil-700">{item.quantity} × {item.title} <span className="text-soil-400">({item.variantLabel})</span></span>
                <span className="font-semibold">{taka(item.total ?? item.unitPrice * item.quantity)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between border-t border-soil-100 pt-3">
            <span className="text-sm font-bold text-soil-900">Total</span>
            <span className="text-lg font-extrabold text-leaf-800">{taka(order.pricing?.grandTotal)}</span>
          </div>

          <a
            href={storefront.invoiceUrl(order.orderNumber, phone)}
            target="_blank"
            rel="noreferrer"
            className="btn-outline mt-4 w-full"
          >
            <Printer size={15} aria-hidden /> Open printable invoice
          </a>
        </div>
      )}
    </div>
  );
}
