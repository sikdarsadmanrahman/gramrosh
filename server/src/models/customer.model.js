/**
 * -----------------------------------------------------------------------------
 *  customer.model.js — Customer database (name, phone, address, order history)
 * -----------------------------------------------------------------------------
 *  Guests check out without an account, so a Customer record is *created
 *  implicitly* on the first order and merged on every subsequent one. The
 *  identity key is the **phone number** — that is why it is normalised to E.164
 *  before save and carries a unique index: it is both the de-duplication key and
 *  the lookup path for "find my order" support calls.
 * -----------------------------------------------------------------------------
 */
import mongoose from 'mongoose';
import { normalizePhone, formatPhone } from '../utils/phone.js';
import { SHIPPING_ZONE } from '../config/constants.js';

const { Schema, Types } = mongoose;

/**
 * Reusable postal address. Exported because `Order` snapshots the address at
 * purchase time (a customer moving house must never rewrite an old invoice).
 */
export const addressSchema = new Schema(
  {
    label: { type: String, trim: true, default: 'Home' },
    line1: { type: String, required: true, trim: true, maxlength: 200 },
    line2: { type: String, trim: true, maxlength: 200, default: '' },
    area: { type: String, trim: true, maxlength: 100, default: '' },
    city: { type: String, trim: true, maxlength: 100, default: '' },
    district: { type: String, required: true, trim: true, maxlength: 60 },
    postalCode: { type: String, trim: true, maxlength: 12, default: '' },
    landmark: { type: String, trim: true, maxlength: 160, default: '' },
    /** Resolved automatically from `district` — drives the shipping fee. */
    shippingZone: { type: String, enum: Object.values(SHIPPING_ZONE), default: SHIPPING_ZONE.OUTSIDE_DHAKA },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true },
);

const customerSchema = new Schema(
  {
    name: { type: String, required: [true, 'Customer name is required'], trim: true, maxlength: 120 },
    /**
     * Canonical E.164 phone: `+8801711223344`.
     * Unique — one customer document per phone number, forever.
     */
    phone: {
      type: String,
      required: [true, 'Customer phone is required'],
      unique: true,
      trim: true,
      maxlength: 20,
    },
    /** Human friendly rendering (`+880 1711-223344`) for the admin table. */
    phonePretty: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, maxlength: 160, default: null },

    /** Primary address — copied onto every new order by default. */
    address: { type: addressSchema, default: undefined },
    /** Saved address book (max 5 kept in the UI). */
    addresses: { type: [addressSchema], default: [] },

    notes: { type: String, trim: true, maxlength: 600, default: '' },
    tags: { type: [String], default: [] },

    marketing: {
      smsOptIn: { type: Boolean, default: false },
      emailOptIn: { type: Boolean, default: false },
      source: { type: String, trim: true, default: 'web' },
    },

    /** Denormalised RFM-ish counters, maintained by the order service. */
    stats: {
      totalOrders: { type: Number, min: 0, default: 0 },
      /** Lifetime value across non-cancelled orders. */
      totalSpent: { type: Number, min: 0, default: 0 },
      itemsPurchased: { type: Number, min: 0, default: 0 },
      /**
       * Deliberately *absent* rather than `null`: MongoDB's `$min`/`$max` treat
       * null as smaller than any date, so a null default would never be replaced
       * by the first order's timestamp.
       */
      firstOrderAt: { type: Date },
      lastOrderAt: { type: Date },
      /** Rolling average order value — surfaced in the admin customer drawer. */
      avgOrderValue: { type: Number, min: 0, default: 0 },
    },

    /** Simple lifecycle tag for the CRM view. */
    segment: {
      type: String,
      enum: ['new', 'returning', 'vip', 'at_risk', 'blocked'],
      default: 'new',
    },

    /** Set when the guest later registers an account. */
    user: { type: Types.ObjectId, ref: 'Admin', default: null },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

/* -------------------------------------------------------------------------- */
/*  Indexes                                                                   */
/* -------------------------------------------------------------------------- */

// `phone` unique index (declared inline) — the de-dup + support lookup path.
// Admin "customers" table: newest first.
customerSchema.index({ createdAt: -1 });
// CRM: most recently active customers.
customerSchema.index({ 'stats.lastOrderAt': -1 });
// Segment / value filtering.
customerSchema.index({ segment: 1, 'stats.totalSpent': -1 });
// Delivery routing reports.
customerSchema.index({ 'address.district': 1 });
// Free-text search across name/phone/email in the admin search box.
customerSchema.index({ name: 'text', phone: 'text', email: 'text' }, { name: 'customer_text_search' });

/* -------------------------------------------------------------------------- */
/*  Hooks & helpers                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Pure derivation: canonicalise the phone (the identity key), render the pretty
 * form, and guarantee exactly one default address.
 *
 * @param {object} doc
 * @returns {object}
 */
export function deriveCustomer(doc) {
  const normalized = normalizePhone(doc.phone);
  if (normalized) {
    doc.phone = normalized;
    doc.phonePretty = formatPhone(normalized);
  } else if (!doc.phonePretty && doc.phone) {
    doc.phonePretty = formatPhone(doc.phone);
  }

  if (Array.isArray(doc.addresses) && doc.addresses.length) {
    if (!doc.addresses.some((a) => a.isDefault)) doc.addresses[0].isDefault = true;
    let seenDefault = false;
    for (const address of doc.addresses) {
      if (address.isDefault) {
        if (seenDefault) address.isDefault = false;
        seenDefault = true;
      }
    }
  }
  return doc;
}

customerSchema.pre('validate', function normalizePhoneNumber(next) {
  deriveCustomer(this);
  next();
});

customerSchema.virtual('orderCount').get(function orderCount() {
  return this.stats?.totalOrders ?? 0;
});

/** Static: recompute `segment` from lifetime value + recency. */
customerSchema.statics.recomputeSegment = async function recomputeSegment(id) {
  const customer = await this.findById(id).lean();
  if (!customer) return null;
  const { totalOrders = 0, totalSpent = 0, lastOrderAt } = customer.stats ?? {};
  const daysSince = lastOrderAt ? (Date.now() - new Date(lastOrderAt).getTime()) / 86_400_000 : Infinity;

  let segment = 'new';
  if (totalOrders >= 6 || totalSpent >= 15_000) segment = 'vip';
  else if (totalOrders >= 2) segment = 'returning';
  if (daysSince > 180 && totalOrders > 0) segment = 'at_risk';
  if (customer.segment === 'blocked') segment = 'blocked';

  await this.updateOne({ _id: id }, { $set: { segment } });
  return segment;
};

export const Customer = mongoose.models.Customer || mongoose.model('Customer', customerSchema);
export { customerSchema };
export default Customer;
