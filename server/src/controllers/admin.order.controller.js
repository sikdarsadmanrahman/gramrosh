/**
 * -----------------------------------------------------------------------------
 *  admin.order.controller.js — Order queue, status pipeline, invoices & export
 * -----------------------------------------------------------------------------
 */
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/apiResponse.js';
import { db } from '../db/index.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { renderInvoiceHtml } from '../utils/invoiceHtml.js';
import { ORDER_STATUS, ORDER_STATUS_LIST, STATUS_TRANSITIONS } from '../config/constants.js';
import {
  listOrders, buildOrderFilter, getOrderByIdOrNumber, createOrder, transitionStatus,
  updatePaymentStatus, updateShippingDetails, updateOrderNotes,
  buildInvoiceContext, listCustomerOrders,
} from '../services/order.service.js';

/** GET /api/admin/orders */
export const listOrdersHandler = asyncHandler(async (req, res) => {
  const { items, total, page, limit } = await listOrders(req.query);

  // Status counts for the kanban tabs are computed for the *same* filter minus
  // the status clause, so the tab badges always match what you'd see on click.
  const { status: _status, statuses: _statuses, ...withoutStatus } = req.query;
  const tabCounts = await countByStatus(withoutStatus);

  return sendPaginated(res, {
    items,
    page,
    limit,
    total,
    message: `${total} order(s)`,
    extraMeta: {
      statusCounts: tabCounts,
      transitions: STATUS_TRANSITIONS,
    },
  });
});

/** Count orders per status for a given (status-less) filter. */
async function countByStatus(query) {
  const filter = buildOrderFilter(query);
  const rows = await db.Order.aggregate([
    { $match: filter },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const counts = Object.fromEntries(ORDER_STATUS_LIST.map((status) => [status, 0]));
  for (const row of rows) if (row._id in counts) counts[row._id] = row.count;
  return counts;
}

/** GET /api/admin/orders/:id — full order with the customer attached. */
export const getOrderHandler = asyncHandler(async (req, res) => {
  const order = await getOrderByIdOrNumber(req.params.id, { withCustomer: true });
  return sendSuccess(res, {
    message: `Order ${order.orderNumber}`,
    data: { ...order, allowedStatuses: STATUS_TRANSITIONS[order.status] ?? [] },
  });
});

/** POST /api/admin/orders — staff-created order (taken over phone / WhatsApp). */
export const createOrderHandler = asyncHandler(async (req, res) => {
  const result = await createOrder(req.body, {
    req,
    source: 'admin',
    staff: req.admin,
    status: req.body.status ?? ORDER_STATUS.PENDING,
  });
  logger.info('[admin] order created by staff', { orderNumber: result.order.orderNumber, by: req.admin?.email });
  return sendSuccess(res, {
    statusCode: 201,
    message: `Order ${result.order.orderNumber} created`,
    data: result,
  });
});

/** PATCH /api/admin/orders/:id/status — move along the pipeline. */
export const updateStatusHandler = asyncHandler(async (req, res) => {
  const order = await transitionStatus(req.params.id, req.body, req.admin);
  return sendSuccess(res, {
    message: `Order ${order.orderNumber} moved to "${order.status}"`,
    data: { ...order, allowedStatuses: STATUS_TRANSITIONS[order.status] ?? [] },
  });
});

/** PATCH /api/admin/orders/:id/payment — reconcile bKash / Nagad / Rocket. */
export const updatePaymentHandler = asyncHandler(async (req, res) => {
  const order = await updatePaymentStatus(req.params.id, req.body, req.admin);
  return sendSuccess(res, { message: `Payment marked "${order.payment.status}"`, data: order });
});

/** PATCH /api/admin/orders/:id/shipping — courier & tracking number. */
export const updateShippingHandler = asyncHandler(async (req, res) => {
  const order = await updateShippingDetails(req.params.id, req.body, req.admin);
  return sendSuccess(res, { message: 'Shipping details saved', data: order });
});

/** PATCH /api/admin/orders/:id/notes */
export const updateNotesHandler = asyncHandler(async (req, res) => {
  const order = await updateOrderNotes(req.params.id, req.body);
  return sendSuccess(res, { message: 'Notes saved', data: order });
});

/**
 * GET /api/admin/orders/:id/invoice?format=html|json&variant=invoice|shipping
 *
 * The printable artefact. `format=html` is a complete document with `@media
 * print` CSS — open it and hit Ctrl+P, or pipe it through headless Chrome for a
 * PDF. `format=json` returns the same context for the React invoice page.
 */
export const invoiceHandler = asyncHandler(async (req, res) => {
  const order = await getOrderByIdOrNumber(req.params.id);
  const context = await buildInvoiceContext(order);

  if (!order.invoiceGeneratedAt) {
    db.Order.updateOne({ _id: order._id }, { $set: { invoiceGeneratedAt: new Date() } }).catch(() => {});
  }

  if (req.query.format === 'json') {
    return sendSuccess(res, { message: `Invoice ${context.order.invoiceNumber}`, data: context });
  }

  const variant = req.query.variant === 'shipping' ? 'shipping' : 'invoice';
  return res
    .type('html')
    .set('Cache-Control', 'private, no-store')
    .send(renderInvoiceHtml(context, { variant, showPrintButton: true }));
});

/**
 * GET /api/admin/orders/export?format=csv&…
 * Bulk export honouring the same filters as the list screen.
 */
/** Hard ceiling so an export can never become an unbounded memory dump. */
const EXPORT_LIMIT = 5000;

export const exportOrdersHandler = asyncHandler(async (req, res) => {
  // Page through the same filter the list screen uses. Bounded, because a
  // full-history dump belongs in a background job, not an HTTP request.
  const all = [];
  let page = 1;
  let total = Infinity;

  while (all.length < Math.min(total, EXPORT_LIMIT)) {
    const batch = await listOrders({ ...req.query, page, limit: env.MAX_PAGE_SIZE });
    total = batch.total;
    all.push(...batch.items);
    if (!batch.items.length) break;
    page += 1;
  }
  const truncated = total > all.length;

  if (req.query.format === 'json') {
    return sendSuccess(res, {
      message: `${all.length} order(s) exported`,
      data: all,
      meta: { total, exported: all.length, truncated },
    });
  }

  const csv = ordersToCsv(all);
  return res
    .type('text/csv; charset=utf-8')
    .set('Content-Disposition', `attachment; filename="gramrosh-orders-${new Date().toISOString().slice(0, 10)}.csv"`)
    .set('Cache-Control', 'no-store')
    .set('X-Export-Total', String(total))
    .set('X-Export-Truncated', truncated ? '1' : '0')
    // BOM so Excel opens the UTF-8 file (and Bengali names) correctly.
    .send(`\uFEFF${csv}`);
});

/** RFC-4180-ish CSV writer with proper quoting. */
function ordersToCsv(orders) {
  const headers = [
    'Order Number', 'Placed At', 'Status', 'Customer', 'Phone', 'District', 'Zone',
    'Items', 'Qty', 'Subtotal', 'Discount', 'Shipping', 'Grand Total',
    'Payment Method', 'Payment Status', 'TrxID', 'Sender Phone', 'Courier', 'Tracking',
  ];
  const escapeCell = (value) => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [headers.join(',')];

  for (const order of orders) {
    lines.push([
      order.orderNumber,
      new Date(order.createdAt).toISOString(),
      order.status,
      order.contact?.name,
      order.contact?.phone,
      order.shippingAddress?.district,
      order.shipping?.method,
      (order.items ?? []).map((i) => `${i.title} (${i.variantLabel})`).join(' | '),
      order.totals?.itemCount,
      order.pricing?.subtotal,
      order.pricing?.discount,
      order.pricing?.shippingFee,
      order.pricing?.grandTotal,
      order.payment?.method,
      order.payment?.status,
      order.payment?.transactionId ?? '',
      order.payment?.senderPhone ?? '',
      order.shipping?.courier ?? '',
      order.shipping?.trackingNumber ?? '',
    ].map(escapeCell).join(','));
  }
  return lines.join('\r\n');
}

/** GET /api/admin/orders/:id/customer-orders — the "also bought" side panel. */
export const customerOrdersHandler = asyncHandler(async (req, res) => {
  const order = await getOrderByIdOrNumber(req.params.id);
  const history = await listCustomerOrders(order.customer, { page: 1, limit: 10 });
  return sendSuccess(res, {
    message: `${history.total} order(s) from this customer`,
    data: history.items.filter((entry) => String(entry._id) !== String(order._id)),
  });
});
