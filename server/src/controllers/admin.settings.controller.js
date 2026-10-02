/**
 * -----------------------------------------------------------------------------
 *  admin.settings.controller.js — Storefront content & configuration
 * -----------------------------------------------------------------------------
 */
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { getStorefront, updateStorefront } from '../services/storefront.service.js';
import { getCommerceConfig } from '../services/pricing.service.js';
import { collectIndexDefinitions } from '../models/index.js';
import { getDriver, getConnectionState, getMemoryDatabase } from '../db/index.js';
import { getImageProvider, isCloudinaryConfigured } from '../services/cloudinary.service.js';
import { env } from '../config/env.js';

/** GET /api/admin/settings */
export const getSettingsHandler = asyncHandler(async (_req, res) => {
  const [settings, commerce] = await Promise.all([getStorefront(), Promise.resolve(getCommerceConfig())]);
  return sendSuccess(res, { message: 'Storefront settings', data: { settings, commerce } });
});

/** PATCH /api/admin/settings */
export const updateSettingsHandler = asyncHandler(async (req, res) => {
  const settings = await updateStorefront(req.body, { updatedBy: req.admin?.email ?? 'system' });
  return sendSuccess(res, { message: 'Storefront updated — changes are live immediately', data: settings });
});

/**
 * GET /api/admin/system
 * Deployment facts an operator needs without shell access: which database
 * driver is live, whether the CDN is wired up, and proof that the required
 * indexes are declared.
 */
export const systemHandler = asyncHandler(async (_req, res) => {
  const memory = getMemoryDatabase();
  return sendSuccess(res, {
    message: 'System information',
    data: {
      environment: env.NODE_ENV,
      node: process.version,
      database: {
        driver: getDriver(),
        state: getConnectionState(),
        ...(memory ? memory.stats() : { uri: env.MONGO_URI.replace(/\/\/([^@/]+)@/, '//***@') }),
      },
      images: { provider: getImageProvider(), cloudinaryConfigured: isCloudinaryConfigured() },
      limits: { maxPageSize: env.MAX_PAGE_SIZE, defaultPageSize: env.DEFAULT_PAGE_SIZE, uploadMaxMb: env.UPLOAD_MAX_MB },
      caching: { maxAge: env.CACHE_MAX_AGE, sMaxAge: env.CACHE_S_MAXAGE },
      indexes: collectIndexDefinitions(),
    },
  });
});
