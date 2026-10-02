/**
 * -----------------------------------------------------------------------------
 *  admin/OrderDetail.jsx — one order: pipeline actions, payment, invoice
 * -----------------------------------------------------------------------------
 *  The status buttons come from the API's `allowedStatuses` (the transition
 *  table lives server-side), so this screen can never offer an illegal move.
 *  Marking Paid / recording courier info PATCH their own endpoints; the
 *  printable invoice opens the server-rendered HTML in a new tab.
 * -----------------------------------------------------------------------------
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, Printer, Truck, BadgeCheck, StickyNote, Loader2, PhoneCall, MapPin,
} from 'lucide-react';
import { clsx } from 'clsx';
import { admin, adminApi } from '../lib/api';
import { taka, formatDate, prettyPhone } from '../lib/format';
import { Loading, ErrorBanner } from '../components/ui';
import { PageHeader, StatusChip, PaymentChip, useToast } from './shared';

export default function OrderDetail() {
  const { id } = useParams();
  const { toast, ToastHost } = useToast();

  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [courier, setCourier] = useState({ courier: '', trackingNumber: '' });
  const [notes, setNotes] = useState('');

  const load = useCallback(() => {
    admin.order(id)
      .then((data) => {
        setOrder(data);
        setNotes(data.notes ?? '');
        setCourier({ courier: data.shipping?.courier ?? '', trackingNumber: data.shipping?.trackingNumber ?? '' });
      })
      .catch(setError);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (error) return <div className="p-6"><ErrorBanner error={error} /></div>;
  if (!order) return <Loading label="Loading the order…" />;

  /** Advance / cancel through the server's allowed transitions only. */
  const moveTo = async (status) => {
    if (status === 'Cancelled' && !cancelReason.trim()) {
      toast('Add a cancellation reason first', 'error');
      return;
    }
    setBusy(true);
    try {
      const { message } = await admin.updateOrderStatus(id, {
        status,
        ...(status === 'Cancelled' ? { reason: cancelReason.trim() } : {}),
      });
      toast(message);
      load();
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };

  const markPaid = async () => {
    setBusy(true);
    try {
      const { message } = await admin.updateOrderPayment(id, { status: 'Paid' });
      toast(message);
      load();
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };

  const saveCourier = async () => {
    setBusy(true);
    try {
      const { message } = await admin.updateOrderShipping(id, courier);
      toast(message);
      load();
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };

  const saveNotes = async () => {
    try {
      const { message } = await admin.updateOrderNotes(id, { notes });
      toast(message);
    } catch (err) { toast(err.message, 'error'); }
  };

  /** Open the server-rendered printable invoice with the bearer token. */
  const openInvoice = async (variant) => {
    const response = await adminApi.get(`/orders/${id}/invoice`, {
      params: { format: 'html', variant },
      responseType: 'blob',
    });
    const url = URL.createObjectURL(new Blob([response.data], { type: 'text/html' }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const allowed = order.allowedStatuses ?? [];
  const forwardMoves = allowed.filter((s) => s !== 'Cancelled');
  const canCancel = allowed.includes('Cancelled');
  const unpaid = !['Paid', 'Refunded'].includes(order.payment?.status);

  return (
    <div>
      <ToastHost />
      <PageHeader
        title={<span className="font-mono">{order.orderNumber}</span>}
        description={`Placed ${formatDate(order.createdAt)} · ${order.meta?.channel === 'admin' ? `keyed in by ${order.meta?.takenBy?.email || 'staff'}` : 'storefront checkout'}`}
        actions={
          <>
            <Link to="/admin/orders" className="btn-ghost"><ArrowLeft size={15} aria-hidden /> Orders</Link>
            <button type="button" className="btn-outline" onClick={() => openInvoice('invoice')}>
              <Printer size={15} aria-hidden /> Invoice
            </button>
            <button type="button" className="btn-outline" onClick={() => openInvoice('shipping')}>
              <Truck size={15} aria-hidden /> Shipping slip
            </button>
          </>
        }
      />

      <div className="grid gap-6 px-4 sm:px-6 lg:grid-cols-[1fr_22rem]">
        {/* ================= LEFT ================= */}
        <div className="space-y-6">
          {/* ---- pipeline actions ---- */}
          <section className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <StatusChip status={order.status} />
                <PaymentChip status={order.payment?.status} />
              </div>
              <div className="flex flex-wrap gap-2">
                {forwardMoves.map((status) => (
                  <button key={status} type="button" className="btn-primary !py-2" disabled={busy} onClick={() => moveTo(status)}>
                    {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null} Mark {status}
                  </button>
                ))}
              </div>
            </div>

            {canCancel && (
              <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-soil-100 pt-4">
                <div className="min-w-0 flex-1">
                  <label className="field-label" htmlFor="od-reason">Cancellation reason (required, stock is released)</label>
                  <input id="od-reason" className="field" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Customer changed their mind…" />
                </div>
                <button type="button" className="btn-danger" disabled={busy} onClick={() => moveTo('Cancelled')}>
                  Cancel order
                </button>
              </div>
            )}

            {/* timeline */}
            <ol className="mt-4 space-y-1.5 border-t border-soil-100 pt-4 text-sm">
              {[...(order.statusHistory ?? [])].reverse().map((entry, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3">
                  <span>
                    <span className="font-semibold text-soil-800">{entry.status}</span>
                    {entry.note && <span className="text-soil-500"> — {entry.note}</span>}
                    {entry.changedByName && <span className="text-soil-400"> · {entry.changedByName}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-soil-400">{formatDate(entry.at)}</span>
                </li>
              ))}
            </ol>
          </section>

          {/* ---- items ---- */}
          <section className="card overflow-x-auto">
            <table className="w-full min-w-[480px]">
              <thead className="border-b border-soil-100 bg-soil-50/60">
                <tr><th className="th">Item</th><th className="th">Unit</th><th className="th">Qty</th><th className="th text-right">Total</th></tr>
              </thead>
              <tbody className="divide-y divide-soil-50">
                {order.items?.map((item, i) => (
                  <tr key={i}>
                    <td className="td">
                      <div className="flex items-center gap-3">
                        {item.image && <img src={item.image} alt="" width={40} height={40} className="h-10 w-10 rounded-lg object-cover" loading="lazy" />}
                        <div>
                          <p className="text-sm font-semibold text-soil-900">{item.title}</p>
                          <p className="text-xs text-soil-400">{item.variantLabel} · {item.sku}</p>
                        </div>
                      </div>
                    </td>
                    <td className="td whitespace-nowrap text-sm">{taka(item.unitPrice)}</td>
                    <td className="td text-sm tabular-nums">{item.quantity}</td>
                    <td className="td whitespace-nowrap text-right text-sm font-bold">{taka(item.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-soil-100 bg-soil-50/40 text-sm">
                <tr><td colSpan={3} className="td text-right text-soil-500">Subtotal</td><td className="td text-right font-semibold">{taka(order.pricing?.subtotal)}</td></tr>
                {order.pricing?.discount > 0 && (
                  <tr><td colSpan={3} className="td text-right text-soil-500">Coupon {order.coupon?.code ? `(${order.coupon.code})` : ''}</td><td className="td text-right font-semibold text-leaf-700">−{taka(order.pricing.discount)}</td></tr>
                )}
                <tr><td colSpan={3} className="td text-right text-soil-500">Delivery — {order.shipping?.zoneLabel ?? order.shipping?.method}</td><td className="td text-right font-semibold">{order.pricing?.shippingFee === 0 ? 'FREE' : taka(order.pricing?.shippingFee)}</td></tr>
                <tr><td colSpan={3} className="td text-right font-bold text-soil-900">Grand total</td><td className="td text-right text-base font-extrabold text-leaf-800">{taka(order.pricing?.grandTotal)}</td></tr>
              </tfoot>
            </table>
          </section>

          {/* ---- internal notes ---- */}
          <section className="card p-5">
            <h2 className="flex items-center gap-2 text-sm font-bold text-soil-900">
              <StickyNote size={15} className="text-honey-600" aria-hidden /> Internal notes
            </h2>
            <textarea rows={2} className="field mt-3" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Only staff see this…" />
            <button type="button" className="btn-outline mt-2" onClick={saveNotes}>Save note</button>
            {order.deliveryNote && (
              <p className="mt-3 rounded-lg bg-honey-50 px-3 py-2 text-xs text-honey-800">
                <strong>Customer's delivery note:</strong> {order.deliveryNote}
              </p>
            )}
          </section>
        </div>

        {/* ================= RIGHT ================= */}
        <div className="space-y-6">
          {/* ---- customer ---- */}
          <section className="card p-5">
            <h2 className="text-sm font-bold text-soil-900">Customer</h2>
            <p className="mt-2 text-sm font-semibold text-soil-800">{order.contact?.name}</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-soil-600">
              <PhoneCall size={13} aria-hidden />
              <a href={`tel:${order.contact?.phone}`} className="hover:text-leaf-700">{prettyPhone(order.contact?.phone)}</a>
            </p>
            {order.contact?.email && <p className="mt-1 text-sm text-soil-500">{order.contact.email}</p>}
            <p className="mt-3 flex items-start gap-1.5 text-sm text-soil-600">
              <MapPin size={13} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                {[order.shippingAddress?.line1, order.shippingAddress?.area, order.shippingAddress?.district, order.shippingAddress?.postalCode].filter(Boolean).join(', ')}
              </span>
            </p>
            {typeof order.customer === 'string' || order.customer?._id ? (
              <Link to={`/admin/customers/${order.customer?._id ?? order.customer}`} className="btn-outline mt-3 w-full !py-2 text-xs">
                Full profile & order history
              </Link>
            ) : null}
          </section>

          {/* ---- payment ---- */}
          <section className="card p-5">
            <h2 className="text-sm font-bold text-soil-900">Payment</h2>
            <dl className="mt-2 space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-soil-500">Method</dt><dd className="font-semibold uppercase">{order.payment?.method}</dd></div>
              <div className="flex justify-between"><dt className="text-soil-500">Status</dt><dd><PaymentChip status={order.payment?.status} /></dd></div>
              {order.payment?.senderPhone && (
                <div className="flex justify-between"><dt className="text-soil-500">Sender</dt><dd className="font-mono text-xs">{order.payment.senderPhone}</dd></div>
              )}
              {order.payment?.transactionId && (
                <div className="flex justify-between"><dt className="text-soil-500">TrxID</dt><dd className="font-mono text-xs font-bold">{order.payment.transactionId}</dd></div>
              )}
              {order.payment?.merchantNumber && (
                <div className="flex justify-between"><dt className="text-soil-500">Merchant</dt><dd className="font-mono text-xs">{order.payment.merchantNumber}</dd></div>
              )}
            </dl>
            {unpaid && order.status !== 'Cancelled' && (
              <button type="button" className="btn-primary mt-3 w-full !py-2 text-xs" disabled={busy} onClick={markPaid}>
                <BadgeCheck size={14} aria-hidden /> Mark payment verified / paid
              </button>
            )}
          </section>

          {/* ---- courier ---- */}
          <section className="card p-5">
            <h2 className="text-sm font-bold text-soil-900">Courier & tracking</h2>
            <div className="mt-3 space-y-3">
              <div>
                <label className="field-label" htmlFor="od-courier">Courier</label>
                <input id="od-courier" className="field" value={courier.courier} onChange={(e) => setCourier((c) => ({ ...c, courier: e.target.value }))} placeholder="Pathao / Steadfast / RedX" />
              </div>
              <div>
                <label className="field-label" htmlFor="od-tracking">Tracking number</label>
                <input id="od-tracking" className="field font-mono" value={courier.trackingNumber} onChange={(e) => setCourier((c) => ({ ...c, trackingNumber: e.target.value }))} placeholder="—" />
              </div>
              <button type="button" className="btn-outline w-full" disabled={busy} onClick={saveCourier}>Save shipping info</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
