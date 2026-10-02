/**
 * -----------------------------------------------------------------------------
 *  admin.model.js — Back-office users (JWT auth)
 * -----------------------------------------------------------------------------
 *  Deliberately separate from `Customer`: staff credentials must never live in
 *  the same collection as shopper records, and role/permission checks are a
 *  different concern entirely.
 *
 *  Password hashing lives in the service layer (not a schema hook) so the exact
 *  same code path runs regardless of which storage driver is active.
 * -----------------------------------------------------------------------------
 */
import mongoose from 'mongoose';

const { Schema } = mongoose;

export const ADMIN_ROLES = Object.freeze(['super_admin', 'admin', 'operator']);

/** Coarse capability list checked by `requirePermission`. */
export const PERMISSIONS = Object.freeze({
  super_admin: ['*'],
  admin: [
    'product:read', 'product:write', 'product:delete',
    'order:read', 'order:write',
    'customer:read', 'customer:write',
    'catalogue:write', 'report:read',
  ],
  operator: ['product:read', 'order:read', 'order:write', 'customer:read', 'report:read'],
});

const adminSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 160 },
    /** bcrypt hash — never returned to the client (`select: false`). */
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ADMIN_ROLES, default: 'operator' },
    avatarUrl: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    isActive: { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: false },
    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, trim: true, default: '' },
    failedLoginAttempts: { type: Number, min: 0, default: 0 },
    lockedUntil: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      // Belt & braces: strip the hash even if `select: false` is bypassed.
      transform: (_doc, ret) => {
        delete ret.passwordHash;
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: true },
  },
);

// `email` already carries `unique: true` inline — its unique index is created
// there, so it is not re-declared below.
adminSchema.index({ isActive: 1, role: 1 });
adminSchema.index({ createdAt: -1 });

adminSchema.virtual('permissions').get(function permissions() {
  return PERMISSIONS[this.role] ?? [];
});

export const Admin = mongoose.models.Admin || mongoose.model('Admin', adminSchema);
export default Admin;
