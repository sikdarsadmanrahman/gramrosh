/**
 * -----------------------------------------------------------------------------
 *  tests/api.checkout.test.js — quote, checkout, tracking, invoice
 * -----------------------------------------------------------------------------
 *  The money-critical path: server-side pricing, the ৳60/৳120 shipping
 *  calculator, mobile-banking proof, stock reservation and release.
 * -----------------------------------------------------------------------------
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { getAgent, getAdminToken } from './setup.js';

let agent;
let token;
/** A plain in-stock product used across the suite. */
let product;
let variant;

beforeAll(async () => {
  agent = await getAgent();
  token = await getAdminToken(agent);
  const list = await agent.get('/api/products?limit=24&inStock=true');
  product = list.body.data.find((p) => !p.isCombo && p.totalStock > 5);
  variant = product.variants.find((v) => v.stock > 5);
}, 30_000);

const checkoutBody = (overrides = {}) => ({
  customer: { name: 'Vitest Buyer', phone: '01712345678' },
  shippingAddress: { line1: 'House 1, Road 1', district: 'Dhaka' },
  items: [{ productId: product._id, variantId: variant._id, quantity: 1 }],
  payment: { method: 'cod' },
  ...overrides,
});

describe('POST /api/orders/quote — the shipping calculator', () => {
  it('charges ৳60 inside Dhaka and ৳120 outside', async () => {
    const inside = await agent.post('/api/orders/quote').send({
      items: [{ productId: product._id, variantId: variant._id, quantity: 1 }],
      district: 'Dhaka',
    });
    expect(inside.status).toBe(200);
    const insideShipping = inside.body.data.shipping;
    expect(insideShipping.zone).toBe('inside_dhaka');
    expect(insideShipping.isFree ? insideShipping.standardFee : insideShipping.fee).toBe(60);

    const outside = await agent.post('/api/orders/quote').send({
      items: [{ productId: product._id, variantId: variant._id, quantity: 1 }],
      district: 'Khulna',
    });
    const outsideShipping = outside.body.data.shipping;
    expect(outsideShipping.zone).toBe('outside_dhaka');
    expect(outsideShipping.isFree ? outsideShipping.standardFee : outsideShipping.fee).toBe(120);
  });

  it('rejects an empty basket with a 422', async () => {
    const res = await agent.post('/api/orders/quote').send({ items: [] });
    expect(res.status).toBe(422);
  });
});

describe('POST /api/orders — server-side money', () => {
  it('ignores client-supplied prices entirely', async () => {
    const res = await agent.post('/api/orders').send(checkoutBody({
      // A hostile client claims everything costs 1 taka.
      pricing: { subtotal: 1, grandTotal: 1 },
      items: [{ productId: product._id, variantId: variant._id, quantity: 1, unitPrice: 1 }],
    }));
    expect(res.status).toBe(201);
    const { order } = res.body.data;
    const expected = variant.salePrice ?? variant.price;
    expect(order.items[0].unitPrice).toBe(expected);
    expect(order.pricing.grandTotal).toBeGreaterThanOrEqual(expected);
    expect(order.status).toBe('Pending');
  });

  it('requires senderPhone + TrxID for bKash and stores them', async () => {
    const missing = await agent.post('/api/orders').send(checkoutBody({ payment: { method: 'bkash' } }));
    expect(missing.status).toBe(422);
    const paths = missing.body.errors.map((e) => e.path);
    expect(paths).toContain('payment.senderPhone');
    expect(paths).toContain('payment.transactionId');

    const trx = `VITEST${Date.now().toString(36).toUpperCase()}`;
    const ok = await agent.post('/api/orders').send(checkoutBody({
      customer: { name: 'Vitest bKash', phone: '01712345679' },
      payment: { method: 'bkash', senderPhone: '01712345679', transactionId: trx.toLowerCase() },
    }));
    expect(ok.status).toBe(201);
    expect(ok.body.data.order.payment.transactionId).toBe(trx); // trimmed + upper-cased
    expect(ok.body.data.order.payment.status).toBe('Pending Verification');

    // The same confirmation SMS cannot pay for a second order.
    const dupe = await agent.post('/api/orders').send(checkoutBody({
      customer: { name: 'Vitest Dupe', phone: '01712345680' },
      payment: { method: 'bkash', senderPhone: '01712345680', transactionId: trx },
    }));
    expect(dupe.status).toBe(409);
  });

  it('reserves stock on checkout and releases it on cancellation', async () => {
    const before = (await agent.get(`/api/products/${product.slug}`)).body.data
      .variants.find((v) => v._id === variant._id).stock;

    const placed = await agent.post('/api/orders').send(checkoutBody({
      customer: { name: 'Vitest Stock', phone: '01712345681' },
      items: [{ productId: product._id, variantId: variant._id, quantity: 2 }],
    }));
    expect(placed.status).toBe(201);

    const during = (await agent.get(`/api/products/${product.slug}`)).body.data
      .variants.find((v) => v._id === variant._id).stock;
    expect(during).toBe(before - 2);

    const cancelled = await agent
      .patch(`/api/admin/orders/${placed.body.data.order._id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'Cancelled', reason: 'vitest cleanup' });
    expect(cancelled.status).toBe(200);

    const after = (await agent.get(`/api/products/${product.slug}`)).body.data
      .variants.find((v) => v._id === variant._id).stock;
    expect(after).toBe(before);
  });

  it('refuses to oversell', async () => {
    const res = await agent.post('/api/orders').send(checkoutBody({
      customer: { name: 'Vitest Greedy', phone: '01712345682' },
      items: [{ productId: product._id, variantId: variant._id, quantity: Math.min(variant.stock + 10, 99) }],
    }));
    expect(res.status).toBe(409);
  });
});

describe('public tracking & invoice', () => {
  let orderNumber;
  const phone = '01712345683';

  beforeAll(async () => {
    const placed = await agent.post('/api/orders').send(checkoutBody({
      customer: { name: 'Vitest Tracker', phone },
    }));
    orderNumber = placed.body.data.order.orderNumber;
  });

  it('is gated by orderNumber + the checkout phone', async () => {
    const ok = await agent.get(`/api/orders/lookup?orderNumber=${orderNumber}&phone=${phone}`);
    expect(ok.status).toBe(200);

    const wrongPhone = await agent.get(`/api/orders/lookup?orderNumber=${orderNumber}&phone=01700000000`);
    expect(wrongPhone.status).toBeGreaterThanOrEqual(400);
  });

  it('serves a printable HTML invoice with the same gate', async () => {
    const res = await agent.get(`/api/orders/${orderNumber}/invoice?phone=${phone}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('<html');
    expect(res.text).toContain(orderNumber);
    expect(res.text).toContain('@media print');

    const blocked = await agent.get(`/api/orders/${orderNumber}/invoice`);
    expect(blocked.status).toBeGreaterThanOrEqual(400);
  });
});
