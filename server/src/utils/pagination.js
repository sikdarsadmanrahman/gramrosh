/**
 * -----------------------------------------------------------------------------
 *  pagination.js — Server-side pagination helpers (limit + skip)
 * -----------------------------------------------------------------------------
 *  Every list endpoint in the API is paginated *on the database*, never in
 *  Node. Bounding `limit` is what stops a client from asking for 100k documents
 *  and melting the event loop; `skip`/`page` are both accepted because the
 *  storefront uses `page` while bulk sync jobs prefer raw `skip`.
 * -----------------------------------------------------------------------------
 */
import { env } from '../config/env.js';

/**
 * Parse & clamp pagination options out of a request query string.
 *
 * Accepted query params:
 *   page  — 1-based page number            (default 1)
 *   limit — documents per page             (default DEFAULT_PAGE_SIZE, max MAX_PAGE_SIZE)
 *   skip  — raw offset, overrides `page`   (optional)
 *
 * @param {Record<string, unknown>} query  `req.query`
 * @returns {{page:number, limit:number, skip:number}}
 */
export function parsePagination(query = {}) {
  const toInt = (value, fallback) => {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : fallback;
  };

  const limit = Math.min(Math.max(1, toInt(query.limit, env.DEFAULT_PAGE_SIZE)), env.MAX_PAGE_SIZE);

  let skip = Number.isFinite(Number.parseInt(query.skip, 10)) && query.skip !== undefined && query.skip !== ''
    ? Math.max(0, toInt(query.skip, 0))
    : null;

  let page;
  if (skip !== null) {
    // Derive the page number from an explicit skip so `meta.pagination` stays honest.
    page = Math.floor(skip / limit) + 1;
  } else {
    page = Math.max(1, toInt(query.page, 1));
    skip = (page - 1) * limit;
  }

  return { page, limit, skip };
}

/**
 * Parse & whitelist a `sort` query param.
 *
 * Accepts either a known key from `SORT_OPTIONS` (`?sort=price_asc`) or an
 * explicit Mongo sort string (`?sort=-createdAt,title`). Unknown fields are
 * dropped, which closes the door on sorting by fields that have no index.
 *
 * @param {unknown} value             raw `?sort=` value
 * @param {Record<string, object>} whitelist map of allowed key → sort object
 * @param {object} fallback           sort used when nothing valid was supplied
 * @returns {{key:string|null, sort:object}}
 */
export function parseSort(value, whitelist, fallback) {
  if (!value || typeof value !== 'string') return { key: null, sort: fallback };

  const key = value.trim();
  if (whitelist[key]) return { key, sort: whitelist[key] };

  // Manual sort string: "-price,title" → { price: -1, title: 1 }
  const manual = {};
  for (const part of key.split(',')) {
    const field = part.replace(/^-/, '').trim();
    if (!field) continue;
    manual[field] = part.trim().startsWith('-') ? -1 : 1;
  }
  return Object.keys(manual).length ? { key: null, sort: manual } : { key: null, sort: fallback };
}

export default parsePagination;
