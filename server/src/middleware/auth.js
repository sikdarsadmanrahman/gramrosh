/**
 * -----------------------------------------------------------------------------
 *  middleware/auth.js — JWT authentication & permission checks for /api/admin
 * -----------------------------------------------------------------------------
 *  The storefront is 100% public (guest checkout, no account required). Only the
 *  admin surface is protected: a short-lived bearer token issued at login and
 *  verified on every subsequent request.
 *
 *  Tokens are stateless; `Admin.isActive` is re-checked against the database so
 *  deactivating a staff member takes effect on their next request rather than
 *  when their token expires.
 * -----------------------------------------------------------------------------
 */
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { db } from '../db/index.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { PERMISSIONS } from '../models/admin.model.js';

/**
 * Sign an access token.
 * @param {{id:string, email:string, role:string, name:string}} admin
 */
export function signToken(admin) {
  return jwt.sign(
    { sub: String(admin.id ?? admin._id), email: admin.email, role: admin.role, name: admin.name },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN, issuer: 'gramrosh-api', audience: 'gramrosh-admin' },
  );
}

/** Verify & decode a token (throws ApiError on any problem). */
export function verifyToken(token) {
  try {
    return jwt.verify(token, env.JWT_SECRET, { issuer: 'gramrosh-api', audience: 'gramrosh-admin' });
  } catch (error) {
    if (error.name === 'TokenExpiredError') throw ApiError.unauthorized('Session expired, please sign in again');
    throw ApiError.unauthorized('Invalid authentication token');
  }
}

/** Pull `Bearer <token>` out of the request (header first, then `?token=`). */
function extractToken(req) {
  const header = req.headers.authorization ?? '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  if (typeof req.query?.token === 'string' && req.query.token) return req.query.token;
  return null;
}

/**
 * Require a valid admin session. Populates `req.admin`.
 */
export const requireAdmin = asyncHandler(async (req, _res, next) => {
  const token = extractToken(req);
  if (!token) throw ApiError.unauthorized('Authentication required — no token supplied');

  const payload = verifyToken(token);
  const admin = await db.Admin.findById(payload.sub).lean();
  if (!admin) throw ApiError.unauthorized('Account no longer exists');
  if (!admin.isActive) throw ApiError.forbidden('This account has been deactivated');

  req.admin = {
    id: String(admin._id),
    name: admin.name,
    email: admin.email,
    role: admin.role,
    permissions: PERMISSIONS[admin.role] ?? [],
  };
  next();
});

/**
 * Attach `req.admin` when a token is present, but never reject the request.
 * Used by endpoints that personalise their response for staff (e.g. previews).
 */
export const optionalAdmin = asyncHandler(async (req, _res, next) => {
  const token = extractToken(req);
  if (!token) return next();
  try {
    const payload = verifyToken(token);
    const admin = await db.Admin.findById(payload.sub).lean();
    if (admin?.isActive) {
      req.admin = {
        id: String(admin._id),
        name: admin.name,
        email: admin.email,
        role: admin.role,
        permissions: PERMISSIONS[admin.role] ?? [],
      };
    }
  } catch {
    /* anonymous access continues */
  }
  next();
});

/**
 * Require a specific capability, e.g. `requirePermission('product:delete')`.
 * `super_admin` holds the wildcard `*`.
 */
export function requirePermission(permission) {
  return (req, _res, next) => {
    const admin = req.admin;
    if (!admin) return next(ApiError.unauthorized());
    if (admin.permissions.includes('*') || admin.permissions.includes(permission)) return next();
    return next(ApiError.forbidden(`Missing permission: ${permission}`));
  };
}

/** Require one of several roles. */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.admin) return next(ApiError.unauthorized());
    if (roles.includes(req.admin.role)) return next();
    return next(ApiError.forbidden(`Requires role: ${roles.join(' or ')}`));
  };
}

export default requireAdmin;
