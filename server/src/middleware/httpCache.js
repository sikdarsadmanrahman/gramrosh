/**
 * -----------------------------------------------------------------------------
 *  middleware/httpCache.js — HTTP caching for catalogue reads
 * -----------------------------------------------------------------------------
 *  The catalogue changes a few times a day but is read thousands of times an
 *  hour. `Cache-Control` + the strong ETag Express generates for every JSON
 *  response lets a CDN (Cloudflare / CloudFront) serve repeats without touching
 *  Node at all, and lets the browser revalidate with a cheap 304.
 *
 *  Admin and mutating routes get `no-store` — stale order data is worse than a
 *  slow page.
 * -----------------------------------------------------------------------------
 */
import { env } from '../config/env.js';

/**
 * Build a `Cache-Control` middleware.
 *
 * @param {object}  [options]
 * @param {number}  [options.maxAge]               browser max-age, seconds
 * @param {number}  [options.sMaxAge]              shared/CDN max-age, seconds
 * @param {number}  [options.staleWhileRevalidate] serve stale while refreshing
 * @param {boolean} [options.isPublic=true]
 * @param {boolean} [options.immutable=false]
 * @returns {import('express').RequestHandler}
 */
export function cacheControl({
  maxAge = env.CACHE_MAX_AGE,
  sMaxAge = env.CACHE_S_MAXAGE,
  staleWhileRevalidate = 600,
  isPublic = true,
  immutable = false,
} = {}) {
  const directives = [
    isPublic ? 'public' : 'private',
    `max-age=${maxAge}`,
    `s-maxage=${sMaxAge}`,
    `stale-while-revalidate=${staleWhileRevalidate}`,
    ...(immutable ? ['immutable'] : []),
  ];
  const value = directives.join(', ');

  return (_req, res, next) => {
    res.set('Cache-Control', value);
    next();
  };
}

/** Catalogue lists & detail pages — short browser cache, longer CDN cache. */
export const catalogueCache = cacheControl({ maxAge: env.CACHE_MAX_AGE, sMaxAge: env.CACHE_S_MAXAGE });

/** Storefront bootstrap/config — changes only when an admin edits settings. */
export const configCache = cacheControl({ maxAge: 300, sMaxAge: 900, staleWhileRevalidate: 1800 });

/** Versioned static assets served by the API (uploaded images, PDFs). */
export const immutableCache = cacheControl({ maxAge: 31_536_000, sMaxAge: 31_536_000, immutable: true });

/** Never cache: admin screens, orders, auth. */
export const noStore = (_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  next();
};

export default catalogueCache;
