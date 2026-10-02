/**
 * -----------------------------------------------------------------------------
 *  routes/index.js — API surface map
 * -----------------------------------------------------------------------------
 *    GET    /api/health                        liveness / readiness
 *    GET    /api/config                        shipping, payments, districts
 *    GET    /api/storefront/home               one-shot homepage payload
 *    GET    /api/storefront/settings           footer / about / contact content
 *    GET    /api/storefront/certifications     BSTI / lab reports
 *    GET    /api/storefront/stories            sourcing & origin stories
 *    GET    /api/storefront/facets             shop filter options
 *    GET    /api/products                      paginated catalogue
 *    GET    /api/products/meta/facets
 *    GET    /api/products/sections/:name
 *    GET    /api/products/:slugOrId
 *    GET    /api/categories                    GET /api/categories/:slug
 *    POST   /api/orders/quote                  shipping calculator + totals
 *    POST   /api/orders                        guest checkout
 *    GET    /api/orders/lookup                 public tracking
 *    GET    /api/orders/:orderNumber/invoice   printable invoice
 *    *      /api/admin/**                      see admin.routes.js
 * -----------------------------------------------------------------------------
 */
import { Router } from 'express';
import { health } from '../controllers/health.controller.js';
import { getConfig } from '../controllers/storefront.controller.js';
import { noLimit } from '../middleware/rateLimit.js';
import { configCache } from '../middleware/httpCache.js';
import storefrontRoutes from './storefront.routes.js';
import productRoutes from './product.routes.js';
import categoryRoutes from './category.routes.js';
import orderRoutes from './order.routes.js';
import adminRoutes from './admin.routes.js';

const router = Router();

/** Health must never be throttled or cached — load balancers poll it. */
router.get('/health', noLimit, health);

/** GET /api/config — commerce constants (shipping, payments, districts). */
router.get('/config', configCache, getConfig);

// Public storefront content: /api/storefront/{home,settings,certifications,stories,facets}.
router.use('/storefront', storefrontRoutes);
router.use('/products', productRoutes);
router.use('/categories', categoryRoutes);
router.use('/orders', orderRoutes);

// Back office.
router.use('/admin', adminRoutes);

export default router;
