/**
 * -----------------------------------------------------------------------------
 *  product.service.js — Catalogue reads & writes
 * -----------------------------------------------------------------------------
 *  Every read goes through `buildProductFilter`, which exists to keep queries
 *  *index-shaped*:
 *
 *    • the public catalogue always pins `status:'active'` + `isArchived:false`,
 *      the two leading equality fields of the primary compound index
 *      `{ category, status, isArchived, createdAt }`, so the sort on `createdAt`
 *      is served by the index and MongoDB never spills to an in-memory sort;
 *    • price and stock filters hit the denormalised `priceRange.min` /
 *      `totalStock` / `stockStatus` fields rather than walking `variants`;
 *    • search runs against the single pre-computed `searchBlob` haystack (or the
 *      weighted text index with `searchMode=text`), never against five fields.
 * -----------------------------------------------------------------------------
 */
import mongoose from 'mongoose';
import { db } from '../db/index.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { parseSort } from '../utils/pagination.js';
import { slugify, uniqueSlug } from '../utils/slugify.js';
import { searchTokenRegexes, normalizeSearchTerm } from '../utils/text.js';
import { computeDerivedFields } from '../models/product.model.js';
import { SORT_OPTIONS, STOCK_STATUS, UNIT_TYPES } from '../config/constants.js';

/**
 * Fields the product-card component needs — nothing more.
 *
 * Kept to *top-level* paths on purpose: a projection like `variants.sku` would
 * be applied element-wise on MongoDB but flattened by a naive client-side
 * projector, and the card needs nearly every variant field anyway. Excluding
 * `description`, `documents`, `seo` and `origin.story` still removes the bulk of
 * each document (~70% of bytes on a typical product), which is what matters for
 * a 12-item mobile grid on a slow connection.
 */
export const CARD_PROJECTION = Object.freeze({
  title: 1,
  titleBn: 1,
  slug: 1,
  summary: 1,
  image: 1,
  images: 1,
  category: 1,
  categorySlug: 1,
  categoryName: 1,
  priceRange: 1,
  totalStock: 1,
  stockStatus: 1,
  discountPercent: 1,
  rating: 1,
  reviewCount: 1,
  badges: 1,
  tags: 1,
  isCombo: 1,
  isFeatured: 1,
  bundle: 1,
  flashSale: 1,
  variants: 1,
  createdAt: 1,
});

/** Base filter every *public* query starts from (the index prefix). */
const PUBLIC_BASE_FILTER = Object.freeze({ status: 'active', isArchived: false });

/* -------------------------------------------------------------------------- */
/*  Category resolution                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Turn `?category=honey` / `?category=<id>` / `?categories=a,b` into ObjectIds.
 *
 * @returns {Promise<{ids:import('mongoose').Types.ObjectId[], unresolved:string[]}>}
 */
async function resolveCategoryFilter({ category, categories }) {
  const tokens = [
    ...(categories ?? []),
    ...(category ? String(category).split(',').map((s) => s.trim()).filter(Boolean) : []),
  ];
  if (!tokens.length) return { ids: [], unresolved: [] };

  const ids = tokens.filter((t) => mongoose.isValidObjectId(t)).map((t) => new mongoose.Types.ObjectId(t));
  const slugs = tokens.filter((t) => !mongoose.isValidObjectId(t)).map((t) => t.toLowerCase());

  const filter = {};
  if (ids.length && slugs.length) filter.$or = [{ _id: { $in: ids } }, { slug: { $in: slugs } }];
  else if (ids.length) filter._id = { $in: ids };
  else filter.slug = { $in: slugs };

  const found = await db.Category.find(filter).select('_id slug').lean();
  const resolvedSlugs = new Set(found.map((c) => c.slug));
  return {
    ids: found.map((c) => c._id),
    unresolved: slugs.filter((s) => !resolvedSlugs.has(s)),
  };
}

/* -------------------------------------------------------------------------- */
/*  Filter construction                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Build the MongoDB filter for a catalogue query.
 *
 * @param {object} query   already validated & coerced query params
 * @param {{isAdmin?:boolean}} [options]
 */
export async function buildProductFilter(query = {}, { isAdmin = false } = {}) {
  const filter = isAdmin
    ? { ...(query.includeArchived ? {} : { isArchived: false }) }
    : { ...PUBLIC_BASE_FILTER };

  // --- explicit status (admin) --------------------------------------------
  if (isAdmin && query.status) filter.status = query.status;

  // --- category -----------------------------------------------------------
  const { ids: categoryIds, unresolved } = await resolveCategoryFilter(query);
  if (unresolved.length) {
    // Unknown slug ⇒ nothing can match. Short-circuit instead of scanning.
    logger.debug('[catalogue] unresolved category filter', { unresolved });
  }
  if (categoryIds.length) filter.category = { $in: categoryIds };
  else if (query.category || query.categories?.length) return { ...filter, _id: null }; // guaranteed empty

  // --- search --------------------------------------------------------------
  const term = normalizeSearchTerm(query.q);
  if (term) {
    if (query.searchMode === 'text') {
      // Uses the weighted text index `product_text_search`.
      filter.$text = { $search: term };
    } else {
      // Instant "as you type" search against the single pre-computed haystack.
      const tokens = searchTokenRegexes(term, { mode: 'contains' });
      const clauses = tokens.map((regex) => ({ searchBlob: { $regex: regex } }));
      if (clauses.length === 1) Object.assign(filter, clauses[0]);
      else filter.$and = [...(filter.$and ?? []), ...clauses];
    }
  }

  // --- price range (denormalised, indexed) --------------------------------
  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    const priceRange = {};
    // A product overlaps [min,max] when its max ≥ min and its min ≤ max.
    if (query.minPrice !== undefined) priceRange.$gte = query.minPrice;
    if (query.maxPrice !== undefined) {
      filter['priceRange.min'] = { $lte: query.maxPrice };
    }
    if (Object.keys(priceRange).length) filter['priceRange.max'] = priceRange;
  }

  // --- stock ---------------------------------------------------------------
  if (query.inStock === true) filter.stockStatus = { $in: [STOCK_STATUS.IN_STOCK, STOCK_STATUS.LOW_STOCK] };
  else if (query.inStock === false) filter.stockStatus = STOCK_STATUS.OUT_OF_STOCK;
  if (query.onSale === true) filter.discountPercent = { $gt: 0 };
  if (query.stockAlerts === true) {
    filter.$or = [...(filter.$or ?? []), { stockStatus: STOCK_STATUS.OUT_OF_STOCK }, { stockStatus: STOCK_STATUS.LOW_STOCK }];
  }

  // --- flags ---------------------------------------------------------------
  if (query.isFeatured !== undefined) filter.isFeatured = query.isFeatured;
  if (query.isCombo !== undefined) filter.isCombo = query.isCombo;

  // --- tags & badges -------------------------------------------------------
  if (query.tags?.length) filter.tags = { $in: query.tags };
  if (query.badges?.length) filter.badges = { $all: query.badges };

  // --- ready-made sections -------------------------------------------------
  const now = new Date();
  switch (query.section) {
    case 'featured':
      filter.isFeatured = true;
      break;
    case 'best_selling':
      filter['stats.sold'] = { $gt: 0 };
      break;
    case 'new':
      filter.createdAt = { $gte: new Date(now.getTime() - 60 * 86_400_000) };
      break;
    case 'flash_sale':
      filter['flashSale.isActive'] = true;
      filter['flashSale.endsAt'] = { $gte: now };
      break;
    case 'combos':
      filter.isCombo = true;
      filter['bundle.isActive'] = true;
      break;
    case 'low_stock':
      filter.stockStatus = { $in: [STOCK_STATUS.LOW_STOCK, STOCK_STATUS.OUT_OF_STOCK] };
      break;
    default:
      break;
  }

  // --- related products ----------------------------------------------------
  if (query.relatedTo) {
    const anchor = await getProductBySlugOrId(query.relatedTo, { isAdmin: true, projection: { category: 1, tags: 1 } });
    if (anchor) {
      filter.category = anchor.category;
      filter._id = { $ne: anchor._id };
    }
  }

  return filter;
}

/** Sort object for a validated `sort` key, with section-aware defaults. */
export function resolveProductSort(query) {
  const defaults = {
    featured: { sortOrder: 1, 'stats.sold': -1, createdAt: -1 },
    best_selling: { 'stats.sold': -1, rating: -1 },
    new: { createdAt: -1 },
    flash_sale: { 'flashSale.endsAt': 1 },
    combos: { sortOrder: 1, createdAt: -1 },
    low_stock: { totalStock: 1, 'stats.sold': -1 },
  };
  if (query.section && defaults[query.section] && !query.sort) return defaults[query.section];
  const { sort } = parseSort(query.sort ?? (query.section ? null : 'newest'), SORT_OPTIONS, { createdAt: -1 });
  return sort;
}

/* -------------------------------------------------------------------------- */
/*  Reads                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Paginated catalogue list.
 *
 * @param {object} query validated query params (page/limit/skip already parsed)
 * @param {{isAdmin?:boolean, projection?:object}} [options]
 * @returns {Promise<{items:object[], total:number, page:number, limit:number, filter:object}>}
 */
export async function listProducts(query, { isAdmin = false, projection } = {}) {
  const filter = await buildProductFilter(query, { isAdmin });

  // A guaranteed-empty filter avoids two round trips.
  if (filter._id === null) {
    return { items: [], total: 0, page: query.page ?? 1, limit: query.limit ?? 12, filter };
  }

  const sort = resolveProductSort(query);
  const limit = query.limit ?? 12;
  const skip = query.skip ?? ((query.page ?? 1) - 1) * limit;
  // `?fields=a,b,c` lets a caller shrink the payload further; otherwise the
  // card projection is used for public reads and the full document for admin.
  const selectFields = query.fields
    ? Object.fromEntries(String(query.fields).split(',').map((f) => [f.trim(), 1]).filter(([f]) => f))
    : projection ?? (isAdmin ? null : CARD_PROJECTION);

  // Two queries, both index-covered: one for the page, one for the count.
  // Issued in parallel, so a list request costs one round trip of wall-clock
  // latency rather than two.
  const [items, total] = await Promise.all([
    db.Product.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .select(selectFields)
      .lean(),
    db.Product.countDocuments(filter),
  ]);

  return { items, total, page: query.page ?? Math.floor(skip / limit) + 1, limit, filter };
}

/**
 * Fetch one product by slug (storefront) or ObjectId (admin).
 *
 * @param {string} slugOrId
 * @param {{isAdmin?:boolean, projection?:object, trackView?:boolean}} [options]
 */
export async function getProductBySlugOrId(slugOrId, { isAdmin = false, projection, trackView = false } = {}) {
  const filter = mongoose.isValidObjectId(slugOrId)
    ? { _id: new mongoose.Types.ObjectId(slugOrId) }
    : { slug: String(slugOrId).toLowerCase() };
  if (!isAdmin) Object.assign(filter, PUBLIC_BASE_FILTER);

  const query = db.Product.findOne(filter)
    .populate('category', 'name slug icon accent')
    .lean();
  if (projection) query.select(projection);
  const product = await query;
  if (!product) return null;

  if (trackView) {
    // Fire-and-forget: a view counter must never slow down the page.
    db.Product.updateOne({ _id: product._id }, { $inc: { 'stats.views': 1 } }).catch((error) => {
      logger.warn('[catalogue] view counter failed', { error: error.message });
    });
  }
  return product;
}

/** Same as above but throws 404 — used by controllers that must not continue. */
export async function mustGetProduct(slugOrId, options) {
  const product = await getProductBySlugOrId(slugOrId, options);
  if (!product) throw ApiError.notFound('Product not found or no longer available');
  return product;
}

/**
 * "You may also like" rail for a product page.
 *
 * Same-category siblings are the obvious answer, but a small catalogue has
 * categories holding a single product (one spice, one rice) — an empty rail
 * looks broken. So the search widens in three steps until it is full:
 *
 *   1. same category             (most relevant)
 *   2. shares at least one tag   (still on-topic)
 *   3. best sellers, then newest (always fills the row)
 *
 * Each step is one indexed query and we stop the moment the rail is full, so an
 * ordinary product page costs a single round trip.
 *
 * @param {object} anchor Product document (lean or populated).
 * @param {{limit?:number}} [options]
 * @returns {Promise<object[]>}
 */
export async function getRelatedProducts(anchor, { limit = 5 } = {}) {
  if (!anchor?._id) return [];

  const categoryId = anchor.category?._id ?? anchor.category;
  const base = { ...PUBLIC_BASE_FILTER, _id: { $ne: anchor._id } };
  const picked = [];
  const seen = new Set([String(anchor._id)]);

  /** Append unseen docs in order; returns true once the rail is full. */
  const take = (docs) => {
    for (const doc of docs) {
      if (picked.length >= limit) break;
      const key = String(doc._id);
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(doc);
    }
    return picked.length >= limit;
  };

  const byPopularity = { 'stats.sold': -1, rating: -1, createdAt: -1 };

  // 1. Same category.
  if (categoryId) {
    const siblings = await db.Product.find({ ...base, category: categoryId })
      .sort(byPopularity)
      .limit(limit)
      .lean();
    if (take(siblings)) return picked;
  }

  // 2. Shared tags — `tags` is multi-key indexed, so $in stays cheap.
  const tags = (anchor.tags ?? []).filter(Boolean);
  if (tags.length) {
    const tagged = await db.Product.find({ ...base, tags: { $in: tags } })
      .sort(byPopularity)
      .limit(limit)
      .lean();
    if (take(tagged)) return picked;
  }

  // 3. Fall back to the shop's best sellers, then its newest arrivals.
  const bestSellers = await db.Product.find(base).sort(byPopularity).limit(limit).lean();
  if (take(bestSellers)) return picked;

  const newest = await db.Product.find(base).sort({ createdAt: -1 }).limit(limit).lean();
  take(newest);

  return picked;
}

/**
 * All homepage rails in one round trip (a single DB burst instead of six).
 *
 * @param {{limit?:number}} [options]
 */
export async function getCatalogueSections({ limit = 8 } = {}) {
  const now = new Date();
  const base = { ...PUBLIC_BASE_FILTER };

  const [featured, newArrivals, bestSellers, combos, flashSale] = await Promise.all([
    db.Product.find({ ...base, isFeatured: true }).sort({ sortOrder: 1, 'stats.sold': -1, createdAt: -1 }).limit(limit).lean(),
    db.Product.find({ ...base, createdAt: { $gte: new Date(now.getTime() - 90 * 86_400_000) } }).sort({ createdAt: -1 }).limit(limit).lean(),
    db.Product.find({ ...base, 'stats.sold': { $gt: 0 } }).sort({ 'stats.sold': -1, rating: -1 }).limit(limit).lean(),
    db.Product.find({ ...base, isCombo: true, 'bundle.isActive': true }).sort({ sortOrder: 1, createdAt: -1 }).limit(limit).lean(),
    db.Product.find({ ...base, 'flashSale.isActive': true, 'flashSale.endsAt': { $gte: now } }).sort({ 'flashSale.endsAt': 1 }).limit(limit).lean(),
  ]);

  return { featured, newArrivals, bestSellers, combos, flashSale };
}

/**
 * Filter facets for the shop sidebar: category counts, price bounds, tags.
 * Cheap enough to run per request, and cached at the HTTP layer on top.
 */
export async function getCatalogueFacets() {
  const filter = { ...PUBLIC_BASE_FILTER };
  const [byCategory, priceStats, tags, badges] = await Promise.all([
    db.Product.aggregate([
      { $match: filter },
      { $group: { _id: '$categorySlug', slug: { $first: '$categorySlug' }, name: { $first: '$categoryName' }, count: { $sum: 1 }, minPrice: { $min: '$priceRange.min' }, maxPrice: { $max: '$priceRange.max' } } },
      { $sort: { count: -1 } },
    ]),
    db.Product.aggregate([
      { $match: filter },
      { $group: { _id: null, minPrice: { $min: '$priceRange.min' }, maxPrice: { $max: '$priceRange.max' }, products: { $sum: 1 }, inStock: { $sum: { $cond: [{ $gt: ['$totalStock', 0] }, 1, 0] } } } },
    ]),
    db.Product.distinct('tags', filter),
    db.Product.distinct('badges', filter),
  ]);

  const stats = priceStats[0] ?? { minPrice: 0, maxPrice: 0, products: 0, inStock: 0 };
  return {
    categories: byCategory.filter((c) => c.slug),
    priceRange: { min: stats.minPrice ?? 0, max: stats.maxPrice ?? 0 },
    counts: { products: stats.products ?? 0, inStock: stats.inStock ?? 0 },
    tags: [...tags].sort(),
    badges: [...badges].sort(),
    units: [...UNIT_TYPES],
  };
}

/* -------------------------------------------------------------------------- */
/*  Writes (admin)                                                            */
/* -------------------------------------------------------------------------- */

/** Fields that exist purely to serve queries and must never reach a client. */
const INTERNAL_PRODUCT_FIELDS = Object.freeze(['searchBlob']);

/**
 * Strip query-only fields from a product before it is returned.
 *
 * `searchBlob` is `select: false`, so every *read* already omits it — but
 * `Model.create()` returns the freshly built document, which still carries it.
 * This keeps the contract identical no matter how the document was produced.
 */
export function sanitizeProduct(product) {
  if (!product || typeof product !== 'object') return product;
  const plain = typeof product.toJSON === 'function' ? product.toJSON() : { ...product };
  for (const field of INTERNAL_PRODUCT_FIELDS) delete plain[field];
  return plain;
}

/**
 * Fill in derived variant fields the admin form does not ask for:
 * a label (`500g`) and a SKU (`SUNDARBAN_RAW_HONEY_500G`).
 *
 * @param {object} product
 * @param {{prefixSource?:string}} [options] `prefixSource` is normally the
 *   product's *unique slug*, so two products with the same title still produce
 *   different SKU families.
 */
function ensureVariantDefaults(product, { prefixSource } = {}) {
  const prefix = slugify(prefixSource || product.title || 'product')
    .replace(/-/g, '_')
    .toUpperCase()
    .slice(0, 24) || 'PROD';
  const variants = product.variants ?? [];

  variants.forEach((variant, index) => {
    const unitLabel = `${variant.weightValue}${variant.weightUnit}`;
    if (!variant.label) variant.label = unitLabel;
    if (!variant.sku) variant.sku = `${prefix}_${unitLabel.toUpperCase()}`.replace(/[^A-Z0-9_]/g, '').slice(0, 40);
    if (variant.isActive === undefined) variant.isActive = true;
    if (variants.length === 1) variant.isDefault = true;
    else if (variant.isDefault === undefined) variant.isDefault = index === 0;
  });

  // De-duplicate SKUs *inside* the product first — the unique index would
  // reject the write, and an in-form collision is never the shopper's fault.
  const seen = new Map();
  for (const variant of variants) {
    let sku = String(variant.sku).toUpperCase();
    let suffix = 2;
    while (seen.has(sku)) sku = `${String(variant.sku).toUpperCase()}-${suffix++}`.slice(0, 40);
    seen.set(sku, true);
    variant.sku = sku;
  }

  product.variants = variants;
  return product;
}

/**
 * Make every variant SKU unique *across the whole catalogue*.
 *
 * `variants.sku` carries a unique index, so a collision is a hard write failure.
 * That happens in practice when an operator creates a second product with the
 * same title (the slug gets a `-2` suffix but a truncated SKU prefix would not).
 * Appending `-2`, `-3`… keeps the write succeeding and the SKU still readable.
 *
 * @param {object[]} variants
 * @param {string|null} [excludeId] Product being updated — its own SKUs are fine.
 */
async function ensureGloballyUniqueSkus(variants, excludeId = null) {
  for (const variant of variants ?? []) {
    if (!variant.sku) continue;
    const base = String(variant.sku).toUpperCase();
    let candidate = base;
    let suffix = 2;

    // Bounded on purpose: after a handful of attempts fall back to a
    // time-stamped SKU, which cannot collide with anything already stored.
    while (suffix <= 50) {
      const filter = { 'variants.sku': candidate };
      if (excludeId) filter._id = { $ne: excludeId };
      // eslint-disable-next-line no-await-in-loop
      if (!(await db.Product.exists(filter))) break;
      candidate = `${base}-${suffix++}`.slice(0, 40);
    }
    if (suffix > 50) {
      candidate = `${base.slice(0, 30)}-${Date.now().toString(36).toUpperCase()}`.slice(0, 40);
    }

    variant.sku = candidate;
  }
}

/** Resolve the category and denormalise its name/slug onto the product. */
async function attachCategory(product) {
  if (!product.category) return product;
  const category = await db.Category.findById(product.category).lean();
  if (!category) throw ApiError.badRequest('Selected category does not exist');
  product.categoryName = category.name?.en ?? '';
  product.categorySlug = category.slug ?? '';
  return product;
}

/**
 * Create a product.
 * @param {object} payload validated body
 */
export async function createProduct(payload) {
  const draft = { ...payload };
  await attachCategory(draft);

  // Resolve the unique slug *first*: SKUs are generated from it, so two products
  // sharing a title land in different SKU families instead of colliding.
  draft.slug = await uniqueSlug(payload.slug || payload.title, async (slug) => Boolean(await db.Product.exists({ slug })));

  ensureVariantDefaults(draft, { prefixSource: draft.slug });
  await ensureGloballyUniqueSkus(draft.variants);

  computeDerivedFields(draft);
  const created = await db.Product.create(draft);
  await refreshCategoryCounts([draft.category]);
  logger.info('[catalogue] product created', { id: String(created._id), slug: created.slug });
  return sanitizeProduct(created);
}

/**
 * Update a product. Recomputes slug, category denormalisation and derived fields.
 *
 * @param {string} id
 * @param {object} payload validated partial body
 */
export async function updateProduct(id, payload) {
  const existing = await db.Product.findById(id).lean();
  if (!existing) throw ApiError.notFound('Product not found');

  const update = { ...payload };

  if (update.title && update.title !== existing.title && !payload.slug) {
    update.slug = await uniqueSlug(update.title, async (slug) => Boolean(await db.Product.exists({ slug })), id);
  } else if (update.slug && update.slug !== existing.slug) {
    update.slug = await uniqueSlug(update.slug, async (slug) => Boolean(await db.Product.exists({ slug })), id);
  }

  if (update.category && String(update.category) !== String(existing.category)) {
    await attachCategory(update);
  }

  if (update.variants) {
    const withDefaults = ensureVariantDefaults(
      { ...existing, variants: update.variants },
      { prefixSource: update.slug ?? existing.slug },
    );
    await ensureGloballyUniqueSkus(withDefaults.variants, id);
    update.variants = withDefaults.variants;
  }

  const merged = { ...existing, ...update };
  computeDerivedFields(merged);
  for (const field of ['priceRange', 'totalStock', 'stockStatus', 'discountPercent', 'searchBlob', 'image']) {
    update[field] = merged[field];
  }

  const updated = await db.Product.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
  await refreshCategoryCounts([existing.category, updated.category].filter(Boolean));
  logger.info('[catalogue] product updated', { id, fields: Object.keys(update).length });
  return sanitizeProduct(updated);
}

/** Archive (soft delete) or restore. Archived products keep resolving for old orders. */
export async function setProductArchived(id, archived = true) {
  const updated = await db.Product.findByIdAndUpdate(
    id,
    { $set: { isArchived: archived, status: archived ? 'archived' : 'active' } },
    { new: true },
  ).lean();
  if (!updated) throw ApiError.notFound('Product not found');
  await refreshCategoryCounts([updated.category]);
  return updated;
}

/** Hard delete — super_admin only, and refused when orders reference the product. */
export async function deleteProduct(id) {
  const product = await db.Product.findById(id).lean();
  if (!product) throw ApiError.notFound('Product not found');

  const referencedBy = await db.Order.countDocuments({ 'items.product': product._id });
  if (referencedBy > 0) {
    throw ApiError.conflict(
      `This product appears in ${referencedBy} order(s) and cannot be deleted — archive it instead so invoices stay valid`,
    );
  }
  await db.Product.deleteOne({ _id: product._id });
  await refreshCategoryCounts([product.category]);
  logger.warn('[catalogue] product hard-deleted', { id, slug: product.slug });
  return { deleted: true, slug: product.slug };
}

/** Clone a product as a draft — the fastest way to add a new pack size range. */
export async function duplicateProduct(id, { title, status = 'draft' } = {}) {
  const source = await db.Product.findById(id).lean();
  if (!source) throw ApiError.notFound('Product not found');

  const copy = {
    ...source,
    _id: undefined,
    title: title ?? `${source.title} (copy)`,
    slug: undefined,
    status,
    isArchived: false,
    createdAt: undefined,
    updatedAt: undefined,
    stats: { views: 0, sold: 0, addToCarts: 0 },
    rating: 0,
    reviewCount: 0,
    variants: (source.variants ?? []).map((variant) => ({ ...variant, _id: undefined, stock: 0, sku: '' })),
  };
  delete copy._id;
  delete copy.createdAt;
  delete copy.updatedAt;

  // `createProduct` already sanitises; re-running it here keeps the copy's
  // zeroed stock and regenerated SKUs explicit at the call site.
  return createProduct(copy);
}

/** Bulk stock update used by the admin stock screen. */
export async function bulkUpdateStock(id, { variants, adjustments, variantId, stock }) {
  const product = await db.Product.findById(id).lean();
  if (!product) throw ApiError.notFound('Product not found');

  const nextVariants = (product.variants ?? []).map((variant) => {
    const variantKey = String(variant._id);
    if (variants?.length) {
      const match = variants.find((v) => String(v.variantId) === variantKey);
      if (match) return { ...variant, stock: Math.max(0, Number(match.stock) || 0) };
    }
    if (adjustments?.length) {
      const match = adjustments.find((a) => String(a.variantId) === variantKey);
      if (match) return { ...variant, stock: Math.max(0, (Number(variant.stock) || 0) + Number(match.delta || 0)) };
    }
    if (variantId && String(variantId) === variantKey && stock !== undefined) {
      return { ...variant, stock: Math.max(0, Number(stock) || 0) };
    }
    return variant;
  });

  const merged = { ...product, variants: nextVariants };
  computeDerivedFields(merged);

  const updated = await db.Product.findByIdAndUpdate(
    id,
    { $set: { variants: merged.variants, totalStock: merged.totalStock, stockStatus: merged.stockStatus, priceRange: merged.priceRange, discountPercent: merged.discountPercent, searchBlob: merged.searchBlob } },
    { new: true },
  ).lean();

  logger.info('[inventory] stock updated via admin', { id, totalStock: updated.totalStock, stockStatus: updated.stockStatus });
  return updated;
}

/** Keep `Category.productCount` honest after any catalogue mutation. */
export async function refreshCategoryCounts(categoryIds = []) {
  const unique = [...new Set(categoryIds.filter(Boolean).map(String))];
  await Promise.all(
    unique.map(async (categoryId) => {
      const count = await db.Product.countDocuments({ category: categoryId, status: 'active', isArchived: false });
      await db.Category.updateOne({ _id: categoryId }, { $set: { productCount: count } });
    }),
  );
}

/** Async, best-effort view counter (never blocks the response). */
export function trackProductView(id) {
  db.Product.updateOne({ _id: id }, { $inc: { 'stats.views': 1 } }).catch(() => {});
}
