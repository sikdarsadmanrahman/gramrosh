/**
 * -----------------------------------------------------------------------------
 *  models/derivations.js — Write-time derivations, callable from any driver
 * -----------------------------------------------------------------------------
 *  Each Mongoose schema declares `pre('validate')` / `pre('save')` hooks that run
 *  these functions. The in-process driver cannot execute Mongoose hooks, so it
 *  calls the very same functions at the same points in the write path
 *  (insert and `doc.save()`).
 *
 *  Result: a document written through MongoDB and a document written through the
 *  in-process engine are byte-for-byte identical, and there is exactly ONE place
 *  where each business rule lives.
 * -----------------------------------------------------------------------------
 */
import { deriveCategory } from './category.model.js';
import { deriveProduct } from './product.model.js';
import { deriveCustomer } from './customer.model.js';
import { deriveOrder } from './order.model.js';

/** @type {Record<string, (doc:object, ctx?:object)=>object>} */
export const DERIVATIONS = {
  Category: deriveCategory,
  Product: deriveProduct,
  Customer: deriveCustomer,
  Order: deriveOrder,
  Admin: (doc) => doc,      // password hashing lives in admin.service.js
  Storefront: (doc) => doc, // defaults are sufficient
};

/**
 * Apply the derivation registered for `modelName`, if any.
 *
 * @param {string} modelName
 * @param {object} doc
 * @param {{isNew?:boolean}} [ctx]
 * @returns {object} the same document, mutated
 */
export function applyDerivations(modelName, doc, ctx = {}) {
  const derive = DERIVATIONS[modelName];
  if (typeof derive === 'function' && doc && typeof doc === 'object') derive(doc, ctx);
  return doc;
}

export { deriveCategory, deriveProduct, deriveCustomer, deriveOrder };
