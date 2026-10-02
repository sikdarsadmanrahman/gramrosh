/**
 * -----------------------------------------------------------------------------
 *  order.service.js — Checkout, the status pipeline, and order reads
 * -----------------------------------------------------------------------------
 *  Checkout sequence (each step is deliberately ordered):
 *
 *    1. reserve stock with atomic conditional writes  → cannot oversell
 *    2. price the basket **from the database**        → cannot be tampered with
 *    3. upsert the customer by phone                  → one record per shopper
 *    4. persist the order                             → immutable snapshot
 *    5. fold the order into customer lifetime value
 *
 *  Any failure after step 1 releases the reservation, so a rejected checkout
 *  never strands stock.
 *
 *  Status changes are validated against `STATUS_TRANSITIONS` — the pipeline is
 *  Pending → Processing → Shipped → Delivered, with Cancelled reachable from any
 *  non-terminal state. Every move is appended to `statusHistory`.
 * -----------------------------------------------------------------------------
 */
import mongoose from 'mongoose';
import { db } from '../db/index.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { generateOrderNumber } from '../utils/orderNumber.js';
import { normalizePhone, formatPhone } from '../utils/phone.js';
import { escapeRegex } from '../utils/text.js';
import { deriveOrder } from '../models/order.model.js';
import { ORDER_STATUS, STATUS_TRANSITIONS, PAYMENT_METHOD, PAYMENT_STATUS, SHIPPING_ZONE, ORDER_SOURCE, ORDER_CHANNEL } from '../config/constants.js';
import { reserveStock, releaseStock, recordUnitsSold } from './inventory.service.js';
import { quoteOrder, resolveShippingZone, getShippingMethod, getPaymentMethod } from './pricing.service.js';
import { findOrCreateCustomer, applyOrderToCustomer } from './customer.service.js';
import { getStorefront } from './storefront.service.js';

/* -------------------------------------------------------------------------- */
/*  Order numbers                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Allocate an unused order number.
 *
 * The check-then-insert is best effort; the **unique index** on `orderNumber` is
 * the real guarantee (see `createOrder`, which retries on a duplicate-key error).
 */
async function nextOrderNumber() {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate = generateOrderNumber();
    const clash = await db.Order.exists({ orderNumber: candidate });
    if (!clash) return candidate;
  }
  throw ApiError.internal('Could not allocate an order number, please try again');
}

/* -------------------------------------------------------------------------- */
/*  Coupons                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Resolve a coupon code against the live flash-sale campaign.
 *
 * An expired or unknown code is *ignored* rather than rejected: a shopper whose
 * cart still holds a code from a campaign that ended an hour ago must still be
 * able to check out. The response reports whether it applied.
 */
async function resolveCoupon(code) {
  const trimmed = String(code ?? '').trim().toUpperCase();
  if (!trimmed) return { coupon: null, applied: false, attempted: null };

  const settings = await getStorefront();
  const sale = settings?.flashSale;
  const active = sale?.isActive
    && (!sale.startsAt || new Date(sale.startsAt).getTime() <= Date.now())
    && sale.endsAt && new Date(sale.endsAt).getTime() >= Date.now();

  if (active && String(sale.couponCode ?? '').toUpperCase() === trimmed && Number(sale.couponValue) > 0) {
    return {
      coupon: { code: trimmed, type: 'flat', value: Number(sale.couponValue) },
      applied: true,
      attempted: trimmed,
    };
  }
  return { coupon: null, applied: false, attempted: trimmed };
}

/* -------------------------------------------------------------------------- */
/*  Checkout                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Create an order from a validated checkout payload.
 *
 * @param {object} payload  validated body (no prices — they come from the DB)
 * @param {{req?:object, source?:string, staff?:object|null, forceZone?:string|null, status?:string}} [context]
 */
export async function createOrder(payload, { req = null, source = 'web', staff = null, forceZone = null, status = null } = {}) {
  const { customer: contact, shippingAddress, items, payment } = payload;

  // 0. Basic sanity: duplicate lines for the same variant are merged so the
  //    reservation loop cannot race itself.
  const mergedItems = mergeDuplicateLines(items);

  // 1. Shipping zone — derived from the district, never trusted from the client.
  const zone = forceZone ?? resolveShippingZone(shippingAddress.district);
  if (payload.shippingMethod && payload.shippingMethod !== zone) {
    logger.warn('[checkout] client shipping zone disagreed with the server', {
      client: payload.shippingMethod,
      server: zone,
      district: shippingAddress.district,
    });
  }

  // 2. A mobile-banking TrxID may only ever pay for one order. The unique sparse
  //    index is the real guard under concurrency; this read exists so the shopper
  //    sees a sentence instead of a duplicate-key error, and so we refuse
  //    *before* reserving stock that would then have to be rolled back.
  const transactionId = payment.transactionId
    ? String(payment.transactionId).trim().toUpperCase().replace(/\s+/g, '')
    : null;
  if (transactionId) {
    const clash = await db.Order.findOne({ 'payment.transactionId': transactionId })
      .select({ orderNumber: 1, status: 1 })
      .lean();
    if (clash) {
      throw ApiError.conflict(
        `Transaction ${transactionId} has already been used on order ${clash.orderNumber}. `
        + 'If you were charged twice, contact support and we will refund the duplicate.',
      );
    }
  }

  // 3. Reserve stock atomically (throws 404/409 with shopper-friendly copy).
  const reserved = await reserveStock(mergedItems);

  try {
    // 3. Price from the database.
    const { coupon, applied: couponApplied, attempted: couponAttempted } = await resolveCoupon(payload.couponCode);
    const quote = quoteOrder({
      items: reserved.map((line) => ({
        unitPrice: line.unitPrice,
        compareAtPrice: line.compareAtPrice,
        quantity: line.quantity,
      })),
      district: shippingAddress.district,
      coupon,
      paymentMethod: payment.method,
      forceZone: zone,
    });

    // 4. Customer upsert by phone.
    const customer = await findOrCreateCustomer({
      name: contact.name,
      phone: contact.phone,
      email: contact.email ?? null,
      address: { ...shippingAddress, shippingZone: zone },
      source,
    });
    if (!customer) throw ApiError.internal('Could not create the customer record');

    // 5. Assemble the immutable snapshot.
    const shippingMethod = getShippingMethod(zone);
    const paymentMethod = getPaymentMethod(payment.method);
    const orderNumber = await nextOrderNumber();

    const document = {
      orderNumber,
      customer: customer._id,
      contact: {
        name: contact.name,
        phone: contact.phone,
        email: contact.email ?? null,
      },
      alternatePhone: contact.alternatePhone ?? '',
      shippingAddress: {
        ...shippingAddress,
        shippingZone: zone,
        isDefault: false,
      },
      items: reserved.map((line) => ({
        product: line.productId,
        variant: line.variantId,
        title: line.title,
        titleBn: line.titleBn,
        variantLabel: line.variantLabel,
        sku: line.sku,
        image: line.image,
        categoryName: line.categoryName,
        unitPrice: line.unitPrice,
        compareAtPrice: line.compareAtPrice,
        quantity: line.quantity,
        wasFlashSale: line.wasFlashSale,
      })),
      pricing: quote.pricing,
      shipping: {
        method: zone,
        label: shippingMethod.label,
        etaDays: shippingMethod.etaDays,
        courier: '',
        trackingNumber: null,
        trackingUrl: null,
      },
      payment: {
        method: payment.method,
        status: payment.method === PAYMENT_METHOD.COD ? PAYMENT_STATUS.COD_DUE : PAYMENT_STATUS.PENDING_VERIFICATION,
        senderPhone: payment.senderPhone ?? null,
        merchantNumber: paymentMethod?.merchantNumber ?? null,
        transactionId: payment.transactionId ?? null,
        note: payment.note ?? '',
      },
      coupon: couponApplied
        ? { code: coupon.code, type: coupon.type, value: coupon.value, discount: Math.min(coupon.value, quote.pricing.subtotal) }
        : undefined,
      status: status ?? ORDER_STATUS.PENDING,
      notes: payload.notes ?? '',
      deliveryNote: payload.deliveryNote ?? '',
      meta: {
        ip: req?.ip ?? '',
        userAgent: String(req?.headers?.['user-agent'] ?? '').slice(0, 400),
        // The caller's declared intake channel survives — a staff member taking
        // a phone order still records `phone`, which is the whole point of the
        // field. What the server refuses to trust is *who wrote it*: `channel`
        // comes from the authenticated surface, never from the request body.
        source: payload?.meta?.source ?? (staff ? ORDER_SOURCE.ADMIN : source),
        channel: staff ? ORDER_CHANNEL.ADMIN : ORDER_CHANNEL.STOREFRONT,
        ...(staff
          ? { takenBy: { id: String(staff._id ?? ''), email: staff.email ?? '' } }
          : {}),
      },
    };

    deriveOrder(document, { isNew: true });
    const created = await persistOrder(document);

    // 6. Lifetime value.
    await applyOrderToCustomer(customer._id, {
      grandTotal: created.pricing.grandTotal,
      itemCount: created.totals.itemCount,
      placedAt: created.createdAt,
    });

    logger.info('[checkout] order placed', {
      orderNumber: created.orderNumber,
      total: created.pricing.grandTotal,
      payment: created.payment.method,
      zone,
      lines: created.items.length,
    });

    return {
      order: created,
      breakdown: quote.breakdown,
      coupon: { attempted: couponAttempted, applied: couponApplied },
      customer: { id: customer._id, name: customer.name, phone: customer.phone, isNewCustomer: (customer.stats?.totalOrders ?? 0) <= 1 },
    };
  } catch (error) {
    // Nothing after the reservation may strand stock.
    await releaseStock(reserved.map((line) => ({
      productId: line.productId,
      variantId: line.variantId,
      quantity: line.quantity,
    })));
    logger.warn('[checkout] failed after reservation, stock released', { reason: error.message });
    throw error;
  }
}

/** Insert with a retry on the (rare) order-number collision. */
async function persistOrder(document, attempt = 0) {
  try {
    return await db.Order.create(document);
  } catch (error) {
    const isDuplicate = error?.code === 11000 || /E11000 duplicate key/.test(error?.message ?? '');
    if (isDuplicate && /orderNumber/.test(error?.message ?? JSON.stringify(error?.keyValue ?? {})) && attempt < 3) {
      document.orderNumber = generateOrderNumber();
      document.invoice = { ...(document.invoice ?? {}), number: document.orderNumber.replace('GR-', 'INV-') };
      return persistOrder(document, attempt + 1);
    }
    throw error;
  }
}

/** Collapse repeated `{productId, variantId}` lines into one with a summed qty. */
function mergeDuplicateLines(items) {
  const byKey = new Map();
  for (const item of items) {
    const key = `${item.productId}:${item.variantId}`;
    const existing = byKey.get(key);
    if (existing) existing.quantity += item.quantity;
    else byKey.set(key, { ...item });
  }
  return [...byKey.values()];
}

/* -------------------------------------------------------------------------- */
/*  Pre-checkout quote                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Price a basket **without** reserving stock.
 *
 * Powers the slide-over cart and the checkout summary: the customer sees the
 * real shipping fee and total before committing, computed from database prices,
 * so the number on screen and the number stored can never disagree.
 *
 * Also reports exactly what would block checkout (archived product, retired pack
 * size, insufficient quantity) so the UI can flag it before the customer hits
 * "Place order".
 */
export async function quoteBasket({ items, district, paymentMethod, couponCode, shippingMethod }) {
  const merged = mergeDuplicateLines(items ?? []);

  // An empty basket has no meaningful quote: returning one would render a
  // "shipping ৳60 · total ৳60" summary over a cart with nothing in it.
  if (!merged.length) {
    throw ApiError.unprocessable('Your cart is empty — add a product to see a delivery estimate');
  }

  const productIds = [...new Set(merged.map((item) => String(item.productId)))];

  const products = productIds.length
    ? await db.Product.find({ _id: { $in: productIds }, status: 'active', isArchived: false }).lean()
    : [];
  const byId = new Map(products.map((product) => [String(product._id), product]));

  const lines = [];
  const unavailable = [];

  for (const item of merged) {
    const product = byId.get(String(item.productId));
    if (!product) {
      unavailable.push({ productId: item.productId, reason: 'unavailable', message: 'This item is no longer available' });
      continue;
    }
    const variant = (product.variants ?? []).find((v) => String(v._id) === String(item.variantId));
    if (!variant || variant.isActive === false) {
      unavailable.push({
        productId: item.productId,
        variantId: item.variantId,
        title: product.title,
        reason: 'variant_unavailable',
        message: `${product.title} is no longer sold in that pack size`,
      });
      continue;
    }
    lines.push({
      productId: product._id,
      variantId: variant._id,
      title: product.title,
      variantLabel: variant.label,
      sku: variant.sku,
      image: product.image,
      unitPrice: variant.price,
      compareAtPrice: variant.compareAtPrice ?? null,
      quantity: item.quantity,
      availableStock: variant.stock,
      insufficientStock: variant.stock < item.quantity,
    });
  }

  const zone = shippingMethod ?? resolveShippingZone(district);
  const { coupon, applied: couponApplied, attempted } = await resolveCoupon(couponCode);
  const quote = quoteOrder({ items: lines, district, coupon, paymentMethod, forceZone: zone });

  const checkoutReady = lines.length > 0
    && unavailable.length === 0
    && lines.every((line) => !line.insufficientStock);

  return {
    ...quote,
    lines,
    unavailable,
    coupon: { attempted, applied: couponApplied, value: coupon?.value ?? 0 },
    /** Green light for the "Place order" button. */
    checkoutReady,
    /**
     * One-line reason the button is disabled, so the cart can explain itself
     * without re-deriving the rules client-side.
     */
    blockingReason: checkoutReady
      ? null
      : !lines.length
        ? 'Everything in your cart is unavailable right now'
        : unavailable.length
          ? 'Some items in your cart are unavailable'
          : 'Some items are requested in a quantity we cannot supply',
  };
}

/* -------------------------------------------------------------------------- */
/*  Reads                                                                     */
/* -------------------------------------------------------------------------- */

/** Fetch by ObjectId or by public order number. 404 when missing. */
export async function getOrderByIdOrNumber(idOrNumber, { withCustomer = false } = {}) {
  const filter = mongoose.isValidObjectId(idOrNumber)
    ? { _id: new mongoose.Types.ObjectId(idOrNumber) }
    : { orderNumber: String(idOrNumber).trim().toUpperCase() };

  const query = db.Order.findOne(filter).lean();
  if (withCustomer) query.populate('customer', 'name phone email segment stats tags notes');
  const order = await query;
  if (!order) throw ApiError.notFound('Order not found');
  return order;
}

/**
 * Public order tracking.
 *
 * Requires the order number **and** the phone number on the order, so a
 * sequential guesser cannot enumerate other people's purchases.
 */
export async function lookupPublicOrder({ orderNumber, phone }) {
  const normalized = normalizePhone(phone);
  const order = await db.Order.findOne({
    orderNumber: String(orderNumber).trim().toUpperCase(),
    'contact.phone': normalized,
  }).lean();

  if (!order) {
    throw ApiError.notFound('No order matches that order number and phone combination');
  }
  return redactForPublic(order);
}

/** Strip admin-only fields before an order leaves the API for a shopper. */
export function redactForPublic(order) {
  const { meta, isArchived, ...safe } = order;
  return {
    ...safe,
    // Expose the timeline without internal actor ids.
    statusHistory: (order.statusHistory ?? []).map((entry) => ({
      status: entry.status,
      note: entry.note,
      at: entry.at,
      by: entry.changedByName || 'Gramrosh',
    })),
    payment: {
      method: order.payment?.method,
      status: order.payment?.status,
      senderPhone: order.payment?.senderPhone ?? null,
      transactionId: order.payment?.transactionId ?? null,
      merchantNumber: order.payment?.merchantNumber ?? null,
      paidAt: order.payment?.paidAt ?? null,
    },
    allowedStatuses: STATUS_TRANSITIONS[order.status] ?? [],
  };
}

const ORDER_SORTS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  total_desc: { 'pricing.grandTotal': -1 },
  total_asc: { 'pricing.grandTotal': 1 },
  status: { status: 1, createdAt: -1 },
};

/** Build the admin order-list filter. */
export function buildOrderFilter(query = {}) {
  const filter = {};

  if (query.status) filter.status = query.status;
  else if (query.statuses?.length) filter.status = { $in: query.statuses };

  if (query.paymentMethod) filter['payment.method'] = query.paymentMethod;
  if (query.paymentStatus) filter['payment.status'] = query.paymentStatus;
  if (query.shippingMethod) filter['shipping.method'] = query.shippingMethod;
  if (query.isPaid !== undefined) filter.isPaid = query.isPaid;
  if (query.customer) filter.customer = query.customer;
  if (query.district) filter['shippingAddress.district'] = new RegExp(escapeRegex(query.district), 'i');

  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = new Date(query.from);
    if (query.to) filter.createdAt.$lte = new Date(query.to);
  }
  if (query.minTotal !== undefined || query.maxTotal !== undefined) {
    filter['pricing.grandTotal'] = {};
    if (query.minTotal !== undefined) filter['pricing.grandTotal'].$gte = query.minTotal;
    if (query.maxTotal !== undefined) filter['pricing.grandTotal'].$lte = query.maxTotal;
  }

  const term = String(query.q ?? '').trim();
  if (term) {
    const clauses = [
      // Exact-ish prefixes hit the unique orderNumber index.
      { orderNumber: new RegExp(`^${escapeRegex(term.toUpperCase())}`) },
      { 'contact.name': new RegExp(escapeRegex(term), 'i') },
      { 'shipping.trackingNumber': new RegExp(`^${escapeRegex(term.toUpperCase())}`) },
      { 'payment.transactionId': new RegExp(`^${escapeRegex(term.toUpperCase())}`) },
      { 'items.title': new RegExp(escapeRegex(term), 'i') },
      { 'items.sku': new RegExp(escapeRegex(term.toUpperCase()), 'i') },
    ];
    const asPhone = normalizePhone(term);
    if (asPhone) clauses.unshift({ 'contact.phone': asPhone });
    filter.$or = clauses;
  }

  return filter;
}

/** Paginated admin order list. */
export async function listOrders(query = {}) {
  const filter = buildOrderFilter(query);
  const sort = ORDER_SORTS[query.sort] ?? ORDER_SORTS.newest;
  const limit = query.limit ?? 20;
  const skip = query.skip ?? ((query.page ?? 1) - 1) * limit;

  // `contact.*` and `pricing.*` are snapshotted on the order, so the list needs
  // **no populate at all** — one indexed query per page.
  const [items, total] = await Promise.all([
    db.Order.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    db.Order.countDocuments(filter),
  ]);

  return { items, total, page: query.page ?? 1, limit };
}

/** Orders for one customer (their profile page). */
export async function listCustomerOrders(customerId, { page = 1, limit = 10, status } = {}) {
  const filter = { customer: customerId };
  if (status) filter.status = status;
  const [items, total] = await Promise.all([
    db.Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    db.Order.countDocuments(filter),
  ]);
  return { items, total, page, limit };
}

/* -------------------------------------------------------------------------- */
/*  Status pipeline                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Move an order along the pipeline.
 *
 * @param {string} idOrNumber
 * @param {{status:string, note?:string, reason?:string, courier?:string, trackingNumber?:string, trackingUrl?:string}} body
 * @param {{id?:string, name?:string}|null} admin
 */
export async function transitionStatus(idOrNumber, body, admin = null) {
  const order = await getOrderByIdOrNumber(idOrNumber);
  const { status } = body;

  if (order.status === status) {
    throw ApiError.conflict(`This order is already "${status}"`);
  }

  const allowed = STATUS_TRANSITIONS[order.status] ?? [];
  if (!allowed.includes(status)) {
    throw ApiError.conflict(
      `"${order.status}" → "${status}" is not an allowed move. From ${order.status} you can go to: ${allowed.length ? allowed.join(', ') : 'nothing (terminal state)'}`,
      { errors: [{ path: 'status', message: `Allowed transitions: ${allowed.join(', ') || 'none'}` }] },
    );
  }

  const reopening = order.status === ORDER_STATUS.CANCELLED;
  const cancelling = status === ORDER_STATUS.CANCELLED;

  // Re-opening a cancelled order must put the stock back under reservation
  // *before* the status flips, otherwise we would promise goods we don't have.
  if (reopening) {
    await reserveStock(order.items.map((item) => ({
      productId: item.product,
      variantId: item.variant,
      quantity: item.quantity,
      unitPriceOverride: item.unitPrice,
    })));
  }

  const now = new Date();
  const set = { status };

  if (status === ORDER_STATUS.SHIPPED) {
    set['shipping.shippedAt'] = now;
    if (body.courier) set['shipping.courier'] = body.courier;
    if (body.trackingNumber) set['shipping.trackingNumber'] = String(body.trackingNumber).toUpperCase();
    if (body.trackingUrl) set['shipping.trackingUrl'] = body.trackingUrl;
  }
  if (status === ORDER_STATUS.DELIVERED) {
    set['shipping.deliveredAt'] = now;
    if (!set['shipping.shippedAt'] && !order.shipping?.shippedAt) set['shipping.shippedAt'] = now;
    // COD settles on delivery; prepaid orders are reconciled separately.
    if (order.payment?.method === PAYMENT_METHOD.COD) {
      set['payment.status'] = PAYMENT_STATUS.PAID;
      set['payment.paidAt'] = now;
      set.isPaid = true;
    }
  }
  if (cancelling) {
    set.cancellation = {
      reason: body.reason || body.note || 'Cancelled',
      cancelledBy: admin?.id ? new mongoose.Types.ObjectId(admin.id) : null,
      cancelledByName: admin?.name ?? 'System',
      at: now,
    };
  }
  if (reopening) {
    set.cancellation = { reason: '', cancelledBy: null, cancelledByName: '', at: null };
  }

  const updated = await db.Order.findOneAndUpdate(
    { _id: order._id },
    {
      $set: set,
      $push: {
        statusHistory: {
          status,
          note: body.note ?? '',
          changedBy: admin?.id ? new mongoose.Types.ObjectId(admin.id) : null,
          changedByName: admin?.name ?? 'System',
          at: now,
        },
      },
    },
    { new: true },
  ).lean();

  // --- side effects --------------------------------------------------------
  if (cancelling) {
    await releaseStock(order.items.map((item) => ({
      productId: item.product,
      variantId: item.variant,
      quantity: item.quantity,
    })));
    await applyOrderToCustomer(order.customer, {
      grandTotal: order.pricing.grandTotal,
      itemCount: order.totals.itemCount,
      placedAt: order.createdAt,
      counts: false,
    });
  }
  if (status === ORDER_STATUS.DELIVERED) {
    await recordUnitsSold(order.items);
  }

  logger.info('[orders] status changed', {
    orderNumber: updated.orderNumber,
    from: order.status,
    to: status,
    by: admin?.name ?? 'system',
  });

  return updated;
}

/**
 * Reconcile a manual mobile-banking payment (admin confirms the TrxID).
 */
export async function updatePaymentStatus(idOrNumber, body, admin = null) {
  const order = await getOrderByIdOrNumber(idOrNumber);
  const now = new Date();

  const set = { 'payment.status': body.status };
  if (body.senderPhone) set['payment.senderPhone'] = body.senderPhone;
  if (body.transactionId) set['payment.transactionId'] = String(body.transactionId).toUpperCase();
  if (body.note !== undefined) set['payment.note'] = body.note;

  if (body.status === PAYMENT_STATUS.PAID) {
    set['payment.paidAt'] = now;
    set['payment.verifiedBy'] = admin?.id ? new mongoose.Types.ObjectId(admin.id) : null;
    set['payment.verifiedAt'] = now;
    set.isPaid = true;
  }
  if (body.status === PAYMENT_STATUS.FAILED || body.status === PAYMENT_STATUS.REFUNDED) {
    set.isPaid = false;
  }

  // A duplicate TrxID means the same payment was attached to two orders.
  if (set['payment.transactionId']) {
    const clash = await db.Order.findOne({
      'payment.transactionId': set['payment.transactionId'],
      _id: { $ne: order._id },
    }).select({ orderNumber: 1 }).lean();
    if (clash) {
      throw ApiError.conflict(`Transaction ${set['payment.transactionId']} is already recorded on order ${clash.orderNumber}`);
    }
  }

  const updated = await db.Order.findOneAndUpdate(
    { _id: order._id },
    {
      $set: set,
      $push: {
        statusHistory: {
          status: order.status,
          note: `Payment marked "${body.status}"${body.note ? ` — ${body.note}` : ''}`,
          changedBy: admin?.id ? new mongoose.Types.ObjectId(admin.id) : null,
          changedByName: admin?.name ?? 'System',
          at: now,
        },
      },
    },
    { new: true },
  ).lean();

  logger.info('[orders] payment reconciled', { orderNumber: updated.orderNumber, status: body.status, by: admin?.name ?? 'system' });
  return updated;
}

/** Attach courier + tracking details without changing the pipeline status. */
export async function updateShippingDetails(idOrNumber, body, admin = null) {
  const order = await getOrderByIdOrNumber(idOrNumber);
  const set = {};
  if (body.courier !== undefined) set['shipping.courier'] = body.courier;
  if (body.trackingNumber !== undefined) set['shipping.trackingNumber'] = String(body.trackingNumber).toUpperCase();
  if (body.trackingUrl !== undefined) set['shipping.trackingUrl'] = body.trackingUrl;
  if (body.etaDays) set['shipping.etaDays'] = body.etaDays;
  if (!Object.keys(set).length) throw ApiError.badRequest('Nothing to update');

  const updated = await db.Order.findOneAndUpdate(
    { _id: order._id },
    {
      $set: set,
      $push: {
        statusHistory: {
          status: order.status,
          note: `Shipping details updated${set['shipping.trackingNumber'] ? ` (${set['shipping.trackingNumber']})` : ''}`,
          changedBy: admin?.id ? new mongoose.Types.ObjectId(admin.id) : null,
          changedByName: admin?.name ?? 'System',
          at: new Date(),
        },
      },
    },
    { new: true },
  ).lean();
  return updated;
}

/** Free-text note on the order (rider instructions, internal comments). */
export async function updateOrderNotes(idOrNumber, { notes, deliveryNote }) {
  const order = await getOrderByIdOrNumber(idOrNumber);
  const set = {};
  if (notes !== undefined) set.notes = notes;
  if (deliveryNote !== undefined) set.deliveryNote = deliveryNote;
  if (!Object.keys(set).length) throw ApiError.badRequest('Nothing to update');
  return db.Order.findByIdAndUpdate(order._id, { $set: set }, { new: true }).lean();
}

/** Most recent orders for the dashboard "latest activity" card. */
export async function recentOrders(limit = 8) {
  return db.Order.find({})
    .sort({ createdAt: -1 })
    .limit(limit)
    .select({ orderNumber: 1, status: 1, createdAt: 1, 'contact.name': 1, 'contact.phone': 1, 'pricing.grandTotal': 1, 'payment.method': 1, 'totals.itemCount': 1 })
    .lean();
}

/* -------------------------------------------------------------------------- */
/*  Invoice                                                                   */
/* -------------------------------------------------------------------------- */

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

/** Convert an integer to English words (used on the printed invoice). */
export function numberToWords(value) {
  const n = Math.floor(Math.abs(Number(value) || 0));
  if (n === 0) return 'Zero';
  if (n < 20) return ONES[n];
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${numberToWords(n % 100)}` : ''}`;
  if (n < 100_000) return `${numberToWords(Math.floor(n / 1000))} Thousand${n % 1000 ? ` ${numberToWords(n % 1000)}` : ''}`;
  if (n < 10_000_000) return `${numberToWords(Math.floor(n / 100_000))} Lakh${n % 100_000 ? ` ${numberToWords(n % 100_000)}` : ''}`;
  return `${numberToWords(Math.floor(n / 10_000_000))} Crore${n % 10_000_000 ? ` ${numberToWords(n % 10_000_000)}` : ''}`;
}

/**
 * Assemble everything the printable invoice / shipping slip needs.
 *
 * Kept as a plain data structure so the same context renders both the React
 * invoice page and the server-side HTML fallback (`GET /api/orders/:id/invoice`).
 */
export async function buildInvoiceContext(order) {
  const settings = await getStorefront();
  const contact = settings?.contact ?? {};
  const taka = Math.floor(order.pricing.grandTotal);
  const poisha = Math.round((order.pricing.grandTotal - taka) * 100);

  return {
    store: {
      name: settings?.storeName ?? env.STORE_NAME,
      tagline: settings?.tagline ?? '',
      phone: contact.phone ?? env.STORE_PHONE,
      whatsapp: contact.whatsapp ?? env.STORE_WHATSAPP,
      email: contact.email ?? env.STORE_EMAIL,
      address: contact.address ?? 'Dhaka, Bangladesh',
      hours: contact.hours ?? '',
    },
    order: {
      number: order.orderNumber,
      invoiceNumber: order.invoice?.number ?? order.orderNumber.replace('GR-', 'INV-'),
      placedAt: order.createdAt,
      issuedAt: order.invoice?.issuedAt ?? order.createdAt,
      status: order.status,
      notes: order.invoice?.notes ?? order.notes ?? '',
      deliveryNote: order.deliveryNote ?? '',
    },
    customer: {
      name: order.contact.name,
      phone: order.contact.phonePretty || formatPhone(order.contact.phone),
      email: order.contact.email ?? '',
      alternatePhone: order.alternatePhone ? formatPhone(order.alternatePhone) : '',
    },
    shippingAddress: order.shippingAddress,
    shipping: {
      label: order.shipping?.label || getShippingMethod(order.shipping?.method).label,
      zone: order.shipping?.method,
      fee: order.pricing.shippingFee,
      courier: order.shipping?.courier ?? '',
      trackingNumber: order.shipping?.trackingNumber ?? '',
      etaDays: order.shipping?.etaDays ?? [],
    },
    items: (order.items ?? []).map((item) => ({
      title: item.title,
      titleBn: item.titleBn ?? '',
      variantLabel: item.variantLabel,
      sku: item.sku ?? '',
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      total: item.total ?? item.unitPrice * item.quantity,
    })),
    pricing: order.pricing,
    payment: {
      method: order.payment?.method,
      methodLabel: getPaymentMethod(order.payment?.method)?.label ?? order.payment?.method,
      status: order.payment?.status,
      senderPhone: order.payment?.senderPhonePretty || (order.payment?.senderPhone ? formatPhone(order.payment.senderPhone) : ''),
      transactionId: order.payment?.transactionId ?? '',
      merchantNumber: order.payment?.merchantNumber ?? '',
      paidAt: order.payment?.paidAt ?? null,
    },
    totals: {
      itemCount: order.totals?.itemCount ?? (order.items ?? []).reduce((s, i) => s + i.quantity, 0),
      amountInWords: `${numberToWords(taka)} Taka${poisha ? ` and ${numberToWords(poisha)} Poisha` : ''} Only`,
    },
    currencySymbol: env.CURRENCY_SYMBOL,
    timeline: (order.statusHistory ?? []).map((entry) => ({ status: entry.status, at: entry.at, note: entry.note, by: entry.changedByName })),
  };
}

/** Re-exported for controllers that only need the zone helper. */
export { resolveShippingZone, SHIPPING_ZONE };
