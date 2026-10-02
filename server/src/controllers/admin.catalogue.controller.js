/**
 * -----------------------------------------------------------------------------
 *  admin.catalogue.controller.js — Product & category management (CRUD)
 * -----------------------------------------------------------------------------
 */
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import {
  listProducts, getProductBySlugOrId, createProduct, updateProduct,
  setProductArchived, deleteProduct, duplicateProduct, bulkUpdateStock,
} from '../services/product.service.js';
import {
  listCategories, getCategory, createCategory, updateCategory, deleteCategory, reorderCategories,
} from '../services/category.service.js';
import { computeBundleAvailability } from '../services/inventory.service.js';
import { decorateProduct } from './product.controller.js';

/* -------------------------------------------------------------------------- */
/*  Products                                                                  */
/* -------------------------------------------------------------------------- */

/** GET /api/admin/products — full documents, archive included on request. */
export const adminListProducts = asyncHandler(async (req, res) => {
  const { items, total, page, limit } = await listProducts(req.query, { isAdmin: true, projection: null });
  return sendPaginated(res, {
    items,
    page,
    limit,
    total,
    message: `${total} product(s)`,
  });
});

/** GET /api/admin/products/:id */
export const adminGetProduct = asyncHandler(async (req, res) => {
  const product = await getProductBySlugOrId(req.params.id, { isAdmin: true });
  if (!product) throw ApiError.notFound('Product not found');

  const data = decorateProduct(product);
  if (product.isCombo && product.bundle?.items?.length) {
    data.bundleAvailability = await computeBundleAvailability(product);
  }
  return sendSuccess(res, { message: 'Product', data });
});

/** POST /api/admin/products */
export const adminCreateProduct = asyncHandler(async (req, res) => {
  const product = await createProduct(req.body);
  return sendSuccess(res, {
    statusCode: 201,
    message: `"${product.title}" added to the catalogue`,
    data: product,
  });
});

/** PATCH /api/admin/products/:id */
export const adminUpdateProduct = asyncHandler(async (req, res) => {
  const product = await updateProduct(req.params.id, req.body);
  return sendSuccess(res, { message: `"${product.title}" updated`, data: product });
});

/** PATCH /api/admin/products/:id/stock — the admin stock screen. */
export const adminUpdateStock = asyncHandler(async (req, res) => {
  const product = await bulkUpdateStock(req.params.id, req.body);
  return sendSuccess(res, {
    message: `Stock updated — ${product.totalStock} unit(s) across ${product.variants.length} pack size(s)`,
    data: {
      /** The full product, so the admin form can refresh in place. */
      product,
      /** Handy top-level echoes for the stock table header. */
      stockStatus: product.stockStatus,
      totalStock: product.totalStock,
      /**
       * Compact per-variant stock rows. Keyed `_id` (not `id`) so the admin SPA
       * can match them against `product.variants` and against the ids it already
       * holds in open carts without a mapping layer.
       */
      variants: product.variants.map((v) => ({
        _id: v._id,
        label: v.label,
        sku: v.sku,
        stock: v.stock,
        lowStockThreshold: v.lowStockThreshold,
      })),
    },
  });
});

/** PATCH /api/admin/products/:id/archive */
export const adminArchiveProduct = asyncHandler(async (req, res) => {
  const archived = req.body?.archived !== false;
  const product = await setProductArchived(req.params.id, archived);
  return sendSuccess(res, {
    message: archived ? `"${product.title}" archived` : `"${product.title}" restored to the catalogue`,
    data: product,
  });
});

/** DELETE /api/admin/products/:id — refused while orders reference the product. */
export const adminDeleteProduct = asyncHandler(async (req, res) => {
  const result = await deleteProduct(req.params.id);
  return sendSuccess(res, { message: 'Product deleted permanently', data: result });
});

/** POST /api/admin/products/:id/duplicate */
export const adminDuplicateProduct = asyncHandler(async (req, res) => {
  const product = await duplicateProduct(req.params.id, req.body ?? {});
  return sendSuccess(res, {
    statusCode: 201,
    message: `Duplicated as "${product.title}" (draft, zero stock)`,
    data: product,
  });
});

/* -------------------------------------------------------------------------- */
/*  Categories                                                                */
/* -------------------------------------------------------------------------- */

/** GET /api/admin/categories */
export const adminListCategories = asyncHandler(async (req, res) => {
  const categories = await listCategories({ includeInactive: true, withCounts: true });
  return sendSuccess(res, { message: `${categories.length} categor(y/ies)`, data: categories });
});

/** POST /api/admin/categories */
export const adminCreateCategory = asyncHandler(async (req, res) => {
  const category = await createCategory(req.body);
  return sendSuccess(res, { statusCode: 201, message: `Category "${category.name.en}" created`, data: category });
});

/** PATCH /api/admin/categories/:id */
export const adminUpdateCategory = asyncHandler(async (req, res) => {
  const category = await updateCategory(req.params.id, req.body);
  return sendSuccess(res, { message: 'Category updated', data: category });
});

/** DELETE /api/admin/categories/:id */
export const adminDeleteCategory = asyncHandler(async (req, res) => {
  const result = await deleteCategory(req.params.id);
  return sendSuccess(res, { message: 'Category deleted', data: result });
});

/** POST /api/admin/categories/reorder */
export const adminReorderCategories = asyncHandler(async (req, res) => {
  const result = await reorderCategories(req.body?.entries ?? []);
  return sendSuccess(res, { message: `${result.updated} categor(y/ies) reordered`, data: result });
});

/** GET /api/admin/categories/:slug — resolve one for the edit form. */
export const adminGetCategory = asyncHandler(async (req, res) => {
  const category = await getCategory(req.params.slug, { includeInactive: true });
  return sendSuccess(res, { message: 'Category', data: category });
});
