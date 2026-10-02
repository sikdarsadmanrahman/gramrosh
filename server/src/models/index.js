/**
 * -----------------------------------------------------------------------------
 *  models/index.js — Model registry
 * -----------------------------------------------------------------------------
 *  Importing this module registers every schema with Mongoose exactly once.
 *  Model *definitions* do not require an open connection, so the same registry
 *  is used by:
 *    • the real MongoDB driver  (`db/mongoose.js`)
 *    • the in-process engine    (`db/memory/*`), which reads `model.schema`
 *      to learn field paths, defaults, enums and index definitions.
 * -----------------------------------------------------------------------------
 */
import mongoose from 'mongoose';

import Category, { imageSchema } from './category.model.js';
import Product, { computeDerivedFields } from './product.model.js';
import Customer, { addressSchema } from './customer.model.js';
import Order from './order.model.js';
import Admin, { ADMIN_ROLES, PERMISSIONS } from './admin.model.js';
import Storefront, { STOREFRONT_ID } from './storefront.model.js';

/** Ordered so referenced collections are created first. */
export const MODELS = Object.freeze({
  Category,
  Product,
  Customer,
  Order,
  Admin,
  Storefront,
});

export const MODEL_NAMES = Object.freeze(Object.keys(MODELS));

/**
 * Report every index declared across the schema set.
 *
 * Used at boot (and by `npm run db:indexes`) to prove the required indexes on
 * `category`, `phone`, `orderId`/`orderNumber` and `createdAt` exist, and by the
 * in-process driver to verify query coverage.
 *
 * @returns {Array<{model:string, key:object, options:object}>}
 */
export function collectIndexDefinitions() {
  return MODEL_NAMES.flatMap((name) =>
    (MODELS[name].schema.indexes() ?? []).map(([key, options]) => ({ model: name, key, options: options ?? {} })),
  );
}

export {
  Category,
  Product,
  Customer,
  Order,
  Admin,
  Storefront,
  imageSchema,
  addressSchema,
  computeDerivedFields,
  ADMIN_ROLES,
  PERMISSIONS,
  STOREFRONT_ID,
  mongoose,
};
