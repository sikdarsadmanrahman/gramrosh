/**
 * -----------------------------------------------------------------------------
 *  order.controller.js — Public checkout, quotes, tracking & invoices
 * -----------------------------------------------------------------------------
 */
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';
import { normalizePhone } from '../utils/phone.js';
import { renderInvoiceHtml } from '../utils/invoiceHtml.js';
import {
  createOrder, quoteBasket, lookupPublicOrder, getOrderByIdOrNumber,
  buildInvoiceContext, redactForPublic,
} from '../services/order.service.js';

/**
 * POST /api/orders/quote
 * Price the current basket (shipping calculator + totals) without placing it.
 */
export const quoteOrderHandler = asyncHandler(async (req, res) => {
  // `req.body` is already parsed, trimmed and defaulted by `quoteOrderBody`.
  const quote = await quoteBasket({
    items: req.body.items,
    district: req.body.district,
    paymentMethod: req.body.paymentMethod ?? null,
    couponCode: req.body.couponCode ?? null,
    shippingMethod: req.body.shippingMethod ?? null,
  });

  return sendSuccess(res, {
    message: quote.checkoutReady ? 'Basket priced' : 'Some items need your attention',
    data: quote,
  });
});

/**
 * POST /api/orders
 * Guest checkout. Prices, shipping and stock are all resolved server-side.
 */
export const createOrderHandler = asyncHandler(async (req, res) => {
  const { order, breakdown, coupon, customer } = await createOrder(req.body, {
    req,
    source: req.body.meta?.source ?? 'web',
  });

  logger.info('[api] order created', { orderNumber: order.orderNumber, ip: req.ip });

  return sendSuccess(res, {
    statusCode: 201,
    message: `Order ${order.orderNumber} placed successfully`,
    data: {
      order: redactForPublic(order),
      breakdown,
      coupon,
      customer,
      /** Where the client should go next. */
      nextSteps: {
        confirmationUrl: `/order-confirmation/${order.orderNumber}`,
        trackingUrl: `/track?orderNumber=${order.orderNumber}&phone=${encodeURIComponent(order.contact.phone)}`,
        invoiceUrl: `/invoice/${order.orderNumber}?phone=${encodeURIComponent(order.contact.phone)}`,
      },
    },
  });
});

/**
 * GET /api/orders/lookup?orderNumber=GR-2026-000417&phone=01711223344
 * Public tracking. Both values are required so orders cannot be enumerated.
 */
export const lookupOrderHandler = asyncHandler(async (req, res) => {
  const order = await lookupPublicOrder(req.query);
  return sendSuccess(res, { message: `Order ${order.orderNumber}`, data: order });
});

/**
 * GET /api/orders/:orderNumber/invoice?phone=…&format=html|json
 *
 * Printable invoice. `format=html` (default) returns a complete document with
 * `@media print` rules — the warehouse prints it straight from the browser, or
 * pipes it through headless Chrome / wkhtmltopdf for a PDF attachment.
 */
export const publicInvoiceHandler = asyncHandler(async (req, res) => {
  const { orderNumber } = req.params;
  const phone = normalizePhone(req.query.phone);

  const order = await getOrderByIdOrNumber(orderNumber);
  // A shopper may only print their own invoice; staff go through /api/admin.
  if (!req.admin && (!phone || phone !== order.contact.phone)) {
    throw ApiError.forbidden('Enter the phone number used at checkout to view this invoice');
  }

  const context = await buildInvoiceContext(order);
  if (req.query.format === 'json') {
    return sendSuccess(res, { message: `Invoice ${context.order.invoiceNumber}`, data: context });
  }

  return res
    .type('html')
    .set('Cache-Control', 'private, no-store')
    // Allow the invoice to be embedded in the admin panel's print preview.
    .set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data: https:;")
    .send(renderInvoiceHtml(context, { variant: 'invoice', showPrintButton: !env.isProduction }));
});

/**
 * GET /api/orders/:orderNumber/shipping-slip?phone=…
 * The parcel insert: address, items and delivery note — no money.
 */
export const publicShippingSlipHandler = asyncHandler(async (req, res) => {
  const order = await getOrderByIdOrNumber(req.params.orderNumber);
  const phone = normalizePhone(req.query.phone);
  if (!req.admin && (!phone || phone !== order.contact.phone)) {
    throw ApiError.forbidden('Enter the phone number used at checkout to view this slip');
  }

  const context = await buildInvoiceContext(order);
  return res
    .type('html')
    .set('Cache-Control', 'private, no-store')
    .send(renderInvoiceHtml(context, { variant: 'shipping', showPrintButton: !env.isProduction }));
});
