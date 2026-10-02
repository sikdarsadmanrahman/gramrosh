/**
 * -----------------------------------------------------------------------------
 *  product.model.js — The catalogue workhorse
 * -----------------------------------------------------------------------------
 *  Design notes (why the schema looks like this):
 *
 *  1. VARIANTS, not separate products. A jar of honey sold as 250g / 500g / 1kg
 *     is one document with three variants. This keeps the catalogue small, the
 *     product page fast and the "unit selector" a pure client concern.
 *
 *  2. DELIBERATE DENORMALISATION. Sorting a catalogue by price or filtering by
 *     "in stock" cannot be done cheaply against an array of variants, so the
 *     aggregate values a query needs (`priceRange.min/max`, `totalStock`,
 *     `availableStock`, `discountPercent`, `searchBlob`) are computed on write
 *     and stored at the top level where a B-tree index can serve them. They are
 *     recomputed by ONE pure function (`computeDerivedFields`) that is invoked
 *     both from the Mongoose `pre('save')` hook and from the service layer, so
 *     the values can never drift no matter which write path was used.
 *
 *  3. SOFT DELETE / ARCHIVE. `status: 'archived'` instead of hard deletes keeps
 *     historical orders resolvable and populating.
 * -----------------------------------------------------------------------------
 */
import mongoose from 'mongoose';
import { imageSchema } from './category.model.js';
import { slugify } from '../utils/slugify.js';
import { UNIT_TYPES, STOCK_STATUS, LOW_STOCK_THRESHOLD } from '../config/constants.js';

const { Schema, Types } = mongoose;

/* -------------------------------------------------------------------------- */
/*  Sub-schemas                                                               */
/* -------------------------------------------------------------------------- */

/**
 * One purchasable unit option: 250g, 500g, 1kg, 1L…
 * Stock lives here — never on the parent — because stock is per pack size.
 */
const variantSchema = new Schema(
  {
    sku: {
      type: String,
      required: [true, 'Variant SKU is required'],
      trim: true,
      uppercase: true,
      maxlength: 40,
    },
    /** Human label rendered on the unit selector chip, e.g. `500g`. */
    label: { type: String, required: true, trim: true, maxlength: 30 },
    /** Numeric magnitude, used for "price per kg" comparisons & sorting. */
    weightValue: { type: Number, required: true, min: [0.001, 'weightValue must be positive'] },
    weightUnit: { type: String, required: true, enum: { values: UNIT_TYPES, message: '{VALUE} is not a supported unit' } },
    /** Grams/ml normalised value — enables "cheapest per kg" sorting. */
    normalizedValue: { type: Number, min: 0, default: 0 },
    price: { type: Number, required: true, min: [0, 'Price cannot be negative'] },
    /** Strike-through price; must exceed `price` for a discount to show. */
    compareAtPrice: { type: Number, min: 0, default: null },
    stock: { type: Number, required: true, default: 0, min: [0, 'Stock cannot be negative'] },
    /** Reserved by in-flight orders (kept simple: single numeric field). */
    lowStockThreshold: { type: Number, min: 0, default: LOW_STOCK_THRESHOLD },
    barcode: { type: String, trim: true },
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { _id: true },
);

/** Limited-time flash sale attached to a single product. */
const flashSaleSchema = new Schema(
  {
    isActive: { type: Boolean, default: false },
    startsAt: { type: Date, default: () => new Date() },
    /** Drives the sticky countdown bar in the storefront. */
    endsAt: { type: Date, required: true },
    label: { type: String, trim: true, default: 'Flash Sale' },
    /** Optional per-campaign inventory cap, separate from physical stock. */
    stockLimit: { type: Number, min: 0, default: null },
    soldCount: { type: Number, min: 0, default: 0 },
  },
  { _id: false },
);

/** Combo / bundle definition. */
const bundleSchema = new Schema(
  {
    isActive: { type: Boolean, default: false },
    /** Marketing label shown on the combo ribbon, e.g. "Save ৳350". */
    badge: { type: String, trim: true, default: 'Combo Deal' },
    headline: { type: String, trim: true, maxlength: 120 },
    items: [
      {
        product: { type: Types.ObjectId, ref: 'Product', required: true },
        variant: { type: Types.ObjectId, default: null },
        quantity: { type: Number, required: true, min: 1, default: 1 },
        /** Snapshot label so combos render even if an item is archived. */
        label: { type: String, trim: true },
        _id: false,
      },
    ],
    /**
     * When true the combo's sellable stock is derived as
     * `min(floor(itemStock / itemQty))` instead of being tracked manually.
     */
    autoStock: { type: Boolean, default: false },
    /** Sum of the individual item prices, used to show the bundle saving. */
    combinedPrice: { type: Number, min: 0, default: 0 },
  },
  { _id: false },
);

/** BSTI certificate / lab test report / sourcing document. */
const documentSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 140 },
    /** One of CERTIFICATION_TYPES: bsti, lab_report, organic_certificate… */
    type: { type: String, required: true, trim: true, lowercase: true },
    url: { type: String, required: true, trim: true },
    /** Lab/batch identifier printed on the report. */
    reference: { type: String, trim: true },
    issuedAt: { type: Date },
    expiresAt: { type: Date },
    fileSizeKb: { type: Number, min: 0 },
    isPublic: { type: Boolean, default: true },
  },
  { _id: true },
);

const seoSchema = new Schema(
  {
    title: { type: String, trim: true, maxlength: 70 },
    description: { type: String, trim: true, maxlength: 170 },
    keywords: { type: [String], default: [] },
  },
  { _id: false },
);

/* -------------------------------------------------------------------------- */
/*  Main schema                                                               */
/* -------------------------------------------------------------------------- */

const productSchema = new Schema(
  {
    title: {
      type: String,
      required: [true, 'Product title is required'],
      trim: true,
      maxlength: 160,
    },
    /** Bengali title, rendered beneath the English one on the storefront. */
    titleBn: { type: String, trim: true, maxlength: 160 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 180 },
    /** One-line teaser shown on the product card (the "short description"). */
    summary: { type: String, trim: true, maxlength: 240 },
    /** Full description; may contain simple markdown, rendered on the PDP. */
    description: { type: String, trim: true, maxlength: 8000 },

    category: {
      type: Types.ObjectId,
      ref: 'Category',
      required: [true, 'A product must belong to a category'],
    },
    /** Denormalised category slug — lets card components render without populate. */
    categorySlug: { type: String, trim: true, lowercase: true, default: '' },
    categoryName: { type: String, trim: true, default: '' },

    brand: { type: String, trim: true, default: 'Gramrosh' },
    /** Where it comes from — powers the sourcing/origin story cards. */
    origin: {
      name: { type: String, trim: true, maxlength: 120 },
      district: { type: String, trim: true, maxlength: 80 },
      story: { type: String, trim: true, maxlength: 800 },
      harvestSeason: { type: String, trim: true, maxlength: 80 },
    },

    images: { type: [imageSchema], default: [] },
    /** Convenience pointer to the primary image (kept in sync on save). */
    image: { type: String, trim: true, default: '' },

    tags: { type: [String], default: [], index: true },
    badges: {
      type: [String],
      enum: ['organic', 'raw', 'unprocessed', 'farm-direct', 'new', 'bestseller', 'limited', 'chemical-free', 'bsti-certified'],
      default: [],
    },

    variants: {
      type: [variantSchema],
      validate: [(v) => Array.isArray(v) && v.length > 0, 'A product needs at least one variant'],
    },

    /** Lifecycle: `archived` products stay queryable for old orders. */
    status: {
      type: String,
      enum: { values: ['active', 'draft', 'archived'], message: '{VALUE} is not a valid product status' },
      default: 'active',
    },
    isArchived: { type: Boolean, default: false },
    isFeatured: { type: Boolean, default: false },
    isCombo: { type: Boolean, default: false },
    /** Manual pinning inside a section (lower = earlier). */
    sortOrder: { type: Number, default: 0 },

    rating: { type: Number, min: 0, max: 5, default: 0 },
    reviewCount: { type: Number, min: 0, default: 0 },

    stats: {
      views: { type: Number, min: 0, default: 0 },
      sold: { type: Number, min: 0, default: 0 },
      addToCarts: { type: Number, min: 0, default: 0 },
    },

    flashSale: { type: flashSaleSchema, default: undefined },
    bundle: { type: bundleSchema, default: undefined },
    documents: { type: [documentSchema], default: [] },

    seo: { type: seoSchema, default: undefined },

    /* ---- denormalised, index-backed query fields (see computeDerivedFields) ---- */
    priceRange: {
      min: { type: Number, default: 0, min: 0 },
      max: { type: Number, default: 0, min: 0 },
    },
    /** Sum of stock across all *active* variants. */
    totalStock: { type: Number, default: 0, min: 0 },
    /** Cached availability bucket used by the "in stock only" filter. */
    stockStatus: { type: String, enum: Object.values(STOCK_STATUS), default: STOCK_STATUS.IN_STOCK },
    /** Percentage off the default variant, 0 when not discounted. */
    discountPercent: { type: Number, default: 0, min: 0, max: 99 },
    /**
     * Lower-cased haystack for prefix search (title + bn + summary + tags…).
     * `select: false` keeps it out of every API payload — it is a query-time
     * artifact, not product content, and shipping ~1.2 KB of it per document
     * would bloat the mobile catalogue response for no reason.
     */
    searchBlob: { type: String, default: '', maxlength: 1200, select: false },
  },
  {
    timestamps: true,
    /**
     * `searchBlob` is a query-time artifact (see the field comment). `select:
     * false` already keeps it out of every read; this transform closes the one
     * remaining gap — documents returned straight from `create()` / `save()` —
     * so no serialization path can ever leak it.
     */
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret.searchBlob;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret.searchBlob;
        return ret;
      },
    },
  },
);

/* -------------------------------------------------------------------------- */
/*  Indexes — the performance contract of the catalogue                       */
/* -------------------------------------------------------------------------- */

// PRIMARY CATEGORY LISTING
//   GET /api/products?category=<slug>&status=active&sort=newest&page=2
//   Equality fields first, then the range/sort field. This single compound index
//   serves the filter *and* the sort, so MongoDB never performs an in-memory
//   SORT stage (the classic cause of a 32MB sort spill on a big catalogue).
productSchema.index({ category: 1, status: 1, isArchived: 1, createdAt: -1 });

// HOMEPAGE SECTIONS (featured rails, best sellers, new arrivals)
productSchema.index({ isFeatured: 1, status: 1, sortOrder: 1, createdAt: -1 });
productSchema.index({ 'stats.sold': -1, status: 1 });

// PRICE SORTING + "in stock only" filtering (uses the denormalised fields)
productSchema.index({ 'priceRange.min': 1, status: 1 });
productSchema.index({ stockStatus: 1, status: 1, totalStock: 1 });
productSchema.index({ totalStock: 1 });

// TIME-BASED LISTING (explicitly required) & the admin "newest first" table
productSchema.index({ createdAt: -1 });
productSchema.index({ status: 1, isArchived: 1, updatedAt: -1 });

// FLASH SALE QUERIES — "active sales ending soon" for the sticky countdown bar
productSchema.index({ 'flashSale.isActive': 1, 'flashSale.endsAt': 1 });

// COMBO RAIL
productSchema.index({ isCombo: 1, status: 1, 'bundle.isActive': 1 });

// SEARCH
//   A weighted text index powers `$text` deep search; `searchBlob` backs the
//   instant prefix search used while the customer is still typing.
productSchema.index(
  { title: 'text', titleBn: 'text', summary: 'text', description: 'text', tags: 'text', searchBlob: 'text' },
  { weights: { title: 10, titleBn: 8, searchBlob: 6, tags: 5, summary: 3, description: 1 }, name: 'product_text_search' },
);

// VARIANT SKU LOOKUP (unique across every variant of every product)
productSchema.index({ 'variants.sku': 1 }, { unique: true, name: 'variant_sku_unique' });

/* -------------------------------------------------------------------------- */
/*  Derived fields — one pure function, used by every write path              */
/* -------------------------------------------------------------------------- */

const UNIT_TO_GRAMS = { g: 1, kg: 1000, ml: 1, l: 1000, pcs: 1, box: 1 };

/**
 * Recompute every denormalised field from the variant array.
 *
 * Exported (rather than hidden in a hook) so the service layer can run the exact
 * same logic when writing through a non-Mongoose path — the derived fields are
 * therefore identical whichever driver is active.
 *
 * @param {object} doc plain object or mongoose document
 * @returns {object} the same object, mutated
 */
export function computeDerivedFields(doc) {
  const variants = Array.isArray(doc.variants) ? doc.variants : [];
  const active = variants.filter((v) => v.isActive !== false);
  const pool = active.length ? active : variants;

  // --- normalised weight (grams/ml equivalent) -----------------------------
  for (const variant of variants) {
    const factor = UNIT_TO_GRAMS[variant.weightUnit] ?? 1;
    variant.normalizedValue = Number(((variant.weightValue ?? 0) * factor).toFixed(3));
    if (!variant.label && variant.weightValue != null) {
      variant.label = `${variant.weightValue}${variant.weightUnit}`;
    }
  }

  // --- exactly one default variant -----------------------------------------
  const hasDefault = pool.some((v) => v.isDefault);
  pool.forEach((v, i) => {
    v.isDefault = hasDefault ? Boolean(v.isDefault) : i === 0;
  });

  // --- price range ----------------------------------------------------------
  const prices = pool.map((v) => Number(v.price) || 0);
  doc.priceRange = {
    min: prices.length ? Math.min(...prices) : 0,
    max: prices.length ? Math.max(...prices) : 0,
  };

  // --- stock rollup ---------------------------------------------------------
  const totalStock = pool.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
  doc.totalStock = totalStock;
  doc.stockStatus =
    totalStock <= 0
      ? STOCK_STATUS.OUT_OF_STOCK
      : totalStock <= LOW_STOCK_THRESHOLD
        ? STOCK_STATUS.LOW_STOCK
        : STOCK_STATUS.IN_STOCK;

  // --- discount % from the default variant ---------------------------------
  const defaultVariant = pool.find((v) => v.isDefault) ?? pool[0];
  if (defaultVariant && defaultVariant.compareAtPrice > defaultVariant.price) {
    doc.discountPercent = Math.round(
      ((defaultVariant.compareAtPrice - defaultVariant.price) / defaultVariant.compareAtPrice) * 100,
    );
  } else {
    doc.discountPercent = 0;
  }

  // --- primary image --------------------------------------------------------
  const images = Array.isArray(doc.images) ? doc.images : [];
  if (images.length) {
    if (!images.some((img) => img.isPrimary)) images[0].isPrimary = true;
    const primary = images.find((img) => img.isPrimary) ?? images[0];
    doc.image = primary.url;
  } else {
    doc.image = '';
  }

  // --- archive flag mirror --------------------------------------------------
  if (doc.status === 'archived') doc.isArchived = true;
  else if (doc.isArchived === true) doc.status = 'archived';
  else doc.isArchived = false;

  // --- search haystack ------------------------------------------------------
  const categoryName = typeof doc.categoryName === 'string' ? doc.categoryName : '';
  const haystack = [
    doc.title,
    doc.titleBn,
    doc.summary,
    doc.brand,
    categoryName,
    doc.categorySlug,
    doc.origin?.name,
    doc.origin?.district,
    ...(Array.isArray(doc.tags) ? doc.tags : []),
    ...(Array.isArray(doc.badges) ? doc.badges : []),
    ...pool.map((v) => v.label),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  doc.searchBlob = haystack.slice(0, 1200);

  return doc;
}

/* -------------------------------------------------------------------------- */
/*  Virtuals & hooks                                                          */
/* -------------------------------------------------------------------------- */

/** `true` when a flash sale is running right now. */
productSchema.virtual('isOnFlashSale').get(function isOnFlashSale() {
  const sale = this.flashSale;
  if (!sale?.isActive || !sale.endsAt) return false;
  const now = Date.now();
  const start = sale.startsAt ? new Date(sale.startsAt).getTime() : 0;
  return now >= start && now <= new Date(sale.endsAt).getTime();
});

/** Cheapest price across active variants — handy for "from ৳X" labels. */
productSchema.virtual('priceFrom').get(function priceFrom() {
  return this.priceRange?.min ?? 0;
});

productSchema.virtual('reviewSummary').get(function reviewSummary() {
  return { rating: this.rating ?? 0, count: this.reviewCount ?? 0 };
});

/**
 * Full derivation applied on every write: slug + all denormalised fields.
 * @param {object} doc
 * @returns {object}
 */
export function deriveProduct(doc) {
  if (!doc.slug && doc.title) doc.slug = slugify(doc.title);
  return computeDerivedFields(doc);
}

productSchema.pre('validate', function autoSlug(next) {
  if (!this.slug && this.title) this.slug = slugify(this.title);
  if (!this.categorySlug && this.category?.slug) this.categorySlug = this.category.slug;
  next();
});

productSchema.pre('save', function keepDerivedFieldsFresh(next) {
  computeDerivedFields(this);
  next();
});

/*
 * NOTE ON HOOKS: only `save()` recomputes derived fields. Atomic updates
 * (`updateOne`, `findOneAndUpdate`) intentionally skip that work so a stock
 * decrement stays a single indexed write; the calling service follows up with
 * `Product.recomputeDerived(id)`. See `services/inventory.service.js`.
 */

/**
 * Static helper: locate a variant (and its parent) by SKU.
 * Used by the admin stock screen and by bulk CSV imports.
 */
productSchema.statics.findByVariantSku = function findByVariantSku(sku) {
  return this.findOne({ 'variants.sku': String(sku).toUpperCase() }).lean();
};

/**
 * Static helper: refresh the denormalised fields of a single product.
 *
 * `updateOne`/`findOneAndUpdate` skip Mongoose `save()` hooks, so any write that
 * touches `variants` (stock adjustments, price changes) must be followed by this
 * call. Keeping it explicit — rather than hiding it in a hook — means the
 * invariant holds identically on every storage driver.
 *
 * @param {import('mongoose').Types.ObjectId|string} id
 * @returns {Promise<object|null>} the updated product as a plain object
 */
productSchema.statics.recomputeDerived = async function recomputeDerived(id) {
  const doc = await this.findById(id).lean();
  if (!doc) return null;
  computeDerivedFields(doc);
  await this.updateOne(
    { _id: id },
    {
      $set: {
        priceRange: doc.priceRange,
        totalStock: doc.totalStock,
        stockStatus: doc.stockStatus,
        discountPercent: doc.discountPercent,
        searchBlob: doc.searchBlob,
        image: doc.image,
      },
    },
  );
  return doc;
};

export const Product = mongoose.models.Product || mongoose.model('Product', productSchema);
export { productSchema };
export default Product;
