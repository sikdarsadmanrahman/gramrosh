/**
 * -----------------------------------------------------------------------------
 *  routes/storefront.routes.js — Public content endpoints
 * -----------------------------------------------------------------------------
 *  These are the hottest paths in the app, so they get the longest CDN cache and
 *  are the reason the homepage costs one round trip.
 * -----------------------------------------------------------------------------
 */
/**
 * Mounted at `/api/storefront` (see routes/index.js). `GET /api/config` is
 * registered separately at the API root because it predates this router and the
 * client bootstraps from it before it knows anything else.
 */
import { Router } from 'express';
import {
  getHome, getPublicSettings, listCertifications, listOriginStories, getFacets,
} from '../controllers/storefront.controller.js';
import { configCache, catalogueCache } from '../middleware/httpCache.js';

const router = Router();

/** GET /api/storefront/home — hero, rails, categories, flash sale, trust. */
router.get('/home', configCache, getHome);

/** GET /api/storefront/settings — footer / about / contact content. */
router.get('/settings', configCache, getPublicSettings);

/** GET /api/storefront/certifications — BSTI / lab reports. */
router.get('/certifications', catalogueCache, listCertifications);

/** GET /api/storefront/stories — sourcing & origin stories. */
router.get('/stories', catalogueCache, listOriginStories);

/** GET /api/storefront/facets — shop filter options. */
router.get('/facets', catalogueCache, getFacets);

export default router;
