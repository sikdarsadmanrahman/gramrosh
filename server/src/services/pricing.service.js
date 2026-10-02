/**
 * -----------------------------------------------------------------------------
 *  pricing.service.js — The automated shipping calculator & order quote
 * -----------------------------------------------------------------------------
 *  Single source of truth for money. The storefront calls `POST /api/orders/quote`
 *  (via `GET /api/config`) to *display* a total, and the checkout calls the same
 *  function to *persist* it — so what the customer saw is what gets stored, and
 *  neither number ever comes from the browser.
 *
 *  Rules:
 *    • Inside Dhaka  → ৳60
 *    • Outside Dhaka → ৳120
 *    • Subtotal ≥ FREE_SHIPPING_THRESHOLD → shipping waived
 *    • COD and the three mobile-banking wallets carry no surcharge today; the
 *      `fee` field exists so one can be added without touching checkout code.
 * -----------------------------------------------------------------------------
 */
import { env } from '../config/env.js';
import {
  DISTRICTS, SHIPPING_METHODS, SHIPPING_ZONE, PAYMENT_METHODS, DHAKA_DISTRICTS,
} from '../config/constants.js';

/** Normalise a district name for comparison ("Dhaka " → "dhaka"). */
function normalizeDistrict(district) {
  return String(district ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Resolve a shipping zone from a district name.
 *
 * Dhaka city and its surrounding upazilas (Savar, Keraniganj, Dhamrai, Dohar,
 * Nawabganj) are the standard "Inside Dhaka" delivery area used by BD couriers.
 *
 * @param {string} district
 * @returns {'inside_dhaka'|'outside_dhaka'}
 */
export function resolveShippingZone(district) {
  const normalized = normalizeDistrict(district);
  if (!normalized) return SHIPPING_ZONE.OUTSIDE_DHAKA;
  return DHAKA_DISTRICTS.includes(normalized) ? SHIPPING_ZONE.INSIDE_DHAKA : SHIPPING_ZONE.OUTSIDE_DHAKA;
}

/** @param {'inside_dhaka'|'outside_dhaka'} zone */
export function getShippingMethod(zone) {
  return SHIPPING_METHODS.find((m) => m.id === zone) ?? SHIPPING_METHODS[SHIPPING_METHODS.length - 1];
}

/** @param {string} id e.g. `bkash` */
export function getPaymentMethod(id) {
  return PAYMENT_METHODS.find((m) => m.id === String(id ?? '').toLowerCase()) ?? null;
}

/**
 * Shipping fee for a zone, honouring the free-shipping threshold.
 *
 * @param {{zone:string, subtotal:number}} input
 * @returns {{fee:number, freeShipping:boolean, threshold:number, savings:number}}
 */
export function calculateShipping({ zone, subtotal }) {
  const method = getShippingMethod(zone);
  const threshold = env.FREE_SHIPPING_THRESHOLD;
  const qualifies = threshold > 0 && subtotal >= threshold;
  return {
    fee: qualifies ? 0 : method.fee,
    standardFee: method.fee,
    freeShipping: qualifies,
    threshold,
    savings: qualifies ? method.fee : 0,
    /** How much more the customer needs to add to unlock free delivery. */
    remainingForFreeShipping: qualifies ? 0 : Math.max(0, threshold - subtotal),
    label: method.label,
    etaDays: method.etaDays,
  };
}

/**
 * Price a basket.
 *
 * @param {object} input
 * @param {Array<{unitPrice:number, quantity:number, compareAtPrice?:number|null}>} input.items
 *        **already resolved from the database** — never from the request body.
 * @param {string}  input.district         delivery district (drives the zone)
 * @param {object} [input.coupon]           `{ code, value }` — flat BDT discount
 * @param {string} [input.paymentMethod]    adds a per-method surcharge when set
 * @param {boolean}[input.forceZone]        admin override for phone orders
 * @returns {object} the pricing block stored on the order + a display breakdown
 */
export function quoteOrder({ items, district, coupon = null, paymentMethod = null, forceZone = null }) {
  const lineItems = (items ?? []).map((item) => {
    const unitPrice = Math.max(0, Number(item.unitPrice) || 0);
    const quantity = Math.max(1, Number(item.quantity) || 1);
    const compareAtPrice = item.compareAtPrice == null ? null : Math.max(0, Number(item.compareAtPrice) || 0);
    return {
      ...item,
      unitPrice,
      quantity,
      compareAtPrice,
      total: Number((unitPrice * quantity).toFixed(2)),
      /** Savings versus the strike-through price, per line. */
      lineSavings: compareAtPrice && compareAtPrice > unitPrice ? (compareAtPrice - unitPrice) * quantity : 0,
    };
  });

  const subtotal = Number(lineItems.reduce((sum, item) => sum + item.total, 0).toFixed(2));
  const listTotal = Number(
    lineItems.reduce((sum, item) => sum + (item.compareAtPrice ? item.compareAtPrice * item.quantity : item.total), 0).toFixed(2),
  );

  // --- coupon (flat discount, capped at the subtotal) ----------------------
  const couponDiscount = coupon && Number(coupon.value) > 0
    ? Math.min(Number(coupon.value), subtotal)
    : 0;

  // --- shipping ------------------------------------------------------------
  const zone = forceZone ?? resolveShippingZone(district);
  const shipping = calculateShipping({ zone, subtotal: subtotal - couponDiscount });

  // --- payment surcharge ---------------------------------------------------
  const method = getPaymentMethod(paymentMethod);
  const paymentFee = method?.fee ?? 0;

  const tax = 0; // VAT is inclusive in BD retail pricing for this catalogue.
  // `discount` is what is actually deducted; `savings` is the marketing total
  // (product markdowns + coupon). Conflating the two double-counts markdowns.
  const discount = Number(couponDiscount.toFixed(2));
  const savings = Number((couponDiscount + (listTotal - subtotal)).toFixed(2));
  const grandTotal = Number(Math.max(0, subtotal - discount + shipping.fee + paymentFee + tax).toFixed(2));

  return {
    items: lineItems,
    pricing: {
      subtotal,
      discount,
      savings,
      shippingFee: shipping.fee,
      paymentFee,
      tax,
      grandTotal,
      currency: env.CURRENCY,
    },
    /**
     * The shipping calculator's answer, shaped for the checkout UI. `breakdown`
     * below keeps the full arithmetic audit trail; this block is what the
     * client renders next to the district selector.
     */
    shipping: {
      id: zone,
      zone,
      label: shipping.label,
      fee: shipping.fee,
      standardFee: shipping.standardFee,
      isFree: Boolean(shipping.freeShipping),
      threshold: shipping.threshold,
      remainingForFreeShipping: shipping.remainingForFreeShipping,
      etaDays: shipping.etaDays,
      description: shipping.description ?? null,
    },
    breakdown: {
      ...shipping,
      zone,
      subtotal,
      listTotal,
      productSavings: Number((listTotal - subtotal).toFixed(2)),
      couponCode: coupon?.code ?? null,
      couponDiscount,
      totalSavings: savings,
      paymentFee,
      paymentMethodLabel: method?.label ?? null,
      grandTotal,
      currency: env.CURRENCY,
      currencySymbol: env.CURRENCY_SYMBOL,
      itemCount: lineItems.reduce((sum, item) => sum + item.quantity, 0),
    },
  };
}

/** Public description of shipping + payment options (served by `GET /api/config`). */
export function getCommerceConfig() {
  return {
    currency: env.CURRENCY,
    currencySymbol: env.CURRENCY_SYMBOL,
    freeShippingThreshold: env.FREE_SHIPPING_THRESHOLD,
    shippingMethods: SHIPPING_METHODS.map((method) => ({ ...method })),
    paymentMethods: PAYMENT_METHODS.map((method) => ({ ...method })),
    districts: [...DISTRICTS],
    dhakaDistricts: [...DHAKA_DISTRICTS],
    defaultPageSize: env.DEFAULT_PAGE_SIZE,
    maxPageSize: env.MAX_PAGE_SIZE,
  };
}
