/**
 * -----------------------------------------------------------------------------
 *  tests/setup.js — one app instance for the whole vitest run
 * -----------------------------------------------------------------------------
 *  Boots the in-process memory driver (no MongoDB binary needed in CI),
 *  bootstraps the admin account and seeds the demo catalogue exactly once,
 *  then hands every suite the same supertest agent.
 * -----------------------------------------------------------------------------
 */
import supertest from 'supertest';
import { createApp } from '../src/app.js';
import { connectDatabase } from '../src/db/index.js';
import { ensureBootstrapAdmin } from '../src/services/admin.service.js';
import { seedDatabase } from '../src/seed/seed.js';

let agentPromise = null;

/** Lazily boot app + database + seed; concurrent suites share one boot. */
export function getAgent() {
  if (!agentPromise) {
    agentPromise = (async () => {
      await connectDatabase();
      await ensureBootstrapAdmin();
      await seedDatabase({ fresh: true });
      return supertest(createApp());
    })();
  }
  return agentPromise;
}

/** Login helper — returns a bearer token for the seeded super admin. */
export async function getAdminToken(agent) {
  const res = await agent
    .post('/api/admin/auth/login')
    .send({ email: 'admin@gramrosh.test', password: 'Admin@1234' });
  if (res.status !== 200) throw new Error(`admin login failed: ${res.status} ${res.text}`);
  return res.body.data.token;
}
