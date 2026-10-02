/**
 * -----------------------------------------------------------------------------
 *  constants.js — Single source of truth for domain enums & business rules
 * -----------------------------------------------------------------------------
 *  These values are shared by the Mongoose schemas, the service layer and the
 *  `/api/config` bootstrap payload that the React client consumes — so the
 *  storefront never hard-codes a shipping fee or an order status twice.
 * -----------------------------------------------------------------------------
 */

/**
 * Order lifecycle.
 *
 * The pipeline is *linear*: `statusTransitions` declares exactly which moves an
 * admin is allowed to make, which prevents nonsense such as jumping a
 * `Delivered` order back to `Processing`.
 */
export const ORDER_STATUS = Object.freeze({
  PENDING: 'Pending',
  PROCESSING: 'Processing',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
});

export const ORDER_STATUS_LIST = Object.freeze(Object.values(ORDER_STATUS));

/** Allowed next states per status (empty array = terminal state). */
export const STATUS_TRANSITIONS = Object.freeze({
  [ORDER_STATUS.PENDING]: [ORDER_STATUS.PROCESSING, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.PROCESSING]: [ORDER_STATUS.SHIPPED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.SHIPPED]: [ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.DELIVERED]: [],
  [ORDER_STATUS.CANCELLED]: [ORDER_STATUS.PENDING], // allow "re-open" after a mistake
});

/** Statuses that count towards revenue reporting. */
export const REVENUE_STATUSES = Object.freeze([ORDER_STATUS.SHIPPED, ORDER_STATUS.DELIVERED]);

/**
 * Payment methods.
 *
 * `COD` needs no extra fields. The mobile-banking methods are *manual*: the
 * customer sends money to the merchant wallet and types their sender number +
 * transaction id, which the admin later reconciles.
 */
export const PAYMENT_METHOD = Object.freeze({
  COD: 'cod',
  BKASH: 'bkash',
  NAGAD: 'nagad',
  ROCKET: 'rocket',
});

export const PAYMENT_METHODS = Object.freeze([
  {
    id: PAYMENT_METHOD.COD,
    label: 'Cash on Delivery',
    shortLabel: 'COD',
    /** Charge added on top of the order total for using this method. */
    fee: 0,
    requiresReference: false,
    hint: 'Pay the courier when the parcel reaches your door.',
  },
  {
    id: PAYMENT_METHOD.BKASH,
    label: 'bKash',
    shortLabel: 'bKash',
    fee: 0,
    requiresReference: true,
    merchantNumber: '+8801711223344',
    type: 'Send Money (Personal)',
    hint: 'Send the total amount to our bKash number, then enter your sender number and TrxID.',
  },
  {
    id: PAYMENT_METHOD.NAGAD,
    label: 'Nagad',
    shortLabel: 'Nagad',
    fee: 0,
    requiresReference: true,
    merchantNumber: '+8801811223344',
    type: 'Send Money (Personal)',
    hint: 'Send the total amount to our Nagad number, then enter your sender number and TrxID.',
  },
  {
    id: PAYMENT_METHOD.ROCKET,
    label: 'Rocket',
    shortLabel: 'Rocket',
    fee: 0,
    requiresReference: true,
    merchantNumber: '+8801911223344-1',
    type: 'Send Money',
    hint: 'Send the total amount to our Rocket number, then enter your sender number and TrxID.',
  },
]);

export const PAYMENT_METHOD_IDS = Object.freeze(PAYMENT_METHODS.map((m) => m.id));

/**
 * Payment reconciliation state for manual / mobile-banking orders.
 *
 * Values are stored exactly as written here (Title Case, no punctuation) so they
 * are both machine-comparable and safe to drop into CSV exports, URLs and
 * invoices. `PAYMENT_STATUS_LABELS` carries the copy the admin UI shows.
 */
export const PAYMENT_STATUS = Object.freeze({
  UNPAID: 'Unpaid',
  /** Cash on Delivery: money is collected by the courier, not yet in hand. */
  COD_DUE: 'COD Due',
  /** bKash / Nagad / Rocket transfer claimed by the customer, not yet matched. */
  PENDING_VERIFICATION: 'Pending Verification',
  PAID: 'Paid',
  REFUNDED: 'Refunded',
  FAILED: 'Failed',
});

export const PAYMENT_STATUS_LIST = Object.freeze(Object.values(PAYMENT_STATUS));

/** Display copy for each payment state (the enum value doubles as the key). */
export const PAYMENT_STATUS_LABELS = Object.freeze({
  [PAYMENT_STATUS.UNPAID]: 'Unpaid',
  [PAYMENT_STATUS.COD_DUE]: 'Cash on Delivery (due)',
  [PAYMENT_STATUS.PENDING_VERIFICATION]: 'Pending verification',
  [PAYMENT_STATUS.PAID]: 'Paid',
  [PAYMENT_STATUS.REFUNDED]: 'Refunded',
  [PAYMENT_STATUS.FAILED]: 'Failed',
});

/** Display copy + colour hint for each order status, for admin pills. */
export const ORDER_STATUS_LABELS = Object.freeze({
  [ORDER_STATUS.PENDING]: { label: 'Pending', tone: 'amber' },
  [ORDER_STATUS.PROCESSING]: { label: 'Processing', tone: 'blue' },
  [ORDER_STATUS.SHIPPED]: { label: 'Shipped', tone: 'indigo' },
  [ORDER_STATUS.DELIVERED]: { label: 'Delivered', tone: 'green' },
  [ORDER_STATUS.CANCELLED]: { label: 'Cancelled', tone: 'red' },
});

/**
 * Shipping zones — the automated shipping calculator.
 *
 * `match` holds the district names (lower-cased, de-diacritised by the caller)
 * that belong to the zone. Dhaka city is a flat ৳60; everywhere else ৳120.
 */
export const SHIPPING_ZONE = Object.freeze({
  INSIDE_DHAKA: 'inside_dhaka',
  OUTSIDE_DHAKA: 'outside_dhaka',
});

export const SHIPPING_METHODS = Object.freeze([
  {
    id: SHIPPING_ZONE.INSIDE_DHAKA,
    label: 'Inside Dhaka',
    fee: 60,
    etaDays: [1, 2],
    description: 'Dhaka city corporation & nearby suburbs',
  },
  {
    id: SHIPPING_ZONE.OUTSIDE_DHAKA,
    label: 'Outside Dhaka',
    fee: 120,
    etaDays: [2, 4],
    description: 'All other districts of Bangladesh',
  },
]);

/**
 * Delivery areas treated as "Inside Dhaka" by the automatic zone resolver.
 *
 * Dhaka district plus the five upazilas couriers price as city delivery. Note
 * `chapai nawabganj` normalises differently from `nawabganj` (the Dhaka
 * upazila), so the two never collide.
 */
export const DHAKA_DISTRICTS = Object.freeze([
  'dhaka', 'dhamrai', 'dohar', 'keraniganj', 'nawabganj', 'savar',
]);

/**
 * The 64 Bangladeshi districts, offered in the checkout address form and used to
 * derive the shipping zone. Kept alphabetical and spelled the way couriers spell
 * them (Barishal, Chattogram, Cumilla, Jashore) so ops staff recognise them.
 */
export const DISTRICTS = Object.freeze([
  'Bagerhat', 'Bandarban', 'Barguna', 'Barishal', 'Bhola', 'Bogura', 'Brahmanbaria', 'Chandpur',
  'Chapai Nawabganj', 'Chattogram', 'Chuadanga', 'Cox\'s Bazar', 'Cumilla', 'Dhaka', 'Dinajpur',
  'Faridpur', 'Feni', 'Gaibandha', 'Gazipur', 'Gopalganj', 'Habiganj', 'Jamalpur', 'Jashore',
  'Jhalokati', 'Jhenaidah', 'Joypurhat', 'Khagrachhari', 'Khulna', 'Kishoreganj', 'Kurigram',
  'Kushtia', 'Lakshmipur', 'Lalmonirhat', 'Madaripur', 'Magura', 'Manikganj', 'Maulvibazar',
  'Meherpur', 'Munshiganj', 'Mymensingh', 'Naogaon', 'Narail', 'Narayanganj', 'Narsingdi',
  'Natore', 'Netrokona', 'Nilphamari', 'Noakhali', 'Pabna', 'Panchagarh', 'Patuakhali',
  'Pirojpur', 'Rajbari', 'Rajshahi', 'Rangamati', 'Rangpur', 'Satkhira', 'Shariatpur',
  'Sherpur', 'Sirajganj', 'Sunamganj', 'Sylhet', 'Tangail', 'Thakurgaon',
]);

/** Product availability surfaced on cards & the admin stock-alert panel. */
export const STOCK_STATUS = Object.freeze({
  IN_STOCK: 'in_stock',
  LOW_STOCK: 'low_stock',
  OUT_OF_STOCK: 'out_of_stock',
});

/** Below (and including) this quantity a variant is flagged "low stock". */
export const LOW_STOCK_THRESHOLD = 10;

/** Weight / unit options used by the variant selector (250g, 500g, 1kg…). */
export const UNIT_TYPES = Object.freeze(['g', 'kg', 'ml', 'l', 'pcs', 'box']);

/** Trust & certification documents (BSTI, lab reports, sourcing stories). */
export const CERTIFICATION_TYPES = Object.freeze([
  'bsti',
  'lab_report',
  'organic_certificate',
  'halal',
  'iso',
  'sourcing_story',
]);

/** Catalogue sort options whitelisted for the storefront. */
export const SORT_OPTIONS = Object.freeze({
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  // Both directions sort on `priceRange.min` — the "from ৳X" price the product
  // card actually displays — so ascending and descending are exact inverses and
  // never surprise the shopper.
  price_asc: { 'priceRange.min': 1, title: 1 },
  price_desc: { 'priceRange.min': -1, title: 1 },
  popular: { 'stats.views': -1, createdAt: -1 },
  best_selling: { 'stats.sold': -1, rating: -1 },
  rating: { rating: -1, 'stats.views': -1 },
  title_asc: { title: 1 },
});

export const SORT_KEYS = Object.freeze(Object.keys(SORT_OPTIONS));

/**
 * How an order reached us.
 *
 * Declared by whoever took the order (the storefront or a staff member on the
 * phone), so it is *informational* — useful for "which channel sells best?".
 */
export const ORDER_SOURCE = Object.freeze({
  WEB: 'web',
  MOBILE: 'mobile',
  PHONE: 'phone',
  WHATSAPP: 'whatsapp',
  ADMIN: 'admin',
});

export const ORDER_SOURCES = Object.freeze(Object.values(ORDER_SOURCE));

/**
 * Which surface actually wrote the order. Derived server-side from the
 * authenticated request, so — unlike `source` — it can never be spoofed and is
 * safe to trust for auditing and for "hide staff orders from web analytics".
 */
export const ORDER_CHANNEL = Object.freeze({
  STOREFRONT: 'storefront',
  ADMIN: 'admin',
});

export const ORDER_CHANNELS = Object.freeze(Object.values(ORDER_CHANNEL));
