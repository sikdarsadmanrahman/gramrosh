/**
 * -----------------------------------------------------------------------------
 *  pages/Checkout.jsx — dynamic checkout with the automated shipping calculator
 * -----------------------------------------------------------------------------
 *  Money never comes from this file. Every time the basket, the district or
 *  the coupon changes, `/api/orders/quote` re-prices the whole order — the
 *  ৳60/৳120 zone fee, the free-delivery threshold, coupon validity and live
 *  stock — and the summary renders exactly what the server said. The final
 *  POST /orders sends only *references* (ids + quantities), so a tampered
 *  client cannot change what is charged.
 *
 *  Payment methods come from /api/config: COD plus the hardcoded mobile-banking
 *  wallets (bKash / Nagad / Rocket), each requiring sender phone + TrxID.
 * -----------------------------------------------------------------------------
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ShoppingBasket, Truck, Wallet, TicketPercent, Loader2, ShieldCheck, ChevronDown,
} from 'lucide-react';
import { clsx } from 'clsx';
import { storefront } from '../lib/api';
import { useCartStore, toOrderItems } from '../stores/cartStore';
import { useDistricts, usePaymentMethods } from '../stores/configStore';
import { taka } from '../lib/format';
import { EmptyState, ErrorBanner, QuantityStepper } from '../components/ui';

export default function Checkout() {
  const navigate = useNavigate();
  const { lines, setQuantity, remove, clear, applyQuote } = useCartStore();
  const districts = useDistricts();
  const paymentMethods = usePaymentMethods();

  /* ---- form state ---- */
  const [form, setForm] = useState({
    name: '', phone: '', email: '',
    line1: '', area: '', district: 'Dhaka', postalCode: '',
    paymentMethod: 'cod', senderPhone: '', transactionId: '',
    notes: '',
  });
  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState('');

  /* ---- server quote ---- */
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState(null);

  /* ---- submission ---- */
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const fieldErrors = useMemo(() => {
    const map = {};
    for (const e of submitError?.errors ?? []) map[e.path] = e.message;
    return map;
  }, [submitError]);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  /* --------------------------------------------------------------------- */
  /*  The quote loop: re-price on basket / district / coupon change          */
  /* --------------------------------------------------------------------- */
  const quoteSeq = useRef(0);

  useEffect(() => {
    if (lines.length === 0) { setQuote(null); return undefined; }
    const seq = ++quoteSeq.current;
    setQuoting(true);
    setQuoteError(null);

    const t = setTimeout(() => {
      storefront
        .quote({
          items: toOrderItems(lines),
          district: form.district,
          couponCode: appliedCoupon || undefined,
          paymentMethod: form.paymentMethod,
        })
        .then(({ data }) => {
          if (seq !== quoteSeq.current) return; // a newer quote superseded us
          setQuote(data);
          applyQuote(data); // refresh snapshot prices / drop dead lines
        })
        .catch((err) => seq === quoteSeq.current && setQuoteError(err))
        .finally(() => seq === quoteSeq.current && setQuoting(false));
    }, 250); // small debounce: quantity steppers fire fast

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(toOrderItems(lines)), form.district, appliedCoupon, form.paymentMethod]);

  /* --------------------------------------------------------------------- */
  /*  Submit                                                                */
  /* --------------------------------------------------------------------- */
  const selectedMethod = paymentMethods.find((m) => m.id === form.paymentMethod)
    ?? { id: 'cod', label: 'Cash on Delivery', requiresReference: false };

  const placeOrder = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { data } = await storefront.placeOrder({
        customer: { name: form.name, phone: form.phone, email: form.email || undefined },
        shippingAddress: {
          line1: form.line1,
          area: form.area || undefined,
          district: form.district,
          postalCode: form.postalCode || undefined,
        },
        items: toOrderItems(lines),
        payment: {
          method: form.paymentMethod,
          ...(selectedMethod.requiresReference
            ? { senderPhone: form.senderPhone, transactionId: form.transactionId }
            : {}),
        },
        couponCode: appliedCoupon || undefined,
        notes: form.notes || undefined,
      });
      clear();
      navigate(`/order-confirmation/${data.order.orderNumber}`, {
        state: { order: data.order, nextSteps: data.nextSteps },
      });
    } catch (err) {
      setSubmitError(err);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSubmitting(false);
    }
  };

  /* --------------------------------------------------------------------- */

  if (lines.length === 0) {
    return (
      <div className="mx-auto max-w-6xl px-4">
        <EmptyState icon={ShoppingBasket} title="Your basket is empty">
          Add something fresh first — then come back to check out.
          <div className="mt-4"><Link to="/shop" className="btn-primary">Browse the shop</Link></div>
        </EmptyState>
      </div>
    );
  }

  const shipping = quote?.shipping;
  const pricing = quote?.pricing;
  const couponFeedback = quote?.coupon;

  return (
    <form onSubmit={placeOrder} className="mx-auto max-w-6xl px-4 pt-6">
      <h1 className="text-2xl font-extrabold text-soil-900">Checkout</h1>

      <ErrorBanner error={submitError} className="mt-4" />

      <div className="mt-5 grid gap-8 lg:grid-cols-[1fr_24rem]">
        {/* ================= LEFT: forms ================= */}
        <div className="space-y-8">
          {/* ---- contact ---- */}
          <section>
            <h2 className="mb-3 text-base font-bold text-soil-900">1 · Contact</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="co-name">Full name *</label>
                <input id="co-name" required className="field" value={form.name} onChange={set('name')} autoComplete="name" placeholder="Rahim Uddin" />
                {fieldErrors['customer.name'] && <p className="field-error">{fieldErrors['customer.name']}</p>}
              </div>
              <div>
                <label className="field-label" htmlFor="co-phone">Mobile number *</label>
                <input id="co-phone" required className="field" value={form.phone} onChange={set('phone')} autoComplete="tel" inputMode="tel" placeholder="01711223344" />
                {fieldErrors['customer.phone'] && <p className="field-error">{fieldErrors['customer.phone']}</p>}
              </div>
              <div className="sm:col-span-2">
                <label className="field-label" htmlFor="co-email">Email (optional)</label>
                <input id="co-email" type="email" className="field" value={form.email} onChange={set('email')} autoComplete="email" placeholder="you@example.com" />
              </div>
            </div>
          </section>

          {/* ---- delivery ---- */}
          <section>
            <h2 className="mb-3 text-base font-bold text-soil-900">2 · Delivery address</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="field-label" htmlFor="co-line1">House / road / village *</label>
                <input id="co-line1" required className="field" value={form.line1} onChange={set('line1')} autoComplete="address-line1" placeholder="House 12, Road 5" />
                {fieldErrors['shippingAddress.line1'] && <p className="field-error">{fieldErrors['shippingAddress.line1']}</p>}
              </div>
              <div>
                <label className="field-label" htmlFor="co-area">Area / thana</label>
                <input id="co-area" className="field" value={form.area} onChange={set('area')} placeholder="Dhanmondi" />
              </div>
              <div>
                <label className="field-label" htmlFor="co-district">District *</label>
                <div className="relative">
                  <select id="co-district" required className="field appearance-none pr-9" value={form.district} onChange={set('district')}>
                    {districts.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-soil-400" aria-hidden />
                </div>
                {fieldErrors['shippingAddress.district'] && <p className="field-error">{fieldErrors['shippingAddress.district']}</p>}
              </div>
              <div>
                <label className="field-label" htmlFor="co-postal">Postal code</label>
                <input id="co-postal" className="field" value={form.postalCode} onChange={set('postalCode')} inputMode="numeric" placeholder="1205" />
              </div>
            </div>

            {/* the automated shipping calculator readout */}
            <div className="mt-3 flex items-start gap-2.5 rounded-2xl bg-leaf-50/70 p-3.5 text-sm text-leaf-900" aria-live="polite">
              <Truck size={17} className="mt-0.5 shrink-0" aria-hidden />
              {shipping ? (
                <p>
                  <strong>{shipping.label}</strong> — {shipping.isFree
                    ? <>free delivery (order over {taka(shipping.threshold)})</>
                    : <>{taka(shipping.fee)} · arrives in {shipping.etaDays?.[0]}–{shipping.etaDays?.[1]} days</>}
                  {!shipping.isFree && shipping.remainingForFreeShipping > 0 && (
                    <span className="block text-xs text-leaf-700">
                      Add {taka(shipping.remainingForFreeShipping)} more to make it free.
                    </span>
                  )}
                </p>
              ) : (
                <p>Delivery fee is calculated from your district…</p>
              )}
            </div>
          </section>

          {/* ---- payment ---- */}
          <section>
            <h2 className="mb-3 text-base font-bold text-soil-900">3 · Payment</h2>
            <div className="space-y-2.5">
              {paymentMethods.map((method) => {
                const active = form.paymentMethod === method.id;
                return (
                  <label
                    key={method.id}
                    className={clsx(
                      'block cursor-pointer rounded-2xl border p-4 transition-colors',
                      active ? 'border-leaf-600 bg-leaf-50/60 ring-1 ring-leaf-600' : 'border-soil-200 bg-white hover:border-leaf-300',
                    )}
                  >
                    <span className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="paymentMethod"
                        value={method.id}
                        checked={active}
                        onChange={set('paymentMethod')}
                        className="h-4 w-4 border-soil-300 text-leaf-600 focus:ring-leaf-500"
                      />
                      <Wallet size={17} className="text-soil-400" aria-hidden />
                      <span className="text-sm font-bold text-soil-900">{method.label}</span>
                      {method.merchantNumber && (
                        <span className="ml-auto font-mono text-xs text-soil-500">{method.merchantNumber}</span>
                      )}
                    </span>
                    {active && (
                      <div className="mt-3 space-y-3 pl-7">
                        <p className="text-xs leading-relaxed text-soil-500">{method.hint}</p>
                        {method.requiresReference && (
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                              <label className="field-label" htmlFor="co-sender">Sender phone number *</label>
                              <input
                                id="co-sender" required className="field" inputMode="tel"
                                value={form.senderPhone} onChange={set('senderPhone')}
                                placeholder="Number you sent from"
                              />
                              {fieldErrors['payment.senderPhone'] && <p className="field-error">{fieldErrors['payment.senderPhone']}</p>}
                            </div>
                            <div>
                              <label className="field-label" htmlFor="co-trx">Transaction ID (TrxID) *</label>
                              <input
                                id="co-trx" required className="field font-mono uppercase"
                                value={form.transactionId} onChange={set('transactionId')}
                                placeholder="e.g. 9H7XK2M4PQ"
                              />
                              {fieldErrors['payment.transactionId'] && <p className="field-error">{fieldErrors['payment.transactionId']}</p>}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </label>
                );
              })}
            </div>
          </section>

          {/* ---- note ---- */}
          <section>
            <label className="field-label" htmlFor="co-notes">Delivery note (optional)</label>
            <textarea id="co-notes" rows={2} className="field" value={form.notes} onChange={set('notes')} placeholder="Call before delivery, leave with the gate guard…" />
          </section>
        </div>

        {/* ================= RIGHT: live order summary ================= */}
        <aside className="h-fit lg:sticky lg:top-20">
          <div className="card p-5">
            <h2 className="text-base font-bold text-soil-900">Order summary</h2>

            {/* lines */}
            <ul className="mt-3 divide-y divide-soil-100">
              {lines.map((line) => (
                <li key={line.key} className="flex gap-3 py-3">
                  <img src={line.image} alt="" width={52} height={52} loading="lazy" className="h-13 w-13 rounded-lg object-cover" style={{ width: 52, height: 52 }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-soil-900">{line.title}</p>
                    <p className="text-xs text-soil-500">{line.variantLabel}</p>
                    <div className="mt-1.5 flex items-center justify-between">
                      <QuantityStepper small value={line.quantity} min={0} max={Math.min(99, line.availableStock ?? 99)} onChange={(q) => (q === 0 ? remove(line.key) : setQuantity(line.key, q))} />
                      <span className="text-sm font-bold">{taka(line.unitPrice * line.quantity)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            {/* stock warnings from the quote */}
            {quote?.lines?.filter((l) => l.insufficientStock).map((l) => (
              <p key={`${l.productId}:${l.variantId}`} className="mt-2 rounded-lg bg-honey-50 px-3 py-2 text-xs font-medium text-honey-800">
                Only {l.availableStock} × {l.title} ({l.variantLabel}) left — lower the quantity to continue.
              </p>
            ))}

            {/* coupon */}
            <div className="mt-4">
              <label className="field-label" htmlFor="co-coupon">Coupon</label>
              <div className="flex gap-2">
                <input
                  id="co-coupon"
                  className="field font-mono uppercase"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                  placeholder="GRAMROSH200"
                />
                <button
                  type="button"
                  className="btn-outline shrink-0"
                  onClick={() => setAppliedCoupon(couponCode.trim())}
                  disabled={!couponCode.trim() || quoting}
                >
                  <TicketPercent size={15} aria-hidden /> Apply
                </button>
              </div>
              {appliedCoupon && couponFeedback && (
                <p className={clsx('mt-1.5 text-xs font-medium', couponFeedback.applied ? 'text-leaf-700' : 'text-red-600')} aria-live="polite">
                  {couponFeedback.applied
                    ? <>Coupon <strong>{appliedCoupon}</strong> applied — you save {taka(couponFeedback.value)}.</>
                    : <>“{appliedCoupon}” isn’t valid right now.</>}
                </p>
              )}
            </div>

            {/* totals — verbatim from the server quote */}
            <dl className="mt-4 space-y-2 border-t border-soil-100 pt-4 text-sm" aria-live="polite">
              <div className="flex justify-between">
                <dt className="text-soil-600">Subtotal</dt>
                <dd className="font-semibold">{pricing ? taka(pricing.subtotal) : '…'}</dd>
              </div>
              {pricing?.savings > 0 && (
                <div className="flex justify-between text-leaf-700">
                  <dt>You save</dt>
                  <dd className="font-semibold">−{taka(pricing.savings)}</dd>
                </div>
              )}
              {pricing?.discount > 0 && (
                <div className="flex justify-between text-leaf-700">
                  <dt>Coupon</dt>
                  <dd className="font-semibold">−{taka(pricing.discount)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-soil-600">Delivery {shipping ? `(${shipping.label})` : ''}</dt>
                <dd className="font-semibold">
                  {shipping ? (shipping.isFree ? <span className="text-leaf-700">FREE</span> : taka(shipping.fee)) : '…'}
                </dd>
              </div>
              <div className="flex justify-between border-t border-soil-100 pt-3 text-base">
                <dt className="font-bold text-soil-900">Total</dt>
                <dd className="font-extrabold text-leaf-800">
                  {quoting ? <Loader2 size={17} className="inline animate-spin" aria-label="Recalculating" /> : pricing ? taka(pricing.grandTotal) : '…'}
                </dd>
              </div>
            </dl>

            {quoteError && <ErrorBanner error={quoteError} className="mt-3" />}
            {quote && !quote.checkoutReady && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                {quote.blockingReason ?? 'Something in the basket is unavailable — adjust it to continue.'}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || quoting || (quote && !quote.checkoutReady)}
              className="btn-primary mt-4 w-full !py-3.5 text-base"
            >
              {submitting
                ? <><Loader2 size={17} className="animate-spin" aria-hidden /> Placing order…</>
                : <>Place order {pricing ? `· ${taka(pricing.grandTotal)}` : ''}</>}
            </button>

            <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[11px] text-soil-400">
              <ShieldCheck size={13} aria-hidden /> Prices are confirmed server-side. No card required.
            </p>
          </div>
        </aside>
      </div>
    </form>
  );
}
