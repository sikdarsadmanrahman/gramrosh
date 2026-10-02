/**
 * -----------------------------------------------------------------------------
 *  lib/api.js — the single HTTP layer
 * -----------------------------------------------------------------------------
 *  Every request in the app flows through these two axios instances:
 *
 *    `api`      — public storefront calls (no auth header)
 *    `adminApi` — admin calls; attaches the JWT and reacts to 401/403 by
 *                 clearing the session so the router bounces to /admin/login
 *
 *  URLs are relative (`/api/...`). In development Vite proxies them to Express;
 *  in production Express serves the SPA itself, so same-origin always holds and
 *  nothing ever points at localhost from the user's browser.
 *
 *  The server envelope is `{ success, message, data, meta? }`. The helpers
 *  below unwrap it so callers deal in domain objects, and normalise errors to
 *  `{ status, message, errors[] }` so form code can map field-level issues.
 * -----------------------------------------------------------------------------
 */
import axios from 'axios';

export const api = axios.create({ baseURL: '/api', timeout: 20000 });
export const adminApi = axios.create({ baseURL: '/api/admin', timeout: 20000 });

/* -------------------------------------------------------------------------- */
/*  Admin token wiring                                                        */
/* -------------------------------------------------------------------------- */

const TOKEN_KEY = 'gramrosh.admin.token';

export const getAdminToken = () => localStorage.getItem(TOKEN_KEY);

export function setAdminToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

adminApi.interceptors.request.use((config) => {
  const token = getAdminToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/** Called by the admin store so a dead token logs the UI out everywhere. */
let onUnauthorized = null;
export const registerUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

adminApi.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    // 401 = token expired/invalid; 403 with "deactivated" = account disabled.
    // Either way the stored session is worthless.
    if (status === 401 && onUnauthorized) onUnauthorized();
    return Promise.reject(error);
  },
);

/* -------------------------------------------------------------------------- */
/*  Envelope helpers                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Normalise any axios failure into something a form can render.
 * @returns {{status:number|null, message:string, errors:Array<{path:string,message:string}>}}
 */
export function toApiError(error) {
  const body = error.response?.data;
  return {
    status: error.response?.status ?? null,
    message: body?.message ?? (error.code === 'ECONNABORTED' ? 'The request timed out — check your connection.' : 'Something went wrong. Please try again.'),
    errors: Array.isArray(body?.errors) ? body.errors : [],
  };
}

/** GET that resolves to `data` (throws normalised errors). */
export async function fetchData(client, url, params) {
  try {
    const { data } = await client.get(url, { params });
    return data.data;
  } catch (error) {
    throw toApiError(error);
  }
}

/** GET that resolves to `{ items, pagination, meta }` for list endpoints. */
export async function fetchList(client, url, params) {
  try {
    const { data } = await client.get(url, { params });
    return {
      items: Array.isArray(data.data) ? data.data : [],
      pagination: data.meta?.pagination ?? null,
      meta: data.meta ?? {},
    };
  } catch (error) {
    throw toApiError(error);
  }
}

/** POST/PATCH/DELETE that resolves to `{ data, message }`. */
export async function send(client, method, url, body) {
  try {
    const { data } = await client.request({ method, url, data: body });
    return { data: data.data, message: data.message };
  } catch (error) {
    throw toApiError(error);
  }
}

/* -------------------------------------------------------------------------- */
/*  Public storefront endpoints                                               */
/* -------------------------------------------------------------------------- */

export const storefront = {
  config: () => fetchData(api, '/config'),
  home: () => fetchData(api, '/storefront/home'),
  settings: () => fetchData(api, '/storefront/settings'),
  facets: () => fetchData(api, '/storefront/facets'),
  certifications: () => fetchData(api, '/storefront/certifications'),
  stories: () => fetchData(api, '/storefront/stories'),
  categories: () => fetchList(api, '/categories'),
  products: (params) => fetchList(api, '/products', params),
  product: (slug) => fetchData(api, `/products/${slug}`),
  quote: (body) => send(api, 'post', '/orders/quote', body),
  placeOrder: (body) => send(api, 'post', '/orders', body),
  trackOrder: (orderNumber, phone) => fetchData(api, '/orders/lookup', { orderNumber, phone }),
  invoiceUrl: (orderNumber, phone) => `/api/orders/${encodeURIComponent(orderNumber)}/invoice?phone=${encodeURIComponent(phone)}`,
};

/* -------------------------------------------------------------------------- */
/*  Admin endpoints                                                           */
/* -------------------------------------------------------------------------- */

export const admin = {
  // auth
  login: (email, password) => send(adminApi, 'post', '/auth/login', { email, password }),
  me: () => fetchData(adminApi, '/auth/me'),
  logout: () => send(adminApi, 'post', '/auth/logout'),

  // dashboard
  overview: (params) => fetchData(adminApi, '/stats/overview', params),

  // catalogue
  products: (params) => fetchList(adminApi, '/products', params),
  product: (id) => fetchData(adminApi, `/products/${id}`),
  createProduct: (body) => send(adminApi, 'post', '/products', body),
  updateProduct: (id, body) => send(adminApi, 'patch', `/products/${id}`, body),
  updateStock: (id, body) => send(adminApi, 'patch', `/products/${id}/stock`, body),
  archiveProduct: (id, archived) => send(adminApi, 'patch', `/products/${id}/archive`, { archived }),
  duplicateProduct: (id) => send(adminApi, 'post', `/products/${id}/duplicate`),
  deleteProduct: (id) => send(adminApi, 'delete', `/products/${id}`),
  categories: () => fetchList(adminApi, '/categories'),

  // orders
  orders: (params) => fetchList(adminApi, '/orders', params),
  order: (id) => fetchData(adminApi, `/orders/${id}`),
  updateOrderStatus: (id, body) => send(adminApi, 'patch', `/orders/${id}/status`, body),
  updateOrderPayment: (id, body) => send(adminApi, 'patch', `/orders/${id}/payment`, body),
  updateOrderShipping: (id, body) => send(adminApi, 'patch', `/orders/${id}/shipping`, body),
  updateOrderNotes: (id, body) => send(adminApi, 'patch', `/orders/${id}/notes`, body),
  invoiceUrl: (id, variant = 'invoice') => `/api/admin/orders/${id}/invoice?format=html&variant=${variant}`,
  exportUrl: (params = '') => `/api/admin/orders/export?format=csv${params ? `&${params}` : ''}`,

  // customers
  customers: (params) => fetchList(adminApi, '/customers', params),
  customer: (id) => fetchData(adminApi, `/customers/${id}`),
  customerOrders: (id, params) => fetchList(adminApi, `/customers/${id}/orders`, params),

  // settings
  settings: () => fetchData(adminApi, '/settings'),
  updateSettings: (body) => send(adminApi, 'patch', '/settings', body),
  system: () => fetchData(adminApi, '/settings/system'),
};
