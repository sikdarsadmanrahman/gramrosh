/**
 * -----------------------------------------------------------------------------
 *  validators/common.validator.js — Reusable Zod primitives
 * -----------------------------------------------------------------------------
 *  Query strings are all strings, so every numeric field needs coercion — and an
 *  empty `?page=` must be treated as "not supplied" rather than NaN, otherwise
 *  the client gets a confusing 422 for a harmless blank parameter.
 * -----------------------------------------------------------------------------
 */
import { z } from 'zod';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { SORT_KEYS } from '../config/constants.js';
import { normalizePhone, isValidBdPhone } from '../utils/phone.js';

/** Empty strings / nulls become `undefined` so `.optional()` works. */
export const blankToUndefined = (value) => (value === '' || value === null ? undefined : value);

/** Integer query param with a default. */
export const queryInt = (fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) =>
  z.preprocess(blankToUndefined, z.coerce.number().int().min(min).max(max).optional()).transform((v) => v ?? fallback);

/** Optional integer query param (no default). */
export const queryIntOptional = ({ min = 0, max = Number.MAX_SAFE_INTEGER } = {}) =>
  z.preprocess(blankToUndefined, z.coerce.number().int().min(min).max(max).optional());

/** Optional float query param. */
export const queryFloatOptional = ({ min = 0, max = Number.MAX_SAFE_INTEGER } = {}) =>
  z.preprocess(blankToUndefined, z.coerce.number().min(min).max(max).optional());

/** Loose boolean from `true|false|1|0|yes|no`. */
export const queryBoolean = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}, z.boolean().optional());

/** Accepts `?a=x&a=y`, `?a[]=x&a[]=y` and `?a=x,y` — always yields an array. */
export const stringArray = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) return value.flatMap((v) => String(v).split(',')).map((v) => v.trim()).filter(Boolean);
  return String(value).split(',').map((v) => v.trim()).filter(Boolean);
}, z.array(z.string().max(120)).optional());

/** A 24-char hex ObjectId. */
export const objectId = z
  .string()
  .trim()
  .refine((value) => mongoose.isValidObjectId(value), { message: 'Must be a valid 24-character id' });

/** ObjectId *or* slug — most public detail endpoints accept either. */
export const idOrSlug = z.string().trim().min(2).max(180);

/** Bangladeshi mobile number, normalised to E.164 on the way in. */
export const bdPhone = z
  .string()
  .trim()
  .max(24)
  .refine((value) => isValidBdPhone(value), { message: 'Enter a valid Bangladeshi mobile number (e.g. 01711223344)' })
  .transform((value) => normalizePhone(value));

/** Optional BD phone (normalised when present). */
export const bdPhoneOptional = z.preprocess(blankToUndefined, bdPhone.optional());

/** Trimmed, length-bounded free text. */
export const text = (max, { min = 1 } = {}) => z.string().trim().min(min).max(max);

export const optionalText = (max) => z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

export const email = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
  z.string().email('Enter a valid email address').max(160),
);

export const emailOptional = z.preprocess(blankToUndefined, email.optional());

/** Catalogue sort key whitelist (mirrors `SORT_OPTIONS`). */
export const sortKey = z.enum(SORT_KEYS);

/** Standard pagination block shared by every list endpoint. */
export const paginationQuery = z.object({
  page: queryInt(1, { min: 1, max: 100_000 }),
  limit: queryInt(env.DEFAULT_PAGE_SIZE, { min: 1, max: env.MAX_PAGE_SIZE }),
  skip: queryIntOptional({ min: 0, max: 1_000_000 }),
});

/** Shared `id` param for admin routes. */
export const idParams = z.object({ id: objectId });

/** Shared slug param for public routes. */
export const slugParams = z.object({ slug: idOrSlug });
