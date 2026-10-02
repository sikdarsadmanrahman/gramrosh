/**
 * -----------------------------------------------------------------------------
 *  routes/category.routes.js — Public category reads
 * -----------------------------------------------------------------------------
 */
import { Router } from 'express';
import { listCategoriesHandler, getCategoryHandler } from '../controllers/category.controller.js';
import { catalogueCache } from '../middleware/httpCache.js';
import { validate } from '../middleware/validate.js';
import { listCategoriesQuery, categorySlugParams, categoryProductsQuery } from '../validators/category.validator.js';

const router = Router();

/** GET /api/categories */
router.get('/', catalogueCache, validate({ query: listCategoriesQuery }), listCategoriesHandler);

/** GET /api/categories/:slug — category + first page of its products. */
router.get('/:slug', catalogueCache, validate({ params: categorySlugParams, query: categoryProductsQuery }), getCategoryHandler);

export default router;
