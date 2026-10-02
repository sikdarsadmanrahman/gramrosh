/**
 * -----------------------------------------------------------------------------
 *  app.js — Express application factory
 * -----------------------------------------------------------------------------
 *  Exported as a factory (not a running server) so tests can build an app
 *  instance per case with `supertest` and never bind a port.
 *
 *  Middleware order is deliberate:
 *    security headers → CORS → body parsing → request context → rate limit →
 *    routes → 404 → error boundary.
 * -----------------------------------------------------------------------------
 */
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';

import { env, ROOT_DIR } from './config/env.js';
import { logger } from './utils/logger.js';
import apiRoutes from './routes/index.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { requestContext } from './middleware/requestContext.js';
import { notFoundHandler, errorHandler } from './middleware/error.js';
import { immutableCache } from './middleware/httpCache.js';
import { LOCAL_UPLOAD_DIR } from './services/cloudinary.service.js';

/** Body size ceilings — a product description is long, but never 10MB long. */
const JSON_LIMIT = '1mb';

/**
 * Decide which origins may call the API directly.
 *
 * In development we reflect any origin: the Vite dev server proxies `/api`, so
 * browser requests are same-origin anyway, and reflecting keeps preview tunnels
 * (which have unpredictable hostnames) working. In production the allow-list is
 * enforced from `CORS_ORIGINS`.
 */
/**
 * Headers a cross-origin browser client is allowed to *read* back.
 *
 * Without this list, `fetch`/axios in the admin SPA can see the response body but
 * not the CSV export counters or the download filename — CORS hides all
 * non-"simple" response headers by default.
 */
const EXPOSED_HEADERS = [
  'X-Request-Id',
  'X-Export-Total',
  'X-Export-Truncated',
  'Content-Disposition',
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
  'Retry-After',
];

function buildCorsOptions() {
  const shared = {
    credentials: true,
    maxAge: 86_400,
    exposedHeaders: EXPOSED_HEADERS,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'If-None-Match'],
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  };

  // Development: the Vite dev server proxies /api, so requests are same-origin
  // in practice. Reflecting any Origin keeps direct cross-port calls working
  // too — acceptable here because no cookies carry privilege (JWT is a header).
  if (!env.isProduction) {
    return { ...shared, origin: true };
  }

  // Production: strict allow-list. `*` is supported for fully public deployments
  // but then credentials are dropped, since the two are mutually exclusive.
  const allowList = env.CORS_ORIGINS;
  const wildcard = allowList.includes('*');
  return {
    ...shared,
    credentials: !wildcard,
    origin(origin, callback) {
      // No Origin header = curl / SSR / health check / same-origin → allow.
      if (!origin || wildcard || allowList.includes(origin)) return callback(null, true);
      return callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
  };
}

/**
 * @param {{exposeAdmin?:boolean}} [options]
 * @returns {import('express').Express}
 */
export function createApp() {
  const app = express();

  // Behind a load balancer / CDN: honour X-Forwarded-* so `req.ip` and secure
  // cookie logic are correct, and so rate limiting keys on the real client.
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');
  // Strong ETags let browsers and the CDN revalidate with a cheap 304.
  app.set('etag', 'strong');
  app.set('json spaces', env.isProduction ? 0 : 0);

  /* ------------------------------ security ------------------------------- */
  app.use(
    helmet({
      // This is a JSON API plus a few self-contained printable HTML invoices,
      // which set their own strict CSP. A blanket CSP here would only fight them.
      contentSecurityPolicy: false,
      // Product images are loaded by the storefront from this origin/CDN.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginEmbedderPolicy: false,
      // The invoice route is same-origin only; no reason to be frameable elsewhere.
      frameguard: { action: 'sameorigin' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  app.use(cors(buildCorsOptions()));

  /* ------------------------------ performance ---------------------------- */
  // gzip/brotli-ish compression of JSON. The catalogue payload is text-heavy and
  // compresses ~5x, which matters far more on Bangladeshi mobile connections
  // than any server-side micro-optimisation.
  app.use(
    compression({
      level: 6,
      threshold: 1024,
      // Never compress already-compressed binaries (uploaded images).
      filter: (req, res) => {
        if (req.headers['x-no-compression']) return false;
        if (res.getHeader('Content-Type')?.toString().startsWith('image/')) return false;
        return compression.filter(req, res);
      },
    }),
  );

  /* -------------------------------- parsing ------------------------------ */
  app.use(express.json({ limit: JSON_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: JSON_LIMIT }));

  /* ------------------------------ observability -------------------------- */
  app.use(requestContext);

  /* ----------------------- locally transcoded images --------------------- */
  // Only used by the development image provider; in production Cloudinary/CDN
  // serves these and the directory simply does not exist.
  app.use(
    '/uploads',
    immutableCache,
    express.static(LOCAL_UPLOAD_DIR, {
      maxAge: '365d',
      immutable: true,
      fallthrough: true,
      index: false,
      dotfiles: 'ignore',
    }),
  );

  /* --------------------------------- API --------------------------------- */
  app.use('/api', apiLimiter, apiRoutes);

  /** Tiny service index — useful when someone opens the API root in a browser. */
  app.get('/', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({
      success: true,
      message: 'Gramrosh API',
      data: {
        name: 'Gramrosh — Fresh & Organic Food',
        version: '1.0.0',
        environment: env.NODE_ENV,
        endpoints: {
          health: '/api/health',
          config: '/api/config',
          home: '/api/storefront/home',
          products: '/api/products?page=1&limit=12',
          categories: '/api/categories',
          quote: 'POST /api/orders/quote',
          checkout: 'POST /api/orders',
          tracking: '/api/orders/lookup?orderNumber=GR-2026-000417&phone=01711223344',
          admin: '/api/admin/** (bearer token required)',
        },
      },
    });
  });

  /* --------------------- serve the built SPA in production --------------- */
  const clientDist = path.join(ROOT_DIR, 'client', 'dist');
  if (env.isProduction && fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { maxAge: '1h', index: false }));
    // SPA fallback: any non-API GET renders index.html and lets React Router work.
    app.get(/^(?!\/api|\/uploads).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
    logger.info('[http] serving built storefront', { clientDist });
  }

  /* ------------------------------- errors -------------------------------- */
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
