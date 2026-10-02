/**
 * -----------------------------------------------------------------------------
 *  pages/OrderConfirmation.jsx — post-checkout receipt
 * -----------------------------------------------------------------------------
 *  Rendered from the order handed over by Checkout via router state; on a
 *  refresh (state lost) it degrades to a tracking prompt rather than erroring.
 * -----------------------------------------------------------------------------
 */
import { Link, useLocation, useParams } from 'react-router-dom';
import { CheckCircle2, PackageSearch, Printer, Phone } from 'lucide-react';
import { taka, formatDate, STATUS_STYLES } from '../lib/format';
import { storefront } from '../lib/api';
import { useSupport } from '../stores/configStore';

export default function OrderConfirmation() {
  const { orderNumber } = useParams();
  const { state } = useLocation();
  const support = useSupport();
  const order = state?.order;

  return (
    <div className="mx-auto max-w-2xl px-4 pt-10 text-center">
      <CheckCircle2 size={56} className="mx-auto text-leaf-600" aria-hidden />
      <h1 className="mt-4 text-2xl font-extrabold text-soil-900">Order placed — thank you!</h1>
      <p className="mt-2 text-sm text-soil-600">
        Your order number is <strong className="font-mono text-leaf-800">{orderNumber}</strong>.
        {order?.contact?.phone && <> We’ll confirm on <strong>{order.contact.phone}</strong> shortly.</>}
      </p>

      {order ? (
        <div className="card mt-6 p-5 text-left">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-soil-900">Summary</h2>
            <span className={`chip ${STATUS_STYLES[order.status] ?? ''}`}>{order.status}</span>
          </div>
          <ul className="mt-3 divide-y divide-soil-100 text-sm">
            {order.items?.map((item, i) => (
              <li key={i} className="flex justify-between gap-3 py-2">
                <span className="text-soil-700">
                  {item.quantity} × {item.title} <span className="text-soil-400">({item.variantLabel})</span>
                </span>
                <span className="font-semibold">{taka(item.total ?? item.unitPrice * item.quantity)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-3 space-y-1.5 border-t border-soil-100 pt-3 text-sm">
            <div className="flex justify-between"><dt className="text-soil-500">Delivery ({order.shipping?.method === 'inside_dhaka' ? 'Inside Dhaka' : 'Outside Dhaka'})</dt><dd>{order.pricing?.shippingFee === 0 ? 'FREE' : taka(order.pricing?.shippingFee)}</dd></div>
            {order.pricing?.discount > 0 && <div className="flex justify-between text-leaf-700"><dt>Coupon</dt><dd>−{taka(order.pricing.discount)}</dd></div>}
            <div className="flex justify-between text-base font-bold"><dt>Total {order.payment?.method === 'cod' ? '(pay on delivery)' : ''}</dt><dd className="text-leaf-800">{taka(order.pricing?.grandTotal)}</dd></div>
          </dl>
          <p className="mt-3 text-xs text-soil-400">
            Placed {formatDate(order.createdAt)} · Payment: {order.payment?.status}
            {order.payment?.transactionId && <> · TrxID <span className="font-mono">{order.payment.transactionId}</span></>}
          </p>
        </div>
      ) : (
        <p className="mt-6 text-sm text-soil-500">
          Save your order number — you can check progress any time on the tracking page.
        </p>
      )}

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link to={`/track?orderNumber=${encodeURIComponent(orderNumber)}`} className="btn-primary">
          <PackageSearch size={16} aria-hidden /> Track this order
        </Link>
        {order?.contact?.phone && (
          <a
            href={storefront.invoiceUrl(orderNumber, order.contact.phone)}
            target="_blank"
            rel="noreferrer"
            className="btn-outline"
          >
            <Printer size={16} aria-hidden /> Printable invoice
          </a>
        )}
        <Link to="/shop" className="btn-ghost">Keep shopping</Link>
      </div>

      {support.phone && (
        <p className="mt-8 text-xs text-soil-400">
          Questions? Call <a className="font-semibold text-leaf-700" href={`tel:${support.phone}`}><Phone size={11} className="inline" aria-hidden /> {support.hotline || support.phone}</a> or tap the WhatsApp button.
        </p>
      )}
    </div>
  );
}
