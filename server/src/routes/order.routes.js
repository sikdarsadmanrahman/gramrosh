/**
 * -----------------------------------------------------------------------------
 *  routes/order.routes.js — Public checkout, tracking & self-serve invoices
 * -----------------------------------------------------------------------------
 *  These endpoints are unauthenticated by design (guest checkout), so they are
 *  the most rate-limited surface in the API and never cached.
 * -----------------------------------------------------------------------------
 */
import { Router } from 'express';
import {
  createOrderHandler, quoteOrderHandler, lookupOrderHandler,
  publicInvoiceHandler, publicShippingSlipHandler,
} from '../controllers/order.controller.js';
import { validate } from '../middleware/validate.js';
import {
  createOrderBody, quoteOrderBody, lookupOrderQuery, invoiceAccessQuery,
} from '../validators/order.validator.js';
import { orderLimiter, quoteLimiter } from '../middleware/rateLimit.js';
import { noStore } from '../middleware/httpCache.js';
import { optionalAdmin } from '../middleware/auth.js';

const router = Router();

/** POST /api/orders/quote — shipping calculator + basket total (no writes). */
router.post('/quote', noStore, quoteLimiter, validate({ body: quoteOrderBody }), quoteOrderHandler);

/** POST /api/orders — place the order. */
router.post('/', noStore, orderLimiter, validate({ body: createOrderBody }), createOrderHandler);

/** GET /api/orders/lookup?orderNumber=&phone= — public tracking. */
router.get('/lookup', noStore, validate({ query: lookupOrderQuery }), lookupOrderHandler);

/**
 * GET /api/orders/:orderNumber/invoice?phone=…
 * `optionalAdmin` lets a signed-in staff member print any invoice without
 * re-entering the customer's phone number.
 */
router.get('/:orderNumber/invoice', noStore, optionalAdmin, validate({ query: invoiceAccessQuery }), publicInvoiceHandler);
router.get('/:orderNumber/shipping-slip', noStore, optionalAdmin, validate({ query: invoiceAccessQuery }), publicShippingSlipHandler);

export default router;
