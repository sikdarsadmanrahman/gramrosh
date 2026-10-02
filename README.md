# Gramrosh — Fresh & Organic Food E-Commerce (MERN)

A production-ready, mobile-first e-commerce platform for a Bangladeshi fresh & organic food brand: raw Sundarban honey, grass-fed ghee, organic gur, kalijira rice, nuts and gift combos — with a complete back office for catalogue, orders, customers and settings.

| Layer | Stack |
| --- | --- |
| Frontend | **React 18** (Vite) · **Tailwind CSS** · **Lucide icons** · **Zustand** |
| Backend | **Node.js** · **Express.js** |
| Database | **MongoDB** via **Mongoose** (with a zero-dependency in-process fallback driver for dev/CI) |
| Images | **WebP everywhere** — Cloudinary CDN in production, a local `sharp` transcoder in development |

---

## Quick start

```bash
npm install          # installs server + client workspaces
npm run dev          # API on :5000 + storefront on :5173 (concurrently)
```

- Storefront: <http://localhost:5173>
- Back office: <http://localhost:5173/admin> — dev credentials `admin@gramrosh.test` / `Admin@1234`
- API health: <http://localhost:5173/health> (proxied)

The API auto-seeds a realistic demo dataset on first boot (8 categories, 12 products, 12 customers, 42 back-dated orders) so every screen has data immediately. Seeding is idempotent and deterministic.

```bash
npm run seed         # re-seed (add --fresh to wipe first: npm run seed -- --fresh)
npm test             # vitest + supertest API contract tests
npm run smoke -w server   # 500+ end-to-end HTTP checks against a running server
npm run images       # rebuild the WebP catalogue images + certificate PDFs
npm run build        # production client build → client/dist (served by Express)
```

### Without a local MongoDB

Nothing to install: with `DB_DRIVER=memory` (the dev default) the API runs on an in-process storage engine that speaks the Mongoose query API (filters, updates, aggregation pipeline, unique indexes) and persists to `server/.data/`. Point `MONGO_URI` at a real cluster and set `DB_DRIVER=mongodb` for production — the models and services are identical in both modes.

---

## Repository layout

```
server/
  src/
    config/        env parsing + frozen domain constants (statuses, zones, fees)
    models/        Mongoose schemas — the single source of truth for data shape
    db/            driver abstraction: mongodb | in-process memory engine
    validators/    Zod request schemas (every route validates before it runs)
    services/      all business logic (pricing, stock ledger, orders, stats…)
    controllers/   thin HTTP adapters around services
    routes/        public, storefront, order and admin routers
    middleware/    auth/RBAC, rate limits, validation, caching, errors
    utils/         API envelope, invoice HTML, phone/slug/money helpers
    seed/          deterministic demo dataset + seeding CLI
  tests/           vitest + supertest contract suites
  scripts/smoke.mjs  exhaustive HTTP smoke test (~515 checks)

client/
  src/
    lib/           axios API layer + formatting helpers
    stores/        Zustand: cart (persisted), config, admin session
    components/    Header, ProductGrid, ProductCard, CartDrawer, Countdown…
    pages/         Home, Shop, ProductDetail, Checkout, Tracking, Confirmation
    admin/         Dashboard, Products, ProductForm, Orders, OrderDetail,
                   Customers, CustomerDetail, Settings, Login
  scripts/build-images.mjs   WebP pipeline + demo certificate PDFs
  public/img/products/       generated WebP catalogue assets
```

---

## What's implemented

### Storefront
- **Dynamic catalogue** with server-side pagination (`limit`/`skip`), real-time debounced search, category filter (Honey, Ghee, Organic Sugar, Nuts, Combos & Gifts), price/rating/best-selling sorts — all state in the URL.
- **Weight-unit variant selector** (250g / 500g / 1kg…) with per-pack pricing, strike-through compare-at prices and per-variant stock badges.
- **Combo / bundle section**: bundles list their contents, and combo availability is derived from component stock.
- **Flash-sale countdown** anchored to the *server's* clock (`secondsRemaining` + monotonic timer — immune to wrong phone clocks) with a copyable coupon code.
- **Trust & certification**: BSTI licences, lab reports, organic/halal certificates and sourcing stories rendered per product with downloadable documents.
- **Slide-over cart** (persisted to localStorage) with a live free-delivery progress bar.
- **Dynamic checkout** with the automated shipping calculator — **৳60 inside Dhaka, ৳120 outside**, free over ৳2,500 — re-quoted server-side on every basket/district/coupon change.
- **Payments**: Cash on Delivery + hardcoded mobile banking (**bKash / Nagad / Rocket**) with **sender phone + TrxID** proof fields; duplicate TrxIDs are rejected (unique sparse index).
- **Floating WhatsApp / call widget**, public **order tracking** (orderNumber + phone gate) and a **printable invoice**.

### Admin
- **Dashboard**: revenue/orders/AOV/customer KPIs with period deltas, order-status pipeline, top products, stock alerts, latest orders — one aggregation round trip.
- **Product management**: create/edit with bilingual titles, variants, badges/tags; **inline per-variant stock editing**; archive/restore; duplicate; delete (refused while orders reference the product). Out-of-stock badges everywhere.
- **Order pipeline** `Pending → Processing → Shipped → Delivered / Cancelled` — the UI only offers the transitions the server's state machine allows; cancellation requires a reason and releases reserved stock.
- **Customer database** with lifetime stats (spend, AOV, first/last order), automatic segmentation (new/returning/VIP/at-risk), address book and full order history.
- **Printable invoice generator** (server-rendered HTML with `@media print` CSS, amount-in-words in lakh/crore) + packing-slip variant + filtered **CSV export** (BOM + RFC-4180).
- **RBAC**: `super_admin` / `admin` / `operator` roles with per-permission route guards, login lockout and last-super-admin protection.

### Performance & scalability
- **40 MongoDB indexes** declared on the schemas — including the required `category`, `phone` (`contact.phone`), `orderId` (`orderNumber`) and `createdAt` — each annotated with the admin screen it serves.
- **Server-side pagination everywhere** (12 default / 60 max per page, enforced by validation).
- **WebP images with declared dimensions** (zero layout shift), `srcset` support via Cloudinary in production, lazy loading, and a build pipeline that keeps the whole catalogue ~1 MB.
- Response caching (`Cache-Control` + ETag revalidation) on catalogue reads, gzip compression, tiered rate limiting, and code-split bundles (the admin app never ships to shoppers).

### Correctness guarantees
- **Checkout payloads carry no prices.** The server re-derives every taka from the database; tampered clients change nothing.
- **Stock is a ledger**: reserved at checkout inside a rollback-protected section, released on cancellation, never released on delivery, never negative, oversells → HTTP 409.
- Phone numbers normalise to E.164 (`+8801…`) and act as the customer identity for dedupe and tracking.

---

## API surface (summary)

```
GET  /api/config                     commerce constants for the client
GET  /api/storefront/home            hero, rails, flash sale, testimonials (1 call)
GET  /api/products?q&category&sort&page&limit&inStock
GET  /api/products/:slug             detail + related rail
POST /api/orders/quote               shipping calculator / basket pricing
POST /api/orders                     checkout (COD | bkash | nagad | rocket)
GET  /api/orders/lookup?orderNumber&phone
GET  /api/orders/:orderNumber/invoice?phone=…

POST /api/admin/auth/login | GET /me | PATCH /password | /accounts (super admin)
GET  /api/admin/stats/overview | /revenue | /top-products | /districts | …
CRUD /api/admin/products (+ /:id/stock /:id/archive /:id/duplicate)
CRUD /api/admin/categories (+ /reorder)
GET  /api/admin/orders (+ /:id/status /payment /shipping /notes /invoice /export)
GET  /api/admin/customers (+ /:id /:id/orders /by-phone/:phone /bulk-tag)
GET/PATCH /api/admin/settings (+ /system)
POST /api/admin/uploads/image(s)     WebP transcode (Cloudinary or local sharp)
```

Envelope: `{ success, message, data, meta? }` — lists put rows in `data` and the pager in `meta.pagination`.

---

## Configuration

Copy `server/.env.example` to `server/.env` (optional in dev — every value has a safe default):

| Variable | Purpose |
| --- | --- |
| `PORT` | API port (default 5000) |
| `DB_DRIVER` | `memory` (dev default) or `mongodb` (required in production) |
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | ≥32 chars — production boot refuses the dev default |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | bootstrap super-admin (must be changed for production) |
| `CLOUDINARY_*` | enables the CDN image provider + real multi-width `srcset` |
| `FREE_SHIPPING_THRESHOLD` | default 2500 (৳) |
| `CORS_ORIGINS` | comma-separated allowlist in production |

In production Express serves the built SPA from `client/dist` with an API-aware fallback, so one process serves everything.
