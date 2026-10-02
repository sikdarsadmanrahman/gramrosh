/**
 * -----------------------------------------------------------------------------
 *  stores/adminStore.js — admin session (Zustand)
 * -----------------------------------------------------------------------------
 *  Holds the JWT (mirrored to localStorage via lib/api) plus the admin profile
 *  and permission list from `/admin/auth/me`. A 401 anywhere in the admin API
 *  clears the session, which the router observes to bounce to /admin/login.
 * -----------------------------------------------------------------------------
 */
import { create } from 'zustand';
import { admin, getAdminToken, setAdminToken, registerUnauthorizedHandler } from '../lib/api';

export const useAdminStore = create((set, get) => ({
  token: getAdminToken(),
  admin: null,
  permissions: [],
  /** idle | checking | authed | anonymous */
  status: getAdminToken() ? 'idle' : 'anonymous',

  async login(email, password) {
    const { data } = await admin.login(email, password); // throws normalised ApiError
    setAdminToken(data.token);
    set({ token: data.token, admin: data.admin, permissions: [], status: 'authed' });
    // Fill permissions in the background; RBAC is enforced server-side anyway.
    get().refresh().catch(() => {});
    return data;
  },

  /** Validate a stored token on app boot / hard refresh. */
  async refresh() {
    if (!get().token) {
      set({ status: 'anonymous' });
      return;
    }
    set({ status: 'checking' });
    try {
      const data = await admin.me();
      set({ admin: data.admin, permissions: data.permissions ?? [], status: 'authed' });
    } catch {
      get().logout();
    }
  },

  logout() {
    admin.logout().catch(() => {}); // best-effort server-side audit entry
    setAdminToken(null);
    set({ token: null, admin: null, permissions: [], status: 'anonymous' });
  },

  /** `can('product:write')` — super_admin's `*` wildcard matches everything. */
  can(permission) {
    const { permissions } = get();
    return permissions.includes('*') || permissions.includes(permission);
  },
}));

// A dead token anywhere in the admin API logs the whole UI out.
registerUnauthorizedHandler(() => {
  const { status, logout } = useAdminStore.getState();
  if (status === 'authed' || status === 'checking') logout();
});
