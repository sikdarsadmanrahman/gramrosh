/**
 * -----------------------------------------------------------------------------
 *  stores/cartStore.js — the basket (Zustand + localStorage persistence)
 * -----------------------------------------------------------------------------
 *  The cart stores *references* (productId + variantId + quantity) plus a
 *  display snapshot (title, image, unit price, pack label) so the drawer can
 *  paint instantly. Prices in the snapshot are cosmetic — checkout totals are
 *  always recomputed server-side by `/orders/quote` and `/orders`, so a stale
 *  snapshot can never change what a customer is charged.
 *
 *  A line's identity is `productId:variantId` — the same product in two pack
 *  sizes (250g and 1kg) is two distinct lines, matching how stock is tracked.
 * -----------------------------------------------------------------------------
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const MAX_PER_LINE = 99; // matches the server-side order validator

const lineKey = (productId, variantId) => `${productId}:${variantId}`;

export const useCartStore = create(
  persist(
    (set, get) => ({
      /** @type {Array<{key,productId,variantId,quantity,title,titleBn,variantLabel,unitPrice,compareAtPrice,image,slug,availableStock}>} */
      lines: [],
      /** Slide-over visibility (kept here so any button can open it). */
      isOpen: false,

      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),

      /**
       * Add `quantity` of a variant. Merges into an existing line and opens the
       * drawer so the shopper always sees what just happened.
       *
       * @param {object} product a product card / detail object from the API
       * @param {object} variant the chosen pack size (must carry _id)
       */
      add(product, variant, quantity = 1) {
        const key = lineKey(product._id, variant._id);
        const lines = [...get().lines];
        const existing = lines.find((line) => line.key === key);

        if (existing) {
          existing.quantity = Math.min(existing.quantity + quantity, MAX_PER_LINE, variant.stock ?? MAX_PER_LINE);
        } else {
          lines.push({
            key,
            productId: product._id,
            variantId: variant._id,
            quantity: Math.min(quantity, MAX_PER_LINE),
            // --- display snapshot (never trusted for money) ---
            title: product.title,
            titleBn: product.titleBn ?? '',
            variantLabel: variant.label,
            unitPrice: variant.salePrice ?? variant.price,
            compareAtPrice: variant.compareAtPrice ?? null,
            image: product.image,
            slug: product.slug,
            availableStock: variant.stock ?? null,
          });
        }

        set({ lines, isOpen: true });
      },

      /** Set an exact quantity; 0 removes the line. */
      setQuantity(key, quantity) {
        const clamped = Math.max(0, Math.min(Number(quantity) || 0, MAX_PER_LINE));
        set({
          lines: clamped === 0
            ? get().lines.filter((line) => line.key !== key)
            : get().lines.map((line) => (line.key === key ? { ...line, quantity: clamped } : line)),
        });
      },

      remove(key) {
        set({ lines: get().lines.filter((line) => line.key !== key) });
      },

      /** Called after a successful checkout. */
      clear() {
        set({ lines: [], isOpen: false });
      },

      /**
       * Reconcile the snapshot against a server quote: refresh prices/stock and
       * drop lines the API reported as gone (product archived, variant removed).
       */
      applyQuote(quote) {
        if (!quote) return;
        const unavailable = new Set((quote.unavailable ?? []).map((u) => lineKey(u.productId, u.variantId)));
        const priced = new Map((quote.lines ?? []).map((l) => [lineKey(l.productId, l.variantId), l]));
        set({
          lines: get().lines
            .filter((line) => !unavailable.has(line.key))
            .map((line) => {
              const fresh = priced.get(line.key);
              return fresh
                ? { ...line, unitPrice: fresh.unitPrice, compareAtPrice: fresh.compareAtPrice, availableStock: fresh.availableStock }
                : line;
            }),
        });
      },
    }),
    {
      name: 'gramrosh.cart',
      // Only the basket itself survives a reload; the drawer starts closed.
      partialize: (state) => ({ lines: state.lines }),
    },
  ),
);

/* ---- derived selectors ---------------------------------------------------- */

export const useCartCount = () => useCartStore((s) => s.lines.reduce((n, l) => n + l.quantity, 0));

export const useCartSubtotal = () => useCartStore((s) => s.lines.reduce((n, l) => n + l.unitPrice * l.quantity, 0));

/** The payload shape `/orders/quote` and `/orders` expect. */
export const toOrderItems = (lines) => lines.map((l) => ({ productId: l.productId, variantId: l.variantId, quantity: l.quantity }));
