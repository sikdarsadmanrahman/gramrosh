/**
 * -----------------------------------------------------------------------------
 *  orderNumber.js — Human friendly, indexed, collision-resistant order ids
 * -----------------------------------------------------------------------------
 *  Format:  GR-2026-000417
 *           ^^  ^^^^  ^^^^^^
 *           |    |       └── zero padded random/sequence component
 *           |    └────────── calendar year (makes archived orders easy to read)
 *           └─────────────── brand prefix
 *
 *  It is stored on its own **unique index** so support staff can search an order
 *  by the number printed on the parcel / invoice in O(log n).
 * -----------------------------------------------------------------------------
 */
import crypto from 'node:crypto';

const PREFIX = 'GR';

/** Base-36 → digits only, so the number never contains ambiguous letters. */
function numericToken(length) {
  // 4 random bytes gives up to 10 base-10 digits; slice to the length we need.
  const raw = crypto.randomInt(0, 1_000_000_000).toString().padStart(9, '0');
  return raw.slice(-length);
}

/**
 * @param {Date} [when] defaults to now
 * @returns {string} e.g. `GR-2026-000417`
 */
export function generateOrderNumber(when = new Date()) {
  return `${PREFIX}-${when.getUTCFullYear()}-${numericToken(6)}`;
}

/** Validate an order number coming from a tracking link. */
export const ORDER_NUMBER_PATTERN = /^GR-\d{4}-\d{6}$/;

export function isValidOrderNumber(value) {
  return typeof value === 'string' && ORDER_NUMBER_PATTERN.test(value.trim().toUpperCase());
}

export default generateOrderNumber;
