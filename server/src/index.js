/**
 * -----------------------------------------------------------------------------
 *  index.js — Process bootstrap
 * -----------------------------------------------------------------------------
 *  Order matters: config is validated *before* anything binds a port, the
 *  database is connected before routes can serve, and the bootstrap admin exists
 *  before the panel can be opened. A failure anywhere here exits non-zero so the
 *  orchestrator restarts or alerts instead of serving a broken API.
 * -----------------------------------------------------------------------------
 */
import { createApp } from './app.js';
import { env, assertProductionConfig } from './config/env.js';
import { logger } from './utils/logger.js';
import { connectDatabase, disconnectDatabase } from './db/index.js';
import { configureCloudinary } from './services/cloudinary.service.js';
import { ensureBootstrapAdmin } from './services/admin.service.js';
import { autoSeedIfEmpty } from './seed/seed.js';

async function main() {
  // 1. Fail fast on insecure production configuration.
  assertProductionConfig();

  // 2. Storage.
  await connectDatabase();

  // 3. Image pipeline (Cloudinary in production, local WebP transcoder otherwise).
  configureCloudinary();

  // 4. Guarantee the panel is reachable on a fresh install.
  await ensureBootstrapAdmin();

  // 5. A brand-new database gets the demo catalogue so the app is usable
  //    immediately. Production deployments seed explicitly via `npm run seed`.
  await autoSeedIfEmpty();

  // 6. HTTP.
  const app = createApp();
  const server = app.listen(env.PORT, env.HOST, () => {
    logger.info('[http] Gramrosh API listening', {
      url: `http://${env.HOST}:${env.PORT}`,
      env: env.NODE_ENV,
      driver: env.DB_DRIVER,
    });
    logger.info('[http] endpoints', {
      health: `http://localhost:${env.PORT}/api/health`,
      storefront: `http://localhost:${env.PORT}/api/storefront/home`,
      products: `http://localhost:${env.PORT}/api/products?page=1&limit=12`,
      adminLogin: `POST http://localhost:${env.PORT}/api/admin/auth/login`,
      adminCredentials: env.isProduction ? '(from ADMIN_EMAIL/ADMIN_PASSWORD)' : `${env.ADMIN_EMAIL} / ${env.ADMIN_PASSWORD}`,
    });
  });

  server.keepAliveTimeout = 65_000; // stay above a typical 60s ALB idle timeout
  server.headersTimeout = 66_000;
  server.requestTimeout = 120_000;

  /* --------------------------- graceful shutdown -------------------------- */
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`[process] ${signal} received — draining`);

    // Stop accepting new work, let in-flight requests finish, then close the DB.
    const timer = setTimeout(() => {
      logger.error('[process] forced exit after 10s drain');
      process.exit(1);
    }, 10_000);
    timer.unref();

    server.close(async () => {
      try {
        await disconnectDatabase();
        logger.info('[process] shutdown complete');
        process.exit(0);
      } catch (error) {
        logger.error('[process] shutdown error', { error: error.message });
        process.exit(1);
      }
    });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error('[process] unhandled rejection', { reason: reason instanceof Error ? reason.stack : String(reason) });
  });
  process.on('uncaughtException', (error) => {
    logger.error('[process] uncaught exception — exiting', { stack: error.stack });
    // State is undefined after an uncaught exception: exit and let the
    // orchestrator start a clean process rather than limp along corrupted.
    process.exit(1);
  });

  return server;
}

main().catch((error) => {
  logger.error('[process] failed to start', { stack: error.stack ?? error.message });
  process.exit(1);
});
