/**
 * -----------------------------------------------------------------------------
 *  admin.service.js — Back-office authentication & staff management
 * -----------------------------------------------------------------------------
 *  Passwords are bcrypt-hashed here (never in a schema hook) so the identical
 *  code runs on every storage driver. Login is hardened with:
 *    • per-account lockout after repeated failures (`lockedUntil`),
 *    • a constant-time comparison,
 *    • no user-enumeration (the same message for unknown email and bad password).
 * -----------------------------------------------------------------------------
 */
import bcrypt from 'bcryptjs';
import { db } from '../db/index.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { signToken } from '../middleware/auth.js';
import { PERMISSIONS } from '../models/admin.model.js';

const MAX_FAILED_ATTEMPTS = 8;
const LOCK_MINUTES = 15;

/** Hash a plaintext password with the configured work factor. */
export async function hashPassword(plain) {
  return bcrypt.hash(String(plain), env.BCRYPT_ROUNDS);
}

/** Constant-time password check. */
export async function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compare(String(plain), String(hash));
}

/** Shape the admin object returned to the client (never includes the hash). */
function toPublicAdmin(admin) {
  const { passwordHash, ...safe } = admin;
  return { ...safe, id: String(admin._id), permissions: PERMISSIONS[admin.role] ?? [] };
}

/**
 * Authenticate a staff member.
 *
 * @returns {Promise<{token:string, admin:object, expiresAt:string}>}
 */
export async function login({ email, password, ip = '' }) {
  const normalizedEmail = String(email).trim().toLowerCase();

  // `+passwordHash` opts the field back in — it is `select: false` on the schema
  // so no other query can ever leak it by accident.
  const admin = await db.Admin.findOne({ email: normalizedEmail }).select('+passwordHash').lean();

  if (!admin) {
    // Deliberately indistinguishable from a wrong password.
    await burnTime();
    throw ApiError.unauthorized('Incorrect email or password');
  }

  if (admin.lockedUntil && new Date(admin.lockedUntil) > new Date()) {
    const minutes = Math.ceil((new Date(admin.lockedUntil).getTime() - Date.now()) / 60_000);
    throw ApiError.forbidden(`Account temporarily locked after too many failed attempts — try again in ${minutes} minute(s)`);
  }

  const ok = await verifyPassword(password, admin.passwordHash);
  if (!ok) {
    const attempts = (admin.failedLoginAttempts ?? 0) + 1;
    const set = { failedLoginAttempts: attempts };
    if (attempts >= MAX_FAILED_ATTEMPTS) {
      set.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
      set.failedLoginAttempts = 0;
      logger.warn('[auth] admin account locked', { email: normalizedEmail, ip });
    }
    await db.Admin.updateOne({ _id: admin._id }, { $set: set });
    throw ApiError.unauthorized('Incorrect email or password');
  }

  if (!admin.isActive) throw ApiError.forbidden('This account has been deactivated');

  await db.Admin.updateOne(
    { _id: admin._id },
    { $set: { lastLoginAt: new Date(), lastLoginIp: ip, failedLoginAttempts: 0, lockedUntil: null } },
  );

  const token = signToken({ id: String(admin._id), email: admin.email, role: admin.role, name: admin.name });
  logger.info('[auth] admin signed in', { email: admin.email, role: admin.role });

  return {
    token,
    admin: toPublicAdmin(admin),
    expiresAt: new Date(Date.now() + parseExpiry(env.JWT_EXPIRES_IN)).toISOString(),
    mustChangePassword: Boolean(admin.mustChangePassword),
  };
}

/** Turn `7d` / `12h` / `30m` into milliseconds. */
function parseExpiry(value) {
  const match = /^(\d+)([smhd])$/.exec(String(value));
  if (!match) return 7 * 86_400_000;
  const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]];
  return Number(match[1]) * unit;
}

/** Cached dummy hash, built once, used to equalise login response times. */
let DUMMY_HASH = null;

/**
 * Roughly equalise the response time for "no such user" and "wrong password"
 * so a timing attack cannot enumerate staff emails.
 */
async function burnTime() {
  try {
    if (!DUMMY_HASH) DUMMY_HASH = await bcrypt.hash('timing-equaliser', env.BCRYPT_ROUNDS);
    await bcrypt.compare('timing-equaliser', DUMMY_HASH);
  } catch {
    /* never fail a login because of the timing equaliser */
  }
}

/** Current profile for `GET /api/admin/auth/me`. */
export async function getProfile(id) {
  const admin = await db.Admin.findById(id).lean();
  if (!admin) throw ApiError.notFound('Account not found');
  return toPublicAdmin(admin);
}

/** Self-service password change. */
export async function changePassword(id, { currentPassword, newPassword }) {
  const admin = await db.Admin.findById(id).select('+passwordHash').lean();
  if (!admin) throw ApiError.notFound('Account not found');

  const ok = await verifyPassword(currentPassword, admin.passwordHash);
  if (!ok) throw ApiError.unauthorized('Your current password is incorrect');

  await db.Admin.updateOne(
    { _id: id },
    { $set: { passwordHash: await hashPassword(newPassword), mustChangePassword: false } },
  );
  logger.info('[auth] password changed', { email: admin.email });
  return { updated: true };
}

/** List staff accounts. */
export async function listAdmins() {
  const admins = await db.Admin.find({}).sort({ createdAt: 1 }).lean();
  return admins.map(toPublicAdmin);
}

/** Create a staff account (super_admin only — enforced in the route). */
export async function createAdmin(payload) {
  const email = String(payload.email).trim().toLowerCase();
  const clash = await db.Admin.exists({ email });
  if (clash) throw ApiError.conflict('An account with that email already exists');

  const created = await db.Admin.create({
    ...payload,
    email,
    passwordHash: await hashPassword(payload.password),
    mustChangePassword: true,
  });
  logger.info('[auth] staff account created', { email, role: payload.role });
  return toPublicAdmin(created.toObject ? created.toObject() : created);
}

/** Update a staff account; may also rotate their password. */
export async function updateAdmin(id, payload) {
  const existing = await db.Admin.findById(id).lean();
  if (!existing) throw ApiError.notFound('Account not found');

  const update = { ...payload };
  delete update.password;
  if (payload.password) update.passwordHash = await hashPassword(payload.password);
  if (update.email) update.email = String(update.email).trim().toLowerCase();

  // Never let the last super_admin be demoted or deactivated — that would lock
  // everybody out of the panel permanently.
  const demoting = Boolean(update.role) && update.role !== 'super_admin';
  const deactivating = update.isActive === false;
  if (existing.role === 'super_admin' && (demoting || deactivating)) {
    const remaining = await db.Admin.countDocuments({
      role: 'super_admin',
      isActive: true,
      _id: { $ne: existing._id },
    });
    if (remaining === 0) {
      throw ApiError.conflict('At least one active super admin must remain — promote another account first');
    }
  }

  const updated = await db.Admin.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
  return toPublicAdmin(updated);
}

/**
 * Ensure at least one admin exists.
 *
 * Runs on boot and from the seed script using ADMIN_EMAIL / ADMIN_PASSWORD, so a
 * fresh deployment is never unreachable.
 */
export async function ensureBootstrapAdmin() {
  const email = env.ADMIN_EMAIL.toLowerCase();
  const existing = await db.Admin.findOne({ email }).lean();
  if (existing) return { created: false, email };

  const created = await db.Admin.create({
    name: env.ADMIN_NAME,
    email,
    passwordHash: await hashPassword(env.ADMIN_PASSWORD),
    role: 'super_admin',
    isActive: true,
    mustChangePassword: env.isProduction,
  });
  logger.warn('[auth] bootstrap admin created', { email, note: env.isProduction ? 'change this password immediately' : 'dev credentials' });
  return { created: true, email, id: String(created._id) };
}
