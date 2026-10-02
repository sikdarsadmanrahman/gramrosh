/**
 * -----------------------------------------------------------------------------
 *  phone.js — Bangladeshi phone number normalisation
 * -----------------------------------------------------------------------------
 *  Customers type `01711223344`, `1711223344`, `+88 017-1122-3344` and
 *  `008801711223344` interchangeably. Storing all of those verbatim would make
 *  the unique `phone` index useless and split one customer into four records.
 *
 *  Canonical form:  `+8801711223344`  (E.164)
 * -----------------------------------------------------------------------------
 */

/** Loose BD mobile pattern applied to the *canonical* form. */
const BD_MOBILE = /^\+8801[3-9]\d{8}$/;

/**
 * Reduce any user-supplied BD phone string to E.164.
 *
 * @param {string} input
 * @returns {string|null} canonical `+8801XXXXXXXXX`, or null when unparseable
 */
export function normalizePhone(input) {
  if (input === null || input === undefined) return null;
  // Keep digits and a single leading +.
  let value = String(input).replace(/[^\d+]/g, '');
  if (!value) return null;

  // Collapse international prefixes: 0088…, +88…, 88…
  if (value.startsWith('+')) value = value.slice(1);
  if (value.startsWith('0088')) value = value.slice(4);
  else if (value.startsWith('88') && value.length === 13) value = value.slice(2);

  // Local form 01XXXXXXXXX → 1XXXXXXXXX
  if (value.startsWith('0')) value = value.slice(1);

  if (!/^1[3-9]\d{8}$/.test(value)) return null;
  return `+880${value}`;
}

/** @returns {boolean} true when `input` normalises to a valid BD mobile. */
export function isValidBdPhone(input) {
  const normalized = normalizePhone(input);
  return Boolean(normalized && BD_MOBILE.test(normalized));
}

/**
 * Pretty form for the storefront/invoice: `+880 1711-223344`.
 * Falls back to the raw input when it is not a BD mobile.
 */
export function formatPhone(input) {
  const normalized = normalizePhone(input);
  if (!normalized) return String(input ?? '');
  const local = normalized.slice(4); // 1711223344
  return `+880 ${local.slice(0, 4)}-${local.slice(4)}`;
}

/**
 * Digits-only local form used to build `wa.me` / `tel:` links.
 * `wa.me` expects the country code without `+`, e.g. `8801711223344`.
 */
export function toTelDigits(input) {
  const normalized = normalizePhone(input);
  return normalized ? normalized.slice(1) : String(input ?? '').replace(/\D/g, '');
}
