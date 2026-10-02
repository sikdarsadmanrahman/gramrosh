/**
 * -----------------------------------------------------------------------------
 *  validators/product.validator.js
 * -----------------------------------------------------------------------------
 */
import { z } from 'zod';
import { UNIT_TYPES, CERTIFICATION_TYPES } from '../config/constants.js';
import {
  paginationQuery, sortKey, stringArray, queryBoolean, queryFloatOptional,
  objectId, idOrSlug, text, optionalText, blankToUndefined, idParams,
} from './common.validator.js';

/* -------------------------------------------------------------------------- */
/*  Storefront: list & detail                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Filter fields as a plain shape so both the public and admin list schemas can
 * extend them. (`z.object(...).refine(...)` returns ZodEffects, which has no
 * `.extend()` / `.partial()` — hence the shape/object split below.)
 */
const listProductsShape = {
  sort: z.preprocess(blankToUndefined, sortKey.optional()).transform((v) => v ?? 'newest'),
  /** Instant search term (name / tag / category). */
  q: z.preprocess(blankToUndefined, z.string().trim().max(120).optional()),
  /** Category slug, ObjectId, or a comma separated list of either. */
  category: z.preprocess(blankToUndefined, z.string().trim().max(80).optional()),
  categories: stringArray,
  minPrice: queryFloatOptional({ min: 0, max: 1_000_000 }),
  maxPrice: queryFloatOptional({ min: 0, max: 1_000_000 }),
  inStock: queryBoolean,
  onSale: queryBoolean,
  isFeatured: queryBoolean,
  isCombo: queryBoolean,
  tags: stringArray,
  badges: stringArray,
  /** Ready-made homepage rails. */
  section: z.enum(['featured', 'best_selling', 'new', 'flash_sale', 'combos', 'low_stock']).optional(),
  /** Related products for a PDP "you may also like" rail. */
  relatedTo: z.preprocess(blankToUndefined, z.string().trim().max(180).optional()),
  /** Comma separated field list — keeps payloads small on mobile. */
  fields: z.preprocess(blankToUndefined, z.string().trim().max(400).optional()),
};

/** Cross-field rule shared by the public and admin list schemas. */
const priceRangeRule = (v) => v.minPrice === undefined || v.maxPrice === undefined || v.minPrice <= v.maxPrice;
const priceRangeIssue = {
  message: 'minPrice cannot be greater than maxPrice',
  path: ['maxPrice'],
};

const listProductsObject = z.object({ ...paginationQuery.shape, ...listProductsShape });

/** GET /api/products — storefront catalogue search, filters, sorting, paging. */
export const listProductsQuery = listProductsObject.refine(priceRangeRule, priceRangeIssue);

export const productDetailParams = z.object({ slugOrId: idOrSlug });

/* -------------------------------------------------------------------------- */
/*  Admin: write operations                                                   */
/* -------------------------------------------------------------------------- */

const imageInput = z.object({
  url: text(600),
  placeholderUrl: optionalText(600),
  alt: optionalText(180),
  width: z.coerce.number().int().min(0).max(20_000).optional(),
  height: z.coerce.number().int().min(0).max(20_000).optional(),
  format: z.enum(['webp', 'avif', 'jpg', 'jpeg', 'png']).optional(),
  isPrimary: z.boolean().optional(),
});

const variantInput = z.object({
  _id: z.preprocess(blankToUndefined, objectId.optional()),
  sku: z.preprocess(blankToUndefined, z.string().trim().max(40).optional()),
  label: z.preprocess(blankToUndefined, z.string().trim().max(30).optional()),
  weightValue: z.coerce.number().positive('Weight must be greater than zero'),
  weightUnit: z.enum(UNIT_TYPES),
  price: z.coerce.number().min(0, 'Price cannot be negative'),
  compareAtPrice: z.preprocess(
    blankToUndefined,
    z.coerce.number().min(0).nullable().optional(),
  ),
  stock: z.coerce.number().int().min(0, 'Stock cannot be negative').default(0),
  lowStockThreshold: z.coerce.number().int().min(0).optional(),
  barcode: optionalText(60),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional().default(true),
}).refine((v) => v.compareAtPrice === undefined || v.compareAtPrice === null || v.compareAtPrice >= v.price, {
  message: 'compareAtPrice must be greater than or equal to price',
  path: ['compareAtPrice'],
});

const documentInput = z.object({
  _id: z.preprocess(blankToUndefined, objectId.optional()),
  title: text(140),
  type: z.string().trim().toLowerCase().refine(
    (v) => CERTIFICATION_TYPES.includes(v),
    { message: `Type must be one of: ${CERTIFICATION_TYPES.join(', ')}` },
  ),
  url: text(600),
  reference: optionalText(80),
  issuedAt: z.preprocess(blankToUndefined, z.coerce.date().nullable().optional()),
  expiresAt: z.preprocess(blankToUndefined, z.coerce.date().nullable().optional()),
  fileSizeKb: z.coerce.number().min(0).optional(),
  isPublic: z.boolean().optional().default(true),
});

const bundleInput = z.object({
  isActive: z.boolean().default(true),
  badge: optionalText(60),
  headline: optionalText(120),
  autoStock: z.boolean().optional().default(false),
  combinedPrice: z.coerce.number().min(0).optional().default(0),
  items: z.array(z.object({
    product: objectId,
    variant: z.preprocess(blankToUndefined, objectId.nullable().optional()),
    quantity: z.coerce.number().int().min(1).default(1),
    label: optionalText(120),
  })).min(1, 'A combo needs at least one item').max(12),
}).optional();

const flashSaleInput = z.object({
  isActive: z.boolean().default(true),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date(),
  label: optionalText(60),
  stockLimit: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).nullable().optional()),
}).optional().refine(
  (sale) => !sale || !sale.startsAt || sale.endsAt > sale.startsAt,
  { message: 'Flash sale must end after it starts', path: ['endsAt'] },
);

const originInput = z.object({
  name: optionalText(120),
  district: optionalText(80),
  story: optionalText(800),
  harvestSeason: optionalText(80),
}).optional();

const seoInput = z.object({
  title: optionalText(70),
  description: optionalText(170),
  keywords: stringArray.optional(),
}).optional();

/** Every writable product field, before refinements. */
const productShape = {
  title: text(160),
  titleBn: optionalText(160),
  slug: optionalText(180),
  summary: optionalText(240),
  description: optionalText(8000),
  category: objectId,
  brand: optionalText(80),
  origin: originInput,
  images: z.array(imageInput).max(10).default([]),
  tags: stringArray.default([]),
  badges: z.array(z.string().trim().max(30)).max(8).default([]),
  variants: z.array(variantInput).min(1, 'At least one pack size / variant is required').max(20),
  status: z.enum(['active', 'draft', 'archived']).default('active'),
  isFeatured: z.boolean().default(false),
  isCombo: z.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).default(0),
  bundle: bundleInput,
  flashSale: flashSaleInput,
  documents: z.array(documentInput).max(12).default([]),
  seo: seoInput,
};

const productObject = z.object(productShape);

/** POST /api/admin/products */
export const createProductBody = productObject.refine(
  (v) => !v.isCombo || Boolean(v.bundle?.items?.length),
  { message: 'A combo product needs at least one bundle item', path: ['bundle'] },
);

/**
 * PATCH /api/admin/products/:id — every field optional, and partial refinements
 * are re-applied so a combo cannot be flipped on without bundle items.
 */
export const updateProductBody = productObject
  .partial()
  .extend({ category: z.preprocess(blankToUndefined, objectId.optional()) })
  .refine(
    (v) => !v.isCombo || Boolean(v.bundle?.items?.length),
    { message: 'A combo product needs at least one bundle item', path: ['bundle'] },
  );

/** PATCH /api/admin/products/:id/stock */
export const updateStockBody = z.object({
  /** Absolute set: `[{ variantId, stock }]`. */
  variants: z.array(z.object({
    variantId: objectId,
    stock: z.coerce.number().int().min(0),
  })).min(1).optional(),
  /** Relative adjust: `[{ variantId, delta }]` (negative allowed). */
  adjustments: z.array(z.object({
    variantId: objectId,
    delta: z.coerce.number().int(),
  })).min(1).optional(),
  /** Convenience single-variant absolute set. */
  variantId: z.preprocess(blankToUndefined, objectId.optional()),
  stock: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).optional()),
}).refine((v) => v.variants?.length || v.adjustments?.length || (v.variantId && v.stock !== undefined), {
  message: 'Supply either "variants", "adjustments", or "variantId" + "stock"',
});

/** Admin list — same filters plus archive / lifecycle / stock-alert controls. */
export const adminListProductsQuery = listProductsObject
  .extend({
    status: z.preprocess(blankToUndefined, z.enum(['active', 'draft', 'archived']).optional()),
    includeArchived: queryBoolean,
    stockAlerts: queryBoolean,
  })
  .refine(priceRangeRule, priceRangeIssue);

export const productIdParams = idParams;

/** POST /api/admin/products/:id/duplicate */
export const duplicateProductBody = z.object({
  title: optionalText(160),
  status: z.enum(['active', 'draft', 'archived']).default('draft'),
}).default({});
