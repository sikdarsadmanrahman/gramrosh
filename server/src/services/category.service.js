/**
 * -----------------------------------------------------------------------------
 *  category.service.js — Taxonomy reads & writes
 * -----------------------------------------------------------------------------
 *  Categories are the cheapest thing in the app and the most frequently read, so
 *  they are served with the longest HTTP cache in the catalogue.
 * -----------------------------------------------------------------------------
 */
import mongoose from 'mongoose';
import { db } from '../db/index.js';
import { ApiError } from '../utils/ApiError.js';
import { uniqueSlug } from '../utils/slugify.js';
import { deriveCategory } from '../models/category.model.js';

/**
 * Active categories for the storefront, ordered by the manual sort order.
 *
 * @param {{includeInactive?:boolean, withCounts?:boolean}} [options]
 */
export async function listCategories({ includeInactive = false, withCounts = true } = {}) {
  const filter = includeInactive ? {} : { isActive: true };
  const categories = await db.Category.find(filter)
    .sort({ sortOrder: 1, 'name.en': 1 })
    .lean();

  if (!withCounts) return categories;

  // One aggregation replaces N `countDocuments` calls (the classic N+1 that
  // makes a category strip cost 8 queries instead of 1).
  const counts = await db.Product.aggregate([
    { $match: { status: 'active', isArchived: false } },
    { $group: { _id: '$category', count: { $sum: 1 } } },
  ]);
  const countById = new Map(counts.map((row) => [String(row._id), row.count]));

  return categories.map((category) => ({
    ...category,
    liveProductCount: countById.get(String(category._id)) ?? 0,
  }));
}

/** Fetch by slug or ObjectId; 404 when missing. */
export async function getCategory(slugOrId, { includeInactive = false } = {}) {
  const filter = mongoose.isValidObjectId(slugOrId)
    ? { _id: new mongoose.Types.ObjectId(slugOrId) }
    : { slug: String(slugOrId).toLowerCase() };
  if (!includeInactive) filter.isActive = true;

  const category = await db.Category.findOne(filter).lean();
  if (!category) throw ApiError.notFound('Category not found');
  return category;
}

/** Create a category, deriving a unique slug from its English name. */
export async function createCategory(payload) {
  const draft = deriveCategory({ ...payload });
  draft.slug = await uniqueSlug(payload.slug || draft.name.en, async (slug) => Boolean(await db.Category.exists({ slug })));

  if (draft.parent) {
    const parent = await db.Category.findById(draft.parent).lean();
    if (!parent) throw ApiError.badRequest('Parent category does not exist');
    if (parent.parent) throw ApiError.badRequest('Only two levels of nesting are supported');
  }

  const created = await db.Category.create(draft);
  return created;
}

/** Update a category (renaming re-derives the slug only when one is supplied). */
export async function updateCategory(id, payload) {
  const existing = await db.Category.findById(id).lean();
  if (!existing) throw ApiError.notFound('Category not found');

  const update = { ...payload };
  if (update.name && !update.name.en) update.name = { ...existing.name, ...update.name };
  if (update.slug && update.slug !== existing.slug) {
    update.slug = await uniqueSlug(update.slug, async (slug) => Boolean(await db.Category.exists({ slug })), id);
  }
  if (update.parent && String(update.parent) === String(existing._id)) {
    throw ApiError.badRequest('A category cannot be its own parent');
  }

  const updated = await db.Category.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
  return updated;
}

/**
 * Delete a category. Refused while products still reference it — otherwise the
 * catalogue would show items with a dangling breadcrumb.
 */
export async function deleteCategory(id) {
  const category = await db.Category.findById(id).lean();
  if (!category) throw ApiError.notFound('Category not found');

  const [productCount, childCount] = await Promise.all([
    db.Product.countDocuments({ category: id }),
    db.Category.countDocuments({ parent: id }),
  ]);
  if (productCount > 0) {
    throw ApiError.conflict(`Move or archive the ${productCount} product(s) in "${category.name.en}" first`);
  }
  if (childCount > 0) {
    throw ApiError.conflict(`This category has ${childCount} sub-categor${childCount === 1 ? 'y' : 'ies'} — remove them first`);
  }

  await db.Category.deleteOne({ _id: id });
  return { deleted: true, slug: category.slug };
}

/** Reorder the homepage strip: `[{ id, sortOrder }]`. */
export async function reorderCategories(entries = []) {
  await Promise.all(
    entries.map((entry) =>
      db.Category.updateOne({ _id: entry.id }, { $set: { sortOrder: Number(entry.sortOrder) || 0 } }),
    ),
  );
  return { updated: entries.length };
}
