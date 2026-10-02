/**
 * -----------------------------------------------------------------------------
 *  validators/auth.validator.js — Admin authentication
 * -----------------------------------------------------------------------------
 */
import { z } from 'zod';
import { optionalText, text, blankToUndefined } from './common.validator.js';

/** POST /api/admin/auth/login */
export const loginBody = z.object({
  email: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.string().email('Enter a valid email address').max(160),
  ),
  password: z.string().min(6, 'Password must be at least 6 characters').max(200),
  /** When true the client stores the token in localStorage instead of memory. */
  remember: z.boolean().optional().default(false),
});

/** PATCH /api/admin/auth/password */
export const changePasswordBody = z.object({
  currentPassword: z.string().min(6).max(200),
  newPassword: z
    .string()
    .min(10, 'Use at least 10 characters')
    .max(200)
    // Pragmatic complexity rule: letters + digits + one symbol.
    .regex(/[A-Za-z]/, 'Include at least one letter')
    .regex(/\d/, 'Include at least one digit')
    .regex(/[^A-Za-z0-9]/, 'Include at least one symbol'),
}).refine((v) => v.currentPassword !== v.newPassword, {
  message: 'The new password must differ from the current one',
  path: ['newPassword'],
});

/** POST /api/admin/auth (create staff account — super_admin only) */
export const createAdminBody = z.object({
  name: text(120),
  email: z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.string().email().max(160)),
  password: z.string().min(10).max(200),
  role: z.enum(['super_admin', 'admin', 'operator']).default('operator'),
  phone: optionalText(24),
  avatarUrl: optionalText(600),
});

/** PATCH /api/admin/auth/:id */
export const updateAdminBody = z.object({
  name: z.preprocess(blankToUndefined, text(120).optional()),
  role: z.enum(['super_admin', 'admin', 'operator']).optional(),
  isActive: z.boolean().optional(),
  mustChangePassword: z.boolean().optional(),
  phone: optionalText(24),
  avatarUrl: optionalText(600),
  password: z.preprocess(blankToUndefined, z.string().min(10).max(200).optional()),
});
