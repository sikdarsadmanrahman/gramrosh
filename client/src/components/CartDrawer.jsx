/**
 * -----------------------------------------------------------------------------
 *  components/CartDrawer.jsx — the slide-over basket
 * -----------------------------------------------------------------------------
 *  Opens from any Add button. Shows a live free-shipping progress bar (the
 *  ৳2,500 threshold comes from /api/config) and pushes to /checkout, where the
 *  server quote becomes the source of truth for money.
 * -----------------------------------------------------------------------------
 */
import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShoppingBasket, Trash2, X, Truck } from 'lucide-react';
import { useCartStore, useCartSubtotal } from '../stores/cartStore';
import { useFreeShippingThreshold } from '../stores/configStore';
import { taka } from '../lib/format';
import { Price, QuantityStepper, EmptyState } from './ui';

export default function CartDrawer() {
  const { lines, isOpen, close, setQuantity, remove } = useCartStore();
  const subtotal = useCartSubtotal();
  const threshold = useFreeShippingThreshold();
  const navigate = useNavigate();

  // Lock body scroll while the drawer is open (mobile).
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  // Esc closes.
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, close]);

  if (!isOpen) return null;

  const remainingForFree = Math.max(0, threshold - subtotal);
  const progress = Math.min(100, (subtotal / threshold) * 100);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Shopping cart">
      {/* backdrop */}
      <button type="button" aria-label="Close cart" onClick={close} className="absolute inset-0 animate-fade-in bg-soil-950/40" />

      {/* panel */}
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-md animate-slide-in-right flex-col bg-white shadow-drawer">
        <header className="flex items-center justify-between border-b border-soil-100 px-4 py-3.5">
          <h2 className="flex items-center gap-2 text-base font-bold text-soil-900">
            <ShoppingBasket size={19} className="text-leaf-600" aria-hidden />
            Your basket
            <span className="text-sm font-medium text-soil-400">({lines.length} {lines.length === 1 ? 'item' : 'items'})</span>
          </h2>
          <button type="button" className="btn-ghost !px-2" aria-label="Close" onClick={close}>
            <X size={20} />
          </button>
        </header>

        {lines.length === 0 ? (
          <EmptyState icon={ShoppingBasket} title="Your basket is empty">
            Raw honey, pure ghee and winter gur are waiting.
            <div className="mt-4">
              <Link to="/shop" onClick={close} className="btn-primary">Browse the shop</Link>
            </div>
          </EmptyState>
        ) : (
          <>
            {/* free-shipping meter */}
            <div className="border-b border-soil-100 bg-leaf-50/60 px-4 py-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-leaf-800">
                <Truck size={14} aria-hidden />
                {remainingForFree > 0
                  ? <>Add <strong>{taka(remainingForFree)}</strong> more for free delivery</>
                  : <>You’ve unlocked <strong>free delivery</strong> 🎉</>}
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-leaf-100">
                <div className="h-full rounded-full bg-leaf-600 transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>

            {/* lines */}
            <ul className="flex-1 divide-y divide-soil-100 overflow-y-auto px-4">
              {lines.map((line) => (
                <li key={line.key} className="flex gap-3 py-3.5">
                  <Link to={`/product/${line.slug}`} onClick={close} className="shrink-0">
                    <img src={line.image} alt="" width={72} height={72} loading="lazy" className="h-18 w-18 rounded-xl object-cover" style={{ width: 72, height: 72 }} />
                  </Link>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-start justify-between gap-2">
                      <Link to={`/product/${line.slug}`} onClick={close} className="line-clamp-2 text-sm font-semibold text-soil-900 hover:text-leaf-700">
                        {line.title}
                      </Link>
                      <button type="button" className="text-soil-300 hover:text-red-600" aria-label={`Remove ${line.title}`} onClick={() => remove(line.key)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <p className="text-xs text-soil-500">{line.variantLabel}</p>
                    <div className="mt-auto flex items-center justify-between pt-2">
                      <QuantityStepper
                        small
                        value={line.quantity}
                        max={Math.min(99, line.availableStock ?? 99)}
                        min={1}
                        onChange={(q) => setQuantity(line.key, q)}
                      />
                      <Price amount={line.unitPrice * line.quantity} compareAt={line.compareAtPrice ? line.compareAtPrice * line.quantity : null} size="sm" />
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            {/* summary */}
            <footer className="space-y-3 border-t border-soil-100 px-4 py-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-soil-600">Subtotal</span>
                <span className="text-lg font-bold text-soil-900">{taka(subtotal)}</span>
              </div>
              <p className="text-xs text-soil-400">
                Delivery (৳60 inside Dhaka · ৳120 outside) is calculated at checkout.
              </p>
              <button
                type="button"
                className="btn-primary w-full !py-3 text-base"
                onClick={() => { close(); navigate('/checkout'); }}
              >
                Checkout
              </button>
              <button type="button" className="btn-ghost w-full" onClick={close}>
                Continue shopping
              </button>
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}
