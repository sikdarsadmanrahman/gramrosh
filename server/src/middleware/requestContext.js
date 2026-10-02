/**
 * -----------------------------------------------------------------------------
 *  middleware/requestContext.js — Request ids & timing
 * -----------------------------------------------------------------------------
 *  A request id on every log line and every error response is what turns
 *  "checkout failed for someone, sometime" into a 10-second investigation.
 *  Honours an inbound `x-request-id` so a trace can span CDN → API → worker.
 * -----------------------------------------------------------------------------
 */
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { logger } from '../utils/logger.js';

/** Skip the access log for these paths (load balancers hammer them). */
const QUIET_PATHS = new Set(['/api/health', '/favicon.ico']);

export function requestContext(req, res, next) {
  const incoming = req.headers['x-request-id'];
  req.id = typeof incoming === 'string' && incoming.length <= 128 ? incoming : crypto.randomUUID();
  req.startedAt = performance.now();

  res.setHeader('X-Request-Id', req.id);

  res.on('finish', () => {
    if (QUIET_PATHS.has(req.path)) return;
    const durationMs = Number((performance.now() - req.startedAt).toFixed(1));
    const entry = {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs,
      driver: res.locals?.dbDriver,
    };
    // Anything 5xx is an error; 4xx is expected traffic; the rest is debug.
    if (res.statusCode >= 500) logger.error('request failed', entry);
    else if (res.statusCode >= 400) logger.warn('request rejected', entry);
    else if (durationMs > 400) logger.warn('slow request', entry);
    else logger.debug('request', entry);
  });

  next();
}

export default requestContext;
