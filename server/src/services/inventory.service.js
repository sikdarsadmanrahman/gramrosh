/**
 * -----------------------------------------------------------------------------
 *  inventory.service.js — Stock reservation without overselling
 * -----------------------------------------------------------------------------
 *  Checkout decrements stock with a *conditional atomic update*:
 *
 *      Product.findOneAndUpdate(
 *        { _id, variants: { $elemMatch: { _id: variantId, stock: { $gte: qty } } } },
 *        { $inc: { 'variants.$.stock': -qty } },
 *      )
 *
 *  The guard lives in the filter, so MongoDB's single-document write lock makes
 *  the check-and-decrement indivisible. Two shoppers racing for the last jar
 *  cannot both succeed — one gets `null` back and we return "only 1 left".
 *  This is deliberately used instead of a transaction: it works on a standalone
 *  mongod (no replica set required) and is one indexed write per line.
 *
 *  Every reservation is rolled back if a later line in the same basket fails, so
 *  a rejected checkout never leaks stock.
 * -----------------------------------------------------------------------------
 */
import { db } from '../db/index.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { LOW_STOCK_THRESHOLD, STOCK_STATUS } from '../config/constants.js';

/** Find a variant inside a product document by id. */
function findVariant(product, variantId) {
  return (product?.variants ?? []).find((v) => String(v._id) === String(variantId)) ?? null;
}

/** Refresh the denormalised stock/price fields after atomic variant writes. */
async function refreshDerived(productIds) {
  const unique = [...new Set(productIds.filter(Boolean).map(String))];
  await Promise.all(unique.map((id) => db.Product.recomputeDerived(id).catch((error) => {
    logger.warn('[inventory] derived-field refresh failed', { id, error: error.message });
  })));
}

/**
 * Atomically reserve stock for a basket.
 *
 * @param {Array<{productId:string, variantId:string, quantity:number, unitPriceOverride?:number}>} items
 * @returns {Promise<Array<object>>} resolved line items with price snapshots
 * @throws {ApiError} 404 (gone), 400 (unknown variant) or 409 (insufficient stock)
 */
export async function reserveStock(items) {
  const reserved = [];

  try {
    for (const item of items) {
      const updated = await db.Product.findOneAndUpdate(
        {
          _id: item.productId,
          status: 'active',
          isArchived: false,
          variants: {
            $elemMatch: { _id: item.variantId, isActive: true, stock: { $gte: item.quantity } },
          },
        },
        { $inc: { 'variants.$.stock': -item.quantity } },
        { new: true },
      ).lean();

      if (!updated) {
        // Explain *why* it failed — "out of stock" vs "product retired" need
        // different UI copy, and support needs it too.
        const existing = await db.Product.findById(item.productId).lean();
        if (!existing || existing.isArchived || existing.status !== 'active') {
          throw ApiError.notFound(`"${item.title ?? 'One of your items'}" is no longer available`);
        }
        const variant = findVariant(existing, item.variantId);
        if (!variant) {
          throw ApiError.badRequest(`"${existing.title}" is no longer sold in that pack size`);
        }
        if (!variant.isActive) {
          throw ApiError.conflict(`"${existing.title} — ${variant.label}" is not available right now`);
        }
        throw ApiError.conflict(
          variant.stock > 0
            ? `Only ${variant.stock} × ${variant.label} of "${existing.title}" left — reduce the quantity and try again`
            : `"${existing.title} — ${variant.label}" just sold out`,
          { errors: [{ path: 'items', message: `${existing.title} (${variant.label}) has ${variant.stock} in stock` }] },
        );
      }

      const variant = findVariant(updated, item.variantId);
      reserved.push({
        productId: updated._id,
        variantId: variant._id,
        quantity: item.quantity,
        title: updated.title,
        titleBn: updated.titleBn ?? '',
        variantLabel: variant.label,
        sku: variant.sku,
        image: updated.image || updated.images?.[0]?.url || '',
        categoryName: updated.categoryName ?? '',
        unitPrice: item.unitPriceOverride ?? variant.price,
        compareAtPrice: variant.compareAtPrice ?? null,
        wasFlashSale: Boolean(updated.flashSale?.isActive && updated.flashSale?.endsAt > new Date()),
        remainingStock: variant.stock,
      });
    }

    await refreshDerived(reserved.map((line) => line.productId));
    return reserved;
  } catch (error) {
    // Roll back everything already decremented, then rethrow the original error.
    if (reserved.length) {
      await releaseStock(reserved.map((line) => ({
        productId: line.productId,
        variantId: line.variantId,
        quantity: line.quantity,
      })));
      logger.info('[inventory] rolled back partial reservation', { lines: reserved.length });
    }
    throw error;
  }
}

/**
 * Return stock to the shelf (order cancelled, or reservation rollback).
 * Never throws: failing to restock must not mask the original error.
 */
export async function releaseStock(items) {
  const touched = [];
  for (const item of items ?? []) {
    try {
      const result = await db.Product.updateOne(
        { _id: item.productId, variants: { $elemMatch: { _id: item.variantId } } },
        { $inc: { 'variants.$.stock': item.quantity, 'stats.sold': -item.quantity } },
      );
      if (result?.matchedCount || result?.modifiedCount) touched.push(String(item.productId));
    } catch (error) {
      logger.error('[inventory] restock failed', { item, error: error.message });
    }
  }
  await refreshDerived(touched);
  return { restocked: touched.length };
}

/** Increment the lifetime `sold` counter once an order reaches Delivered. */
export async function recordUnitsSold(items) {
  const touched = [];
  for (const item of items ?? []) {
    try {
      await db.Product.updateOne(
        { _id: item.product, 'variants._id': item.variant },
        { $inc: { 'stats.sold': item.quantity } },
      );
      touched.push(String(item.product));
    } catch (error) {
      logger.warn('[inventory] sold counter failed', { error: error.message });
    }
  }
  await refreshDerived(touched);
}

/**
 * Stock-alert feed for the admin dashboard.
 *
 * @param {{threshold?:number, limit?:number, includeOutOfStock?:boolean}} [options]
 */
export async function getStockAlerts({ threshold = LOW_STOCK_THRESHOLD, limit = 20, includeOutOfStock = true } = {}) {
  const filter = { status: 'active', isArchived: false };
  if (!includeOutOfStock) filter.stockStatus = STOCK_STATUS.LOW_STOCK;

  const products = await db.Product.find(filter)
    .sort({ totalStock: 1, 'stats.sold': -1 })
    .limit(Math.min(limit * 3, 200))
    .select({ title: 1, slug: 1, image: 1, categoryName: 1, stockStatus: 1, totalStock: 1, variants: 1, 'stats.sold': 1 })
    .lean();

  const alerts = [];
  for (const product of products) {
    for (const variant of product.variants ?? []) {
      if (variant.isActive === false) continue;
      const level = variant.stock <= 0 ? 'out_of_stock' : variant.stock <= threshold ? 'low_stock' : null;
      if (!level) continue;
      if (level === 'out_of_stock' && !includeOutOfStock) continue;
      alerts.push({
        productId: product._id,
        title: product.title,
        slug: product.slug,
        image: product.image,
        categoryName: product.categoryName,
        variantId: variant._id,
        variantLabel: variant.label,
        sku: variant.sku,
        stock: variant.stock,
        threshold: variant.lowStockThreshold ?? threshold,
        level,
        sold: product.stats?.sold ?? 0,
      });
    }
  }

  return alerts
    .sort((a, b) => a.stock - b.stock || b.sold - a.sold)
    .slice(0, limit);
}

/**
 * Sellable quantity for a combo with `bundle.autoStock` —
 * the smallest number of complete bundles the component stock allows.
 */
export async function computeBundleAvailability(product) {
  const bundle = product?.bundle;
  if (!bundle?.isActive || !bundle.autoStock || !bundle.items?.length) return null;

  const ids = bundle.items.map((entry) => entry.product).filter(Boolean);
  const components = await db.Product.find({ _id: { $in: ids } }).select({ variants: 1, title: 1 }).lean();
  const byId = new Map(components.map((c) => [String(c._id), c]));

  let available = Infinity;
  const breakdown = [];
  for (const entry of bundle.items) {
    const component = byId.get(String(entry.product));
    if (!component) {
      breakdown.push({ product: entry.product, label: entry.label ?? 'Unknown item', available: 0 });
      available = 0;
      continue;
    }
    const variant = entry.variant ? findVariant(component, entry.variant) : (component.variants ?? [])[0];
    const stock = variant?.stock ?? 0;
    const bundles = Math.floor(stock / Math.max(1, entry.quantity));
    breakdown.push({
      product: entry.product,
      label: entry.label ?? component.title,
      variantLabel: variant?.label ?? '',
      stock,
      required: entry.quantity,
      available: bundles,
    });
    available = Math.min(available, bundles);
  }

  return { available: Number.isFinite(available) ? available : 0, breakdown };
}
