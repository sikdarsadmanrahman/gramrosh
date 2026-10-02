/**
 * -----------------------------------------------------------------------------
 *  stats.service.js — Admin dashboard & reporting aggregations
 * -----------------------------------------------------------------------------
 *  All reporting reads run against **denormalised order snapshots**
 *  (`pricing.grandTotal`, `items.*`, `shippingAddress.district`), so none of them
 *  needs a `$lookup`. That keeps every report a single indexed aggregation and
 *  means the numbers stay correct even after a product is renamed or archived.
 * -----------------------------------------------------------------------------
 */
import { db } from '../db/index.js';
import { ORDER_STATUS, ORDER_STATUS_LIST, PAYMENT_STATUS, REVENUE_STATUSES, STOCK_STATUS } from '../config/constants.js';
import { recentOrders } from './order.service.js';

/** Start of today, UTC. */
function startOfToday() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Resolve a reporting window.
 * `from`/`to` win; otherwise `days` (default 30) ending now.
 */
export function resolveDateRange({ from, to, days = 30 } = {}) {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - days * 86_400_000);
  const span = Math.max(1, end.getTime() - start.getTime());
  return {
    start,
    end,
    days,
    /** The equally-sized window immediately before, for trend deltas. */
    previousStart: new Date(start.getTime() - span),
    previousEnd: start,
  };
}

/** Sum `pricing.grandTotal` over revenue-eligible orders in a window. */
async function revenueBetween(start, end, extraFilter = {}) {
  const rows = await db.Order.aggregate([
    { $match: { status: { $in: [...REVENUE_STATUSES] }, createdAt: { $gte: start, $lte: end }, ...extraFilter } },
    { $group: { _id: null, revenue: { $sum: '$pricing.grandTotal' }, orders: { $sum: 1 }, units: { $sum: '$totals.itemCount' } } },
  ]);
  const row = rows[0] ?? { revenue: 0, orders: 0, units: 0 };
  return { revenue: Number(row.revenue ?? 0), orders: Number(row.orders ?? 0), units: Number(row.units ?? 0) };
}

/** Revenue ÷ billable orders for one window, guarded against division by zero. */
function averageOf({ revenue, orders }) {
  return orders ? Number((revenue / orders).toFixed(2)) : 0;
}

/** Percentage change, guarded against division by zero. */
function delta(current, previous) {
  if (!previous) return current > 0 ? 100 : 0;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

/**
 * Everything the dashboard's first paint needs — resolved in parallel so the
 * screen loads in one round trip instead of a dozen.
 */
export async function getDashboardOverview(params = {}) {
  const range = resolveDateRange(params);
  const today = startOfToday();

  const [
    todayStats,
    periodStats,
    previousStats,
    lifetimeStats,
    statusRows,
    pendingVerification,
    unpaidCod,
    stockRows,
    productCounts,
    categoryCount,
    customerTotal,
    newCustomers,
    topProducts,
    latestOrders,
  ] = await Promise.all([
    revenueBetween(today, new Date()),
    revenueBetween(range.start, range.end),
    revenueBetween(range.previousStart, range.previousEnd),
    revenueBetween(new Date(0), new Date()),
    db.Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, revenue: { $sum: '$pricing.grandTotal' } } }]),
    db.Order.countDocuments({ 'payment.status': PAYMENT_STATUS.PENDING_VERIFICATION }),
    db.Order.countDocuments({ 'payment.status': PAYMENT_STATUS.COD_DUE, status: { $nin: [ORDER_STATUS.CANCELLED] } }),
    db.Product.aggregate([
      { $match: { status: 'active', isArchived: false } },
      { $group: { _id: '$stockStatus', count: { $sum: 1 } } },
    ]),
    db.Product.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    db.Category.countDocuments({ isActive: true }),
    db.Customer.countDocuments({}),
    db.Customer.countDocuments({ createdAt: { $gte: range.start, $lte: range.end } }),
    getTopProducts({ ...params, limit: 6 }),
    recentOrders(8),
  ]);

  const statusCounts = Object.fromEntries(ORDER_STATUS_LIST.map((s) => [s, 0]));
  for (const row of statusRows) {
    if (row._id && row._id in statusCounts) statusCounts[row._id] = row.count;
  }

  const stockByStatus = Object.fromEntries(stockRows.map((row) => [row._id, row.count]));
  const productsByStatus = Object.fromEntries(productCounts.map((row) => [row._id, row.count]));

  return {
    range: { from: range.start, to: range.end, days: params.days ?? 30 },
    kpis: {
      revenue: {
        today: todayStats.revenue,
        period: periodStats.revenue,
        lifetime: lifetimeStats.revenue,
        change: delta(periodStats.revenue, previousStats.revenue),
      },
      orders: {
        today: todayStats.orders,
        period: periodStats.orders,
        lifetime: lifetimeStats.orders,
        change: delta(periodStats.orders, previousStats.orders),
      },
      units: { period: periodStats.units, change: delta(periodStats.units, previousStats.units) },
      /**
       * Average order value, split the same way as revenue/orders so the three
       * tiles always agree: `revenue.lifetime / orders.lifetime ===
       * averageOrderValue.lifetime`. A bare scalar here would leave the dashboard
       * guessing which window it was looking at.
       */
      averageOrderValue: {
        today: averageOf(todayStats),
        period: averageOf(periodStats),
        lifetime: averageOf(lifetimeStats),
      },
      customers: { total: customerTotal, newInPeriod: newCustomers },
    },
    /** What needs a human's attention right now. */
    attention: {
      pendingOrders: statusCounts[ORDER_STATUS.PENDING] ?? 0,
      processingOrders: statusCounts[ORDER_STATUS.PROCESSING] ?? 0,
      paymentsToVerify: pendingVerification,
      cashToCollect: unpaidCod,
      outOfStockProducts: stockByStatus[STOCK_STATUS.OUT_OF_STOCK] ?? 0,
      lowStockProducts: stockByStatus[STOCK_STATUS.LOW_STOCK] ?? 0,
    },
    ordersByStatus: statusCounts,
    catalogue: {
      total: productCounts.reduce((sum, row) => sum + row.count, 0),
      active: productsByStatus.active ?? 0,
      draft: productsByStatus.draft ?? 0,
      archived: productsByStatus.archived ?? 0,
      categories: categoryCount,
    },
    topProducts,
    recentOrders: latestOrders,
  };
}

/** Best sellers by units, over the reporting window. */
export async function getTopProducts({ from, to, days = 30, limit = 10 } = {}) {
  const range = resolveDateRange({ from, to, days });
  const rows = await db.Order.aggregate([
    { $match: { status: { $in: [...REVENUE_STATUSES] }, createdAt: { $gte: range.start, $lte: range.end } } },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.product',
        title: { $first: '$items.title' },
        variantLabel: { $first: '$items.variantLabel' },
        image: { $first: '$items.image' },
        categoryName: { $first: '$items.categoryName' },
        units: { $sum: '$items.quantity' },
        revenue: { $sum: '$items.total' },
        orders: { $sum: 1 },
      },
    },
    { $sort: { units: -1 } },
    { $limit: Math.min(Math.max(1, limit), 50) },
  ]);
  return rows.map((row) => ({ productId: row._id, ...row, _id: undefined }));
}

/** Revenue & order count bucketed by day/week/month, zero-filled. */
export async function getRevenueSeries({ from, to, days = 30, groupBy = 'day' } = {}) {
  const range = resolveDateRange({ from, to, days });
  const format = groupBy === 'month' ? '%Y-%m' : groupBy === 'week' ? '%Y-%m-%d' : '%Y-%m-%d';

  const rows = await db.Order.aggregate([
    { $match: { status: { $in: [...REVENUE_STATUSES] }, createdAt: { $gte: range.start, $lte: range.end } } },
    { $group: { _id: { $dateToString: { format, date: '$createdAt' } }, revenue: { $sum: '$pricing.grandTotal' }, orders: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  const byKey = new Map(rows.map((row) => [row._id, row]));
  const series = [];

  if (groupBy === 'month') {
    const cursor = new Date(Date.UTC(range.start.getUTCFullYear(), range.start.getUTCMonth(), 1));
    const last = new Date(Date.UTC(range.end.getUTCFullYear(), range.end.getUTCMonth(), 1));
    while (cursor <= last) {
      const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
      const row = byKey.get(key);
      series.push({ bucket: key, label: cursor.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }), revenue: row?.revenue ?? 0, orders: row?.orders ?? 0 });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  } else {
    const cursor = new Date(range.start.getTime());
    cursor.setUTCHours(0, 0, 0, 0);
    const last = new Date(range.end.getTime());
    // Weekly bucketing still keys on the Monday; daily is the common case.
    const step = groupBy === 'week' ? 7 : 1;
    while (cursor <= last) {
      const key = cursor.toISOString().slice(0, 10);
      const row = byKey.get(key);
      series.push({
        bucket: key,
        label: cursor.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }),
        revenue: row?.revenue ?? 0,
        orders: row?.orders ?? 0,
      });
      cursor.setUTCDate(cursor.getUTCDate() + step);
    }
  }

  return {
    groupBy,
    from: range.start,
    to: range.end,
    series,
    totals: series.reduce((acc, point) => ({ revenue: acc.revenue + point.revenue, orders: acc.orders + point.orders }), { revenue: 0, orders: 0 }),
  };
}

/** Where the parcels go — useful for negotiating courier rates. */
export async function getOrdersByDistrict({ from, to, days = 90, limit = 12 } = {}) {
  const range = resolveDateRange({ from, to, days });
  return db.Order.aggregate([
    { $match: { createdAt: { $gte: range.start, $lte: range.end }, status: { $ne: ORDER_STATUS.CANCELLED } } },
    { $group: { _id: '$shippingAddress.district', orders: { $sum: 1 }, revenue: { $sum: '$pricing.grandTotal' }, zone: { $first: '$shipping.method' } } },
    { $sort: { orders: -1 } },
    { $limit: limit },
  ]).then((rows) => rows.map((row) => ({ district: row._id, zone: row.zone, orders: row.orders, revenue: row.revenue })));
}

/** Payment method mix — tells you how much cash the riders are carrying. */
export async function getPaymentMethodBreakdown({ from, to, days = 90 } = {}) {
  const range = resolveDateRange({ from, to, days });
  const rows = await db.Order.aggregate([
    { $match: { createdAt: { $gte: range.start, $lte: range.end }, status: { $ne: ORDER_STATUS.CANCELLED } } },
    { $group: { _id: '$payment.method', orders: { $sum: 1 }, revenue: { $sum: '$pricing.grandTotal' } } },
    { $sort: { orders: -1 } },
  ]);
  return rows.map((row) => ({ method: row._id, orders: row.orders, revenue: row.revenue }));
}

/** Category performance for the merchandising screen. */
export async function getCategoryPerformance({ limit = 12 } = {}) {
  const rows = await db.Order.aggregate([
    { $match: { status: { $in: [...REVENUE_STATUSES] } } },
    { $unwind: '$items' },
    { $group: { _id: '$items.categoryName', units: { $sum: '$items.quantity' }, revenue: { $sum: '$items.total' } } },
    { $sort: { revenue: -1 } },
    { $limit: limit },
  ]);
  return rows.filter((row) => row._id).map((row) => ({ category: row._id, units: row.units, revenue: row.revenue }));
}
