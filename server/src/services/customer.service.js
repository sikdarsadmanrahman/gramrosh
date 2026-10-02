/**
 * -----------------------------------------------------------------------------
 *  customer.service.js — The customer database
 * -----------------------------------------------------------------------------
 *  Checkout is guest-first: nobody registers. A Customer document is therefore
 *  *upserted by phone number* on the first order and merged on every later one,
 *  which is what makes the unique `phone` index the backbone of this collection:
 *  it is simultaneously the de-duplication key, the support-lookup key and the
 *  upsert target.
 * -----------------------------------------------------------------------------
 */
import mongoose from 'mongoose';
import { db } from '../db/index.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { normalizePhone, formatPhone, isValidBdPhone } from '../utils/phone.js';
import { resolveShippingZone } from './pricing.service.js';

/**
 * Find the customer for a phone number, creating the record on first contact.
 *
 * The upsert is a single atomic write against the unique `phone` index, so two
 * simultaneous first orders from the same number produce exactly one document.
 *
 * @param {{name:string, phone:string, email?:string|null, address?:object, source?:string}} input
 */
export async function findOrCreateCustomer({ name, phone, email = null, address = null, source = 'web' }) {
  const normalized = normalizePhone(phone);
  if (!normalized) {
    throw ApiError.badRequest('Enter a valid Bangladeshi mobile number (e.g. 01711223344)');
  }

  const set = { name: String(name).trim(), phonePretty: formatPhone(normalized) };
  if (email) set.email = String(email).toLowerCase();
  if (address) {
    set.address = { ...address, shippingZone: address.shippingZone ?? resolveShippingZone(address.district) };
  }

  const setOnInsert = {
    phone: normalized,
    segment: 'new',
    isActive: true,
    marketing: { smsOptIn: false, emailOptIn: Boolean(email), source },
    stats: { totalOrders: 0, totalSpent: 0, itemsPurchased: 0, avgOrderValue: 0 },
  };

  const customer = await db.Customer.findOneAndUpdate(
    { phone: normalized },
    { $set: set, $setOnInsert: setOnInsert },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();

  // Grow the saved address book. Done as a second write (rather than a `$push`)
  // so the de-duplication and the cap are plain JS that behaves identically on
  // MongoDB and on the in-process engine.
  if (address && customer) {
    await rememberAddress(customer, set.address);
  }

  return customer;
}

/** How many entries the address book keeps — enough to offer, small enough to render. */
const MAX_SAVED_ADDRESSES = 5;

/** Two addresses are "the same place" when their postal identity matches. */
function isSameAddress(a, b) {
  const key = (x) => [x?.line1, x?.line2, x?.area, x?.district, x?.postalCode]
    .map((part) => String(part ?? '').trim().toLowerCase())
    .join('|');
  return key(a) === key(b);
}

/**
 * Append a checkout address to the customer's address book if it is new.
 *
 * The newest entry wins as the default only when the book was empty, so an
 * admin's manual "make this the default" choice is never silently overridden.
 *
 * @param {object} customer the freshly upserted document
 * @param {object} address  normalised address (already carries `shippingZone`)
 */
async function rememberAddress(customer, address) {
  const saved = Array.isArray(customer.addresses) ? customer.addresses : [];
  if (saved.some((entry) => isSameAddress(entry, address))) return;

  const entry = {
    ...address,
    label: address.label || 'Home',
    isDefault: saved.length === 0,
  };

  // Keep the most recent N; the plain `address` field always holds the latest.
  const next = [...saved, entry].slice(-MAX_SAVED_ADDRESSES);
  await db.Customer.updateOne({ _id: customer._id }, { $set: { addresses: next } });
  customer.addresses = next;
}

/** Look a customer up by canonical phone (support tooling). */
export async function getCustomerByPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) throw ApiError.badRequest('Enter a valid Bangladeshi mobile number');
  return db.Customer.findOne({ phone: normalized }).lean();
}

/**
 * Fold a new order into the customer's lifetime counters and re-segment.
 *
 * @param {string} customerId
 * @param {{grandTotal:number, itemCount:number, placedAt:Date, counts?:boolean}} order
 */
export async function applyOrderToCustomer(customerId, { grandTotal, itemCount, placedAt, counts = true }) {
  if (!customerId) return null;
  const at = placedAt instanceof Date ? placedAt : new Date(placedAt ?? Date.now());

  if (counts) {
    await db.Customer.updateOne(
      { _id: customerId },
      {
        $inc: {
          'stats.totalOrders': 1,
          'stats.totalSpent': Math.max(0, Number(grandTotal) || 0),
          'stats.itemsPurchased': Math.max(0, Number(itemCount) || 0),
        },
        $set: { 'stats.lastOrderAt': at },
        $min: { 'stats.firstOrderAt': at },
      },
    );
  } else {
    // A cancellation: roll the lifetime value back.
    await db.Customer.updateOne(
      { _id: customerId },
      {
        $inc: {
          'stats.totalOrders': -1,
          'stats.totalSpent': -Math.max(0, Number(grandTotal) || 0),
          'stats.itemsPurchased': -Math.max(0, Number(itemCount) || 0),
        },
      },
    );
  }

  return refreshCustomerStats(customerId);
}

/** Recompute `avgOrderValue` and the lifecycle `segment` from the counters. */
export async function refreshCustomerStats(customerId) {
  const customer = await db.Customer.findById(customerId).lean();
  if (!customer) return null;

  const stats = customer.stats ?? {};
  const totalOrders = Math.max(0, stats.totalOrders ?? 0);
  const totalSpent = Math.max(0, stats.totalSpent ?? 0);
  const avgOrderValue = totalOrders ? Number((totalSpent / totalOrders).toFixed(2)) : 0;

  const daysSinceLastOrder = stats.lastOrderAt
    ? (Date.now() - new Date(stats.lastOrderAt).getTime()) / 86_400_000
    : Infinity;

  let segment = 'new';
  if (totalOrders >= 6 || totalSpent >= 15_000) segment = 'vip';
  else if (totalOrders >= 2) segment = 'returning';
  if (totalOrders > 0 && daysSinceLastOrder > 180) segment = 'at_risk';
  if (customer.segment === 'blocked') segment = 'blocked'; // manual override always wins

  await db.Customer.updateOne(
    { _id: customerId },
    { $set: { 'stats.avgOrderValue': avgOrderValue, 'stats.totalOrders': totalOrders, 'stats.totalSpent': totalSpent, segment } },
  );

  return { ...customer, segment, stats: { ...stats, avgOrderValue, totalOrders, totalSpent } };
}

/* -------------------------------------------------------------------------- */
/*  Admin CRUD                                                                */
/* -------------------------------------------------------------------------- */

/** Build the admin list filter from validated query params. */
function buildCustomerFilter(query = {}) {
  const filter = {};
  if (query.isActive !== undefined) filter.isActive = query.isActive;
  if (query.segment) filter.segment = query.segment;
  if (query.district) filter['address.district'] = new RegExp(String(query.district).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  if (query.tags?.length) filter.tags = { $in: query.tags };
  if (query.minOrders !== undefined) filter['stats.totalOrders'] = { $gte: query.minOrders };
  if (query.minSpent !== undefined) filter['stats.totalSpent'] = { ...(filter['stats.totalSpent'] ?? {}), $gte: query.minSpent };

  const term = String(query.q ?? '').trim();
  if (term) {
    const normalizedPhone = normalizePhone(term);
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const clauses = [
      { name: { $regex: new RegExp(escaped, 'i') } },
      { email: { $regex: new RegExp(escaped, 'i') } },
      { 'address.district': { $regex: new RegExp(escaped, 'i') } },
    ];
    // A phone-shaped search term hits the unique index directly.
    if (normalizedPhone) clauses.unshift({ phone: normalizedPhone });
    else clauses.unshift({ phone: { $regex: new RegExp(`${escaped.replace(/\D/g, '') || escaped}`) } });
    filter.$or = clauses;
  }
  return filter;
}

const CUSTOMER_SORTS = {
  newest: { createdAt: -1 },
  last_order: { 'stats.lastOrderAt': -1 },
  most_orders: { 'stats.totalOrders': -1 },
  highest_value: { 'stats.totalSpent': -1 },
  name: { name: 1 },
};

/** Paginated customer list for the admin table. */
export async function listCustomers(query = {}) {
  const filter = buildCustomerFilter(query);
  const sort = CUSTOMER_SORTS[query.sort] ?? CUSTOMER_SORTS.newest;
  const limit = query.limit ?? 20;
  const skip = query.skip ?? ((query.page ?? 1) - 1) * limit;

  const [items, total] = await Promise.all([
    db.Customer.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    db.Customer.countDocuments(filter),
  ]);
  return { items, total, page: query.page ?? 1, limit };
}

/**
 * Customer profile + order history (the admin "customer drawer").
 * Order history is paginated independently so a VIP with 300 orders does not
 * blow up the payload.
 */
export async function getCustomerProfile(id, { ordersPage = 1, ordersLimit = 10 } = {}) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest('Invalid customer id');

  const customer = await db.Customer.findById(id).lean();
  if (!customer) throw ApiError.notFound('Customer not found');

  const [orders, orderTotal] = await Promise.all([
    db.Order.find({ customer: id })
      .sort({ createdAt: -1 })
      .skip((ordersPage - 1) * ordersLimit)
      .limit(ordersLimit)
      .select({ orderNumber: 1, status: 1, createdAt: 1, 'pricing.grandTotal': 1, 'totals.itemCount': 1, 'payment.method': 1, 'payment.status': 1, 'shippingAddress.district': 1 })
      .lean(),
    db.Order.countDocuments({ customer: id }),
  ]);

  return { customer, orders, orderTotal, ordersPage, ordersLimit };
}

/**
 * Bulk CRM tagging — "mark these 40 customers as Eid campaign".
 *
 * Accepts several tags at once and an explicit `action`, so the admin UI can add
 * and remove with one code path. Both `$addToSet: {$each}` and `$pull: {$in}`
 * are single atomic writes, so a 500-customer selection costs one query.
 *
 * @param {{ids:string[], tags:string[], action?:'add'|'remove'}} input
 */
export async function bulkTagCustomers({ ids, tags, action = 'add' }) {
  const uniqueIds = [...new Set((ids ?? []).map(String).filter(Boolean))];
  const uniqueTags = [...new Set((tags ?? []).map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))];

  if (!uniqueIds.length) throw ApiError.badRequest('Provide a non-empty "ids" array');
  if (!uniqueTags.length) throw ApiError.badRequest('Provide at least one tag');

  const update = action === 'remove'
    ? { $pull: { tags: { $in: uniqueTags } } }
    : { $addToSet: { tags: { $each: uniqueTags } } };

  const result = await db.Customer.updateMany({ _id: { $in: uniqueIds } }, update);

  logger.info('[crm] bulk tag', { action, tags: uniqueTags, ids: uniqueIds.length, modified: result.modifiedCount ?? 0 });

  return {
    action,
    tags: uniqueTags,
    selected: uniqueIds.length,
    matched: result.matchedCount ?? 0,
    modified: result.modifiedCount ?? 0,
  };
}

/** Create a customer manually (phone orders taken by support staff). */
export async function createCustomer(payload) {
  if (!isValidBdPhone(payload.phone)) throw ApiError.badRequest('Enter a valid Bangladeshi mobile number');
  const existing = await getCustomerByPhone(payload.phone);
  if (existing) {
    throw ApiError.conflict(`A customer with ${formatPhone(existing.phone)} already exists`, {
      errors: [{ path: 'phone', message: 'This phone number is already registered' }],
    });
  }

  const draft = { ...payload };
  if (draft.address) draft.address.shippingZone = draft.address.shippingZone ?? resolveShippingZone(draft.address.district);
  if (draft.addresses?.length) {
    draft.addresses = draft.addresses.map((address) => ({
      ...address,
      shippingZone: address.shippingZone ?? resolveShippingZone(address.district),
    }));
  }
  const created = await db.Customer.create(draft);
  logger.info('[customers] created manually', { id: String(created._id) });
  return created;
}

/** Update a customer; re-normalises the phone when it changed. */
export async function updateCustomer(id, payload) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest('Invalid customer id');
  const existing = await db.Customer.findById(id).lean();
  if (!existing) throw ApiError.notFound('Customer not found');

  const update = { ...payload };
  if (update.phone && normalizePhone(update.phone) !== existing.phone) {
    const clash = await getCustomerByPhone(update.phone);
    if (clash && String(clash._id) !== String(id)) {
      throw ApiError.conflict('Another customer already uses that phone number');
    }
    update.phone = normalizePhone(update.phone);
    update.phonePretty = formatPhone(update.phone);
  } else {
    delete update.phone;
  }
  if (update.address) update.address.shippingZone = update.address.shippingZone ?? resolveShippingZone(update.address.district);

  const updated = await db.Customer.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
  return updated;
}

/**
 * Delete a customer. Blocked while orders exist — invoices must stay resolvable.
 */
export async function deleteCustomer(id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest('Invalid customer id');
  const customer = await db.Customer.findById(id).lean();
  if (!customer) throw ApiError.notFound('Customer not found');

  const orderCount = await db.Order.countDocuments({ customer: id });
  if (orderCount > 0) {
    throw ApiError.conflict(
      `This customer has ${orderCount} order(s). Deactivate the record instead so invoices and history stay intact.`,
    );
  }
  await db.Customer.deleteOne({ _id: id });
  return { deleted: true, phone: customer.phone };
}
