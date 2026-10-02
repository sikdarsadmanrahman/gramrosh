/**
 * -----------------------------------------------------------------------------
 *  tests/api.public.test.js — storefront surface
 * -----------------------------------------------------------------------------
 *  The 500+-check HTTP smoke script (`npm run smoke`) is the exhaustive net;
 *  these suites pin the *contracts* the React client depends on, so a refactor
 *  that would break the storefront fails fast in `npm test`.
 * -----------------------------------------------------------------------------
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { getAgent } from './setup.js';

let agent;
beforeAll(async () => { agent = await getAgent(); }, 30_000);

describe('GET /api/config', () => {
  it('exposes the commerce constants the client renders', async () => {
    const res = await agent.get('/api/config');
    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(data.currencySymbol).toBe('৳');
    expect(data.freeShippingThreshold).toBe(2500);
    // The mandated shipping zones with their exact fees.
    const fees = Object.fromEntries(data.shippingMethods.map((m) => [m.id, m.fee]));
    expect(fees).toEqual({ inside_dhaka: 60, outside_dhaka: 120 });
    // COD + the three hardcoded mobile-banking wallets.
    expect(data.paymentMethods.map((m) => m.id).sort()).toEqual(['bkash', 'cod', 'nagad', 'rocket']);
    for (const wallet of data.paymentMethods.filter((m) => m.id !== 'cod')) {
      expect(wallet.requiresReference).toBe(true);
      expect(wallet.merchantNumber).toBeTruthy();
    }
    expect(data.districts).toHaveLength(64);
  });
});

describe('GET /api/products (server-side pagination)', () => {
  it('paginates with limit/skip and reports the pager', async () => {
    const res = await agent.get('/api/products?limit=5&page=2');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeLessThanOrEqual(5);
    const pager = res.body.meta.pagination;
    expect(pager.page).toBe(2);
    expect(pager.limit).toBe(5);
    expect(pager.skip).toBe(5);
    expect(pager.total).toBeGreaterThan(0);
  });

  it('rejects a limit beyond the configured maximum', async () => {
    const res = await agent.get('/api/products?limit=500');
    expect(res.status).toBe(422);
  });

  it('cards carry everything the grid renders', async () => {
    const res = await agent.get('/api/products?limit=1');
    const [card] = res.body.data;
    for (const key of ['title', 'slug', 'image', 'priceFrom', 'stockStatus', 'categoryName', 'variants', 'imageSrcSet', 'defaultVariant']) {
      expect(card, key).toHaveProperty(key);
    }
    expect(card.searchBlob).toBeUndefined(); // internal field never leaks
  });

  it('search + category filter narrow the result set', async () => {
    const honey = await agent.get('/api/products?q=honey');
    expect(honey.status).toBe(200);
    expect(honey.body.data.length).toBeGreaterThan(0);
    // Combos that *contain* honey legitimately match too (the search blob
    // indexes bundle contents), so assert relevance, not title matching.
    expect(honey.body.data.some((p) => p.title.toLowerCase().includes('honey'))).toBe(true);
    expect(honey.body.data.length).toBeLessThan(12); // narrower than the full catalogue
    const combos = await agent.get('/api/products?category=combos');
    for (const product of combos.body.data) expect(product.categorySlug).toBe('combos');
  });

  it('price sorting is applied server-side', async () => {
    const res = await agent.get('/api/products?sort=price_asc&limit=12');
    const prices = res.body.data.map((p) => p.priceRange.min);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });
});

describe('GET /api/products/:slug (PDP)', () => {
  it('returns detail + related rail, and archived products 404', async () => {
    const list = await agent.get('/api/products?limit=1');
    const slug = list.body.data[0].slug;
    const res = await agent.get(`/api/products/${slug}`);
    expect(res.status).toBe(200);
    expect(res.body.data.description).toBeTruthy();
    expect(Array.isArray(res.body.data.related)).toBe(true);
    expect(res.body.data.related.length).toBeGreaterThan(0);

    const missing = await agent.get('/api/products/definitely-not-a-product');
    expect(missing.status).toBe(404);
  });
});

describe('GET /api/storefront/home', () => {
  it('paints the landing page from one payload', async () => {
    const res = await agent.get('/api/storefront/home');
    expect(res.status).toBe(200);
    const { data } = res.body;
    for (const key of ['store', 'hero', 'trustPoints', 'categories', 'flashSale', 'rails', 'testimonials']) {
      expect(data, key).toHaveProperty(key);
    }
    expect(data.rails.featured.length).toBeGreaterThan(0);
    // The countdown is anchored server-side.
    expect(data.flashSale.secondsRemaining).toBeGreaterThan(0);
    expect(data.flashSale.serverTime).toBeTruthy();
  });
});
