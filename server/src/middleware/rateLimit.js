/**
 * -----------------------------------------------------------------------------
 *  middleware/rateLimit.js — Abuse protection
 * -----------------------------------------------------------------------------
 *  Four tiers, from generous (catalogue reads) to strict (login & order
 *  creation), because those are the endpoints a bot actually targets.
 *
 *  The default store is in-process memory: correct for a single node, but when
 *  you scale horizontally swap in `rate-limit-redis` (or `@upstash/ratelimit`)
 *  via the `store` option so the budget is shared — see DEPLOYMENT.md.
 * -----------------------------------------------------------------------------
 */
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

/** Shared response shape so the client can render a friendly "slow down" toast. */
const handler = (_req, _res, next, options) => {
  next(ApiError.tooMany(`Too many requests — try again in ${Math.ceil(options.windowMs / 60000)} minute(s)`));
};

const common = {
  standardHeaders: 'draft-7', // RateLimit-* headers
  legacyHeaders: false,       // no X-RateLimit-*
  handler,
};

/** Everything under /api — generous, this is mostly cacheable reads. */
export const apiLimiter = rateLimit({
  ...common,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
});

/** Admin login — tight, and keyed per IP + email so one attacker cannot lock a team out. */
export const authLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: env.RATE_LIMIT_AUTH_MAX,
  skipSuccessfulRequests: true, // only failed attempts count
  keyGenerator: (req) => `${req.ip}:${String(req.body?.email ?? '').toLowerCase()}`,
});

/** Order creation — stops scripted fake-order floods. */
export const orderLimiter = rateLimit({
  ...common,
  windowMs: 10 * 60 * 1000,
  limit: env.RATE_LIMIT_ORDER_MAX,
  keyGenerator: (req) => `${req.ip}:${String(req.body?.customer?.phone ?? '')}`,
});

/**
 * Basket quoting — the slide-over cart re-prices on every quantity change, so
 * this is deliberately generous; it exists to stop a scripted loop hammering the
 * pricing path, not to inconvenience a shopper editing their cart.
 */
export const quoteLimiter = rateLimit({
  ...common,
  windowMs: 10 * 60 * 1000,
  limit: 240,
  // Successful quotes are free; only aborted/invalid ones count towards the cap.
  skipSuccessfulRequests: true,
});

/** Image uploads — the most expensive operation in the app. */
export const uploadLimiter = rateLimit({
  ...common,
  windowMs: 60 * 60 * 1000,
  limit: 200,
});

/** Health check must never be throttled (load balancers poll it). */
export const noLimit = (_req, _res, next) => next();

export default apiLimiter;
