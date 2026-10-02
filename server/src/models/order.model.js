/**
 * -----------------------------------------------------------------------------
 *  order.model.js — Orders, payment reconciliation & the status pipeline
 * -----------------------------------------------------------------------------
 *  Two principles drive this schema:
 *
 *  1. ORDERS ARE IMMUTABLE SNAPSHOTS. Title, image, unit price and the delivery
 *     address are copied onto the line items at purchase time. A merchant
 *     renaming a product or a customer moving house must never rewrite history —
 *     the printed invoice has to match what was actually shipped.
 *
 *  2. THE STATUS IS A PIPELINE, NOT A FREE-FOR-ALL. `status` is an enum and
 *     every transition is appended to `statusHistory` (who, when, why), which is
 *     what makes the admin timeline and the customer's tracking page possible.
 * -----------------------------------------------------------------------------
 */
import mongoose from 'mongoose';
import { addressSchema } from './customer.model.js';
import { ORDER_STATUS, ORDER_STATUS_LIST, PAYMENT_METHOD_IDS, PAYMENT_STATUS, SHIPPING_METHODS, REVENUE_STATUSES, ORDER_SOURCE, ORDER_SOURCES, ORDER_CHANNEL, ORDER_CHANNELS } from '../config/constants.js';
import { normalizePhone, formatPhone } from '../utils/phone.js';

const { Schema, Types } = mongoose;

const SHIPPING_METHOD_IDS = SHIPPING_METHODS.map((m) => m.id);

/* -------------------------------------------------------------------------- */
/*  Sub-schemas                                                               */
/* -------------------------------------------------------------------------- */

/** A purchased line, frozen at checkout. */
const orderItemSchema = new Schema(
  {
    product: { type: Types.ObjectId, ref: 'Product', required: true },
    variant: { type: Types.ObjectId, required: true },
    /** Snapshot fields — see file header. */
    title: { type: String, required: true, trim: true },
    titleBn: { type: String, trim: true, default: '' },
    variantLabel: { type: String, required: true, trim: true },
    sku: { type: String, trim: true, uppercase: true },
    image: { type: String, trim: true, default: '' },
    categoryName: { type: String, trim: true, default: '' },
    unitPrice: { type: Number, required: true, min: 0 },
    compareAtPrice: { type: Number, min: 0, default: null },
    quantity: { type: Number, required: true, min: 1 },
    /** `unitPrice * quantity` — stored so reports never recompute. */
    total: { type: Number, required: true, min: 0 },
    /** Set when this line was purchased under a flash sale. */
    wasFlashSale: { type: Boolean, default: false },
  },
  { _id: true },
);

const pricingSchema = new Schema(
  {
    /** Sum of the line totals, at selling prices. */
    subtotal: { type: Number, required: true, min: 0 },
    /**
     * Amount *actually deducted* from the subtotal (coupon only). This is the
     * figure `grandTotal` is computed from — keeping it separate from `savings`
     * is what stops product markdowns being subtracted twice.
     */
    discount: { type: Number, min: 0, default: 0 },
    /**
     * Informational total the shopper sees as "you saved": product markdowns
     * (compareAtPrice − price) plus the coupon. Never used in arithmetic.
     */
    savings: { type: Number, min: 0, default: 0 },
    shippingFee: { type: Number, required: true, min: 0 },
    /** Per-method surcharge (0 for COD and the current mobile-banking setup). */
    paymentFee: { type: Number, min: 0, default: 0 },
    tax: { type: Number, min: 0, default: 0 },
    grandTotal: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'BDT', uppercase: true },
  },
  { _id: false },
);

const shippingSchema = new Schema(
  {
    method: { type: String, required: true, enum: SHIPPING_METHOD_IDS },
    label: { type: String, trim: true, default: '' },
    etaDays: { type: [Number], default: [2, 4] },
    courier: { type: String, trim: true, default: '' },
    /** Parcel tracking number printed on the shipping slip. */
    trackingNumber: { type: String, trim: true, default: null },
    trackingUrl: { type: String, trim: true, default: null },
    shippedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
  },
  { _id: false },
);

const paymentSchema = new Schema(
  {
    method: { type: String, required: true, enum: PAYMENT_METHOD_IDS },
    status: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.UNPAID,
    },
    /** Mobile banking: the customer's *sender* number. */
    senderPhone: { type: String, trim: true, default: null },
    senderPhonePretty: { type: String, trim: true, default: '' },
    /** Mobile banking: bKash/Nagad/Rocket transaction id. */
    transactionId: { type: String, trim: true, uppercase: true, default: null },
    /** Merchant wallet the money was sent to (for reconciliation). */
    merchantNumber: { type: String, trim: true, default: null },
    note: { type: String, trim: true, maxlength: 300, default: '' },
    paidAt: { type: Date, default: null },
    verifiedBy: { type: Types.ObjectId, ref: 'Admin', default: null },
    verifiedAt: { type: Date, default: null },
  },
  { _id: false },
);

const statusHistoryEntrySchema = new Schema(
  {
    status: { type: String, required: true, enum: ORDER_STATUS_LIST },
    note: { type: String, trim: true, maxlength: 300, default: '' },
    changedBy: { type: Types.ObjectId, ref: 'Admin', default: null },
    changedByName: { type: String, trim: true, default: 'System' },
    at: { type: Date, default: () => new Date() },
  },
  { _id: false },
);

const couponSchema = new Schema(
  {
    code: { type: String, trim: true, uppercase: true, required: true },
    type: { type: String, enum: ['percentage', 'flat', 'free_shipping'], default: 'flat' },
    value: { type: Number, min: 0, default: 0 },
    discount: { type: Number, min: 0, default: 0 },
  },
  { _id: false },
);

const invoiceSchema = new Schema(
  {
    number: { type: String, trim: true, default: '' },
    issuedAt: { type: Date, default: null },
    notes: { type: String, trim: true, maxlength: 300, default: '' },
  },
  { _id: false },
);

/* -------------------------------------------------------------------------- */
/*  Main schema                                                               */
/* -------------------------------------------------------------------------- */

const orderSchema = new Schema(
  {
    /**
     * Public identifier printed on the parcel & invoice (GR-2026-000417).
     * Unique + indexed: this is the field customers quote over the phone.
     */
    orderNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },

    customer: { type: Types.ObjectId, ref: 'Customer', required: true },

    /** Contact snapshot — the customer document may change later. */
    contact: {
      name: { type: String, required: true, trim: true, maxlength: 120 },
      phone: { type: String, required: true, trim: true, maxlength: 20 },
      phonePretty: { type: String, trim: true, default: '' },
      email: { type: String, trim: true, lowercase: true, default: null },
    },

    shippingAddress: { type: addressSchema, required: true },
    /** Second phone for the rider, common in BD deliveries. */
    alternatePhone: { type: String, trim: true, default: '' },

    items: {
      type: [orderItemSchema],
      validate: [(v) => Array.isArray(v) && v.length > 0, 'An order needs at least one item'],
    },

    pricing: { type: pricingSchema, required: true },
    shipping: { type: shippingSchema, required: true },
    payment: { type: paymentSchema, required: true },
    coupon: { type: couponSchema, default: undefined },
    invoice: { type: invoiceSchema, default: undefined },

    /** Current position in the Pending → … → Delivered pipeline. */
    status: { type: String, enum: ORDER_STATUS_LIST, default: ORDER_STATUS.PENDING },
    statusHistory: { type: [statusHistoryEntrySchema], default: [] },
    cancellation: {
      reason: { type: String, trim: true, maxlength: 300, default: '' },
      cancelledBy: { type: Types.ObjectId, ref: 'Admin', default: null },
      cancelledByName: { type: String, trim: true, default: '' },
      at: { type: Date, default: null },
    },

    /** Quick aggregates for list views (avoids `$size`/`$sum` on every read). */
    totals: {
      itemCount: { type: Number, min: 0, default: 0 },
      uniqueItems: { type: Number, min: 0, default: 0 },
    },

    notes: { type: String, trim: true, maxlength: 600, default: '' },
    /** Customer-facing delivery instruction shown on the rider's slip. */
    deliveryNote: { type: String, trim: true, maxlength: 300, default: '' },

    isPaid: { type: Boolean, default: false },
    isArchived: { type: Boolean, default: false },
    /** Set once the printable invoice has been generated. */
    invoiceGeneratedAt: { type: Date, default: null },

    meta: {
      ip: { type: String, trim: true, default: '' },
      userAgent: { type: String, trim: true, maxlength: 400, default: '' },
      /**
       * Declared intake channel (phone / WhatsApp / web …). Informational:
       * whoever took the order sets it, so it answers "where do orders come
       * from?" but is never trusted for authorisation.
       */
      source: { type: String, enum: ORDER_SOURCES, default: ORDER_SOURCE.WEB },
      /**
       * Server-derived writing surface. An order created through the admin API
       * is `admin` no matter what the body claimed, which keeps staff orders
       * separable from real storefront checkouts.
       */
      channel: { type: String, enum: ORDER_CHANNELS, default: ORDER_CHANNEL.STOREFRONT },
      /** Which staff account keyed in this order (admin-channel orders only). */
      takenBy: {
        id: { type: String, trim: true, default: '' },
        email: { type: String, trim: true, lowercase: true, default: '' },
      },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

/* -------------------------------------------------------------------------- */
/*  Indexes — every admin screen maps to exactly one of these                 */
/* -------------------------------------------------------------------------- */

// ORDER ID LOOKUP (required) — customers quote `orderNumber`, not `_id`.
// The unique index is declared inline on the field itself (see `orderNumber`
// above); re-declaring it here would create a duplicate.

// TIME-BASED LISTING (required) — the default admin orders table.
orderSchema.index({ createdAt: -1 });

// STATUS PIPELINE FILTERING — `?status=Processing&sort=-createdAt`.
orderSchema.index({ status: 1, createdAt: -1 });

// CUSTOMER ORDER HISTORY — `?customer=<id>` on the customer profile page.
orderSchema.index({ customer: 1, createdAt: -1 });

// PHONE LOOKUP (required) — "find my order" by the number they called from.
orderSchema.index({ 'contact.phone': 1, createdAt: -1 });

// PAYMENT RECONCILIATION — search a bKash TrxID to verify a manual payment.
// UNIQUE + sparse: one confirmation SMS can only ever pay for one order, while
// COD orders (transactionId === null) are exempt from the constraint entirely.
orderSchema.index({ 'payment.transactionId': 1 }, { unique: true, sparse: true, name: 'payment_trxid_unique' });
orderSchema.index({ 'payment.status': 1, 'payment.method': 1 }, { name: 'payment_reconciliation' });

// COURIER / SHIPPING SLIP lookup.
orderSchema.index({ 'shipping.trackingNumber': 1 }, { sparse: true, name: 'shipping_tracking' });

// REVENUE REPORTS — group by status over a date range.
orderSchema.index({ status: 1, 'pricing.grandTotal': 1, createdAt: -1 }, { name: 'revenue_by_status' });

// STAFF vs STOREFRONT — "orders our team keyed in today", and the inverse
// filter that keeps hand-entered orders out of conversion analytics.
orderSchema.index({ 'meta.channel': 1, createdAt: -1 }, { name: 'orders_by_channel' });

// SALES ANALYTICS — "which products sold?" without a $lookup.
orderSchema.index({ 'items.product': 1 }, { name: 'items_product' });
orderSchema.index({ 'shippingAddress.district': 1, createdAt: -1 }, { name: 'orders_by_district' });

/* -------------------------------------------------------------------------- */
/*  Hooks & helpers                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Pure derivation for orders. Everything the client sends is *recomputed* here —
 * line totals, order totals, phone canonicalisation, the initial status timeline
 * entry and the invoice number. Money is never trusted from the browser.
 *
 * @param {object} doc
 * @param {{isNew?:boolean}} [ctx]
 * @returns {object}
 */
export function deriveOrder(doc, { isNew = false } = {}) {
  // --- contact / payment phone canonicalisation ---------------------------
  if (doc.contact) {
    const normalized = normalizePhone(doc.contact.phone);
    if (normalized) {
      doc.contact.phone = normalized;
      doc.contact.phonePretty = formatPhone(normalized);
    } else if (!doc.contact.phonePretty && doc.contact.phone) {
      doc.contact.phonePretty = formatPhone(doc.contact.phone);
    }
  }
  if (doc.payment?.senderPhone) {
    const sender = normalizePhone(doc.payment.senderPhone);
    if (sender) {
      doc.payment.senderPhone = sender;
      doc.payment.senderPhonePretty = formatPhone(sender);
    }
  }
  if (doc.alternatePhone) {
    const alt = normalizePhone(doc.alternatePhone);
    if (alt) doc.alternatePhone = alt;
  }

  // --- line & order totals (derived, never trusted) ------------------------
  let itemCount = 0;
  if (Array.isArray(doc.items)) {
    for (const item of doc.items) {
      item.total = Number(((Number(item.unitPrice) || 0) * (Number(item.quantity) || 0)).toFixed(2));
      itemCount += Number(item.quantity) || 0;
    }
  }
  doc.totals = { itemCount, uniqueItems: Array.isArray(doc.items) ? doc.items.length : 0 };

  // Recompute pricing so a tampered `grandTotal` cannot survive.
  // Only `discount` (the coupon) is subtracted: product markdowns are already
  // reflected in each line's `unitPrice`, so subtracting `savings` too would
  // discount them twice.
  if (doc.pricing) {
    const subtotal = (doc.items ?? []).reduce((sum, item) => sum + item.total, 0);
    const discount = Math.min(Number(doc.pricing.discount) || 0, subtotal);
    const shippingFee = Number(doc.pricing.shippingFee) || 0;
    const paymentFee = Number(doc.pricing.paymentFee) || 0;
    const tax = Number(doc.pricing.tax) || 0;
    const listTotal = (doc.items ?? []).reduce(
      (sum, item) => sum + (item.compareAtPrice ? item.compareAtPrice * item.quantity : item.total),
      0,
    );
    doc.pricing = {
      ...doc.pricing,
      subtotal,
      discount,
      savings: Number((discount + Math.max(0, listTotal - subtotal)).toFixed(2)),
      shippingFee,
      paymentFee,
      tax,
      grandTotal: Math.max(0, Number((subtotal - discount + shippingFee + paymentFee + tax).toFixed(2))),
      currency: doc.pricing.currency ?? 'BDT',
    };
  }

  // --- status timeline ------------------------------------------------------
  if ((isNew || !doc.statusHistory || doc.statusHistory.length === 0) && doc.status) {
    doc.statusHistory = [
      { status: doc.status, note: 'Order placed', changedBy: null, changedByName: 'System', at: new Date() },
    ];
  }

  // --- cancellation timestamps ---------------------------------------------
  if (doc.status === ORDER_STATUS.CANCELLED && doc.cancellation && !doc.cancellation.at) {
    doc.cancellation.at = new Date();
  }

  // --- invoice number -------------------------------------------------------
  if (doc.orderNumber && (!doc.invoice || !doc.invoice.number)) {
    doc.invoice = { ...(doc.invoice ?? {}), number: doc.orderNumber.replace('GR-', 'INV-'), issuedAt: doc.invoice?.issuedAt ?? null };
  }

  doc.isPaid = doc.payment?.status === PAYMENT_STATUS.PAID;
  return doc;
}

orderSchema.pre('validate', function normalizeContactPhone(next) {
  deriveOrder(this, { isNew: Boolean(this.isNew) });
  next();
});

orderSchema.pre('save', function computeTotalsAndHistory(next) {
  deriveOrder(this, { isNew: Boolean(this.isNew) });
  next();
});

/** Read-only convenience for list views. */
orderSchema.virtual('isCancellable').get(function isCancellable() {
  return [ORDER_STATUS.PENDING, ORDER_STATUS.PROCESSING].includes(this.status);
});

orderSchema.virtual('countsTowardsRevenue').get(function countsTowardsRevenue() {
  return REVENUE_STATUSES.includes(this.status);
});

/**
 * Static: append a status transition (validates the pipeline upstream).
 * @param {string|import('mongoose').Types.ObjectId} id
 * @param {object} params
 */
orderSchema.statics.pushStatus = function pushStatus(id, { status, note = '', changedBy = null, changedByName = 'System' }) {
  return this.findByIdAndUpdate(
    id,
    {
      $set: { status },
      $push: { statusHistory: { status, note, changedBy, changedByName, at: new Date() } },
    },
    { new: true },
  ).lean();
};

export const Order = mongoose.models.Order || mongoose.model('Order', orderSchema);
export { orderSchema };
export default Order;
