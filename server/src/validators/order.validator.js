/**
 * -----------------------------------------------------------------------------
 *  validators/order.validator.js
 * -----------------------------------------------------------------------------
 *  IMPORTANT: the checkout payload carries **no prices**. The client sends
 *  `productId + variantId + quantity` and the order service prices the basket
 *  from the database, so a tampered request cannot buy ৳1,600 honey for ৳1.
 * -----------------------------------------------------------------------------
 */
import { z } from 'zod';
import { ORDER_STATUS_LIST, PAYMENT_METHOD, PAYMENT_METHOD_IDS, PAYMENT_STATUS, SHIPPING_ZONE, DISTRICTS, ORDER_SOURCES } from '../config/constants.js';
import {
  objectId, text, optionalText, bdPhone, bdPhoneOptional, emailOptional,
  paginationQuery, blankToUndefined, queryBoolean, stringArray,
} from './common.validator.js';

/* -------------------------------------------------------------------------- */
/*  Storefront checkout                                                       */
/* -------------------------------------------------------------------------- */

const shippingAddressInput = z.object({
  line1: text(200),
  line2: optionalText(200),
  area: optionalText(100),
  city: optionalText(100),
  district: z.enum(DISTRICTS, { errorMap: () => ({ message: 'Select a valid district' }) }),
  postalCode: optionalText(12),
  landmark: optionalText(160),
});

const paymentInput = z.object({
  method: z.enum(PAYMENT_METHOD_IDS),
  /** Mobile banking: the sender's own number. */
  senderPhone: bdPhoneOptional,
  /** Mobile banking: bKash / Nagad / Rocket transaction id. */
  transactionId: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toUpperCase().replace(/\s+/g, '') : v),
    z.string().min(4, 'Transaction ID looks too short').max(40).optional(),
  ),
  note: optionalText(300),
});

/**
 * The order payload shape, kept separate from its refinement because
 * `z.object(...).superRefine(...)` returns ZodEffects — which has no `.extend()`
 * for the admin variant below to build on.
 */
const orderShape = {
  customer: z.object({
    name: text(120),
    phone: bdPhone,
    email: emailOptional,
    alternatePhone: bdPhoneOptional,
  }),
  shippingAddress: shippingAddressInput,
  items: z.array(z.object({
    productId: objectId,
    variantId: objectId,
    quantity: z.coerce.number().int().min(1).max(99),
  })).min(1, 'Your cart is empty').max(50),
  payment: paymentInput,
  /**
   * Optional: the client's idea of the zone. The server re-derives it from
   * `district` and always wins — this field only exists so a mismatch can be
   * logged as a signal that the storefront cache is stale.
   */
  shippingMethod: z.enum(Object.values(SHIPPING_ZONE)).optional(),
  couponCode: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v),
    z.string().min(2).max(30).optional(),
  ),
  notes: optionalText(600),
  deliveryNote: optionalText(300),
  /**
   * Declared intake channel. `channel` is deliberately absent: the server
   * derives it from the authenticated surface and would ignore anything here.
   */
  meta: z.object({
    source: z.enum(ORDER_SOURCES).optional(),
  }).optional(),
};

const orderObject = z.object(orderShape);

/**
 * Mobile banking (bKash / Nagad / Rocket) is reconciled by hand: without the
 * sender's phone number and the TrxID from the confirmation SMS the finance team
 * cannot match the transfer, so the order would be stuck forever. COD needs
 * neither.
 */
const requireMobileBankingProof = (value, ctx) => {
  if (value.payment.method === PAYMENT_METHOD.COD) return;

  if (!value.payment.senderPhone) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['payment', 'senderPhone'],
      message: 'Enter the phone number you sent the money from',
    });
  }
  if (!value.payment.transactionId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['payment', 'transactionId'],
      message: 'Enter the transaction ID (TrxID) from your payment confirmation SMS',
    });
  }
};

/** POST /api/orders */
export const createOrderBody = orderObject.superRefine(requireMobileBankingProof);

/**
 * POST /api/orders/quote — the shipping calculator / basket pricer.
 *
 * Validated rather than read raw so malformed carts never reach the pricing
 * service, and so an empty basket is a clean 422 that names the field.
 */
export const quoteOrderBody = z.object({
  items: z.array(z.object({
    productId: objectId,
    variantId: objectId,
    quantity: z.coerce.number().int().min(1).max(99),
  })).min(1, 'Your cart is empty — add a product to see a delivery estimate').max(50),
  /** District name; the server derives the ৳60 / ৳120 zone from it. */
  district: z.preprocess(blankToUndefined, z.string().trim().max(60).optional().default('')),
  paymentMethod: z.preprocess(blankToUndefined, z.enum(PAYMENT_METHOD_IDS).optional()),
  couponCode: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v),
    z.string().min(2).max(30).optional(),
  ),
  shippingMethod: z.preprocess(blankToUndefined, z.enum(Object.values(SHIPPING_ZONE)).optional()),
});

/** GET /api/orders/lookup — public order tracking. */
export const lookupOrderQuery = z.object({
  orderNumber: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v),
    z.string().regex(/^GR-\d{4}-\d{6}$/, 'Order number looks like GR-2026-000417'),
  ),
  /** Last line of defence: the phone on the order must match. */
  phone: bdPhone,
});

/** GET /api/orders/:orderNumber/invoice (public, same pairing rule). */
export const invoiceAccessQuery = z.object({
  phone: bdPhoneOptional,
  format: z.enum(['html', 'json']).default('html'),
});

/* -------------------------------------------------------------------------- */
/*  Admin                                                                     */
/* -------------------------------------------------------------------------- */

/** GET /api/admin/orders */
export const listOrdersQuery = paginationQuery.extend({
  status: z.preprocess(blankToUndefined, z.enum(ORDER_STATUS_LIST).optional()),
  statuses: stringArray,
  paymentMethod: z.preprocess(blankToUndefined, z.enum(PAYMENT_METHOD_IDS).optional()),
  paymentStatus: z.preprocess(blankToUndefined, z.enum(Object.values(PAYMENT_STATUS)).optional()),
  shippingMethod: z.preprocess(blankToUndefined, z.enum(Object.values(SHIPPING_ZONE)).optional()),
  customer: z.preprocess(blankToUndefined, objectId.optional()),
  district: z.preprocess(blankToUndefined, z.string().trim().max(60).optional()),
  q: z.preprocess(blankToUndefined, z.string().trim().max(120).optional()),
  from: z.preprocess(blankToUndefined, z.coerce.date().optional()),
  to: z.preprocess(blankToUndefined, z.coerce.date().optional()),
  minTotal: z.preprocess(blankToUndefined, z.coerce.number().min(0).optional()),
  maxTotal: z.preprocess(blankToUndefined, z.coerce.number().min(0).optional()),
  isPaid: queryBoolean,
  sort: z.preprocess(blankToUndefined, z.enum(['newest', 'oldest', 'total_desc', 'total_asc', 'status']).optional()).transform((v) => v ?? 'newest'),
});

export const orderIdParams = z.object({ id: z.string().trim().min(4).max(40) });

/** PATCH /api/admin/orders/:id/status */
export const updateOrderStatusBody = z.object({
  status: z.enum(ORDER_STATUS_LIST),
  note: optionalText(300),
  /** Reason captured when cancelling. */
  reason: optionalText(300),
  /** Courier details, accepted together with a move to `Shipped`. */
  courier: optionalText(80),
  trackingNumber: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v),
    z.string().max(60).optional(),
  ),
  trackingUrl: optionalText(300),
}).refine((v) => v.status !== 'Cancelled' || Boolean(v.reason ?? v.note), {
  message: 'A cancellation reason is required',
  path: ['reason'],
});

/** PATCH /api/admin/orders/:id/payment — manual reconciliation. */
export const updatePaymentBody = z.object({
  status: z.enum(Object.values(PAYMENT_STATUS)),
  senderPhone: bdPhoneOptional,
  transactionId: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toUpperCase().replace(/\s+/g, '') : v),
    z.string().min(4).max(40).optional(),
  ),
  note: optionalText(300),
});

/** PATCH /api/admin/orders/:id/shipping */
export const updateShippingBody = z.object({
  courier: optionalText(80),
  trackingNumber: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v),
    z.string().max(60).optional(),
  ),
  trackingUrl: optionalText(300),
  etaDays: z.tuple([z.coerce.number().int().min(0), z.coerce.number().int().min(0)]).optional(),
});

/** POST /api/admin/orders — staff-created (phone / WhatsApp) order. */
export const adminCreateOrderBody = orderObject
  .extend({
    /** Staff may drop an order straight into a later pipeline stage. */
    status: z.enum(ORDER_STATUS_LIST).optional(),
    /** Higher quantity ceiling and an optional negotiated unit price. */
    items: z.array(z.object({
      productId: objectId,
      variantId: objectId,
      quantity: z.coerce.number().int().min(1).max(999),
      unitPriceOverride: z.coerce.number().min(0).optional(),
    })).min(1).max(50),
  })
  .superRefine(requireMobileBankingProof);

/** GET /api/admin/orders/export (CSV) */
export const exportOrdersQuery = listOrdersQuery.omit({ page: true, limit: true, skip: true }).extend({
  format: z.enum(['csv', 'json']).default('csv'),
});
