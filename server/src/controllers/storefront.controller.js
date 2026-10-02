/**
 * -----------------------------------------------------------------------------
 *  storefront.controller.js — Public config, homepage payload & trust documents
 * -----------------------------------------------------------------------------
 *  `GET /api/storefront/home` exists so the storefront's first paint costs ONE
 *  HTTP round trip instead of seven (config + categories + five product rails).
 *  It is the single most-called endpoint in the app, hence the aggressive
 *  `Cache-Control` applied by the route.
 * -----------------------------------------------------------------------------
 */
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { getCommerceConfig } from '../services/pricing.service.js';
import { listCategories } from '../services/category.service.js';
import { getCatalogueSections, getCatalogueFacets } from '../services/product.service.js';
import {
  getStorefront, getActiveFlashSale, getCertifications, getOriginStories, getTestimonials,
} from '../services/storefront.service.js';
import { env } from '../config/env.js';
import { db } from '../db/index.js';

/**
 * GET /api/config
 * Commerce constants the checkout needs (shipping fees, payment methods,
 * districts, currency). Changes only when an admin edits settings.
 */
export const getConfig = asyncHandler(async (_req, res) => {
  const [commerce, settings] = await Promise.all([
    Promise.resolve(getCommerceConfig()),
    getStorefront(),
  ]);

  return sendSuccess(res, {
    message: 'Storefront configuration',
    data: {
      ...commerce,
      store: {
        name: settings.storeName ?? env.STORE_NAME,
        tagline: settings.tagline ?? '',
        announcement: settings.announcement ?? { text: '', isActive: false },
        contact: settings.contact ?? {},
      },
      support: {
        phone: settings.contact?.phone ?? env.STORE_PHONE,
        whatsapp: settings.contact?.whatsapp ?? env.STORE_WHATSAPP,
        hotline: settings.contact?.hotline ?? '',
        email: settings.contact?.email ?? env.STORE_EMAIL,
      },
    },
  });
});

/**
 * GET /api/storefront/home
 * Everything the homepage renders, in one payload.
 */
export const getHome = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.railLimit) || 8, 24);

  const [settings, flashSale, categories, sections, testimonials] = await Promise.all([
    getStorefront(),
    getActiveFlashSale(),
    listCategories({ withCounts: true }),
    getCatalogueSections({ limit }),
    getTestimonials(),
  ]);

  // A campaign may exist while individual products also carry their own sale
  // window; the sticky bar uses whichever ends soonest.
  const productSaleEnds = sections.flashSale
    .map((product) => new Date(product.flashSale?.endsAt).getTime())
    .filter((ms) => Number.isFinite(ms));
  const countdownEndsAt = flashSale?.endsAt
    ?? (productSaleEnds.length ? new Date(Math.min(...productSaleEnds)).toISOString() : null);

  return sendSuccess(res, {
    message: 'Homepage payload',
    data: {
      store: {
        name: settings.storeName ?? env.STORE_NAME,
        tagline: settings.tagline ?? '',
        announcement: settings.announcement ?? null,
        seo: settings.seo ?? null,
        contact: settings.contact ?? {},
      },
      hero: (settings.hero ?? []).filter((slide) => slide.isActive !== false).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
      trustPoints: settings.trustPoints ?? [],
      categories,
      flashSale: flashSale
        ? { ...flashSale, products: sections.flashSale }
        : { isActive: false, products: sections.flashSale },
      countdownEndsAt,
      serverTime: new Date().toISOString(),
      rails: {
        featured: sections.featured,
        newArrivals: sections.newArrivals,
        bestSellers: sections.bestSellers,
        combos: sections.combos,
      },
      testimonials,
    },
  });
});

/**
 * GET /api/storefront/certifications
 * BSTI certificates, lab reports and organic certificates available to download.
 */
export const listCertifications = asyncHandler(async (req, res) => {
  const certifications = await getCertifications({ type: req.query.type });
  return sendSuccess(res, {
    message: `${certifications.length} trust document(s)`,
    data: certifications,
    meta: { count: certifications.length },
  });
});

/** GET /api/storefront/stories — sourcing & origin stories. */
export const listOriginStories = asyncHandler(async (req, res) => {
  const stories = await getOriginStories();

  // Attach the products each story features so the section can deep-link.
  const ids = [...new Set(stories.flatMap((story) => (story.productIds ?? []).map(String)))];
  const products = ids.length
    ? await db.Product.find({ _id: { $in: ids }, status: 'active', isArchived: false })
        .select({ title: 1, slug: 1, image: 1, priceRange: 1, categoryName: 1 })
        .lean()
    : [];
  const byId = new Map(products.map((product) => [String(product._id), product]));

  return sendSuccess(res, {
    message: `${stories.length} sourcing stor${stories.length === 1 ? 'y' : 'ies'}`,
    data: stories.map((story) => ({
      ...story,
      products: (story.productIds ?? []).map((id) => byId.get(String(id))).filter(Boolean),
    })),
  });
});

/**
 * GET /api/storefront/settings
 *
 * The public-safe slice of the Storefront singleton — everything the header,
 * footer, about and contact pages render without touching the homepage payload.
 * `updatedAtBy` and campaign internals are deliberately omitted so the response
 * can be cached publicly.
 */
export const getPublicSettings = asyncHandler(async (_req, res) => {
  const settings = await getStorefront();

  return sendSuccess(res, {
    message: 'Storefront settings',
    data: {
      store: {
        name: settings.storeName ?? env.STORE_NAME,
        tagline: settings.tagline ?? '',
        announcement: settings.announcement ?? { text: '', isActive: false },
        seo: settings.seo ?? null,
      },
      contact: settings.contact ?? {},
      hero: (settings.hero ?? []).filter((slide) => slide.isActive !== false),
      trustPoints: settings.trustPoints ?? [],
      certifications: (settings.certifications ?? []).filter((cert) => cert.isPublic !== false),
      testimonials: (settings.testimonials ?? []).filter((item) => item.isActive !== false),
      updatedAt: settings.updatedAt ?? null,
    },
  });
});

/** GET /api/storefront/facets — filter options for the shop page. */
export const getFacets = asyncHandler(async (_req, res) => {
  const facets = await getCatalogueFacets();
  return sendSuccess(res, { message: 'Catalogue facets', data: facets });
});
