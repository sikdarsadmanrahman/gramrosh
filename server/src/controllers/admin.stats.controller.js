/**
 * -----------------------------------------------------------------------------
 *  admin.stats.controller.js — Dashboard & reporting endpoints
 * -----------------------------------------------------------------------------
 */
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import {
  getDashboardOverview, getRevenueSeries, getTopProducts,
  getOrdersByDistrict, getPaymentMethodBreakdown, getCategoryPerformance,
} from '../services/stats.service.js';
import { getStockAlerts } from '../services/inventory.service.js';

/** GET /api/admin/stats/overview — one call renders the whole dashboard. */
export const overviewHandler = asyncHandler(async (req, res) => {
  const [overview, alerts] = await Promise.all([
    getDashboardOverview(req.query),
    getStockAlerts({ limit: Number(req.query.alertLimit) || 10 }),
  ]);
  return sendSuccess(res, {
    message: 'Dashboard overview',
    data: { ...overview, stockAlerts: alerts },
  });
});

/** GET /api/admin/stats/revenue */
export const revenueHandler = asyncHandler(async (req, res) => sendSuccess(res, {
  message: 'Revenue series',
  data: await getRevenueSeries(req.query),
}));

/** GET /api/admin/stats/top-products */
export const topProductsHandler = asyncHandler(async (req, res) => sendSuccess(res, {
  message: 'Top products',
  data: await getTopProducts(req.query),
}));

/** GET /api/admin/stats/districts */
export const districtsHandler = asyncHandler(async (req, res) => sendSuccess(res, {
  message: 'Orders by district',
  data: await getOrdersByDistrict(req.query),
}));

/** GET /api/admin/stats/payment-methods */
export const paymentMethodsHandler = asyncHandler(async (req, res) => sendSuccess(res, {
  message: 'Payment method mix',
  data: await getPaymentMethodBreakdown(req.query),
}));

/** GET /api/admin/stats/categories */
export const categoryPerformanceHandler = asyncHandler(async (req, res) => sendSuccess(res, {
  message: 'Category performance',
  data: await getCategoryPerformance(req.query),
}));

/** GET /api/admin/stats/stock-alerts */
export const stockAlertsHandler = asyncHandler(async (req, res) => {
  const alerts = await getStockAlerts({
    limit: Number(req.query.limit) || 25,
    threshold: Number(req.query.threshold) || undefined,
    includeOutOfStock: req.query.includeOutOfStock !== 'false',
  });
  return sendSuccess(res, {
    message: `${alerts.length} stock alert(s)`,
    data: alerts,
    meta: { count: alerts.length },
  });
});
