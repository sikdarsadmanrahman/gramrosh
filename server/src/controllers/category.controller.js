/**
 * -----------------------------------------------------------------------------
 *  category.controller.js — Public category reads
 * -----------------------------------------------------------------------------
 */
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/apiResponse.js';
import { listCategories, getCategory } from '../services/category.service.js';
import { listProducts } from '../services/product.service.js';
import { decorateProduct } from './product.controller.js';

/** GET /api/categories — the filter chips & homepage strip. */
export const listCategoriesHandler = asyncHandler(async (req, res) => {
  const categories = await listCategories({
    includeInactive: Boolean(req.query.includeInactive),
    withCounts: req.query.withCounts !== 'false',
  });
  return sendSuccess(res, {
    message: `${categories.length} categor${categories.length === 1 ? 'y' : 'ies'}`,
    data: categories,
    meta: { count: categories.length },
  });
});

/**
 * GET /api/categories/:slug
 * Category detail **plus its first page of products** — one request renders the
 * whole category landing page.
 */
export const getCategoryHandler = asyncHandler(async (req, res) => {
  const category = await getCategory(req.params.slug);
  const { items, total, page, limit } = await listProducts(
    { ...req.query, category: category.slug },
    { isAdmin: false },
  );

  return sendPaginated(res, {
    items: items.map(decorateProduct),
    page,
    limit,
    total,
    message: `${total} product(s) in ${category.name?.en ?? category.slug}`,
    extraMeta: { category },
  });
});
