/**
 * -----------------------------------------------------------------------------
 *  validators/category.validator.js
 * -----------------------------------------------------------------------------
 */
import { z } from 'zod';
import {
  paginationQuery, text, optionalText, objectId, blankToUndefined,
  queryBoolean, idParams, idOrSlug,
} from './common.validator.js';

const categoryImage = z.object({
  url: text(600),
  placeholderUrl: optionalText(600),
  alt: optionalText(180),
  width: z.coerce.number().int().min(0).optional(),
  height: z.coerce.number().int().min(0).optional(),
  format: z.enum(['webp', 'avif', 'jpg', 'jpeg', 'png']).optional(),
}).optional();

/** GET /api/categories */
export const listCategoriesQuery = z.object({
  includeInactive: queryBoolean,
  withCounts: queryBoolean,
  parent: z.preprocess(blankToUndefined, objectId.nullable().optional()),
});

/** POST /api/admin/categories */
export const createCategoryBody = z.object({
  name: z.object({
    en: text(60),
    bn: optionalText(60),
  }),
  slug: optionalText(80),
  summary: optionalText(240),
  description: optionalText(2000),
  image: categoryImage,
  icon: z.preprocess(blankToUndefined, z.string().trim().max(40).optional()),
  accent: z.preprocess(blankToUndefined, z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #16a34a').optional()),
  parent: z.preprocess(blankToUndefined, objectId.nullable().optional()),
  sortOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
  seo: z.object({
    title: optionalText(70),
    description: optionalText(170),
    keywords: z.preprocess(
      (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v),
      z.array(z.string().max(60)).optional(),
    ),
  }).optional(),
});

/** PATCH /api/admin/categories/:id */
export const updateCategoryBody = createCategoryBody.partial().extend({
  name: z.object({ en: optionalText(60), bn: optionalText(60) }).optional(),
});

export const categoryIdParams = idParams;
export const categorySlugParams = z.object({ slug: idOrSlug });

/** GET /api/categories/:slug/products */
export const categoryProductsQuery = paginationQuery;
