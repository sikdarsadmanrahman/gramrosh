/**
 * -----------------------------------------------------------------------------
 *  category.model.js — Catalogue taxonomy (Honey, Ghee, Organic Sugar, Nuts…)
 * -----------------------------------------------------------------------------
 *  Categories are read on *every* catalogue request (filter chips, breadcrumbs,
 *  product cards), so they are heavily indexed and cached at the HTTP layer.
 * -----------------------------------------------------------------------------
 */
import mongoose from 'mongoose';
import { slugify } from '../utils/slugify.js';

const { Schema, Types } = mongoose;

/** Localised image block — reused across models. */
export const imageSchema = new Schema(
  {
    url: { type: String, required: true, trim: true },
    /** Responsive fallback rendered while the WebP loads. */
    placeholderUrl: { type: String, trim: true },
    alt: { type: String, trim: true, maxlength: 180 },
    width: { type: Number, min: 0 },
    height: { type: Number, min: 0 },
    /** Almost always `webp`; kept explicit so the CDN strategy is auditable. */
    format: { type: String, default: 'webp', enum: ['webp', 'avif', 'jpg', 'jpeg', 'png'] },
    isPrimary: { type: Boolean, default: false },
  },
  { _id: false },
);

const seoSchema = new Schema(
  {
    title: { type: String, trim: true, maxlength: 70 },
    description: { type: String, trim: true, maxlength: 170 },
    keywords: { type: [String], default: [] },
  },
  { _id: false },
);

const categorySchema = new Schema(
  {
    name: {
      /** Primary (English) name — indexed and used for slugs. */
      en: { type: String, required: [true, 'Category name (en) is required'], trim: true, maxlength: 60 },
      /** Bengali name rendered in the storefront. */
      bn: { type: String, trim: true, maxlength: 60 },
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 80,
    },
    summary: { type: String, trim: true, maxlength: 240 },
    description: { type: String, trim: true, maxlength: 2000 },
    image: { type: imageSchema, default: undefined },
    /** Lucide icon name, e.g. `droplet` for Ghee. */
    icon: { type: String, trim: true, default: 'leaf' },
    /** Tailwind-safe accent colour used by category chips & section headers. */
    accent: { type: String, trim: true, default: '#16a34a' },
    /** Self-referencing parent for shallow nesting (max depth 2 in the UI). */
    parent: { type: Types.ObjectId, ref: 'Category', default: null, index: true },
    /** Manual ordering of the category strip on the homepage. */
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    /** Denormalised live product count — refreshed by the product service. */
    productCount: { type: Number, default: 0, min: 0 },
    seo: { type: seoSchema, default: undefined },
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

// `slug` already carries `unique: true` (its own unique index).
// Category strip query: WHERE isActive ORDER BY sortOrder → covered exactly.
categorySchema.index({ isActive: 1, sortOrder: 1, createdAt: -1 });
// Admin category table search / duplicate detection.
categorySchema.index({ 'name.en': 1 });
categorySchema.index({ 'name.en': 'text', 'name.bn': 'text', summary: 'text' });

/* -------------------------------------------------------------------------- */
/*  Hooks                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Pure derivation: auto-slug from the English name unless one was supplied.
 *
 * Exported (not only wired into a hook) so every storage driver produces the
 * same document — see `models/derivations.js`.
 *
 * @param {object} doc plain object or Mongoose document
 * @returns {object} the same object, mutated
 */
export function deriveCategory(doc) {
  if (!doc.slug && doc.name?.en) doc.slug = slugify(doc.name.en);
  return doc;
}

categorySchema.pre('validate', function deriveSlug(next) {
  deriveCategory(this);
  next();
});

export const Category = mongoose.models.Category || mongoose.model('Category', categorySchema);
export default Category;
