/**
 * -----------------------------------------------------------------------------
 *  product.controller.js — Public catalogue reads
 * -----------------------------------------------------------------------------
 *  Thin by design: validation happens in the route (Zod), business rules in
 *  `product.service.js`, and the controller only translates between HTTP and the
 *  service layer. That keeps this file readable and the logic unit-testable.
 * -----------------------------------------------------------------------------
 */
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import {
  listProducts, getRelatedProducts, getProductBySlugOrId, getCatalogueSections,
  getCatalogueFacets,
} from '../services/product.service.js';
import { computeBundleAvailability } from '../services/inventory.service.js';
import { buildSrcSet } from '../services/cloudinary.service.js';

/**
 * GET /api/products
 * Server-side paginated, filtered, sorted catalogue listing.
 */
export const listProductsHandler = asyncHandler(async (req, res) => {
  const { items, total, page, limit } = await listProducts(req.query, { isAdmin: false });

  return sendPaginated(res, {
    items: items.map(decorateProduct),
    page,
    limit,
    total,
    message: `${total} product(s)`,
    extraMeta: {
      applied: {
        q: req.query.q ?? null,
        category: req.query.category ?? req.query.categories ?? null,
        sort: req.query.sort ?? 'newest',
        inStock: req.query.inStock ?? null,
        priceRange: req.query.minPrice != null || req.query.maxPrice != null
          ? { min: req.query.minPrice ?? null, max: req.query.maxPrice ?? null }
          : null,
      },
    },
  });
});

/**
 * GET /api/products/:slugOrId
 * Product detail page. Accepts a slug (SEO) or an ObjectId (admin previews).
 */
export const getProductHandler = asyncHandler(async (req, res) => {
  const product = await getProductBySlugOrId(req.params.slugOrId, { trackView: true });
  if (!product) throw ApiError.notFound('Product not found or no longer available');

  const decorated = decorateProduct(product);
  // Combos show how many complete bundles the component stock allows.
  if (product.isCombo && product.bundle?.autoStock) {
    decorated.bundleAvailability = await computeBundleAvailability(product);
  }

  // "You may also like": same category first, widening to shared tags and then
  // best sellers, so the rail is never empty in a small catalogue.
  const related = await getRelatedProducts(product, { limit: 5 });
  decorated.related = related.map(decorateProduct);

  return sendSuccess(res, { message: 'Product', data: decorated });
});

/** GET /api/products/sections/:name — one homepage rail on demand. */
export const getSectionHandler = asyncHandler(async (req, res) => {
  const { name } = req.params;
  const sections = await getCatalogueSections({ limit: Number(req.query.limit) || 8 });
  if (!(name in sections)) throw ApiError.badRequest(`Unknown section "${name}"`);
  return sendSuccess(res, {
    message: `${name} section`,
    data: sections[name].map(decorateProduct),
    meta: { section: name, count: sections[name].length },
  });
});

/** GET /api/products/meta/facets — filter chips for the shop page. */
export const getFacetsHandler = asyncHandler(async (_req, res) => {
  const facets = await getCatalogueFacets();
  return sendSuccess(res, { message: 'Catalogue facets', data: facets });
});

/**
 * Add presentation-only fields that are expensive or impossible to store:
 * a responsive `srcset` for the CDN image and a "from" price label.
 */
export function decorateProduct(product) {
  if (!product) return product;
  const images = Array.isArray(product.images) ? product.images : [];
  return {
    ...product,
    id: String(product._id),
    /**
     * Responsive sources. With the Cloudinary provider these are real multi-width
     * URLs; with the local development transcoder a single optimised WebP is
     * served, so `srcset` is `null` and the client falls back to `url`. Either
     * way `width`/`height` are present so the browser can reserve space and avoid
     * layout shift on mobile.
     */
    srcset: buildSrcSet(product.image) ?? null,
    imageSrcSet: images.slice(0, 4).map((image) => ({
      url: image.url,
      alt: image.alt ?? product.title,
      srcset: buildSrcSet(image.url) ?? null,
      width: image.width ?? null,
      height: image.height ?? null,
      format: image.format ?? 'webp',
      isPrimary: Boolean(image.isPrimary),
    })),
    priceFrom: product.priceRange?.min ?? 0,
    priceTo: product.priceRange?.max ?? 0,
    hasMultipleVariants: (product.variants ?? []).filter((v) => v.isActive !== false).length > 1,
    defaultVariant: (product.variants ?? []).find((v) => v.isDefault && v.isActive !== false)
      ?? (product.variants ?? []).find((v) => v.isActive !== false)
      ?? null,
    onSale: (product.discountPercent ?? 0) > 0,
    isOnFlashSale: Boolean(
      product.flashSale?.isActive && product.flashSale?.endsAt && new Date(product.flashSale.endsAt).getTime() > Date.now(),
    ),
  };
}

/** Explicit re-export so the facets endpoint stays discoverable. */
export { getCatalogueFacets };
