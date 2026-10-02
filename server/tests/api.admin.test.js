/**
 * -----------------------------------------------------------------------------
 *  tests/api.admin.test.js — back office: auth, RBAC, CRUD, pipeline
 * -----------------------------------------------------------------------------
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { getAgent, getAdminToken } from './setup.js';

let agent;
let token;
const auth = (req) => req.set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  agent = await getAgent();
  token = await getAdminToken(agent);
}, 30_000);

describe('authentication', () => {
  it('rejects bad credentials and anonymous access', async () => {
    // A well-formed but wrong password (a too-short one would be a 422 from
    // validation before credentials are even checked).
    const bad = await agent.post('/api/admin/auth/login').send({ email: 'admin@gramrosh.test', password: 'Wrong@12345' });
    expect(bad.status).toBe(401);

    const anon = await agent.get('/api/admin/orders');
    expect(anon.status).toBe(401);
  });

  it('/me returns the profile and permission list', async () => {
    const res = await auth(agent.get('/api/admin/auth/me'));
    expect(res.status).toBe(200);
    expect(res.body.data.admin.role).toBe('super_admin');
    expect(res.body.data.permissions).toContain('*');
  });
});

describe('product CRUD', () => {
  let categoryId;
  let created;

  beforeAll(async () => {
    const categories = await auth(agent.get('/api/admin/categories'));
    categoryId = categories.body.data.find((c) => c.slug === 'honey')._id;
  });

  it('creates → stocks → archives → deletes a product', async () => {
    // create
    const create = await auth(agent.post('/api/admin/products')).send({
      title: 'Vitest Test Honey',
      category: categoryId,
      summary: 'Created by the test suite',
      variants: [
        { label: '250 g', weightValue: 250, weightUnit: 'g', price: 400, stock: 10, isDefault: true },
        { label: '1 kg', weightValue: 1, weightUnit: 'kg', price: 1400, stock: 4 },
      ],
    });
    expect(create.status).toBe(201);
    created = create.body.data;
    expect(created.slug).toBe('vitest-test-honey');
    expect(created.totalStock).toBe(14);
    expect(created.searchBlob).toBeUndefined();
    expect(created.variants.every((v) => v._id && v.sku)).toBe(true);

    // stock update — response keeps variant _ids so open carts stay valid
    const stock = await auth(agent.patch(`/api/admin/products/${created._id}/stock`)).send({
      variants: [{ variantId: created.variants[0]._id, stock: 0 }],
    });
    expect(stock.status).toBe(200);
    expect(stock.body.data.totalStock).toBe(4);
    expect(String(stock.body.data.product.variants[0]._id)).toBe(String(created.variants[0]._id));

    // archive hides it from the storefront but keeps it queryable for admin
    const archive = await auth(agent.patch(`/api/admin/products/${created._id}/archive`)).send({ archived: true });
    expect(archive.status).toBe(200);
    const publicView = await agent.get(`/api/products/${created.slug}`);
    expect(publicView.status).toBe(404);

    // delete succeeds because no order references it
    const del = await auth(agent.delete(`/api/admin/products/${created._id}`));
    expect(del.status).toBe(200);
  });

  it('gives duplicate titles unique slugs and SKU families', async () => {
    const make = () => auth(agent.post('/api/admin/products')).send({
      title: 'Vitest Clash Honey',
      category: categoryId,
      variants: [{ label: '1 kg', weightValue: 1, weightUnit: 'kg', price: 900, stock: 1, isDefault: true }],
    });
    const first = await make();
    const second = await make();
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.slug).not.toBe(first.body.data.slug);
    expect(second.body.data.variants[0].sku).not.toBe(first.body.data.variants[0].sku);
    await auth(agent.delete(`/api/admin/products/${first.body.data._id}`));
    await auth(agent.delete(`/api/admin/products/${second.body.data._id}`));
  });
});

describe('order pipeline', () => {
  it('only allows the declared transitions', async () => {
    const orders = await auth(agent.get('/api/admin/orders?status=Pending&limit=1'));
    const order = orders.body.data[0];
    expect(order).toBeTruthy();

    // Pending → Shipped skips Processing and must be refused.
    const illegal = await auth(agent.patch(`/api/admin/orders/${order._id}/status`)).send({ status: 'Shipped' });
    expect([409, 422]).toContain(illegal.status);

    // Pending → Processing is legal.
    const legal = await auth(agent.patch(`/api/admin/orders/${order._id}/status`)).send({ status: 'Processing' });
    expect(legal.status).toBe(200);
    expect(legal.body.data.status).toBe('Processing');
    expect(legal.body.data.statusHistory.at(-1).status).toBe('Processing');
  });

  it('lists orders with statusCounts for the pipeline tabs', async () => {
    const res = await auth(agent.get('/api/admin/orders?limit=1'));
    expect(res.status).toBe(200);
    const counts = res.body.meta.statusCounts;
    for (const status of ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled']) {
      expect(counts, status).toHaveProperty(status);
    }
  });

  it('exports CSV with a BOM and the export headers', async () => {
    const res = await auth(agent.get('/api/admin/orders/export?format=csv'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/csv/);
    expect(res.headers['x-export-total']).toBeTruthy();
    expect(res.text.replace(/^\uFEFF/, '').split('\r\n')[0]).toContain('Order Number');
  });
});

describe('dashboard & customers', () => {
  it('overview returns the KPI block in one call', async () => {
    const res = await auth(agent.get('/api/admin/stats/overview'));
    expect(res.status).toBe(200);
    const { kpis } = res.body.data;
    expect(kpis.revenue).toHaveProperty('lifetime');
    expect(kpis.averageOrderValue).toHaveProperty('lifetime');
    // AOV must agree with revenue ÷ orders.
    expect(kpis.averageOrderValue.lifetime)
      .toBeCloseTo(kpis.revenue.lifetime / kpis.orders.lifetime, 1);
  });

  it('customer profile carries lifetime stats + paginated history', async () => {
    const list = await auth(agent.get('/api/admin/customers?limit=1&segment=vip'));
    const customer = list.body.data[0];
    expect(customer).toBeTruthy();

    const profile = await auth(agent.get(`/api/admin/customers/${customer._id}`));
    expect(profile.status).toBe(200);
    const { customer: full, orders, orderTotal } = profile.body.data;
    expect(full.stats.totalOrders).toBeGreaterThan(0);
    expect(full.stats.avgOrderValue).toBeCloseTo(full.stats.totalSpent / full.stats.totalOrders, 1);
    expect(Array.isArray(orders)).toBe(true);
    expect(orderTotal).toBeGreaterThanOrEqual(orders.length);
  });
});
