/**
 * -----------------------------------------------------------------------------
 *  routes/product.routes.js — Public catalogue
 * -----------------------------------------------------------------------------
 *  Route order matters: the static `/meta/*` and `/sections/*` paths are declared
 *  before `/:slugOrId`, otherwise `meta` would be treated as a product slug.
 * -----------------------------------------------------------------------------
 */
import { Router } from 'express';
import {
  listProductsHandler, getProductHandler, getSectionHandler, getFacetsHandler,
} from '../controllers/product.controller.js';
import { validate } from '../middleware/validate.js';
import { listProductsQuery, productDetailParams } from '../validators/product.validator.js';
import { catalogueCache } from '../middleware/httpCache.js';

const router = Router();

/** GET /api/products/meta/facets */
router.get('/meta/facets', catalogueCache, getFacetsHandler);

/** GET /api/products/sections/:name — featured | best_selling | new | flash_sale | combos */
router.get('/sections/:name', catalogueCache, getSectionHandler);

/**
 * GET /api/products
 * ?q=&category=&categories=&minPrice=&maxPrice=&inStock=&onSale=&isCombo=
 * &tags=&badges=&sort=&page=&limit=&skip=&fields=&section=
 */
router.get('/', catalogueCache, validate({ query: listProductsQuery }), listProductsHandler);

/** GET /api/products/:slugOrId */
router.get('/:slugOrId', catalogueCache, validate({ params: productDetailParams }), getProductHandler);

export default router;
