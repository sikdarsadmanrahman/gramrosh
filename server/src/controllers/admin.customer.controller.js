/**
 * -----------------------------------------------------------------------------
 *  admin.customer.controller.js — Customer database (CRM)
 * -----------------------------------------------------------------------------
 */
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import {
  listCustomers, getCustomerProfile, createCustomer, updateCustomer, deleteCustomer,
  getCustomerByPhone, refreshCustomerStats, bulkTagCustomers,
} from '../services/customer.service.js';
import { listCustomerOrders } from '../services/order.service.js';

/** GET /api/admin/customers */
export const listCustomersHandler = asyncHandler(async (req, res) => {
  const { items, total, page, limit } = await listCustomers(req.query);
  return sendPaginated(res, { items, total, page, limit, message: `${total} customer(s)` });
});

/** GET /api/admin/customers/:id — profile + paginated order history. */
export const getCustomerHandler = asyncHandler(async (req, res) => {
  const { customer, orders, orderTotal } = await getCustomerProfile(req.params.id, {
    ordersPage: Number(req.query.ordersPage) || 1,
    ordersLimit: Math.min(Number(req.query.ordersLimit) || 10, 50),
  });
  return sendSuccess(res, {
    message: customer.name,
    data: { customer, orders, orderTotal },
  });
});

/** GET /api/admin/customers/:id/orders */
export const customerOrdersHandler = asyncHandler(async (req, res) => {
  const { items, total, page, limit } = await listCustomerOrders(req.params.id, {
    page: Number(req.query.page) || 1,
    limit: Math.min(Number(req.query.limit) || 20, 50),
    status: req.query.status,
  });
  return sendPaginated(res, { items, total, page, limit, message: `${total} order(s)` });
});

/** GET /api/admin/customers/by-phone/:phone */
export const getCustomerByPhoneHandler = asyncHandler(async (req, res) => {
  const found = await getCustomerByPhone(req.params.phone);
  if (!found) throw ApiError.notFound('No customer with that phone number');

  // Same payload shape as `GET /:id` — the phone lookup is just another way of
  // opening the customer drawer, and support staff need the order history on
  // screen the moment they recognise the caller's number.
  const { customer, orders, orderTotal } = await getCustomerProfile(String(found._id), {
    ordersPage: Number(req.query.ordersPage) || 1,
    ordersLimit: Math.min(Number(req.query.ordersLimit) || 10, 50),
  });

  return sendSuccess(res, { message: customer.name, data: { customer, orders, orderTotal } });
});

/** POST /api/admin/customers */
export const createCustomerHandler = asyncHandler(async (req, res) => {
  const customer = await createCustomer(req.body);
  return sendSuccess(res, { statusCode: 201, message: `Customer ${customer.name} added`, data: customer });
});

/** PATCH /api/admin/customers/:id */
export const updateCustomerHandler = asyncHandler(async (req, res) => {
  const customer = await updateCustomer(req.params.id, req.body);
  return sendSuccess(res, { message: 'Customer updated', data: customer });
});

/** DELETE /api/admin/customers/:id — blocked while orders exist. */
export const deleteCustomerHandler = asyncHandler(async (req, res) => {
  const result = await deleteCustomer(req.params.id);
  return sendSuccess(res, { message: 'Customer deleted', data: result });
});

/** POST /api/admin/customers/:id/recompute — refresh segment & average order value. */
export const recomputeCustomerHandler = asyncHandler(async (req, res) => {
  const customer = await refreshCustomerStats(req.params.id);
  if (!customer) throw ApiError.notFound('Customer not found');
  return sendSuccess(res, { message: `Segment recomputed → ${customer.segment}`, data: customer });
});

/** POST /api/admin/customers/bulk-tag */
export const bulkTagHandler = asyncHandler(async (req, res) => {
  const result = await bulkTagCustomers(req.body);
  const { action, tags, modified } = result;
  const label = tags.map((tag) => `"${tag}"`).join(', ');

  return sendSuccess(res, {
    message: `${action === 'remove' ? 'Removed' : 'Added'} ${label} on ${modified} customer(s)`,
    data: result,
  });
});
