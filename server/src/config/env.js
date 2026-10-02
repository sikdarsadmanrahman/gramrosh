/**
 * -----------------------------------------------------------------------------
 *  env.js — Centralised, validated runtime configuration
 * -----------------------------------------------------------------------------
 *  Every environment variable the API consumes is read exactly once, here, and
 *  given a sane default. The rest of the codebase imports this frozen object
 *  instead of touching `process.env`, which keeps configuration discoverable
 *  and makes the app trivial to unit-test (just mock one module).
 * -----------------------------------------------------------------------------
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path of the `server/` package. */
export const SERVER_DIR = path.resolve(__dirname, '../..');
/** Absolute path of the repository root. */
export const ROOT_DIR = path.resolve(SERVER_DIR, '..');

/**
 * Minimal `.env` loader.
 *
 * The npm scripts already pass `--env-file-if-exists=.env`, but we also parse
 * the file here so that a bare `node src/index.js` behaves identically. Values
 * already present in `process.env` always win (12-factor friendly).
 */
function loadDotEnv(file = path.join(SERVER_DIR, '.env')) {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip matching surrounding quotes.
    if (/^(".*"|'.*')$/s.test(value)) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotEnv();

const processEnv = process.env;

/** Read a string variable with an optional fallback. */
const str = (key, fallback = '') => (processEnv[key] === undefined || processEnv[key] === '' ? fallback : String(processEnv[key]));
/** Read an integer variable with an optional fallback. */
const int = (key, fallback) => {
  const parsed = Number.parseInt(processEnv[key] ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};
/** Read a boolean variable (`1`, `true`, `yes`, `on` are all truthy). */
const bool = (key, fallback = false) => {
  if (processEnv[key] === undefined || processEnv[key] === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(processEnv[key]).toLowerCase());
};
/** Read a comma separated list variable. */
const list = (key, fallback = []) => {
  const value = str(key);
  return value ? value.split(',').map((v) => v.trim()).filter(Boolean) : fallback;
};

const NODE_ENV = str('NODE_ENV', 'development');
const isProduction = NODE_ENV === 'production';
const isTest = NODE_ENV === 'test';

/**
 * Database driver selection.
 *
 *  - `mongodb` → real Mongoose connection against `MONGO_URI` (production).
 *  - `memory`  → in-process document engine that boots from the *same*
 *                Mongoose schemas and persists to a JSON file. Used for
 *                zero-config local development, CI, and the vitest suite.
 *
 * When DB_DRIVER is not set explicitly we auto-select: a MONGO_URI means
 * MongoDB, otherwise we fall back to the in-process engine.
 */
const DB_DRIVER = str('DB_DRIVER', str('MONGO_URI') ? 'mongodb' : 'memory').toLowerCase();

export const env = Object.freeze({
  NODE_ENV,
  isProduction,
  isDevelopment: NODE_ENV === 'development',
  isTest,

  // --- HTTP server -----------------------------------------------------------
  PORT: int('PORT', 5000),
  HOST: str('HOST', '0.0.0.0'),
  /** Origin(s) allowed by CORS. Comma separated. */
  CORS_ORIGINS: list('CORS_ORIGINS', ['http://localhost:5173', 'http://127.0.0.1:5173']),
  TRUST_PROXY: int('TRUST_PROXY', 1),

  // --- Database --------------------------------------------------------------
  DB_DRIVER,
  MONGO_URI: str('MONGO_URI', 'mongodb://127.0.0.1:27017/gramrosh'),
  MEMORY_DB_PATH: str('MEMORY_DB_PATH', path.join(SERVER_DIR, '.data', 'db.json')),
  /** Persist the in-process engine to disk (disable in tests for isolation). */
  MEMORY_DB_PERSIST: bool('MEMORY_DB_PERSIST', !isTest),

  // --- Auth ------------------------------------------------------------------
  JWT_SECRET: str('JWT_SECRET', isProduction ? '' : 'gramrosh-dev-secret-change-me'),
  JWT_EXPIRES_IN: str('JWT_EXPIRES_IN', '7d'),
  BCRYPT_ROUNDS: int('BCRYPT_ROUNDS', 10),
  /** Bootstrap admin used by the seed script. */
  ADMIN_NAME: str('ADMIN_NAME', 'Gramrosh Admin'),
  ADMIN_EMAIL: str('ADMIN_EMAIL', 'admin@gramrosh.test'),
  ADMIN_PASSWORD: str('ADMIN_PASSWORD', 'Admin@1234'),

  // --- Image pipeline (Cloudinary + WebP CDN) --------------------------------
  CLOUDINARY_CLOUD_NAME: str('CLOUDINARY_CLOUD_NAME'),
  CLOUDINARY_API_KEY: str('CLOUDINARY_API_KEY'),
  CLOUDINARY_API_SECRET: str('CLOUDINARY_API_SECRET'),
  CLOUDINARY_FOLDER: str('CLOUDINARY_FOLDER', 'gramrosh'),
  /** Optional custom CDN / CNAME placed in front of Cloudinary. */
  CDN_BASE_URL: str('CDN_BASE_URL'),
  /** Public image base used by the seeded catalogue when no CDN is configured. */
  PUBLIC_ASSET_BASE: str('PUBLIC_ASSET_BASE', '/img/products'),
  UPLOAD_MAX_MB: int('UPLOAD_MAX_MB', 6),

  // --- Rate limiting ---------------------------------------------------------
  RATE_LIMIT_WINDOW_MS: int('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  RATE_LIMIT_MAX: int('RATE_LIMIT_MAX', 600),
  RATE_LIMIT_AUTH_MAX: int('RATE_LIMIT_AUTH_MAX', 20),
  RATE_LIMIT_ORDER_MAX: int('RATE_LIMIT_ORDER_MAX', 30),

  // --- HTTP caching ----------------------------------------------------------
  /** `Cache-Control: max-age` (seconds) applied to public catalogue reads. */
  CACHE_MAX_AGE: int('CACHE_MAX_AGE', 60),
  CACHE_S_MAXAGE: int('CACHE_S_MAXAGE', 300),

  // --- Store / business configuration ---------------------------------------
  CLIENT_URL: str('CLIENT_URL', 'http://localhost:5173'),
  STORE_NAME: str('STORE_NAME', 'Gramrosh'),
  STORE_PHONE: str('STORE_PHONE', '+8801711223344'),
  STORE_WHATSAPP: str('STORE_WHATSAPP', '8801711223344'),
  STORE_EMAIL: str('STORE_EMAIL', 'hello@gramrosh.com'),
  CURRENCY: str('CURRENCY', 'BDT'),
  CURRENCY_SYMBOL: str('CURRENCY_SYMBOL', '৳'),
  /** Orders above this subtotal ship free (0 disables the perk). */
  FREE_SHIPPING_THRESHOLD: int('FREE_SHIPPING_THRESHOLD', 2500),
  /** Default pagination ceiling — protects MongoDB from unbounded queries. */
  MAX_PAGE_SIZE: int('MAX_PAGE_SIZE', 60),
  DEFAULT_PAGE_SIZE: int('DEFAULT_PAGE_SIZE', 12),
});

/**
 * Fail fast on missing production secrets instead of limping along with
 * insecure defaults.
 */
export function assertProductionConfig() {
  const problems = [];
  if (env.isProduction) {
    if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
      problems.push('JWT_SECRET must be set to a random string of at least 32 characters');
    }
    if (env.DB_DRIVER !== 'mongodb') {
      problems.push('DB_DRIVER must be "mongodb" in production (set MONGO_URI)');
    }
    if (env.ADMIN_PASSWORD === 'Admin@1234') {
      problems.push('ADMIN_PASSWORD is still the default — change it before deploying');
    }
  }
  if (problems.length) {
    throw new Error(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
  }
}

export default env;
