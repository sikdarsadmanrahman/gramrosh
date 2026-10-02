/**
 * -----------------------------------------------------------------------------
 *  routes/admin.routes.js — The entire back-office API
 * -----------------------------------------------------------------------------
 *  Structure:
 *    /api/admin/auth      → session + staff accounts
 *    /api/admin/stats     → dashboard & reporting
 *    /api/admin/products  → catalogue CRUD, stock, archive
 *    /api/admin/categories→ taxonomy CRUD
 *    /api/admin/orders    → queue, status pipeline, invoices, CSV export
 *    /api/admin/customers → CRM
 *    /api/admin/settings  → storefront content & system info
 *    /api/admin/uploads   → image ingest (Cloudinary / local WebP)
 *
 *  Everything below `/auth/login` is behind `requireAdmin`; destructive actions
 *  additionally check a permission or role. All admin responses are `no-store`
 *  because stale order data is worse than a slow page.
 *
 *  NOTE on ordering: static segments (`/orders/export`, `/categories/reorder`,
 *  `/customers/by-phone/…`) are declared before the `/:id` catch-alls.
 * -----------------------------------------------------------------------------
 */
import { Router } from 'express';
import { z } from 'zod';

import { requireAdmin, requirePermission, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { noStore } from '../middleware/httpCache.js';
import { authLimiter, uploadLimiter } from '../middleware/rateLimit.js';
import { imageUpload } from '../middleware/upload.js';
import { objectId } from '../validators/common.validator.js';
import { ApiError } from '../utils/ApiError.js';

import * as auth from '../controllers/admin.auth.controller.js';
import * as stats from '../controllers/admin.stats.controller.js';
import * as catalogue from '../controllers/admin.catalogue.controller.js';
import * as orders from '../controllers/admin.order.controller.js';
import * as customers from '../controllers/admin.customer.controller.js';
import * as settings from '../controllers/admin.settings.controller.js';
import * as uploads from '../controllers/admin.upload.controller.js';

import { loginBody, changePasswordBody, createAdminBody, updateAdminBody } from '../validators/auth.validator.js';
import { statsQuery, updateStorefrontBody } from '../validators/storefront.validator.js';
import {
  adminListProductsQuery, createProductBody, updateProductBody, updateStockBody,
  productIdParams, duplicateProductBody,
} from '../validators/product.validator.js';
import {
  listOrdersQuery, orderIdParams, updateOrderStatusBody, updatePaymentBody,
  updateShippingBody, adminCreateOrderBody, exportOrdersQuery,
} from '../validators/order.validator.js';
import {
  listCustomersQuery, createCustomerBody, updateCustomerBody, customerIdParams, customerOrdersQuery,
} from '../validators/customer.validator.js';
import { createCategoryBody, updateCategoryBody, categoryIdParams } from '../validators/category.validator.js';

const router = Router();

/* -------------------------------------------------------------------------- */
/*  Auth                                                                      */
/* -------------------------------------------------------------------------- */

const authRouter = Router();

/** POST /api/admin/auth/login — throttled and keyed per IP + email. */
authRouter.post('/login', authLimiter, validate({ body: loginBody }), auth.loginHandler);

authRouter.use(requireAdmin);
authRouter.get('/me', auth.meHandler);
authRouter.post('/logout', auth.logoutHandler);
authRouter.patch('/password', validate({ body: changePasswordBody }), auth.changePasswordHandler);

// Staff management is super_admin territory.
authRouter.get('/accounts', requireRole('super_admin'), auth.listAdminsHandler);
authRouter.post('/accounts', requireRole('super_admin'), validate({ body: createAdminBody }), auth.createAdminHandler);
authRouter.patch('/accounts/:id', requireRole('super_admin'), validate({ params: productIdParams, body: updateAdminBody }), auth.updateAdminHandler);

router.use('/auth', noStore, authRouter);

/* -------------------------------------------------------------------------- */
/*  Everything below requires a signed-in admin                               */
/* -------------------------------------------------------------------------- */

router.use(noStore, requireAdmin);

/* ------------------------------- Stats ----------------------------------- */

const statsRouter = Router();
statsRouter.get('/overview', validate({ query: statsQuery }), stats.overviewHandler);
statsRouter.get('/revenue', validate({ query: statsQuery }), stats.revenueHandler);
statsRouter.get('/top-products', validate({ query: statsQuery }), stats.topProductsHandler);
statsRouter.get('/districts', validate({ query: statsQuery }), stats.districtsHandler);
statsRouter.get('/payment-methods', validate({ query: statsQuery }), stats.paymentMethodsHandler);
statsRouter.get('/categories', stats.categoryPerformanceHandler);
statsRouter.get('/stock-alerts', stats.stockAlertsHandler);
router.use('/stats', requirePermission('report:read'), statsRouter);

/* ------------------------------ Products --------------------------------- */

const productsRouter = Router();
productsRouter.get('/', requirePermission('product:read'), validate({ query: adminListProductsQuery }), catalogue.adminListProducts);
productsRouter.post('/', requirePermission('product:write'), validate({ body: createProductBody }), catalogue.adminCreateProduct);
productsRouter.get('/:id', requirePermission('product:read'), validate({ params: productIdParams }), catalogue.adminGetProduct);
productsRouter.patch('/:id', requirePermission('product:write'), validate({ params: productIdParams, body: updateProductBody }), catalogue.adminUpdateProduct);
productsRouter.patch('/:id/stock', requirePermission('product:write'), validate({ params: productIdParams, body: updateStockBody }), catalogue.adminUpdateStock);
productsRouter.patch('/:id/archive', requirePermission('product:write'), validate({ params: productIdParams }), catalogue.adminArchiveProduct);
productsRouter.post('/:id/duplicate', requirePermission('product:write'), validate({ params: productIdParams, body: duplicateProductBody }), catalogue.adminDuplicateProduct);
// Permanent deletion is irreversible and breaks nothing only if no orders exist.
productsRouter.delete('/:id', requireRole('super_admin'), validate({ params: productIdParams }), catalogue.adminDeleteProduct);
router.use('/products', productsRouter);

/* ----------------------------- Categories -------------------------------- */

const categoriesRouter = Router();
categoriesRouter.get('/', requirePermission('product:read'), catalogue.adminListCategories);
categoriesRouter.post('/', requirePermission('catalogue:write'), validate({ body: createCategoryBody }), catalogue.adminCreateCategory);
categoriesRouter.post('/reorder', requirePermission('catalogue:write'), reorderValidator, catalogue.adminReorderCategories);
categoriesRouter.get('/:slug', requirePermission('product:read'), catalogue.adminGetCategory);
categoriesRouter.patch('/:id', requirePermission('catalogue:write'), validate({ params: categoryIdParams, body: updateCategoryBody }), catalogue.adminUpdateCategory);
categoriesRouter.delete('/:id', requirePermission('catalogue:write'), validate({ params: categoryIdParams }), catalogue.adminDeleteCategory);
router.use('/categories', categoriesRouter);

/* -------------------------------- Orders --------------------------------- */

const ordersRouter = Router();
ordersRouter.get('/', requirePermission('order:read'), validate({ query: listOrdersQuery }), orders.listOrdersHandler);
ordersRouter.post('/', requirePermission('order:write'), validate({ body: adminCreateOrderBody }), orders.createOrderHandler);
// Static path declared before `/:id`.
ordersRouter.get('/export', requirePermission('order:read'), validate({ query: exportOrdersQuery }), orders.exportOrdersHandler);
ordersRouter.get('/:id', requirePermission('order:read'), validate({ params: orderIdParams }), orders.getOrderHandler);
ordersRouter.patch('/:id/status', requirePermission('order:write'), validate({ params: orderIdParams, body: updateOrderStatusBody }), orders.updateStatusHandler);
ordersRouter.patch('/:id/payment', requirePermission('order:write'), validate({ params: orderIdParams, body: updatePaymentBody }), orders.updatePaymentHandler);
ordersRouter.patch('/:id/shipping', requirePermission('order:write'), validate({ params: orderIdParams, body: updateShippingBody }), orders.updateShippingHandler);
ordersRouter.patch('/:id/notes', requirePermission('order:write'), validate({ params: orderIdParams }), orders.updateNotesHandler);
ordersRouter.get('/:id/invoice', requirePermission('order:read'), validate({ params: orderIdParams }), orders.invoiceHandler);
ordersRouter.get('/:id/customer-orders', requirePermission('order:read'), validate({ params: orderIdParams }), orders.customerOrdersHandler);
router.use('/orders', ordersRouter);

/* ------------------------------- Customers ------------------------------- */

const customersRouter = Router();
customersRouter.get('/', requirePermission('customer:read'), validate({ query: listCustomersQuery }), customers.listCustomersHandler);
customersRouter.post('/', requirePermission('customer:write'), validate({ body: createCustomerBody }), customers.createCustomerHandler);
customersRouter.post('/bulk-tag', requirePermission('customer:write'), bulkTagValidator, customers.bulkTagHandler);
customersRouter.get('/by-phone/:phone', requirePermission('customer:read'), customers.getCustomerByPhoneHandler);
customersRouter.get('/:id', requirePermission('customer:read'), validate({ params: customerIdParams }), customers.getCustomerHandler);
customersRouter.get('/:id/orders', requirePermission('customer:read'), validate({ params: customerIdParams, query: customerOrdersQuery }), customers.customerOrdersHandler);
customersRouter.patch('/:id', requirePermission('customer:write'), validate({ params: customerIdParams, body: updateCustomerBody }), customers.updateCustomerHandler);
customersRouter.post('/:id/recompute', requirePermission('customer:write'), validate({ params: customerIdParams }), customers.recomputeCustomerHandler);
customersRouter.delete('/:id', requireRole('super_admin'), validate({ params: customerIdParams }), customers.deleteCustomerHandler);
router.use('/customers', customersRouter);

/* ------------------------------- Settings -------------------------------- */

const settingsRouter = Router();
settingsRouter.get('/', requirePermission('report:read'), settings.getSettingsHandler);
settingsRouter.patch('/', requirePermission('catalogue:write'), validate({ body: updateStorefrontBody }), settings.updateSettingsHandler);
settingsRouter.get('/system', requireRole('super_admin'), settings.systemHandler);
router.use('/settings', settingsRouter);

/* -------------------------------- Uploads -------------------------------- */

const uploadsRouter = Router();
uploadsRouter.post('/image', uploadLimiter, imageUpload.single('image'), uploads.uploadSingleHandler);
uploadsRouter.post('/images', uploadLimiter, imageUpload.array('images', 8), uploads.uploadManyHandler);
uploadsRouter.delete('/image', uploads.destroyHandler);
router.use('/uploads', requirePermission('product:write'), uploadsRouter);

/* -------------------------------------------------------------------------- */
/*  Small inline validators                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Drag-and-drop reordering.
 *
 * Two payload shapes are accepted because both are natural for a sortable list:
 *   • `{ order: [id, id, …] }`              — position in the array *is* the rank
 *   • `{ entries: [{ id, sortOrder }, …] }`  — explicit ranks
 * Either way the service receives normalised `entries`.
 */
function reorderValidator(req, _res, next) {
  const schema = z.union([
    z.object({
      order: z.array(objectId).min(1).max(100),
    }),
    z.object({
      entries: z.array(z.object({ id: objectId, sortOrder: z.coerce.number().int().min(0) })).min(1).max(100),
    }),
  ]);

  const result = schema.safeParse(req.body ?? {});
  if (!result.success) {
    return next(ApiError.unprocessable('Send either { order: [ids] } or { entries: [{ id, sortOrder }] }', {
      errors: result.error.issues.map((issue) => ({ path: issue.path.join('.') || '(root)', message: issue.message })),
    }));
  }

  req.body = {
    entries: result.data.order
      ? result.data.order.map((id, index) => ({ id, sortOrder: index }))
      : result.data.entries,
  };
  next();
}

/** Bulk CRM tagging: `{ ids: [...], tags: [...], action: 'add' | 'remove' }`. */
function bulkTagValidator(req, _res, next) {
  const schema = z.object({
    ids: z.array(objectId).min(1).max(500),
    tags: z.array(z.string().trim().min(1).max(40)).min(1).max(20),
    action: z.enum(['add', 'remove']).default('add'),
  });
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) {
    return next(ApiError.unprocessable('Validation failed', {
      errors: result.error.issues.map((issue) => ({ path: issue.path.join('.') || '(root)', message: issue.message })),
    }));
  }
  req.body = result.data;
  next();
}

export default router;
