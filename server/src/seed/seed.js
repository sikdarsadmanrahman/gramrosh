/**
 * -----------------------------------------------------------------------------
 *  seed/seed.js — Idempotent demo data loader
 * -----------------------------------------------------------------------------
 *  Run explicitly with `npm run seed`, or automatically on first boot when the
 *  catalogue is empty (so a fresh clone is immediately usable).
 *
 *  Idempotent by construction: categories match on `slug`, products on `slug`,
 *  customers on `phone`, orders on `orderNumber`. Re-running updates rather than
 *  duplicates, and `--fresh` wipes first when you want a clean slate.
 *
 *  The demo order history is generated with a *seeded* PRNG so the dashboard
 *  numbers are reproducible between runs — useful when a screenshot in the README
 *  has to match what a reviewer sees.
 * -----------------------------------------------------------------------------
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectDatabase, disconnectDatabase, db, getDriver } from '../db/index.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { configureCloudinary } from '../services/cloudinary.service.js';
import { ensureBootstrapAdmin } from '../services/admin.service.js';
import { refreshCategoryCounts } from '../services/product.service.js';
import { computeDerivedFields } from '../models/product.model.js';
import { refreshCustomerStats } from '../services/customer.service.js';
import { deriveOrder } from '../models/order.model.js';
import { deriveCustomer } from '../models/customer.model.js';
import { generateOrderNumber } from '../utils/orderNumber.js';
import { normalizePhone } from '../utils/phone.js';
import { resolveShippingZone, quoteOrder } from '../services/pricing.service.js';
import { ORDER_STATUS, PAYMENT_METHOD, PAYMENT_STATUS } from '../config/constants.js';
import {
  categories as categorySeeds, products as productSeeds, storefront as storefrontSeed,
  demoCustomers, demoStreets, daysAgo,
} from './data.js';
import { STOREFRONT_ID as SINGLETON_KEY } from '../models/storefront.model.js';

/* -------------------------------------------------------------------------- */
/*  Deterministic randomness                                                  */
/* -------------------------------------------------------------------------- */

/** mulberry32 — tiny, fast, reproducible. */
function makeRandom(seed = 20260920) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = makeRandom();
const pick = (list) => list[Math.floor(random() * list.length)];
const intBetween = (min, max) => min + Math.floor(random() * (max - min + 1));
/** Weighted pick: `[['a', 60], ['b', 40]]`. */
function weighted(pairs) {
  const total = pairs.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [value, weight] of pairs) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return pairs[pairs.length - 1][0];
}

/* -------------------------------------------------------------------------- */
/*  Categories & products                                                     */
/* -------------------------------------------------------------------------- */

async function seedCategories() {
  const bySlug = new Map();
  for (const entry of categorySeeds) {
    const payload = { ...entry };
    const existing = await db.Category.findOne({ slug: payload.slug ?? payload.name.en.toLowerCase() }).lean();
    if (existing) {
      await db.Category.updateOne({ _id: existing._id }, { $set: payload });
      bySlug.set(existing.slug, { ...existing, ...payload, _id: existing._id });
    } else {
      const created = await db.Category.create(payload);
      bySlug.set(created.slug, created.toObject ? created.toObject() : created);
    }
  }
  logger.info('[seed] categories', { count: bySlug.size });
  return bySlug;
}

async function seedProducts(categoryBySlug) {
  // First pass: create/update the plain products, recording slug → id.
  const idBySlug = new Map();
  const deferred = [];

  for (const entry of productSeeds) {
    const category = categoryBySlug.get(entry.category);
    if (!category) throw new Error(`Seed references unknown category "${entry.category}"`);

    const payload = {
      ...entry,
      category: category._id,
      categoryName: category.name?.en ?? '',
      categorySlug: category.slug,
    };

    if (payload.bundle?.items?.some((item) => item.productSlug)) {
      deferred.push(payload); // combos reference other products — resolve after pass 1
      continue;
    }

    const existing = await db.Product.findOne({ slug: payload.slug }).lean();
    if (existing) {
      computeDerivedFields(payload);
      await db.Product.updateOne({ _id: existing._id }, { $set: payload });
      idBySlug.set(payload.slug, existing._id);
    } else {
      const created = await db.Product.create(payload);
      idBySlug.set(payload.slug, created._id);
    }
  }

  // Second pass: combos, with their bundle items resolved to real ObjectIds.
  for (const payload of deferred) {
    const items = [];
    for (const item of payload.bundle.items) {
      const productId = idBySlug.get(item.productSlug);
      if (!productId) throw new Error(`Combo "${payload.slug}" references unknown product "${item.productSlug}"`);
      const component = await db.Product.findById(productId).lean();
      const variant = item.variantSku
        ? (component.variants ?? []).find((v) => v.sku === item.variantSku)
        : (component.variants ?? [])[0];
      items.push({
        product: productId,
        variant: variant?._id ?? null,
        quantity: item.quantity,
        label: item.label ?? `${component.title} — ${variant?.label ?? ''}`,
      });
    }
    payload.bundle = { ...payload.bundle, items };

    const existing = await db.Product.findOne({ slug: payload.slug }).lean();
    computeDerivedFields(payload);
    if (existing) {
      await db.Product.updateOne({ _id: existing._id }, { $set: payload });
      idBySlug.set(payload.slug, existing._id);
    } else {
      const created = await db.Product.create(payload);
      idBySlug.set(payload.slug, created._id);
    }
  }

  await refreshCategoryCounts([...categoryBySlug.values()].map((c) => c._id));
  logger.info('[seed] products', { count: idBySlug.size });
  return idBySlug;
}

/* -------------------------------------------------------------------------- */
/*  Storefront settings                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Storefront content references products by *slug* in data.js so the seed file
 * stays readable and free of database ids. This resolves those slugs to
 * ObjectIds (and strips the `productSlugs` helper keys) before writing.
 */
function resolveStorefrontReferences(payload, idBySlug) {
  const resolve = (slugs) => (slugs ?? [])
    .map((slug) => idBySlug.get(slug))
    .filter(Boolean);

  const flashSale = { ...payload.flashSale };
  if (flashSale.productSlugs) {
    flashSale.productIds = resolve(flashSale.productSlugs);
    delete flashSale.productSlugs;
  }

  const originStories = (payload.originStories ?? []).map((story) => {
    const { productSlugs, ...rest } = story;
    return productSlugs ? { ...rest, productIds: resolve(productSlugs) } : rest;
  });

  return { ...payload, flashSale, originStories };
}

async function seedStorefront(idBySlug) {
  const existing = await db.Storefront.findOne({ key: SINGLETON_KEY }).lean();
  if (existing) {
    // Never clobber an admin's edits with seed content.
    logger.info('[seed] storefront settings already present, left untouched');
    return existing;
  }
  const created = await db.Storefront.create({
    ...resolveStorefrontReferences(storefrontSeed, idBySlug),
    key: SINGLETON_KEY,
  });
  logger.info('[seed] storefront settings created', {
    storyProducts: created.originStories?.reduce((n, s) => n + (s.productIds?.length ?? 0), 0) ?? 0,
    flashSaleProducts: created.flashSale?.productIds?.length ?? 0,
  });
  return created;
}

/* -------------------------------------------------------------------------- */
/*  Demo customers & order history                                            */
/* -------------------------------------------------------------------------- */

async function seedCustomers() {
  const created = [];
  for (const entry of demoCustomers) {
    const phone = normalizePhone(entry.phone);
    const existing = await db.Customer.findOne({ phone }).lean();
    if (existing) {
      created.push(existing);
      continue;
    }
    const customer = await db.Customer.create(
      deriveCustomer({
        name: entry.name,
        phone,
        email: entry.email ?? null,
        address: {
          line1: pick(demoStreets),
          area: entry.area,
          city: entry.district,
          district: entry.district,
          postalCode: String(intBetween(1000, 9999)),
          shippingZone: resolveShippingZone(entry.district),
          isDefault: true,
        },
        segment: 'new',
      }),
    );
    created.push(customer.toObject ? customer.toObject() : customer);
  }
  logger.info('[seed] customers', { count: created.length });
  return created;
}

/**
 * Build a plausible 60-day order history.
 *
 * Statuses are assigned by age (old orders are delivered, today's are pending),
 * payment methods follow the real BD mix (~65% COD), and every order carries a
 * complete snapshot so the admin table needs no joins.
 */
async function seedOrders(customers, productIdBySlug) {
  const existingCount = await db.Order.countDocuments({});
  if (existingCount > 0) {
    logger.info('[seed] orders already present, skipping order generation', { count: existingCount });
    return { created: 0, skipped: true };
  }

  const catalogue = await db.Product.find({ status: 'active', isArchived: false }).lean();
  if (!catalogue.length) throw new Error('Cannot seed orders before products exist');

  const orderCount = 42;
  const created = [];

  for (let i = 0; i < orderCount; i += 1) {
    const customer = pick(customers);
    // 0–58 days ago, biased towards recent so the dashboard has fresh data.
    const ageDays = Math.floor(Math.pow(random(), 1.4) * 58);
    const placedAt = daysAgo(ageDays, intBetween(8, 22));

    // 1–3 distinct lines.
    const lineCount = intBetween(1, 3);
    const chosen = new Set();
    const lines = [];
    for (let l = 0; l < lineCount; l += 1) {
      const product = pick(catalogue);
      const variants = (product.variants ?? []).filter((v) => v.isActive !== false);
      if (!variants.length) continue;
      const variant = pick(variants);
      const key = `${String(product._id)}:${String(variant._id)}`;
      if (chosen.has(key)) continue;
      chosen.add(key);
      lines.push({
        product: product._id,
        variant: variant._id,
        title: product.title,
        titleBn: product.titleBn ?? '',
        variantLabel: variant.label,
        sku: variant.sku,
        image: product.image || product.images?.[0]?.url || '',
        categoryName: product.categoryName ?? '',
        unitPrice: variant.price,
        compareAtPrice: variant.compareAtPrice ?? null,
        quantity: intBetween(1, 3),
        wasFlashSale: Boolean(product.flashSale?.isActive),
      });
    }
    if (!lines.length) continue;

    const zone = customer.address?.shippingZone ?? resolveShippingZone(customer.address?.district);
    const paymentMethod = weighted([
      [PAYMENT_METHOD.COD, 65],
      [PAYMENT_METHOD.BKASH, 20],
      [PAYMENT_METHOD.NAGAD, 10],
      [PAYMENT_METHOD.ROCKET, 5],
    ]);

    const quote = quoteOrder({
      items: lines,
      district: customer.address?.district,
      paymentMethod,
      forceZone: zone,
      // Every ~5th order uses the live campaign coupon.
      coupon: i % 5 === 0 ? { code: 'GRAMROSH200', value: 200 } : null,
    });

    // Status by age — mirrors how a real queue drains.
    const status = weighted(
      ageDays >= 7
        ? [[ORDER_STATUS.DELIVERED, 82], [ORDER_STATUS.CANCELLED, 10], [ORDER_STATUS.SHIPPED, 8]]
        : ageDays >= 4
          ? [[ORDER_STATUS.DELIVERED, 45], [ORDER_STATUS.SHIPPED, 30], [ORDER_STATUS.PROCESSING, 15], [ORDER_STATUS.CANCELLED, 10]]
          : ageDays >= 2
            ? [[ORDER_STATUS.SHIPPED, 30], [ORDER_STATUS.PROCESSING, 35], [ORDER_STATUS.DELIVERED, 15], [ORDER_STATUS.PENDING, 12], [ORDER_STATUS.CANCELLED, 8]]
            : [[ORDER_STATUS.PENDING, 55], [ORDER_STATUS.PROCESSING, 30], [ORDER_STATUS.CANCELLED, 8], [ORDER_STATUS.SHIPPED, 7]],
    );

    const history = buildStatusHistory(status, placedAt);
    const isPrepaid = paymentMethod !== PAYMENT_METHOD.COD;
    const paymentStatus =
      status === ORDER_STATUS.CANCELLED
        ? isPrepaid ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.FAILED
        : status === ORDER_STATUS.DELIVERED
          ? PAYMENT_STATUS.PAID
          : isPrepaid
            ? ageDays <= 1 ? PAYMENT_STATUS.PENDING_VERIFICATION : PAYMENT_STATUS.PAID
            : PAYMENT_STATUS.COD_DUE;

    const document = {
      orderNumber: generateOrderNumber(placedAt),
      customer: customer._id,
      contact: { name: customer.name, phone: customer.phone, email: customer.email ?? null },
      shippingAddress: {
        ...(customer.address ?? {}),
        shippingZone: zone,
        isDefault: false,
      },
      items: lines,
      pricing: quote.pricing,
      shipping: {
        method: zone,
        label: quote.breakdown.label,
        etaDays: quote.breakdown.etaDays,
        courier: status === ORDER_STATUS.PENDING || status === ORDER_STATUS.CANCELLED ? '' : pick(['Pathao Courier', 'Steadfast', 'RedX', 'Paperfly']),
        trackingNumber: [ORDER_STATUS.SHIPPED, ORDER_STATUS.DELIVERED].includes(status)
          ? `BD${intBetween(100000000, 999999999)}GR`
          : null,
        shippedAt: history.find((h) => h.status === ORDER_STATUS.SHIPPED)?.at ?? null,
        deliveredAt: history.find((h) => h.status === ORDER_STATUS.DELIVERED)?.at ?? null,
      },
      payment: {
        method: paymentMethod,
        status: paymentStatus,
        senderPhone: isPrepaid ? customer.phone : null,
        transactionId: isPrepaid && paymentStatus !== PAYMENT_STATUS.PENDING_VERIFICATION
          ? `${pick(['BKS', 'NGD', 'RCK'])}${intBetween(10000000, 99999999)}`
          : null,
        merchantNumber: isPrepaid ? pick(['+8801711223344', '+8801811223344', '+8801911223344-1']) : null,
        paidAt: paymentStatus === PAYMENT_STATUS.PAID ? history[history.length - 1].at : null,
        note: '',
      },
      status,
      statusHistory: history,
      cancellation: status === ORDER_STATUS.CANCELLED
        ? { reason: pick(['Customer changed their mind', 'Could not reach the customer by phone', 'Delivery address incorrect', 'Product damaged in transit']), cancelledBy: null, cancelledByName: 'Support', at: history[history.length - 1].at }
        : { reason: '', cancelledBy: null, cancelledByName: '', at: null },
      notes: random() < 0.2 ? pick(['Please call before delivery', 'Leave with the guard if nobody answers', 'Gift wrap requested']) : '',
      deliveryNote: random() < 0.15 ? 'Ring the bell twice; the flat is on the 4th floor.' : '',
      isPaid: paymentStatus === PAYMENT_STATUS.PAID,
      meta: { ip: '103.108.0.1', userAgent: 'seed', source: 'web' },
    };

    deriveOrder(document, { isNew: true });
    // Backdate the timestamps so "newest first" reflects the simulated history.
    document.createdAt = placedAt;
    document.updatedAt = history[history.length - 1].at ?? placedAt;
    if (document.coupon) {
      document.invoice = { ...document.invoice, issuedAt: placedAt };
    }

    const order = await db.Order.create(document);
    created.push(order.toObject ? order.toObject() : order);
  }

  // Fold every order into its customer's lifetime value.
  for (const customerId of [...new Set(created.map((order) => String(order.customer)))]) {
    await rebuildCustomerStats(customerId);
  }

  logger.info('[seed] orders', { created: created.length, statuses: summarize(created) });
  return { created: created.length };
}

/** Build a plausible `statusHistory` ending at `status`, backdated from `placedAt`. */
function buildStatusHistory(status, placedAt) {
  const pipeline = [ORDER_STATUS.PENDING, ORDER_STATUS.PROCESSING, ORDER_STATUS.SHIPPED, ORDER_STATUS.DELIVERED];
  const history = [];
  let cursor = new Date(placedAt.getTime());

  const walk = (target) => {
    for (const step of pipeline) {
      cursor = new Date(cursor.getTime() + intBetween(2, 20) * 3_600_000);
      history.push({ status: step, note: noteFor(step), changedBy: null, changedByName: actorFor(step), at: new Date(cursor) });
      if (step === target) return;
    }
  };

  if (status === ORDER_STATUS.CANCELLED) {
    history.push({ status: ORDER_STATUS.PENDING, note: 'Order placed', changedByName: 'System', at: new Date(placedAt) });
    cursor = new Date(placedAt.getTime() + intBetween(1, 30) * 3_600_000);
    history.push({ status: ORDER_STATUS.CANCELLED, note: 'Cancelled after a phone call with the customer', changedByName: 'Support', at: new Date(cursor) });
    return history;
  }

  if (status === ORDER_STATUS.PENDING) {
    return [{ status: ORDER_STATUS.PENDING, note: 'Order placed', changedBy: null, changedByName: 'System', at: new Date(placedAt) }];
  }

  walk(status);
  // The first entry should sit exactly at the order time.
  history[0] = { ...history[0], at: new Date(placedAt), note: 'Order placed' };
  return history;
}

function noteFor(status) {
  return {
    [ORDER_STATUS.PROCESSING]: 'Packed and handed to the dispatch desk',
    [ORDER_STATUS.SHIPPED]: 'Picked up by the courier',
    [ORDER_STATUS.DELIVERED]: 'Delivered and payment collected',
    [ORDER_STATUS.PENDING]: 'Order placed',
    [ORDER_STATUS.CANCELLED]: 'Cancelled',
  }[status] ?? '';
}

function actorFor(status) {
  return status === ORDER_STATUS.DELIVERED ? 'Rider' : status === ORDER_STATUS.SHIPPED ? 'Courier' : 'Warehouse';
}

/**
 * Recompute a customer's lifetime counters straight from their orders.
 *
 * Done as a rebuild (rather than incremental `$inc`) because the seeded history
 * is written in one pass and must end up exactly consistent — including the
 * cancelled orders that should not contribute to spend.
 */
async function rebuildCustomerStats(customerId) {
  const orders = await db.Order.find({ customer: customerId }).lean();
  const billable = orders.filter((order) => order.status !== ORDER_STATUS.CANCELLED);
  const totalSpent = billable.reduce((sum, order) => sum + (order.pricing?.grandTotal ?? 0), 0);
  const itemsPurchased = billable.reduce((sum, order) => sum + (order.totals?.itemCount ?? 0), 0);
  const timestamps = orders.map((order) => new Date(order.createdAt).getTime()).filter((ms) => Number.isFinite(ms));

  await db.Customer.updateOne(
    { _id: customerId },
    {
      $set: {
        'stats.totalOrders': billable.length,
        'stats.totalSpent': Number(totalSpent.toFixed(2)),
        'stats.itemsPurchased': itemsPurchased,
        'stats.firstOrderAt': timestamps.length ? new Date(Math.min(...timestamps)) : undefined,
        'stats.lastOrderAt': timestamps.length ? new Date(Math.max(...timestamps)) : undefined,
      },
    },
  );
  await refreshCustomerStats(customerId);
}

function summarize(orders) {
  const counts = {};
  for (const order of orders) counts[order.status] = (counts[order.status] ?? 0) + 1;
  return counts;
}

/* -------------------------------------------------------------------------- */
/*  Entry points                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Full seed. Safe to run repeatedly.
 * @param {{fresh?:boolean}} [options]
 */
export async function seedDatabase({ fresh = false } = {}) {
  const started = Date.now();

  if (fresh) {
    logger.warn('[seed] --fresh: wiping all collections first');
    for (const name of ['Order', 'Customer', 'Product', 'Category', 'Storefront']) {
      await db[name].deleteMany({});
    }
  }

  const categoryBySlug = await seedCategories();
  const productIdBySlug = await seedProducts(categoryBySlug);
  await seedStorefront(productIdBySlug);
  await ensureBootstrapAdmin();
  const customers = await seedCustomers();
  const orders = await seedOrders(customers, productIdBySlug);

  const summary = {
    driver: getDriver(),
    categories: categoryBySlug.size,
    products: productIdBySlug.size,
    customers: customers.length,
    orders: orders.created,
    admin: env.ADMIN_EMAIL,
    password: env.ADMIN_PASSWORD,
    ms: Date.now() - started,
  };
  logger.info('[seed] complete', summary);
  return summary;
}

/**
 * Seed only when the database is empty — called on boot so a fresh clone works
 * immediately, without ever touching a populated production database.
 */
export async function autoSeedIfEmpty() {
  const productCount = await db.Product.countDocuments({});
  if (productCount > 0) {
    logger.debug('[seed] catalogue already populated, skipping auto-seed', { productCount });
    return { skipped: true, productCount };
  }
  logger.info('[seed] empty database detected — loading the demo catalogue');
  return seedDatabase();
}

/* -------------------------------------------------------------------------- */
/*  CLI                                                                       */
/* -------------------------------------------------------------------------- */

/** True when this file is the process entry point (i.e. `node src/seed/seed.js`). */
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  const fresh = process.argv.includes('--fresh');
  try {
    await connectDatabase();
    configureCloudinary();
    await seedDatabase({ fresh });
    logger.info('[seed] done — you can now sign in to /admin', {
      email: env.ADMIN_EMAIL,
      password: env.ADMIN_PASSWORD,
    });
    await disconnectDatabase();
    process.exit(0);
  } catch (error) {
    logger.error('[seed] failed', { stack: error.stack ?? error.message });
    await disconnectDatabase().catch(() => {});
    process.exit(1);
  }
}
