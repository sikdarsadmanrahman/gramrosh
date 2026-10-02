/**
 * -----------------------------------------------------------------------------
 *  admin.auth.controller.js — Admin session endpoints
 * -----------------------------------------------------------------------------
 */
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { login, getProfile, changePassword, listAdmins, createAdmin, updateAdmin } from '../services/admin.service.js';
import { PERMISSIONS } from '../models/admin.model.js';

/** POST /api/admin/auth/login */
export const loginHandler = asyncHandler(async (req, res) => {
  const result = await login({ email: req.body.email, password: req.body.password, ip: req.ip });

  return sendSuccess(res, {
    statusCode: 200,
    message: `Welcome back, ${result.admin.name}`,
    data: result,
  });
});

/** GET /api/admin/auth/me */
export const meHandler = asyncHandler(async (req, res) => {
  const admin = await getProfile(req.admin.id);

  return sendSuccess(res, {
    message: 'Current session',
    data: {
      admin,
      /**
       * The permission list resolved from the role, echoed so the SPA can gate
       * buttons without duplicating the role table in the bundle.
       */
      permissions: PERMISSIONS[admin?.role] ?? [],
    },
  });
});

/** POST /api/admin/auth/logout — stateless JWT, so this is an instruction to the client. */
export const logoutHandler = asyncHandler(async (_req, res) => sendSuccess(res, {
  message: 'Signed out — discard the access token',
  data: { loggedOut: true },
}));

/** PATCH /api/admin/auth/password */
export const changePasswordHandler = asyncHandler(async (req, res) => {
  await changePassword(req.admin.id, req.body);
  return sendSuccess(res, { message: 'Password updated', data: { updated: true } });
});

/* ------------------------------- staff CRUD ------------------------------- */

/** GET /api/admin/auth/accounts */
export const listAdminsHandler = asyncHandler(async (_req, res) => {
  const admins = await listAdmins();
  return sendSuccess(res, { message: `${admins.length} staff account(s)`, data: admins });
});

/** POST /api/admin/auth/accounts */
export const createAdminHandler = asyncHandler(async (req, res) => {
  const admin = await createAdmin(req.body);
  return sendSuccess(res, { statusCode: 201, message: `Staff account created for ${admin.email}`, data: admin });
});

/** PATCH /api/admin/auth/accounts/:id */
export const updateAdminHandler = asyncHandler(async (req, res) => {
  const admin = await updateAdmin(req.params.id, req.body);
  return sendSuccess(res, { message: 'Staff account updated', data: admin });
});
