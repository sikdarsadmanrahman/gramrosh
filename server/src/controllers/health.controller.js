/**
 * -----------------------------------------------------------------------------
 *  health.controller.js — Liveness & readiness
 * -----------------------------------------------------------------------------
 *  `/api/health` is what the load balancer polls; it must stay cheap and must
 *  never be rate limited or cached. It performs a real 1-document read so a dead
 *  database is reported as a failure rather than a green light.
 * -----------------------------------------------------------------------------
 */
import { db, getDriver, getConnectionState } from '../db/index.js';
import { env } from '../config/env.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getImageProvider } from '../services/cloudinary.service.js';

const startedAt = Date.now();

export const health = asyncHandler(async (_req, res) => {
  const checks = { uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) };
  let databaseHealthy = false;

  try {
    const probeStart = process.hrtime.bigint();
    await db.Category.findOne({}).select('_id').lean();
    checks.databaseMs = Number(process.hrtime.bigint() - probeStart) / 1e6;
    databaseHealthy = true;
  } catch (error) {
    checks.databaseError = error.message;
  }

  const payload = {
    status: databaseHealthy ? 'ok' : 'degraded',
    service: 'gramrosh-api',
    version: '1.0.0',
    environment: env.NODE_ENV,
    time: new Date().toISOString(),
    database: { driver: getDriver(), state: getConnectionState(), healthy: databaseHealthy },
    images: { provider: getImageProvider() },
    checks,
  };

  return res.status(databaseHealthy ? 200 : 503)
    .set('Cache-Control', 'no-store')
    .json({ success: databaseHealthy, message: databaseHealthy ? 'OK' : 'Degraded', data: payload });
});

export default health;
