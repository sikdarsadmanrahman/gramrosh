/**
 * -----------------------------------------------------------------------------
 *  validators/customer.validator.js
 * -----------------------------------------------------------------------------
 */
import { z } from 'zod';
import {
  paginationQuery, bdPhone, bdPhoneOptional, emailOptional, text, optionalText,
  objectId, blankToUndefined, queryBoolean, stringArray, idParams,
} from './common.validator.js';
import { DISTRICTS, SHIPPING_ZONE } from '../config/constants.js';

export const addressInput = z.object({
  _id: z.preprocess(blankToUndefined, objectId.optional()),
  label: optionalText(40),
  line1: text(200),
  line2: optionalText(200),
  area: optionalText(100),
  city: optionalText(100),
  district: z.enum(DISTRICTS, { errorMap: () => ({ message: 'Select a valid district' }) }),
  postalCode: optionalText(12),
  landmark: optionalText(160),
  shippingZone: z.preprocess(blankToUndefined, z.enum(Object.values(SHIPPING_ZONE)).optional()),
  isDefault: z.boolean().optional(),
});

/** GET /api/admin/customers */
export const listCustomersQuery = paginationQuery.extend({
  q: z.preprocess(blankToUndefined, z.string().trim().max(120).optional()),
  segment: z.preprocess(blankToUndefined, z.enum(['new', 'returning', 'vip', 'at_risk', 'blocked']).optional()),
  district: z.preprocess(blankToUndefined, z.string().trim().max(60).optional()),
  tags: stringArray,
  isActive: queryBoolean,
  minOrders: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).optional()),
  minSpent: z.preprocess(blankToUndefined, z.coerce.number().min(0).optional()),
  sort: z.preprocess(blankToUndefined, z.enum(['newest', 'last_order', 'most_orders', 'highest_value', 'name'])).optional(),
});

/** POST /api/admin/customers */
export const createCustomerBody = z.object({
  name: text(120),
  phone: bdPhone,
  email: emailOptional,
  address: addressInput.optional(),
  addresses: z.array(addressInput).max(5).optional(),
  notes: optionalText(600),
  tags: stringArray.optional(),
  segment: z.enum(['new', 'returning', 'vip', 'at_risk', 'blocked']).optional(),
  marketing: z.object({
    smsOptIn: z.boolean().optional(),
    emailOptIn: z.boolean().optional(),
    source: optionalText(40),
  }).optional(),
});

/** PATCH /api/admin/customers/:id */
export const updateCustomerBody = createCustomerBody.partial().extend({
  phone: bdPhoneOptional,
  isActive: z.boolean().optional(),
});

export const customerIdParams = idParams;

/** GET /api/admin/customers/:id/orders */
export const customerOrdersQuery = paginationQuery.extend({
  status: z.preprocess(blankToUndefined, z.string().trim().max(20).optional()),
});
