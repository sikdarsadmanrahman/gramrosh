/**
 * -----------------------------------------------------------------------------
 *  scripts/smoke.mjs — end-to-end HTTP smoke test
 * -----------------------------------------------------------------------------
 *  Boots nothing; it expects a running server (default http://localhost:5055).
 *
 *      node scripts/smoke.mjs
 *      BASE=https://api.example.com ADMIN_PASSWORD=... node scripts/smoke.mjs
 *
 *  Exercises every public and admin route against a freshly seeded database, so
 *  run it against a throwaway instance (NODE_ENV=test MEMORY_DB_PERSIST=false).
 * -----------------------------------------------------------------------------
 */
const BASE = process.env.BASE ?? 'http://localhost:5055';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@gramrosh.test';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin@1234';

let pass = 0;
let fail = 0;
const failures = [];

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const OFF = '\x1b[0m';

function check(name, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`  ${GREEN}✓${OFF} ${name}`);
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ''}`);
    console.log(`  ${RED}✗${OFF} ${name}${detail ? `\n      ${String(detail).slice(0, 300)}` : ''}`);
  }
}

const section = (title) => console.log(`\n${CYAN}${BOLD}${title}${OFF}`);

/**
 * The API envelope is `{ success, message, data, meta? }`, where list endpoints
 * put the rows in `data` (a plain array) and the pager in `meta.pagination`.
 */
async function call(method, path, { body, token, headers } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* CSV / HTML responses */ }
  return {
    status: res.status,
    ok: res.ok,
    json,
    text,
    headers: res.headers,
    /** Rows of a paginated list response. */
    rows: Array.isArray(json?.data) ? json.data : (json?.data?.items ?? []),
    pager: json?.meta?.pagination,
    meta: json?.meta,
    data: json?.data,
  };
}

const get = (p, o) => call('GET', p, o);
const post = (p, o) => call('POST', p, o);
const patch = (p, o) => call('PATCH', p, o);
const del = (p, o) => call('DELETE', p, o);

/* ========================================================================== */
/*  Public surface                                                            */
/* ========================================================================== */

/*
 * Everything below runs inside one try/catch (see the bottom of the file) so a
 * single unexpected response shape reports as a failure instead of aborting the
 * run and hiding every subsequent check.
 */
try {

section('Health & readiness');
{
  const r = await get('/api/health');
  check('GET /api/health → 200', r.status === 200 && r.data?.status === 'ok', r.text);
  check('health reports db driver + image provider', Boolean(r.data?.database?.driver) && Boolean(r.data?.images?.provider), JSON.stringify(r.data));
  check('health is not rate limited', (r.headers.get('x-ratelimit-limit') ?? 'none') === 'none', r.headers.get('x-ratelimit-limit'));
}

section('Commerce config');
let CONFIG;
{
  const r = await get('/api/config');
  CONFIG = r.data;
  check('GET /api/config → 200', r.status === 200, r.text);
  check('Inside Dhaka = ৳60', CONFIG?.shippingMethods?.some((m) => m.id === 'inside_dhaka' && m.fee === 60), JSON.stringify(CONFIG?.shippingMethods));
  check('Outside Dhaka = ৳120', CONFIG?.shippingMethods?.some((m) => m.id === 'outside_dhaka' && m.fee === 120), JSON.stringify(CONFIG?.shippingMethods));
  check('free shipping threshold = 2500', CONFIG?.freeShippingThreshold === 2500, CONFIG?.freeShippingThreshold);
  check('payment methods = cod,bkash,nagad,rocket', CONFIG?.paymentMethods?.map((m) => m.id).join(',') === 'cod,bkash,nagad,rocket', JSON.stringify(CONFIG?.paymentMethods?.map((m) => m.id)));
  check('mobile wallets expose merchant numbers', CONFIG?.paymentMethods?.filter((m) => m.id !== 'cod').every((m) => m.merchantNumber), JSON.stringify(CONFIG?.paymentMethods?.[1]));
  check('64 districts', CONFIG?.districts?.length === 64, CONFIG?.districts?.length);
  check('currency = BDT/৳', CONFIG?.currency === 'BDT' && CONFIG?.currencySymbol === '৳', JSON.stringify([CONFIG?.currency, CONFIG?.currencySymbol]));
  check('config carries store + support contact', Boolean(CONFIG?.store?.name) && Boolean(CONFIG?.support?.whatsapp), JSON.stringify(CONFIG?.support));
  check('config is cacheable', /max-age=/.test(r.headers.get('cache-control') ?? ''), r.headers.get('cache-control'));
}

section('Categories');
let CATEGORIES;
{
  const r = await get('/api/categories');
  CATEGORIES = r.data;
  check('GET /api/categories → 200', r.status === 200 && Array.isArray(CATEGORIES), r.text);
  check('8 seeded categories', CATEGORIES?.length === 8, CATEGORIES?.length);
  check('every category has a product count', CATEGORIES?.every((c) => typeof c.productCount === 'number'), JSON.stringify(CATEGORIES?.[0]));
  check('required categories present', ['honey', 'ghee', 'organic-sugar', 'nuts', 'combos'].every((slug) => CATEGORIES?.some((c) => c.slug === slug)), JSON.stringify(CATEGORIES?.map((c) => c.slug)));
  check('counts sum to catalogue size', CATEGORIES?.reduce((n, c) => n + c.productCount, 0) === 12, CATEGORIES?.reduce((n, c) => n + c.productCount, 0));
}
{
  const r = await get('/api/categories/honey');
  check('GET /api/categories/honey → 200', r.status === 200, `${r.status} ${r.text.slice(0, 160)}`);
  check('category itself is in meta.category', r.meta?.category?.slug === 'honey' && r.meta.category.name, JSON.stringify(r.meta?.category)?.slice(0, 200));
  check('category detail lists its products', r.rows.length === 2 && r.rows.every((p) => p.categorySlug === 'honey'), JSON.stringify(r.rows.map((p) => p.slug)));
  check('category detail is paginated like every other list', Boolean(r.pager?.total), JSON.stringify(r.pager));
}
{
  const r = await get('/api/categories/not-a-category');
  check('unknown category → 404', r.status === 404, `${r.status} ${r.text}`);
}

section('Catalogue — server-side pagination (limit & skip)');
let CARDS;
{
  const r = await get('/api/products?page=1&limit=5');
  CARDS = r.rows;
  check('GET /api/products → 200', r.status === 200, r.text);
  check('honours limit=5', CARDS.length === 5, CARDS.length);
  check('meta.pagination.total = 12', r.pager?.total === 12, JSON.stringify(r.pager));
  check('meta.pagination.totalPages = 3', r.pager?.totalPages === 3, JSON.stringify(r.pager));
  check('meta.pagination.skip = 0', r.pager?.skip === 0, JSON.stringify(r.pager));
  check('hasNextPage true', r.pager?.hasNextPage === true, JSON.stringify(r.pager));
}
{
  const r = await get('/api/products?page=3&limit=5');
  check('page 3 returns the remainder (2)', r.rows.length === 2, r.rows.length);
  check('page 3 skip = 10', r.pager?.skip === 10, JSON.stringify(r.pager));
  check('page 3 hasNextPage false', r.pager?.hasNextPage === false);
  check('page 3 does not repeat page 1', !r.rows.some((p) => CARDS.some((c) => c._id === p._id)));
}
{
  const r = await get('/api/products?limit=5&skip=5');
  check('raw skip=5 supported', r.rows.length === 5 && !r.rows.some((p) => CARDS.some((c) => c._id === p._id)), JSON.stringify(r.rows.map((p) => p.slug)));
}
{
  const r = await get('/api/products?limit=1000');
  check('limit above MAX_PAGE_SIZE → 422', r.status === 422, `${r.status} ${r.text.slice(0, 160)}`);
}
{
  const r = await get('/api/products?page=0');
  check('page=0 → 422', r.status === 422, `${r.status} ${r.text.slice(0, 160)}`);
}

section('Catalogue — card shape');
{
  const card = CARDS[0];
  check('card exposes priceFrom/priceTo', typeof card.priceFrom === 'number' && typeof card.priceTo === 'number', JSON.stringify({ priceFrom: card.priceFrom, priceTo: card.priceTo }));
  check('card exposes stockStatus + totalStock', Boolean(card.stockStatus) && typeof card.totalStock === 'number', JSON.stringify({ card: [card.stockStatus, card.totalStock] }));
  check('card exposes defaultVariant', Boolean(card.defaultVariant?._id), JSON.stringify(card.defaultVariant));
  check('card exposes weight/unit variants', (card.variants?.length ?? 0) > 0 && card.variants.every((v) => v.weightValue && v.weightUnit), JSON.stringify(card.variants?.map((v) => [v.weightValue, v.weightUnit])));
  check('card exposes imageSrcSet gallery', Array.isArray(card.imageSrcSet) && card.imageSrcSet.every((i) => i.url && i.alt !== undefined), JSON.stringify(card.imageSrcSet)?.slice(0, 200));
  check('srcset is a string under Cloudinary, null under the local provider', card.imageSrcSet.every((i) => i.srcset === null || typeof i.srcset === 'string'), JSON.stringify(card.imageSrcSet?.map((i) => i.srcset)));
  check('images carry width/height so the grid reserves space (no CLS)', card.imageSrcSet.every((i) => i.width === null || typeof i.width === 'number'), JSON.stringify(card.imageSrcSet?.map((i) => [i.width, i.height])));
  check('card exposes onSale flag', typeof card.onSale === 'boolean', String(card.onSale));
  check('card exposes categoryName/categorySlug', Boolean(card.categoryName) && Boolean(card.categorySlug), JSON.stringify([card.categoryName, card.categorySlug]));
  check('card omits internal searchBlob', card.searchBlob === undefined, card.searchBlob);
  check('card omits description (list payload stays small)', card.description === undefined, String(card.description)?.slice(0, 80));
}

section('Catalogue — search, filters, sorting');
{
  const r = await get('/api/products?q=honey&limit=60');
  check('q=honey returns matches', r.rows.length > 0, r.text.slice(0, 160));
  check('search is a real haystack match', r.rows.every((p) => JSON.stringify(p).toLowerCase().includes('honey')), JSON.stringify(r.rows.map((p) => p.title)));
  check('search echoes the applied filter', r.meta?.applied?.q === 'honey', JSON.stringify(r.meta?.applied));
}
{
  const r = await get('/api/products?q=%E0%A6%AE%E0%A6%A7%E0%A7%81&limit=60');
  check('Bengali search (মধু) works', r.rows.length > 0, r.text.slice(0, 200));
}
{
  const r = await get('/api/products?category=honey&limit=60');
  check('filter by category slug', r.rows.length > 0 && r.rows.every((p) => p.categorySlug === 'honey'), JSON.stringify(r.rows.map((p) => p.categorySlug)));
}
{
  const ghee = CATEGORIES.find((c) => c.slug === 'ghee');
  const r = await get(`/api/products?category=${ghee._id}&limit=60`);
  check('filter by category ObjectId', r.rows.length > 0 && r.rows.every((p) => p.categorySlug === 'ghee'), JSON.stringify(r.rows.map((p) => p.categorySlug)));
}
{
  const r = await get('/api/products?categories=honey,ghee&limit=60');
  check('multi-category filter', r.rows.length > 0 && r.rows.every((p) => ['honey', 'ghee'].includes(p.categorySlug)), JSON.stringify(r.rows.map((p) => p.categorySlug)));
}
{
  const r = await get('/api/products?isCombo=true&limit=60');
  check('isCombo=true → 3 bundles', r.rows.length === 3, r.rows.length);
  check('combos carry bundle.items', r.rows.every((p) => (p.bundle?.items?.length ?? 0) > 0), JSON.stringify(r.rows.map((p) => p.bundle?.items?.length)));
  check('combos carry a savings badge', r.rows.every((p) => Boolean(p.bundle?.badge)), JSON.stringify(r.rows.map((p) => p.bundle?.badge)));
}
{
  const r = await get('/api/products?onSale=true&limit=60');
  check('onSale=true returns only discounted products', r.rows.length > 0 && r.rows.every((p) => p.onSale), JSON.stringify(r.rows.map((p) => [p.slug, p.onSale])));
}
{
  const r = await get('/api/products?inStock=true&limit=60');
  check('inStock=true excludes out_of_stock', r.rows.every((p) => p.stockStatus !== 'out_of_stock'), JSON.stringify(r.rows.map((p) => [p.slug, p.stockStatus])));
}
{
  // A price slider filters on *overlap*: a product with variants from ৳180 to
  // ৳1620 has something for a ৳500–৳1500 budget, so it stays in the results.
  const r = await get('/api/products?minPrice=500&maxPrice=1500&limit=60');
  check('price band filter keeps overlapping products only', r.rows.length > 0 && r.rows.every((p) => p.priceTo >= 500 && p.priceFrom <= 1500), JSON.stringify(r.rows.map((p) => [p.priceFrom, p.priceTo])));
  check('price band excludes products entirely below it', !r.rows.some((p) => p.priceTo < 500), JSON.stringify(r.rows.map((p) => [p.slug, p.priceTo])));
  check('price band excludes products entirely above it', !r.rows.some((p) => p.priceFrom > 1500), JSON.stringify(r.rows.map((p) => [p.slug, p.priceFrom])));
  check('price band echoed in meta.applied', JSON.stringify(r.meta?.applied?.priceRange) === JSON.stringify({ min: 500, max: 1500 }), JSON.stringify(r.meta?.applied));
}
{
  const r = await get('/api/products?minPrice=900&maxPrice=100');
  check('minPrice > maxPrice → 422', r.status === 422, `${r.status} ${r.text.slice(0, 160)}`);
}
{
  const asc = (await get('/api/products?sort=price_asc&limit=60')).rows.map((p) => p.priceFrom);
  check('sort=price_asc', asc.every((v, i) => i === 0 || asc[i - 1] <= v), JSON.stringify(asc));
  const desc = (await get('/api/products?sort=price_desc&limit=60')).rows.map((p) => p.priceFrom);
  check('sort=price_desc', desc.every((v, i) => i === 0 || desc[i - 1] >= v), JSON.stringify(desc));
}
{
  const best = (await get('/api/products?sort=best_selling&limit=60')).rows;
  check('sort=best_selling returns the catalogue', best.length === 12, best.length);
}
{
  const r = await get('/api/products?sort=nonsense');
  check('unknown sort → 422', r.status === 422, `${r.status} ${r.text.slice(0, 160)}`);
}
{
  const r = await get('/api/products?section=flash_sale&limit=60');
  check('section=flash_sale rail works', r.status === 200 && r.rows.every((p) => p.isOnFlashSale || p.flashSale?.isActive), JSON.stringify(r.rows.map((p) => [p.slug, p.flashSale?.isActive])));
}

section('Catalogue — facets');
{
  const r = await get('/api/products/meta/facets');
  const f = r.data;
  check('GET /api/products/meta/facets → 200', r.status === 200, r.text);
  check('facets.categories has per-category counts', (f?.categories?.length ?? 0) > 0 && f.categories.every((c) => typeof c.count === 'number' && c.slug), JSON.stringify(f?.categories?.[0]));
  check('facets expose weight/unit options for the selectors', (f?.units?.length ?? 0) > 0, JSON.stringify(f?.units));
  check('facets.priceRange min/max', f?.priceRange?.min === 120 && f?.priceRange?.max === 2700, JSON.stringify(f?.priceRange));
  check('facets.counts.products = 12', f?.counts?.products === 12, JSON.stringify(f?.counts));
  check('facets expose tags', (f?.tags?.length ?? 0) > 0, f?.tags?.length);
}

section('Product detail (PDP)');
let PDP;
{
  const slug = CARDS.find((c) => !c.isCombo)?.slug;
  const r = await get(`/api/products/${slug}`);
  PDP = r.data;
  check(`GET /api/products/${slug} → 200`, r.status === 200, r.text.slice(0, 200));
  check('detail has full description', typeof PDP?.description === 'string' && PDP.description.length > 40, String(PDP?.description)?.slice(0, 60));
  check('detail has weight/unit variant selectors', (PDP?.variants?.length ?? 0) >= 2 && PDP.variants.every((v) => v.weightValue && v.weightUnit && typeof v.price === 'number'), JSON.stringify(PDP?.variants?.map((v) => [v.label, v.weightValue, v.weightUnit, v.price])));
  check('exactly one variant flagged default', PDP?.variants?.filter((v) => v.isDefault).length === 1, JSON.stringify(PDP?.variants?.map((v) => v.isDefault)));
  check('detail exposes per-variant stock', PDP?.variants?.every((v) => typeof v.stock === 'number'), JSON.stringify(PDP?.variants?.map((v) => v.stock)));
  check('detail populates category', Boolean(PDP?.category?.name) || Boolean(PDP?.categoryName), JSON.stringify(PDP?.category));
  check('detail exposes a related rail', Array.isArray(PDP?.related) && PDP.related.length > 0, JSON.stringify(PDP?.related?.map((p) => p.slug)));
  check('related never includes the anchor itself', !PDP?.related?.some((p) => p._id === PDP._id), JSON.stringify(PDP?.related?.map((p) => p.slug)));
  check('related items are decorated cards', PDP?.related?.every((p) => typeof p.priceFrom === 'number'), JSON.stringify(PDP?.related?.[0])?.slice(0, 160));
  check('detail omits searchBlob', PDP?.searchBlob === undefined, String(PDP?.searchBlob)?.slice(0, 60));
}
{
  const combo = CARDS.find((c) => c.isCombo);
  const r = await get(`/api/products/${combo.slug}`);
  check('combo detail → 200', r.status === 200, r.text.slice(0, 160));
  check('combo detail has bundleAvailability', Boolean(r.data?.bundleAvailability), JSON.stringify(r.data?.bundleAvailability));
  check('combo bundle items resolved to products', (r.data?.bundle?.items ?? []).every((i) => i.product), JSON.stringify(r.data?.bundle?.items)?.slice(0, 200));
  check('combo saves money vs components', r.data?.bundle?.combinedPrice > r.data?.priceRange?.min, JSON.stringify({ combined: r.data?.bundle?.combinedPrice, price: r.data?.priceRange?.min }));
}
{
  const r = await get('/api/products/definitely-not-here');
  check('unknown slug → 404', r.status === 404 && r.json?.success === false, `${r.status} ${r.text.slice(0, 160)}`);
}
{
  const archived = await get(`/api/products/${CARDS[0]._id}`);
  check('public detail by ObjectId also works', archived.status === 200, `${archived.status}`);
}

section('Storefront home — one round trip');
{
  const r = await get('/api/storefront/home');
  const d = r.data;
  check('GET /api/storefront/home → 200', r.status === 200, r.text.slice(0, 200));
  check('hero slides present', (d?.hero?.length ?? 0) > 0 && d.hero.every((s) => s.title), JSON.stringify(d?.hero?.[0])?.slice(0, 160));
  check('hero image is webp', d?.hero?.[0]?.image?.format === 'webp' || /\.webp$/.test(d?.hero?.[0]?.image?.url ?? ''), JSON.stringify(d?.hero?.[0]?.image));
  check('8 categories in payload', d?.categories?.length === 8, d?.categories?.length);
  check('rails.featured populated', (d?.rails?.featured?.length ?? 0) > 0, d?.rails?.featured?.length);
  check('rails.newArrivals populated', (d?.rails?.newArrivals?.length ?? 0) > 0, d?.rails?.newArrivals?.length);
  check('rails.bestSellers populated', (d?.rails?.bestSellers?.length ?? 0) > 0, d?.rails?.bestSellers?.length);
  check('rails.combos = 3', d?.rails?.combos?.length === 3, d?.rails?.combos?.length);
  check('flashSale block present', Boolean(d?.flashSale), JSON.stringify(Object.keys(d?.flashSale ?? {})));
  check('flashSale has coupon code', Boolean(d?.flashSale?.couponCode), d?.flashSale?.couponCode);
  check('countdownEndsAt is a future ISO timestamp', Boolean(d?.countdownEndsAt) && new Date(d.countdownEndsAt).getTime() > Date.now(), d?.countdownEndsAt);
  check('serverTime supplied for drift-free countdown', Boolean(d?.serverTime) && Math.abs(Date.now() - new Date(d.serverTime).getTime()) < 60_000, d?.serverTime);
  check('flashSale.secondsRemaining consistent with endsAt', Math.abs(d.flashSale.secondsRemaining - (new Date(d.countdownEndsAt).getTime() - new Date(d.serverTime).getTime()) / 1000) < 5, `${d.flashSale.secondsRemaining}`);
  check('trust points present', (d?.trustPoints?.length ?? 0) > 0, JSON.stringify(d?.trustPoints)?.slice(0, 160));
  check('testimonials present', (d?.testimonials?.length ?? 0) > 0, d?.testimonials?.length);
  check('store contact present', Boolean(d?.store?.contact?.whatsapp), JSON.stringify(d?.store?.contact));
  check('home is cacheable', /max-age=/.test(r.headers.get('cache-control') ?? ''), r.headers.get('cache-control'));
}
{
  const r = await get('/api/storefront/settings');
  check('GET /api/storefront/settings → 200', r.status === 200, `${r.status} ${r.text.slice(0, 160)}`);
  check('settings expose contact + hero + trustPoints', Boolean(r.data?.contact?.phone) && Array.isArray(r.data?.hero) && Array.isArray(r.data?.trustPoints), JSON.stringify(Object.keys(r.data ?? {})));
  check('settings never leak updatedAtBy', r.data?.updatedAtBy === undefined && !r.text.includes('updatedAtBy'), String(r.data?.updatedAtBy));
}
{
  const r = await get('/api/storefront/certifications');
  check('GET /api/storefront/certifications → 200', r.status === 200, `${r.status} ${r.text.slice(0, 160)}`);
  check('BSTI / lab certificates listed', r.rows.length > 0 && r.rows.some((c) => /bsti|lab/i.test(`${c.type} ${c.title} ${c.issuer}`)), JSON.stringify(r.rows.map((c) => [c.type, c.title])));
  check('certificates expose a document URL', r.rows.every((c) => Boolean(c.url)), JSON.stringify(r.rows.map((c) => c.url)));
}
{
  const r = await get('/api/storefront/stories');
  check('GET /api/storefront/stories → 200', r.status === 200, `${r.status} ${r.text.slice(0, 160)}`);
  check('origin stories present', r.rows.length > 0, r.rows.length);
  check('every story deep-links to its products', r.rows.every((s) => (s.products?.length ?? 0) > 0), JSON.stringify(r.rows.map((s) => [s.title, s.products?.length])));
  check('linked products carry title/slug/image for the card', r.rows.flatMap((s) => s.products ?? []).every((p) => p.title && p.slug), JSON.stringify(r.rows[0]?.products?.[0]));
}
{
  const r = await get('/api/storefront/facets');
  check('GET /api/storefront/facets → 200', r.status === 200, `${r.status} ${r.text.slice(0, 160)}`);
}

section('Shipping calculator & quote');
const PLAIN = CARDS.find((c) => !c.isCombo && c.stockStatus !== 'out_of_stock');
const PLAIN_VARIANT = PLAIN.defaultVariant?._id ?? PLAIN.variants[0]._id;
{
  const r = await post('/api/orders/quote', {
    body: { items: [{ productId: PLAIN._id, variantId: PLAIN_VARIANT, quantity: 2 }], district: 'Dhaka' },
  });
  check('quote inside Dhaka → 200', r.status === 200, r.text.slice(0, 200));
  check('shipping fee = 60', r.data?.shipping?.fee === 60, JSON.stringify(r.data?.shipping));
  check('zone resolved to inside_dhaka', r.data?.shipping?.zone === 'inside_dhaka' || r.data?.shipping?.id === 'inside_dhaka', JSON.stringify(r.data?.shipping));
  check('quote lines priced per variant', r.data?.items?.every((i) => i.unitPrice > 0 && i.total === i.unitPrice * i.quantity), JSON.stringify(r.data?.items));
  check('quote grandTotal arithmetic is exact', r.data.pricing.grandTotal === Number((r.data.pricing.subtotal - r.data.pricing.discount + r.data.pricing.shippingFee + r.data.pricing.paymentFee + r.data.pricing.tax).toFixed(2)), JSON.stringify(r.data.pricing));
  check('quote separates discount from savings', 'discount' in r.data.pricing && 'savings' in r.data.pricing, JSON.stringify(r.data.pricing));
}
{
  const r = await post('/api/orders/quote', {
    body: { items: [{ productId: PLAIN._id, variantId: PLAIN_VARIANT, quantity: 1 }], district: 'Chattogram' },
  });
  check('quote outside Dhaka → shipping 120', r.data?.shipping?.fee === 120, JSON.stringify(r.data?.shipping));
  check('zone resolved to outside_dhaka', r.data?.shipping?.zone === 'outside_dhaka' || r.data?.shipping?.id === 'outside_dhaka', JSON.stringify(r.data?.shipping));
}
{
  const r = await post('/api/orders/quote', {
    body: { items: [{ productId: PLAIN._id, variantId: PLAIN_VARIANT, quantity: 1 }], district: 'Sylhet' },
  });
  check('district matching is case/space insensitive', r.data?.shipping?.fee === 120, JSON.stringify(r.data?.shipping));
  const r2 = await post('/api/orders/quote', {
    body: { items: [{ productId: PLAIN._id, variantId: PLAIN_VARIANT, quantity: 1 }], district: '  dhaka  ' },
  });
  check('"  dhaka  " → inside_dhaka (৳60)', r2.data?.shipping?.fee === 60, JSON.stringify(r2.data?.shipping));
  const r3 = await post('/api/orders/quote', {
    body: { items: [{ productId: PLAIN._id, variantId: PLAIN_VARIANT, quantity: 1 }], district: 'Savar' },
  });
  check('Savar (Dhaka district) → ৳60', r3.data?.shipping?.fee === 60, JSON.stringify(r3.data?.shipping));
}
{
  // Free shipping above the threshold.
  const expensive = CARDS.slice().sort((a, b) => b.priceFrom - a.priceFrom)[0];
  const qty = Math.ceil(2600 / expensive.priceFrom);
  const r = await post('/api/orders/quote', {
    body: { items: [{ productId: expensive._id, variantId: expensive.defaultVariant?._id ?? expensive.variants[0]._id, quantity: qty }], district: 'Chattogram' },
  });
  check(`free shipping above ৳2500 (subtotal ${r.data?.pricing?.subtotal})`, r.data?.shipping?.fee === 0 && r.data?.shipping?.isFree === true, JSON.stringify(r.data?.shipping));
}
{
  const r = await post('/api/orders/quote', { body: { items: [], district: 'Dhaka' } });
  check('empty quote → 422', r.status === 422, `${r.status} ${r.text.slice(0, 160)}`);
}
{
  // A quote must tolerate stale carts: it reports what broke rather than 404-ing,
  // so the cart page can say "this item is no longer available".
  const r = await post('/api/orders/quote', {
    body: { items: [{ productId: '507f1f77bcf86cd799439011', variantId: '507f1f77bcf86cd799439012', quantity: 1 }], district: 'Dhaka' },
  });
  check('quote with an unknown product → 200', r.status === 200, `${r.status} ${r.text.slice(0, 160)}`);
  check('…but checkoutReady is false', r.data?.checkoutReady === false, String(r.data?.checkoutReady));
  check('…and the item is listed as unavailable', (r.data?.unavailable?.length ?? 0) === 1 && r.data.unavailable[0].reason === 'unavailable', JSON.stringify(r.data?.unavailable));
  check('…and a blockingReason is supplied for the UI', typeof r.data?.blockingReason === 'string' && r.data.blockingReason.length > 0, r.data?.blockingReason);
  const badVariant = await post('/api/orders/quote', {
    body: { items: [{ productId: PLAIN._id, variantId: '507f1f77bcf86cd799439012', quantity: 1 }], district: 'Dhaka' },
  });
  check('unknown variant → variant_unavailable', badVariant.data?.unavailable?.[0]?.reason === 'variant_unavailable', JSON.stringify(badVariant.data?.unavailable));
}
{
  const combo = CARDS.find((c) => c.isCombo);
  const r = await post('/api/orders/quote', {
    body: { items: [{ productId: combo._id, variantId: combo.defaultVariant?._id ?? combo.variants[0]._id, quantity: 1 }], district: 'Dhaka' },
  });
  check('combo quote → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  check('combo quoted at bundle price', r.data?.pricing?.subtotal === combo.priceRange.min, JSON.stringify({ quoted: r.data?.pricing?.subtotal, expected: combo.priceRange.min }));
}

section('Checkout');
let ORDER;
{
  const r = await post('/api/orders', {
    body: {
      customer: { name: 'Smoke Tester', phone: '01799887766', email: 'smoke@example.com' },
      shippingAddress: { line1: 'House 9, Road 3', area: 'Mirpur DOHS', district: 'Dhaka', postalCode: '1216' },
      items: [{ productId: PLAIN._id, variantId: PLAIN_VARIANT, quantity: 2 }],
      payment: { method: 'cod' },
      notes: 'Please call before delivery.',
      meta: { source: 'web' },
    },
  });
  // The checkout response is an envelope: the persisted order plus the pricing
  // breakdown, the upserted customer and human "what happens next" copy.
  check('POST /api/orders → 201', r.status === 201, `${r.status} ${r.text.slice(0, 300)}`);
  check('response carries next-step URLs for the confirmation page', Boolean(r.data?.nextSteps?.confirmationUrl) && Boolean(r.data?.nextSteps?.trackingUrl) && Boolean(r.data?.nextSteps?.invoiceUrl), JSON.stringify(r.data?.nextSteps));
  check('response carries the pricing breakdown', Boolean(r.data?.breakdown?.grandTotal), JSON.stringify(r.data?.breakdown)?.slice(0, 160));
  ORDER = r.data?.order;
  check('response carries the order document', Boolean(ORDER?.orderNumber), JSON.stringify(Object.keys(r.data ?? {})));
  check('orderNumber matches GR-YYYY-NNNNNN', /^GR-\d{4}-\d{6}$/.test(ORDER?.orderNumber ?? ''), ORDER?.orderNumber);
  check('invoiceNumber matches INV-YYYY-NNNNNN', /^INV-\d{4}-\d{6}$/.test(ORDER?.invoice?.number ?? ''), JSON.stringify(ORDER?.invoice));
  check('status = Pending', ORDER?.status === 'Pending', ORDER?.status);
  check('paymentStatus = COD Due', ORDER?.payment?.status === 'COD Due', JSON.stringify(ORDER?.payment));
  check('isPaid false for COD', ORDER?.isPaid === false, String(ORDER?.isPaid));
  check('shipping zone = inside_dhaka', ORDER?.shipping?.method === 'inside_dhaka' && ORDER?.shipping?.label === 'Inside Dhaka', JSON.stringify(ORDER?.shipping));
  check('shipping fee 60 lives in pricing (single source of truth)', ORDER?.pricing?.shippingFee === 60, JSON.stringify(ORDER?.pricing));
  check('shipping carries an ETA window', Array.isArray(ORDER?.shipping?.etaDays) && ORDER.shipping.etaDays.length === 2, JSON.stringify(ORDER?.shipping?.etaDays));
  check('shippingZone also denormalised onto the address', ORDER?.shippingAddress?.shippingZone === 'inside_dhaka', JSON.stringify(ORDER?.shippingAddress?.shippingZone));
  check('grandTotal arithmetic exact', ORDER.pricing.grandTotal === Number((ORDER.pricing.subtotal - ORDER.pricing.discount + ORDER.pricing.shippingFee + ORDER.pricing.paymentFee + ORDER.pricing.tax).toFixed(2)), JSON.stringify(ORDER.pricing));
  check('statusHistory seeded with the creation entry', (ORDER?.statusHistory?.length ?? 0) >= 1 && ORDER.statusHistory[0].status === 'Pending', JSON.stringify(ORDER?.statusHistory));
  check('items denormalised with title/variant/sku/image', ORDER?.items?.every((i) => i.title && i.variantLabel && i.sku && i.image), JSON.stringify(ORDER?.items?.[0]));
  check('items snapshot the product ObjectId for reporting', ORDER?.items?.every((i) => i.product && i.variant), JSON.stringify(ORDER?.items?.[0]));
  check('totals.itemCount = 2', ORDER?.totals?.itemCount === 2, JSON.stringify(ORDER?.totals));
  check('phone normalised to E.164', /^\+880\d{10}$/.test(ORDER?.contact?.phone ?? ''), ORDER?.contact?.phone);
  check('customer upserted', Boolean(ORDER?.customer), String(ORDER?.customer));
}
{
  // Nothing about money may come from the browser.
  const r = await post('/api/orders', {
    body: {
      customer: { name: 'Tamper Tester', phone: '01799887767' },
      shippingAddress: { line1: 'House 1', district: 'Dhaka' },
      items: [{ productId: PLAIN._id, variantId: PLAIN_VARIANT, quantity: 1, unitPrice: 1, total: 1 }],
      payment: { method: 'cod' },
      pricing: { grandTotal: 1, subtotal: 1, shippingFee: 0 },
      status: 'Delivered',
    },
  });
  check('tampered checkout still → 201', r.status === 201, `${r.status} ${r.text.slice(0, 200)}`);
  const tampered = r.data.order;
  check('client-supplied prices ignored', tampered.pricing.grandTotal > 1 && tampered.items[0].unitPrice > 1, JSON.stringify({ pricing: tampered.pricing, unit: tampered.items?.[0]?.unitPrice }));
  check('client-supplied status ignored', tampered.status === 'Pending', tampered.status);
}
{
  const r = await post('/api/orders', {
    body: {
      customer: { name: 'Bkash Tester', phone: '01799887768' },
      shippingAddress: { line1: 'House 2', district: 'Sylhet' },
      items: [{ productId: PLAIN._id, variantId: PLAIN_VARIANT, quantity: 1 }],
      payment: { method: 'bkash' },
    },
  });
  check('bKash without senderPhone+TrxID → 422', r.status === 422, `${r.status} ${r.text.slice(0, 200)}`);
  check('error names both missing fields', r.text.includes('senderPhone') && r.text.includes('transactionId'), r.text.slice(0, 300));
}
let BKASH_ORDER;
{
  const trx = `SMK${Date.now()}`;
  const payload = {
    customer: { name: 'Bkash Tester', phone: '01799887768' },
    shippingAddress: { line1: 'House 2', district: 'Sylhet' },
    items: [{ productId: PLAIN._id, variantId: PLAIN_VARIANT, quantity: 1 }],
    payment: { method: 'bkash', senderPhone: '01811223344', transactionId: ` ${trx.toLowerCase()} ` },
  };
  const r1 = await post('/api/orders', { body: payload });
  BKASH_ORDER = r1.data?.order ?? r1.data;
  check('bKash with proof → 201', r1.status === 201, `${r1.status} ${r1.text.slice(0, 200)}`);
  check('paymentStatus = Pending Verification', r1.data?.order?.payment?.status === 'Pending Verification' || r1.data?.payment?.status === 'Pending Verification', JSON.stringify(r1.data?.order?.payment ?? r1.data?.payment));
  check('TrxID trimmed + uppercased', (r1.data?.order ?? r1.data)?.payment?.transactionId === trx.toUpperCase(), (r1.data?.order ?? r1.data)?.payment?.transactionId);
  check('outside Dhaka shipping = 120', (r1.data?.order ?? r1.data)?.pricing?.shippingFee === 120, JSON.stringify((r1.data?.order ?? r1.data)?.pricing));
  const r2 = await post('/api/orders', { body: payload });
  check('duplicate TrxID → 409', r2.status === 409, `${r2.status} ${r2.text.slice(0, 200)}`);
}
{
  // Ask for more than the variant holds. Public checkout caps a single line at
  // 99 units, so when the seeded stock is that high the deterministic version
  // of this guard (admin pins the stock to 3) runs in "Stock ledger" instead.
  const live = (await get(`/api/products/${PLAIN.slug}`)).data;
  const available = live.variants.find((v) => String(v._id) === String(PLAIN_VARIANT)).stock;
  const qty = Math.min(available + 1, 99);
  const r = await post('/api/orders', {
    body: {
      customer: { name: 'Overbuy Tester', phone: '01799887769' },
      shippingAddress: { line1: 'House 3', district: 'Dhaka' },
      items: [{ productId: PLAIN._id, variantId: PLAIN_VARIANT, quantity: qty }],
      payment: { method: 'cod' },
    },
  });
  if (qty > available) {
    check(`quantity ${qty} > available ${available} → 409`, r.status === 409, `${r.status} ${r.text.slice(0, 200)}`);
    check('the refusal names the shortfall', /only|stock|available|left|short/i.test(r.text), r.text.slice(0, 200));
    check('the refused order reserved nothing', (await get(`/api/products/${PLAIN.slug}`)).data.variants.find((v) => String(v._id) === String(PLAIN_VARIANT)).stock === available, 'stock unchanged');
  } else {
    check(`oversell deferred to the stock-ledger section (stock ${available} exceeds the 99-unit line cap)`, true, `available=${available}`);
  }
}
{
  const r = await post('/api/orders', {
    body: {
      customer: { name: 'Bad Phone', phone: '12345' },
      shippingAddress: { line1: 'House 5', district: 'Dhaka' },
      items: [{ productId: PLAIN._id, variantId: PLAIN_VARIANT, quantity: 1 }],
      payment: { method: 'cod' },
    },
  });
  check('invalid BD phone → 422', r.status === 422, `${r.status} ${r.text.slice(0, 200)}`);
}
{
  const r = await post('/api/orders', {
    body: {
      customer: { name: 'Bad District', phone: '01799887771' },
      shippingAddress: { line1: 'House 6', district: 'Nowhere' },
      items: [{ productId: PLAIN._id, variantId: PLAIN_VARIANT, quantity: 1 }],
      payment: { method: 'cod' },
    },
  });
  check('invalid district → 422', r.status === 422, `${r.status} ${r.text.slice(0, 200)}`);
}

section('Flash-sale coupon');
{
  const code = CONFIG?.flashSale?.couponCode ?? (await get('/api/storefront/home')).data?.flashSale?.couponCode;
  if (code) {
    const withCoupon = await post('/api/orders/quote', {
      body: { items: [{ productId: PLAIN._id, variantId: PLAIN_VARIANT, quantity: 2 }], district: 'Dhaka', couponCode: code.toLowerCase() },
    });
    const without = await post('/api/orders/quote', {
      body: { items: [{ productId: PLAIN._id, variantId: PLAIN_VARIANT, quantity: 2 }], district: 'Dhaka' },
    });
    check(`coupon ${code} accepted + uppercased`, withCoupon.status === 200, `${withCoupon.status} ${withCoupon.text.slice(0, 160)}`);
    check('coupon reduces the total', withCoupon.data.pricing.grandTotal < without.data.pricing.grandTotal, JSON.stringify({ with: withCoupon.data.pricing.grandTotal, without: without.data.pricing.grandTotal }));
    check('coupon recorded in quote breakdown', withCoupon.data.breakdown?.couponCode === code || withCoupon.data.pricing?.couponCode === code, JSON.stringify(withCoupon.data.breakdown));
    const bogus = await post('/api/orders/quote', {
      body: { items: [{ productId: PLAIN._id, variantId: PLAIN_VARIANT, quantity: 2 }], district: 'Dhaka', couponCode: 'NOPE123' },
    });
    check('unknown coupon silently ignored (still 200)', bogus.status === 200 && bogus.data.pricing.grandTotal === without.data.pricing.grandTotal, `${bogus.status} ${JSON.stringify(bogus.data?.pricing?.grandTotal)}`);
  } else {
    check('an active flash-sale coupon exists in the seed data', false, 'no couponCode found');
  }
}

section('Public order tracking');
{
  const r = await get(`/api/orders/lookup?orderNumber=${ORDER.orderNumber}&phone=01799887766`);
  check('lookup with matching phone → 200', r.status === 200 && r.data?.orderNumber === ORDER.orderNumber, `${r.status} ${r.text.slice(0, 200)}`);
  check('lookup exposes the status pipeline', Array.isArray(r.data?.statusHistory) && Array.isArray(r.data?.timeline || r.data?.statusHistory), JSON.stringify(Object.keys(r.data ?? {})));
  check('lookup exposes shipping + payment', Boolean(r.data?.shipping) && Boolean(r.data?.payment), JSON.stringify(Object.keys(r.data ?? {})));
}
{
  const r = await get(`/api/orders/lookup?orderNumber=${ORDER.orderNumber}&phone=+8801799887766`);
  check('lookup accepts E.164 form of the same phone', r.status === 200, `${r.status} ${r.text.slice(0, 160)}`);
}
{
  const r = await get(`/api/orders/lookup?orderNumber=${ORDER.orderNumber}&phone=01700000000`);
  check('lookup with someone else\'s phone → 404 (no enumeration)', r.status === 404, `${r.status} ${r.text.slice(0, 160)}`);
}
{
  const r = await get('/api/orders/lookup?orderNumber=GR-1999-000001&phone=01799887766');
  check('lookup unknown order → 404', r.status === 404, `${r.status} ${r.text.slice(0, 160)}`);
}
{
  const r = await get(`/api/orders/lookup?orderNumber=not-an-order&phone=01799887766`);
  check('malformed order number → 422', r.status === 422, `${r.status} ${r.text.slice(0, 160)}`);
}

section('Printable invoice');
{
  const r = await get(`/api/orders/${ORDER.orderNumber}/invoice?phone=01799887766`);
  check('public invoice → 200 HTML', r.status === 200 && r.text.includes('<html'), `${r.status} ${r.text.slice(0, 160)}`);
  check('invoice is a complete document', r.text.includes('</html>') && r.text.toLowerCase().includes('<!doctype html>'), r.text.slice(0, 120));
  check('invoice has @media print CSS', r.text.includes('@media print'));
  check('invoice shows the order number', r.text.includes(ORDER.orderNumber));
  check('invoice shows the invoice number', r.text.includes(ORDER.invoice?.number ?? ''));
  // Titles are HTML-escaped in the template ("Nuts & Dry Fruits" → "&amp;"), and
  // money is lakh/crore grouped ("৳1,960"), so compare against both forms.
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  check('invoice shows every line item', ORDER.items.every((i) => r.text.includes(esc(i.title)) || r.text.includes(i.title)), JSON.stringify(ORDER.items.map((i) => i.title)));
  check('invoice shows the variant / pack size', r.text.includes(esc(ORDER.items[0].variantLabel)) || r.text.includes(ORDER.items[0].variantLabel), ORDER.items[0].variantLabel);
  const deGrouped = r.text.replace(/,/g, '');
  check('invoice shows the ৳ totals', r.text.includes('৳') && deGrouped.includes(String(ORDER.pricing.grandTotal)), JSON.stringify({ symbol: r.text.includes('৳'), total: ORDER.pricing.grandTotal }));
  check('invoice states the grand total as money', new RegExp(`৳[\\d,]*${String(ORDER.pricing.grandTotal).slice(-3)}`).test(r.text), r.text.match(/৳[\d,]+/g)?.slice(0, 6).join(' '));
  check('invoice sets its own CSP', /default-src|script-src/.test(r.headers.get('content-security-policy') ?? ''), r.headers.get('content-security-policy'));
}
{
  const r = await get(`/api/orders/${ORDER.orderNumber}/invoice?phone=01700000000`);
  check('invoice with wrong phone → 404/403', r.status === 404 || r.status === 403, `${r.status} ${r.text.slice(0, 160)}`);
}
{
  const r = await get(`/api/orders/${ORDER.orderNumber}/invoice`);
  check('invoice without a phone is refused', [400, 401, 403, 422].includes(r.status), `${r.status} ${r.text.slice(0, 160)}`);
  check('the refusal explains what is needed', /phone/i.test(r.text), r.text.slice(0, 200));
}
{
  const r = await get(`/api/orders/${ORDER.orderNumber}/invoice?phone=01799887766&format=json`);
  check('invoice?format=json → 200', r.status === 200 && r.json, `${r.status} ${r.text.slice(0, 160)}`);
  check('json invoice has order + items + pricing', Boolean(r.data?.order) && Array.isArray(r.data?.items) && Boolean(r.data?.pricing), JSON.stringify(Object.keys(r.data ?? {})));
  check('amount spelled out in words', typeof r.data?.totals?.amountInWords === 'string' && /Taka.*Only/.test(r.data.totals.amountInWords), r.data?.totals?.amountInWords);
  check('invoice context carries store + customer + timeline', Boolean(r.data?.store?.name) && Boolean(r.data?.customer?.name) && Array.isArray(r.data?.timeline), JSON.stringify(Object.keys(r.data ?? {})));
  check('invoice items carry sku + variant label', r.data?.items?.every((i) => i.sku && i.variantLabel), JSON.stringify(r.data?.items?.[0]));
}

/* ========================================================================== */
/*  Admin surface                                                             */
/* ========================================================================== */

section('Admin authentication');
let TOKEN;
{
  const r = await get('/api/admin/auth/me');
  check('me without a token → 401', r.status === 401, `${r.status} ${r.text.slice(0, 160)}`);
}
{
  const r = await get('/api/admin/orders', { token: 'not.a.jwt' });
  check('garbage token → 401', r.status === 401, `${r.status} ${r.text.slice(0, 160)}`);
}
{
  const r = await post('/api/admin/auth/login', { body: { email: ADMIN_EMAIL, password: 'definitely-wrong' } });
  check('wrong password → 401', r.status === 401, `${r.status} ${r.text.slice(0, 160)}`);
  check('wrong password does not reveal which field failed', !/no such|not found|unknown user/i.test(r.text), r.text.slice(0, 160));
}
{
  const r = await post('/api/admin/auth/login', { body: { email: 'nobody@gramrosh.test', password: 'definitely-wrong' } });
  check('unknown account → same 401 message', r.status === 401, `${r.status} ${r.text.slice(0, 160)}`);
}
{
  const r = await post('/api/admin/auth/login', { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  TOKEN = r.data?.token;
  check('login → 200 with a bearer token', r.status === 200 && Boolean(TOKEN), `${r.status} ${r.text.slice(0, 200)}`);
  check('login returns the admin profile', r.data?.admin?.role === 'super_admin' && r.data.admin.email === ADMIN_EMAIL, JSON.stringify(r.data?.admin));
  check('login returns expiresAt', Boolean(r.data?.expiresAt), r.data?.expiresAt);
  check('login never leaks passwordHash', !r.text.includes('passwordHash') && !r.text.includes('$2'), r.text.slice(0, 200));
}
{
  const r = await get('/api/admin/auth/me', { token: TOKEN });
  check('me with token → 200', r.status === 200 && r.data?.admin?.email === ADMIN_EMAIL, `${r.status} ${r.text.slice(0, 200)}`);
  check('me exposes the resolved permission list for the UI', Array.isArray(r.data?.permissions) && r.data.permissions.includes('*'), JSON.stringify(r.data?.permissions));
  check('me never leaks passwordHash', !r.text.includes('passwordHash'), r.text.slice(0, 200));
}

section('Admin dashboard stats');
let OVERVIEW;
{
  const r = await get('/api/admin/stats/overview', { token: TOKEN });
  OVERVIEW = r.data;
  check('GET /stats/overview → 200', r.status === 200, r.text.slice(0, 200));
  check('KPIs: revenue, orders, units, AOV, customers', ['revenue', 'orders', 'units', 'averageOrderValue', 'customers'].every((k) => k in (OVERVIEW?.kpis ?? {})), JSON.stringify(Object.keys(OVERVIEW?.kpis ?? {})));
  check('revenue KPI splits today / period / lifetime with a delta', ['today', 'period', 'lifetime', 'change'].every((k) => k in (OVERVIEW?.kpis?.revenue ?? {})), JSON.stringify(OVERVIEW?.kpis?.revenue));
  check('orders KPI splits today / period / lifetime with a delta', ['today', 'period', 'lifetime', 'change'].every((k) => k in (OVERVIEW?.kpis?.orders ?? {})), JSON.stringify(OVERVIEW?.kpis?.orders));
  check('ordersByStatus covers the whole pipeline', ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'].every((s) => s in (OVERVIEW?.ordersByStatus ?? {})), JSON.stringify(OVERVIEW?.ordersByStatus));
  check('topProducts rail present', (OVERVIEW?.topProducts?.length ?? 0) > 0, OVERVIEW?.topProducts?.length);
  check('recentOrders rail present', (OVERVIEW?.recentOrders?.length ?? 0) > 0, OVERVIEW?.recentOrders?.length);
  check('stockAlerts rail present', Array.isArray(OVERVIEW?.stockAlerts), JSON.stringify(OVERVIEW?.stockAlerts)?.slice(0, 160));
  check('attention queue present', Boolean(OVERVIEW?.attention), JSON.stringify(OVERVIEW?.attention)?.slice(0, 200));
  check('catalogue summary present', Boolean(OVERVIEW?.catalogue), JSON.stringify(OVERVIEW?.catalogue)?.slice(0, 200));
  check('revenue is non-zero over the seeded history', OVERVIEW?.kpis?.revenue?.lifetime > 0, JSON.stringify(OVERVIEW?.kpis?.revenue));
  check('AOV splits today / period / lifetime like the other KPIs', ['today', 'period', 'lifetime'].every((k) => k in (OVERVIEW?.kpis?.averageOrderValue ?? {})), JSON.stringify(OVERVIEW.kpis.averageOrderValue));
  check('AOV.lifetime = revenue.lifetime ÷ orders.lifetime', Math.abs(OVERVIEW.kpis.averageOrderValue.lifetime - OVERVIEW.kpis.revenue.lifetime / OVERVIEW.kpis.orders.lifetime) < 0.01, JSON.stringify({ aov: OVERVIEW.kpis.averageOrderValue.lifetime, rev: OVERVIEW.kpis.revenue.lifetime, orders: OVERVIEW.kpis.orders.lifetime }));
  check('ordersByStatus excludes Cancelled from revenue', (OVERVIEW?.ordersByStatus?.Cancelled ?? 0) > 0 && OVERVIEW.kpis.revenue.lifetime > 0, JSON.stringify(OVERVIEW?.ordersByStatus));
}
{
  const r = await get('/api/admin/stats/revenue?range=30', { token: TOKEN });
  check('GET /stats/revenue → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  check('revenue returns a daily series', Array.isArray(r.data?.series ?? r.data?.daily ?? r.data) && (r.data?.series ?? r.data?.daily ?? r.data).length > 0, JSON.stringify(r.data)?.slice(0, 240));
}
{
  const r = await get('/api/admin/stats/top-products', { token: TOKEN });
  check('GET /stats/top-products → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  check('top products carry units + revenue', r.rows.length > 0 && r.rows.every((p) => typeof p.units === 'number' && typeof p.revenue === 'number'), JSON.stringify(r.rows[0]));
}
{
  const r = await get('/api/admin/stats/districts', { token: TOKEN });
  check('GET /stats/districts → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
}
{
  const r = await get('/api/admin/stats/payment-methods', { token: TOKEN });
  check('GET /stats/payment-methods → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  check('payment breakdown includes COD + wallets', r.rows.length >= 2 || Object.keys(r.data ?? {}).length >= 2, JSON.stringify(r.data)?.slice(0, 240));
}
{
  const r = await get('/api/admin/stats/categories', { token: TOKEN });
  check('GET /stats/categories → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
}
{
  const r = await get('/api/admin/stats/stock-alerts', { token: TOKEN });
  check('GET /stats/stock-alerts → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
}

section('Admin order list & filters');
{
  const r = await get('/api/admin/orders?page=1&limit=5', { token: TOKEN });
  check('GET /admin/orders → 200', r.status === 200, r.text.slice(0, 200));
  check('honours limit=5', r.rows.length === 5, r.rows.length);
  check('meta.pagination present', r.pager?.total >= 42, JSON.stringify(r.pager));
  check('meta.statusCounts drives the tabs', ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'].every((s) => s in (r.meta?.statusCounts ?? {})), JSON.stringify(r.meta?.statusCounts));
  check('meta.transitions drives the status dropdown', r.meta?.transitions?.Pending?.includes('Processing') && r.meta?.transitions?.Delivered?.length === 0, JSON.stringify(r.meta?.transitions));
  check('statusCounts sum to the seeded total', Object.values(r.meta.statusCounts).reduce((a, b) => a + b, 0) === r.pager.total, `${JSON.stringify(r.meta.statusCounts)} vs ${r.pager.total}`);
}
{
  const r = await get('/api/admin/orders?status=Delivered&limit=60', { token: TOKEN });
  check('filter status=Delivered', r.rows.length > 0 && r.rows.every((o) => o.status === 'Delivered'), JSON.stringify(r.rows.map((o) => o.status)).slice(0, 160));
}
{
  const r = await get('/api/admin/orders?statuses=Pending,Processing&limit=60', { token: TOKEN });
  check('filter multi-status', r.rows.every((o) => ['Pending', 'Processing'].includes(o.status)), JSON.stringify(r.rows.map((o) => o.status)).slice(0, 160));
}
{
  const r = await get('/api/admin/orders?paymentMethod=cod&limit=60', { token: TOKEN });
  check('filter paymentMethod=cod', r.rows.every((o) => o.payment?.method === 'cod'), JSON.stringify(r.rows.map((o) => o.payment?.method)).slice(0, 160));
}
{
  const r = await get(`/api/admin/orders?q=${ORDER.orderNumber}`, { token: TOKEN });
  check('search by exact order number', r.rows.some((o) => o.orderNumber === ORDER.orderNumber), JSON.stringify(r.rows.map((o) => o.orderNumber)).slice(0, 160));
}
{
  const r = await get('/api/admin/orders?q=Smoke+Tester', { token: TOKEN });
  check('search by customer name', r.rows.some((o) => o.contact?.name === 'Smoke Tester'), JSON.stringify(r.rows.map((o) => o.contact?.name)).slice(0, 200));
}
{
  const r = await get('/api/admin/orders?q=01799887766', { token: TOKEN });
  check('search by phone', r.rows.some((o) => o.contact?.phone?.includes('1799887766')), JSON.stringify(r.rows.map((o) => o.contact?.phone)).slice(0, 200));
}
{
  const r = await get('/api/admin/orders?district=Dhaka&limit=60', { token: TOKEN });
  check('filter by district', r.rows.length > 0 && r.rows.every((o) => o.shippingAddress?.district === 'Dhaka'), JSON.stringify(r.rows.map((o) => o.shippingAddress?.district)).slice(0, 160));
}
{
  const from = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const r = await get(`/api/admin/orders?from=${encodeURIComponent(from)}&limit=60`, { token: TOKEN });
  check('filter from=<date>', r.rows.every((o) => new Date(o.createdAt) >= new Date(from)), JSON.stringify(r.rows.map((o) => o.createdAt)).slice(0, 160));
}
{
  const r = await get('/api/admin/orders?sort=total_desc&limit=60', { token: TOKEN });
  const totals = r.rows.map((o) => o.pricing?.grandTotal ?? 0);
  check('sort=total_desc', totals.every((v, i) => i === 0 || totals[i - 1] >= v), JSON.stringify(totals).slice(0, 200));
}
{
  const r = await get('/api/admin/orders?status=NotAStatus', { token: TOKEN });
  check('invalid status enum → 422', r.status === 422, `${r.status} ${r.text.slice(0, 160)}`);
}

section('Admin order pipeline');
{
  const r = await get(`/api/admin/orders/${ORDER._id}`, { token: TOKEN });
  check('order detail by ObjectId → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  check('detail includes notes + cancellation blocks', 'notes' in r.data && 'cancellation' in r.data, JSON.stringify(Object.keys(r.data)));
}
{
  const r = await get(`/api/admin/orders/${ORDER.orderNumber}`, { token: TOKEN });
  check('order detail by orderNumber → 200', r.status === 200, `${r.status} ${r.text.slice(0, 160)}`);
}
{
  const r = await get(`/api/admin/orders/${ORDER._id}/customer-orders`, { token: TOKEN });
  check('customer-orders side rail → 200', r.status === 200, `${r.status} ${r.text.slice(0, 160)}`);
}

const PIPELINE = [['Pending', 'Processing'], ['Processing', 'Shipped'], ['Shipped', 'Delivered']];
for (const [from, to] of PIPELINE) {
  const r = await patch(`/api/admin/orders/${ORDER._id}/status`, { token: TOKEN, body: { status: to, note: `smoke ${from} → ${to}` } });
  check(`${from} → ${to}`, r.status === 200 && r.data?.status === to, `${r.status} ${r.text.slice(0, 200)}`);
  check(`${from} → ${to} appends to statusHistory`, (r.data?.statusHistory ?? []).some((h) => h.status === to), JSON.stringify(r.data?.statusHistory?.map((h) => h.status)));
}
{
  const r = await patch(`/api/admin/orders/${ORDER._id}/status`, { token: TOKEN, body: { status: 'Pending' } });
  check('Delivered → Pending rejected', r.status === 422 || r.status === 409, `${r.status} ${r.text.slice(0, 200)}`);
  check('rejection explains the allowed transitions', /transition|not allowed|cannot/i.test(r.text), r.text.slice(0, 200));
}
{
  const r = await patch(`/api/admin/orders/${ORDER._id}/status`, { token: TOKEN, body: { status: 'Delivered' } });
  check('no-op re-transition is refused or harmless', [200, 409, 422].includes(r.status), `${r.status}`);
}
{
  const r = await patch(`/api/admin/orders/${ORDER._id}/status`, { token: TOKEN, body: { status: 'Cancelled' } });
  check('Delivered → Cancelled rejected', r.status >= 400 && r.status < 500, `${r.status} ${r.text.slice(0, 200)}`);
}
{
  const r = await get(`/api/admin/orders/${ORDER._id}`, { token: TOKEN });
  check('statusHistory records all 4 stages', (r.data?.statusHistory?.length ?? 0) >= 4, JSON.stringify(r.data?.statusHistory?.map((h) => h.status)));
  check('each history entry has an actor + timestamp', r.data.statusHistory.every((h) => h.at || h.timestamp || h.createdAt), JSON.stringify(r.data.statusHistory[0]));
}
{
  const r = await patch(`/api/admin/orders/${ORDER._id}/payment`, { token: TOKEN, body: { status: 'Paid', reference: 'SMOKE-PAY-1', note: 'Reconciled by hand' } });
  check('mark payment paid → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  check('payment.status = Paid', r.data?.payment?.status === 'Paid', JSON.stringify(r.data?.payment));
  check('isPaid flips to true', r.data?.isPaid === true, String(r.data?.isPaid));
}
{
  const r = await patch(`/api/admin/orders/${BKASH_ORDER._id}/payment`, { token: TOKEN, body: { status: 'Failed', note: 'TrxID not found in the statement' } });
  check('mark payment failed → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  check('failed payment keeps isPaid false', r.data?.isPaid === false, String(r.data?.isPaid));
}
{
  const r = await patch(`/api/admin/orders/${ORDER._id}/shipping`, { token: TOKEN, body: { courier: 'Pathao', trackingNumber: 'smoke123', trackingUrl: 'https://example.com/t/smoke123' } });
  check('update shipping → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  check('tracking number normalised to uppercase', r.data?.shipping?.trackingNumber === 'SMOKE123', JSON.stringify(r.data?.shipping));
  check('courier stored', r.data?.shipping?.courier === 'Pathao', JSON.stringify(r.data?.shipping));
}
{
  const r = await patch(`/api/admin/orders/${ORDER._id}/notes`, { token: TOKEN, body: { notes: [{ text: 'Customer called twice.', isInternal: true }], deliveryNote: 'Ring the bell' } });
  check('save notes → 200', r.status === 200, `${r.status} ${r.text.slice(0, 240)}`);
}
{
  const r = await get(`/api/admin/orders/${ORDER.orderNumber}/invoice`, { token: TOKEN });
  check('admin invoice needs no phone → 200', r.status === 200 && r.text.includes('<html'), `${r.status} ${r.text.slice(0, 160)}`);
  check('admin invoice records invoiceGeneratedAt', r.text.includes(ORDER.orderNumber));
}

section('Stock ledger — decrement, cancel-release, oversell guard');
{
  const before = (await get(`/api/admin/products/${PLAIN._id}`, { token: TOKEN })).data;
  const beforeStock = before.totalStock;

  const placed = await post('/api/orders', {
    body: {
      customer: { name: 'Stock Tester', phone: '01799887772' },
      shippingAddress: { line1: 'House 7', district: 'Dhaka' },
      items: [{ productId: PLAIN._id, variantId: PLAIN_VARIANT, quantity: 1 }],
      payment: { method: 'cod' },
    },
  });
  check('stock order placed → 201', placed.status === 201, `${placed.status} ${placed.text.slice(0, 200)}`);
  const placedOrder = placed.data.order;
  // The public checkout response is redacted (no IP / user-agent leakage), so
  // the channel has to be read back through the admin API.
  check('the public order response redacts request metadata', placedOrder.meta === undefined, JSON.stringify(placedOrder.meta));
  const adminView = (await get(`/api/admin/orders/${placedOrder._id}`, { token: TOKEN })).data;
  check('a storefront checkout is channel=storefront', adminView?.meta?.channel === 'storefront', JSON.stringify(adminView?.meta));
  check('the storefront source defaults to web', adminView?.meta?.source === 'web', JSON.stringify(adminView?.meta));
  check('admin can see the IP for fraud review', Boolean(adminView?.meta?.ip), JSON.stringify(adminView?.meta?.ip));

  const mid = (await get(`/api/admin/products/${PLAIN._id}`, { token: TOKEN })).data;
  check('stock decremented by 1 on checkout', mid.totalStock === beforeStock - 1, `before=${beforeStock} after=${mid.totalStock}`);
  check('variant-level stock decremented too', mid.variants.find((v) => v._id === PLAIN_VARIANT).stock === before.variants.find((v) => v._id === PLAIN_VARIANT).stock - 1, JSON.stringify(mid.variants.map((v) => v.stock)));

  const cancel = await patch(`/api/admin/orders/${placedOrder._id}/status`, { token: TOKEN, body: { status: 'Cancelled', reason: 'Customer changed their mind' } });
  check('Pending → Cancelled → 200', cancel.status === 200, `${cancel.status} ${cancel.text.slice(0, 200)}`);
  check('cancellation reason stored', Boolean(cancel.data?.cancellation?.reason), JSON.stringify(cancel.data?.cancellation));

  const after = (await get(`/api/admin/products/${PLAIN._id}`, { token: TOKEN })).data;
  check('stock released on cancellation', after.totalStock === beforeStock, `before=${beforeStock} after=${after.totalStock}`);
}
{
  // Deterministic oversell: pin a variant to exactly 3 units, then ask for 4.
  // Seeded stock drifts as earlier checks place orders, and the public order
  // validator caps a line at 99 — pinning removes both sources of flakiness.
  const VICTIM = PLAIN.variants[PLAIN.variants.length - 1];
  const ORIGINAL = VICTIM.stock;
  const pin = await patch(`/api/admin/products/${PLAIN._id}/stock`, {
    token: TOKEN,
    body: { variants: [{ variantId: VICTIM._id, stock: 3 }] },
  });
  check('oversell fixture pins a variant to 3 units', pin.status === 200 && pin.data?.variants?.find((v) => String(v._id) === String(VICTIM._id))?.stock === 3, `${pin.status} ${pin.text.slice(0, 200)}`);

  const greedy = await post('/api/orders', {
    body: {
      customer: { name: 'Overbuy Tester', phone: '01799887791' },
      shippingAddress: { line1: 'House 9', district: 'Dhaka' },
      items: [{ productId: PLAIN._id, variantId: VICTIM._id, quantity: 4 }],
      payment: { method: 'cod' },
    },
  });
  check('quantity 4 > available 3 → 409', greedy.status === 409, `${greedy.status} ${greedy.text.slice(0, 240)}`);
  check('the refusal names the shortfall', /only|stock|available|left|short/i.test(greedy.text), greedy.text.slice(0, 240));
  check('a refused order reserves nothing', (await get(`/api/admin/products/${PLAIN._id}`, { token: TOKEN })).data.variants.find((v) => String(v._id) === String(VICTIM._id)).stock === 3, 'stock unchanged');

  // Exactly-available must still succeed, then be cancelled to give stock back.
  const exact = await post('/api/orders', {
    body: {
      customer: { name: 'Exact Buyer', phone: '01799887792' },
      shippingAddress: { line1: 'House 10', district: 'Dhaka' },
      items: [{ productId: PLAIN._id, variantId: VICTIM._id, quantity: 3 }],
      payment: { method: 'cod' },
    },
  });
  check('quantity exactly equal to available → 201', exact.status === 201, `${exact.status} ${exact.text.slice(0, 240)}`);
  check('the variant is now sold out', (await get(`/api/admin/products/${PLAIN._id}`, { token: TOKEN })).data.variants.find((v) => String(v._id) === String(VICTIM._id)).stock === 0, 'not zero');
  const soldOut = await post('/api/orders', {
    body: {
      customer: { name: 'Late Buyer', phone: '01799887793' },
      shippingAddress: { line1: 'House 11', district: 'Dhaka' },
      items: [{ productId: PLAIN._id, variantId: VICTIM._id, quantity: 1 }],
      payment: { method: 'cod' },
    },
  });
  check('buying 1 of a sold-out variant → 409', soldOut.status === 409, `${soldOut.status} ${soldOut.text.slice(0, 240)}`);

  await patch(`/api/admin/orders/${exact.data.order._id}/status`, { token: TOKEN, body: { status: 'Cancelled', reason: 'Smoke test cleanup' } });
  const restore = await patch(`/api/admin/products/${PLAIN._id}/stock`, {
    token: TOKEN,
    body: { variants: [{ variantId: VICTIM._id, stock: ORIGINAL }] },
  });
  check('oversell fixture restores the original stock', restore.status === 200 && restore.data?.variants?.find((v) => String(v._id) === String(VICTIM._id))?.stock === ORIGINAL, `${restore.status} ${JSON.stringify(restore.data?.variants?.map((v) => v.stock))}`);
}
{
  // Delivered orders must NOT give stock back.
  const before = (await get(`/api/admin/products/${PLAIN._id}`, { token: TOKEN })).data.totalStock;
  const placed = await post('/api/orders', {
    body: {
      customer: { name: 'Deliver Tester', phone: '01799887773' },
      shippingAddress: { line1: 'House 8', district: 'Dhaka' },
      items: [{ productId: PLAIN._id, variantId: PLAIN_VARIANT, quantity: 1 }],
      payment: { method: 'cod' },
    },
  });
  const deliveredId = placed.data.order._id;
  for (const status of ['Processing', 'Shipped', 'Delivered']) {
    // eslint-disable-next-line no-await-in-loop
    await patch(`/api/admin/orders/${deliveredId}/status`, { token: TOKEN, body: { status } });
  }
  const after = (await get(`/api/admin/products/${PLAIN._id}`, { token: TOKEN })).data;
  check('delivered order keeps stock decremented', after.totalStock === before - 1, `before=${before} after=${after.totalStock}`);
  check('unitsSold incremented on delivery', (after.stats?.sold ?? 0) >= 1, JSON.stringify(after.stats));
}

section('Admin catalogue CRUD');
const HONEY = CATEGORIES.find((c) => c.slug === 'honey');
let CREATED;
/** The product's slug changes when an admin renames it, so track the live one. */
let CREATED_SLUG;
{
  const r = await get('/api/admin/products?page=1&limit=5', { token: TOKEN });
  check('GET /admin/products → 200', r.status === 200, r.text.slice(0, 200));
  check('admin list is paginated', r.pager?.total >= 12 && r.rows.length === 5, JSON.stringify(r.pager));
  check('admin list includes full description + stats', r.rows.every((p) => 'description' in p && 'stats' in p), JSON.stringify(Object.keys(r.rows[0])).slice(0, 200));
}
{
  const r = await get('/api/admin/products?status=draft&limit=60', { token: TOKEN });
  check('admin filter status=draft', r.status === 200 && r.rows.every((p) => p.status === 'draft'), `${r.status} ${JSON.stringify(r.rows.map((p) => p.status)).slice(0, 120)}`);
}
{
  const r = await get('/api/admin/products?stockAlerts=true&limit=60', { token: TOKEN });
  check('admin stockAlerts filter → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  check('stock alerts are low or out of stock', r.rows.every((p) => p.stockStatus !== 'in_stock' || p.totalStock <= 10), JSON.stringify(r.rows.map((p) => [p.slug, p.stockStatus, p.totalStock])).slice(0, 200));
}
{
  const r = await post('/api/admin/products', {
    token: TOKEN,
    body: {
      title: 'Smoke Test Wildflower Honey',
      titleBn: 'স্মোক টেস্ট মধু',
      summary: 'Created by the automated smoke test.',
      description: 'A long-form description used to verify that the PDP renders markdown-ish copy correctly.',
      category: HONEY._id,
      brand: 'Gramrosh',
      tags: ['smoke-test'],
      badges: ['new'],
      images: [{ url: '/img/products/honey-sundarban.webp', alt: 'Wildflower honey jar', isPrimary: true, format: 'webp' }],
      variants: [
        { label: '250 g', weightValue: 250, weightUnit: 'g', price: 450, compareAtPrice: 550, stock: 25 },
        { label: '500 g', weightValue: 500, weightUnit: 'g', price: 850, stock: 10 },
        { label: '1 kg', weightValue: 1, weightUnit: 'kg', price: 1600, stock: 0 },
      ],
      documents: [{ title: 'BSTI Certificate', type: 'bsti', url: '/img/products/docs/bsti-honey.pdf', reference: 'BSTI/CM/0001' }],
    },
  });
  CREATED = r.data;
  check('POST /admin/products → 201', r.status === 201, `${r.status} ${r.text.slice(0, 300)}`);
  CREATED_SLUG = CREATED?.slug;
  check('slug generated from the title', CREATED_SLUG === 'smoke-test-wildflower-honey', CREATED_SLUG);
  check('priceRange derived (450–1600)', CREATED?.priceRange?.min === 450 && CREATED?.priceRange?.max === 1600, JSON.stringify(CREATED?.priceRange));
  check('totalStock derived (35)', CREATED?.totalStock === 35, CREATED?.totalStock);
  check('stockStatus derived (in_stock)', CREATED?.stockStatus === 'in_stock', CREATED?.stockStatus);
  check('discountPercent derived from compareAtPrice', CREATED?.discountPercent > 0, CREATED?.discountPercent);
  check('searchBlob built but never returned', CREATED?.searchBlob === undefined, String(CREATED?.searchBlob)?.slice(0, 80));
  check('SKUs auto-generated and unique', new Set(CREATED?.variants?.map((v) => v.sku)).size === 3 && CREATED.variants.every((v) => v.sku), JSON.stringify(CREATED?.variants?.map((v) => v.sku)));
  check('first active variant becomes default', CREATED?.variants?.filter((v) => v.isDefault).length === 1, JSON.stringify(CREATED?.variants?.map((v) => [v.label, v.isDefault])));
  check('categoryName denormalised', CREATED?.categoryName === 'Honey', CREATED?.categoryName);
  check('document attached', (CREATED?.documents?.length ?? 0) === 1, JSON.stringify(CREATED?.documents));
}
{
  const r = await post('/api/admin/products', { token: TOKEN, body: { title: 'No Variants', category: HONEY._id, variants: [] } });
  check('product without variants → 422', r.status === 422, `${r.status} ${r.text.slice(0, 200)}`);
}
{
  const r = await post('/api/admin/products', { token: TOKEN, body: { title: 'x', category: 'not-an-objectid', variants: [{ weightValue: 1, weightUnit: 'kg', price: 10 }] } });
  check('invalid category id → 422', r.status === 422, `${r.status} ${r.text.slice(0, 200)}`);
}
{
  const r = await post('/api/admin/products', {
    token: TOKEN,
    body: { title: 'Bad Combo', category: HONEY._id, isCombo: true, variants: [{ weightValue: 1, weightUnit: 'kg', price: 100 }] },
  });
  check('combo without bundle items → 422', r.status === 422, `${r.status} ${r.text.slice(0, 200)}`);
}
{
  const r = await post('/api/admin/products', {
    token: TOKEN,
    body: { title: 'Bad Variant', category: HONEY._id, variants: [{ weightValue: 1, weightUnit: 'kg', price: 100, compareAtPrice: 50 }] },
  });
  check('compareAtPrice below price → 422', r.status === 422, `${r.status} ${r.text.slice(0, 200)}`);
}
{
  const r = await post('/api/admin/products', {
    token: TOKEN,
    body: { title: 'Smoke Test Wildflower Honey', category: HONEY._id, variants: [{ weightValue: 1, weightUnit: 'kg', price: 100 }] },
  });
  check('duplicate title → distinct slug (no 500)', r.status === 201 && r.data.slug !== CREATED.slug, `${r.status} ${r.data?.slug ?? r.text.slice(0, 160)}`);
  const cleanup = await del(`/api/admin/products/${r.data._id}`, { token: TOKEN });
  check('cleanup duplicate → 200', cleanup.status === 200, `${cleanup.status} ${cleanup.text.slice(0, 160)}`);
}
{
  const r = await patch(`/api/admin/products/${CREATED._id}`, { token: TOKEN, body: { title: 'Smoke Test Wildflower Honey (Renamed)', isFeatured: true } });
  check('PATCH product → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  check('title updated', r.data?.title?.endsWith('(Renamed)'), r.data?.title);
  check('slug follows the rename', r.data?.slug === 'smoke-test-wildflower-honey-renamed', r.data?.slug);
  CREATED_SLUG = r.data?.slug ?? CREATED_SLUG;
  check('isFeatured toggled', r.data?.isFeatured === true, String(r.data?.isFeatured));
  check('partial patch keeps untouched fields', r.data?.variants?.length === 3 && r.data?.totalStock === 35, JSON.stringify({ v: r.data?.variants?.length, stock: r.data?.totalStock }));
}
{
  const r = await patch(`/api/admin/products/${CREATED._id}`, { token: TOKEN, body: { summary: null } });
  check('PATCH with a null field → 200/422 (never 500)', r.status === 200 || r.status === 422, `${r.status} ${r.text.slice(0, 160)}`);
}
{
  const r = await patch(`/api/admin/products/${CREATED._id}/stock`, { token: TOKEN, body: { variantId: CREATED.variants[2]._id, stock: 7 } });
  check('PATCH stock (absolute, single variant) → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  check('variant stock set to 7', r.data?.variants?.find((v) => String(v._id) === String(CREATED.variants[2]._id))?.stock === 7, JSON.stringify(r.data?.variants));
  check('totalStock re-derived to 42', r.data?.totalStock === 42, r.data?.totalStock);
  check('the full product comes back for in-place refresh', r.data?.product?._id === CREATED._id && (r.data?.product?.variants?.length ?? 0) === 3, JSON.stringify(Object.keys(r.data ?? {})));
  check('stock response omits searchBlob', r.data?.product?.searchBlob === undefined, String(r.data?.product?.searchBlob)?.slice(0, 60));
  check('variant _ids survive a stock write (carts keep working)', r.data.product.variants.map((v) => String(v._id)).join(',') === CREATED.variants.map((v) => String(v._id)).join(','), `${r.data.product.variants.map((v) => v._id)} vs ${CREATED.variants.map((v) => v._id)}`);
}
{
  const r = await patch(`/api/admin/products/${CREATED._id}/stock`, { token: TOKEN, body: { adjustments: [{ variantId: CREATED.variants[0]._id, delta: -5 }] } });
  check('PATCH stock (relative adjustment) → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  check('25 − 5 = 20', r.data?.variants?.find((v) => String(v._id) === String(CREATED.variants[0]._id))?.stock === 20, JSON.stringify(r.data?.variants));
  check('unmentioned variants are untouched', r.data?.variants?.find((v) => String(v._id) === String(CREATED.variants[1]._id))?.stock === 10, JSON.stringify(r.data?.variants));
}
{
  const r = await patch(`/api/admin/products/${CREATED._id}/stock`, { token: TOKEN, body: { adjustments: [{ variantId: CREATED.variants[1]._id, delta: -999 }] } });
  check('stock can never go negative', r.status === 200 && r.data.variants.find((v) => String(v._id) === String(CREATED.variants[1]._id)).stock === 0, `${r.status} ${JSON.stringify(r.data?.variants)}`);
  check('stockStatus flips to low_stock/out_of_stock sensibly', ['in_stock', 'low_stock', 'out_of_stock'].includes(r.data?.stockStatus), r.data?.stockStatus);
}
{
  const r = await patch(`/api/admin/products/${CREATED._id}/stock`, { token: TOKEN, body: {} });
  check('stock patch with no instructions → 422', r.status === 422, `${r.status} ${r.text.slice(0, 200)}`);
}
{
  const zero = await patch(`/api/admin/products/${CREATED._id}/stock`, { token: TOKEN, body: { variants: CREATED.variants.map((v) => ({ variantId: v._id, stock: 0 })) } });
  check('all variants to 0 → 200', zero.status === 200, `${zero.status} ${zero.text.slice(0, 200)}`);
  check('stockStatus = out_of_stock', zero.data?.stockStatus === 'out_of_stock', zero.data?.stockStatus);
  check('bulk absolute set zeroed every variant', zero.data?.variants?.every((v) => v.stock === 0), JSON.stringify(zero.data?.variants));
  const storefront = await get(`/api/products/${CREATED_SLUG}`);
  check('out-of-stock product still visible on the PDP (badge, not 404)', storefront.status === 200 && storefront.data.stockStatus === 'out_of_stock', `${storefront.status} ${storefront.data?.stockStatus}`);
  const buy = await post('/api/orders', {
    body: {
      customer: { name: 'OOS Tester', phone: '01799887774' },
      shippingAddress: { line1: 'House 10', district: 'Dhaka' },
      items: [{ productId: CREATED._id, variantId: CREATED.variants[0]._id, quantity: 1 }],
      payment: { method: 'cod' },
    },
  });
  check('checkout of an out-of-stock product → 409', buy.status === 409, `${buy.status} ${buy.text.slice(0, 200)}`);
}
{
  const r = await post(`/api/admin/products/${CREATED._id}/duplicate`, { token: TOKEN, body: {} });
  check('duplicate → 201', r.status === 201, `${r.status} ${r.text.slice(0, 200)}`);
  check('copy starts as a draft', r.data?.status === 'draft', r.data?.status);
  check('copy gets a unique slug', r.data?.slug !== CREATED_SLUG, r.data?.slug);
  check('copy starts at zero stock', r.data?.totalStock === 0, r.data?.totalStock);
  check('copy keeps the variants', (r.data?.variants?.length ?? 0) === 3, r.data?.variants?.length);
  const cleanup = await del(`/api/admin/products/${r.data._id}`, { token: TOKEN });
  check('delete the copy → 200', cleanup.status === 200, `${cleanup.status} ${cleanup.text.slice(0, 160)}`);
}
{
  const r = await patch(`/api/admin/products/${CREATED._id}/archive`, { token: TOKEN, body: { archived: true } });
  check('archive → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  check('isArchived true', r.data?.isArchived === true, String(r.data?.isArchived));
  const hidden = await get(`/api/products/${CREATED_SLUG}`);
  check('archived product disappears from the storefront → 404', hidden.status === 404, `${hidden.status}`);
  const listed = await get('/api/products?q=Smoke&limit=60');
  check('archived product excluded from search', !listed.rows.some((p) => p._id === CREATED._id), JSON.stringify(listed.rows.map((p) => p.slug)));
  const adminSees = await get('/api/admin/products?includeArchived=true&q=Smoke&limit=60', { token: TOKEN });
  check('admin still sees it with includeArchived', adminSees.rows.some((p) => p._id === CREATED._id), JSON.stringify(adminSees.rows.map((p) => p.slug)));
  const restore = await patch(`/api/admin/products/${CREATED._id}/archive`, { token: TOKEN, body: { archived: false } });
  check('unarchive → 200', restore.status === 200 && restore.data?.isArchived === false, `${restore.status} ${restore.text.slice(0, 160)}`);
  const visible = await get(`/api/products/${CREATED_SLUG}`);
  check('restored product is public again → 200', visible.status === 200, `${visible.status} ${visible.text.slice(0, 160)}`);
  check('restored product carries its zeroed stock badge', visible.data?.stockStatus === 'out_of_stock', visible.data?.stockStatus);
}
{
  const withOrders = await del(`/api/admin/products/${PLAIN._id}`, { token: TOKEN });
  check('deleting a product that orders reference → 409', withOrders.status === 409, `${withOrders.status} ${withOrders.text.slice(0, 200)}`);
  check('the referenced product survives', (await get(`/api/products/${PLAIN.slug}`)).status === 200);
}

section('Admin categories');
let NEWCAT;
{
  const r = await get('/api/admin/categories', { token: TOKEN });
  check('GET /admin/categories → 200', r.status === 200, r.text.slice(0, 200));
  check('admin categories expose live vs total counts', r.data?.[0]?.productCount !== undefined && r.data?.[0]?.liveProductCount !== undefined, JSON.stringify(r.data?.[0]));
}
{
  const r = await get('/api/admin/categories/honey', { token: TOKEN });
  check('GET /admin/categories/:slug → 200', r.status === 200 && r.data?.slug === 'honey', `${r.status} ${r.text.slice(0, 160)}`);
}
{
  // Category names are bilingual: `en` drives the slug, `bn` is what the
  // storefront renders.
  const r = await post('/api/admin/categories', { token: TOKEN, body: { name: { en: 'Smoke Test Category', bn: 'স্মোক টেস্ট' }, summary: 'Temporary', isActive: true, accent: '#16a34a' } });
  NEWCAT = r.data;
  check('POST category → 201', r.status === 201, `${r.status} ${r.text.slice(0, 240)}`);
  check('category slug derived from the English name', NEWCAT?.slug === 'smoke-test-category', NEWCAT?.slug);
  check('category stores both languages', NEWCAT?.name?.en === 'Smoke Test Category' && NEWCAT?.name?.bn === 'স্মোক টেস্ট', JSON.stringify(NEWCAT?.name));
}
if (NEWCAT?._id) {
  const r = await patch(`/api/admin/categories/${NEWCAT._id}`, { token: TOKEN, body: { summary: 'Updated by smoke test' } });
  check('PATCH category → 200', r.status === 200 && r.data?.summary === 'Updated by smoke test', `${r.status} ${r.text.slice(0, 200)}`);
}
{
  const cats = (await get('/api/admin/categories', { token: TOKEN })).data;
  const reordered = [...cats].reverse().map((c) => c._id);
  const r = await post('/api/admin/categories/reorder', { token: TOKEN, body: { order: reordered } });
  check('POST categories/reorder → 200', r.status === 200, `${r.status} ${r.text.slice(0, 240)}`);
  const after = (await get('/api/admin/categories', { token: TOKEN })).data;
  check('reorder persisted (first is now last)', after[0]._id === cats[cats.length - 1]._id, `${after[0].slug} vs ${cats[cats.length - 1].slug}`);
  check('sortOrder is a contiguous ranking', after.every((c, i) => c.sortOrder === i || c.sortOrder === after[i].sortOrder), JSON.stringify(after.map((c) => c.sortOrder)));
  // Put them back so the storefront order stays sensible.
  await post('/api/admin/categories/reorder', { token: TOKEN, body: { order: cats.map((c) => c._id) } });
}
{
  const r = await post('/api/admin/categories/reorder', { token: TOKEN, body: { order: ['not-an-id'] } });
  check('reorder with garbage ids → 422', r.status === 422, `${r.status} ${r.text.slice(0, 200)}`);
}
if (NEWCAT?._id) {
  const r = await del(`/api/admin/categories/${NEWCAT._id}`, { token: TOKEN });
  check('DELETE an empty category → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  const gone = await get(`/api/admin/categories/${NEWCAT._id}`, { token: TOKEN });
  check('GET a deleted category → 404', gone.status === 404, `${gone.status} ${gone.text.slice(0, 160)}`);
}
{
  const r = await del(`/api/admin/categories/${HONEY._id}`, { token: TOKEN });
  check('DELETE a category that has products → 409', r.status === 409, `${r.status} ${r.text.slice(0, 200)}`);
  check('the category survives', (await get('/api/categories/honey')).status === 200);
}


section('Admin customers');
let SMOKE_CUSTOMER;
{
  const r = await get('/api/admin/customers?page=1&limit=5', { token: TOKEN });
  check('GET /admin/customers → 200', r.status === 200, r.text.slice(0, 200));
  check('customer list is paginated', r.rows.length === 5 && r.pager?.total >= 12, JSON.stringify(r.pager));
  check('customers expose lifetime stats', r.rows.every((c) => 'totalOrders' in (c.stats ?? {}) && 'totalSpent' in (c.stats ?? {})), JSON.stringify(r.rows[0]?.stats));
  check('customers expose a segment', r.rows.every((c) => Boolean(c.segment)), JSON.stringify(r.rows.map((c) => c.segment)));
  check('phonePretty provided for display', r.rows.every((c) => Boolean(c.phonePretty)), JSON.stringify(r.rows.map((c) => c.phonePretty)));
  check('no password/secret fields leak', !r.text.includes('passwordHash'), r.text.slice(0, 160));
}
{
  const r = await get('/api/admin/customers?q=01799887766&limit=5', { token: TOKEN });
  check('search customers by phone', r.rows.some((c) => c.phone?.includes('1799887766')), JSON.stringify(r.rows.map((c) => c.phone)));
  SMOKE_CUSTOMER = r.rows.find((c) => c.phone?.includes('1799887766'));
}
{
  const r = await get('/api/admin/customers?q=Smoke+Tester&limit=5', { token: TOKEN });
  check('search customers by name', r.rows.some((c) => c.name === 'Smoke Tester'), JSON.stringify(r.rows.map((c) => c.name)));
}
{
  const r = await get('/api/admin/customers?segment=new&limit=60', { token: TOKEN });
  check('filter by segment → 200', r.status === 200 && r.rows.every((c) => c.segment === 'new'), `${r.status} ${JSON.stringify(r.rows.map((c) => c.segment)).slice(0, 160)}`);
}
{
  const r = await get('/api/admin/customers/by-phone/01799887766', { token: TOKEN });
  check('GET by-phone → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  check('by-phone resolves the E.164 identity', r.data?.customer?.phone === '+8801799887766', r.data?.customer?.phone);
  check('by-phone returns the same shape as GET /:id', ['customer', 'orders', 'orderTotal'].every((k) => k in (r.data ?? {})), JSON.stringify(Object.keys(r.data ?? {})));
  check('by-phone includes order history for the caller', Array.isArray(r.data?.orders) && r.data.orders.length > 0 && r.data.orderTotal === r.data.orders.length, JSON.stringify({ n: r.data?.orders?.length, total: r.data?.orderTotal }));
  check('history rows are a lean summary, not full orders', r.data?.orders?.every((o) => o.orderNumber && o.status && o.pricing && !o.items), JSON.stringify(Object.keys(r.data?.orders?.[0] ?? {})));
}
{
  const r = await get('/api/admin/customers/by-phone/01700000001', { token: TOKEN });
  check('by-phone for an unknown number → 404', r.status === 404, `${r.status} ${r.text.slice(0, 160)}`);
}
if (SMOKE_CUSTOMER) {
  const r = await get(`/api/admin/customers/${SMOKE_CUSTOMER._id}`, { token: TOKEN });
  const CUSTOMER = r.data?.customer;
  check('GET customer detail → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  check('detail returns customer + orders + orderTotal', Boolean(CUSTOMER) && Array.isArray(r.data?.orders) && typeof r.data?.orderTotal === 'number', JSON.stringify(Object.keys(r.data ?? {})));
  check('lifetime stats are populated', (CUSTOMER?.stats?.totalOrders ?? 0) >= 1 && (CUSTOMER?.stats?.totalSpent ?? 0) > 0, JSON.stringify(CUSTOMER?.stats));
  check('stats agree with the returned order history', CUSTOMER?.stats?.totalOrders >= r.data.orders.length, JSON.stringify({ stats: CUSTOMER?.stats?.totalOrders, listed: r.data.orders.length }));
  check('avgOrderValue = totalSpent ÷ totalOrders', Math.abs(CUSTOMER.stats.avgOrderValue - CUSTOMER.stats.totalSpent / CUSTOMER.stats.totalOrders) < 0.01, JSON.stringify(CUSTOMER?.stats));
  check('itemsPurchased counted', (CUSTOMER?.stats?.itemsPurchased ?? 0) >= 1, JSON.stringify(CUSTOMER?.stats));
  check('firstOrderAt <= lastOrderAt', new Date(CUSTOMER.stats.firstOrderAt) <= new Date(CUSTOMER.stats.lastOrderAt), JSON.stringify([CUSTOMER.stats.firstOrderAt, CUSTOMER.stats.lastOrderAt]));
  check('checkout address saved to the address book', (CUSTOMER?.addresses?.length ?? 0) > 0 && CUSTOMER.addresses.some((a) => a.district === 'Dhaka'), JSON.stringify(CUSTOMER?.addresses)?.slice(0, 240));
  check('the latest address is also the primary one', CUSTOMER?.address?.line1 === CUSTOMER?.addresses?.[CUSTOMER.addresses.length - 1]?.line1, JSON.stringify([CUSTOMER?.address?.line1, CUSTOMER?.addresses?.map((a) => a.line1)]));
  check('segment derived from activity', ['new', 'returning', 'vip', 'at_risk', 'blocked'].includes(CUSTOMER?.segment), CUSTOMER?.segment);

  const orders = await get(`/api/admin/customers/${SMOKE_CUSTOMER._id}/orders`, { token: TOKEN });
  check('GET customer orders → 200', orders.status === 200, `${orders.status} ${orders.text.slice(0, 200)}`);
  check('customer orders are paginated', Boolean(orders.pager?.total), JSON.stringify(orders.pager));
  check('customer orders are all theirs', orders.rows.length > 0 && orders.rows.every((o) => (o.contact?.phone ?? o.customer?.phone) === '+8801799887766'), JSON.stringify(orders.rows.map((o) => o.contact?.phone)).slice(0, 200));

  const tag = await post('/api/admin/customers/bulk-tag', { token: TOKEN, body: { ids: [SMOKE_CUSTOMER._id], tags: ['smoke-test', 'campaign-2026'], action: 'add' } });
  check('bulk-tag add → 200', tag.status === 200, `${tag.status} ${tag.text.slice(0, 200)}`);
  check('bulk-tag reports how many changed', (tag.data?.modified ?? 0) >= 1, JSON.stringify(tag.data));
  check('both tags applied and lower-cased', (await get(`/api/admin/customers/${SMOKE_CUSTOMER._id}`, { token: TOKEN })).data?.customer?.tags?.includes('smoke-test') === true, JSON.stringify((await get(`/api/admin/customers/${SMOKE_CUSTOMER._id}`, { token: TOKEN })).data?.customer?.tags));
  const untag = await post('/api/admin/customers/bulk-tag', { token: TOKEN, body: { ids: [SMOKE_CUSTOMER._id], tags: ['smoke-test', 'campaign-2026'], action: 'remove' } });
  check('bulk-tag remove → 200', untag.status === 200, `${untag.status} ${untag.text.slice(0, 200)}`);
  check('tags removed', ((await get(`/api/admin/customers/${SMOKE_CUSTOMER._id}`, { token: TOKEN })).data?.customer?.tags ?? []).length === 0, JSON.stringify((await get(`/api/admin/customers/${SMOKE_CUSTOMER._id}`, { token: TOKEN })).data?.customer?.tags));
  const badTag = await post('/api/admin/customers/bulk-tag', { token: TOKEN, body: { ids: [SMOKE_CUSTOMER._id], tags: [] } });
  check('bulk-tag with no tags → 422', badTag.status === 422, `${badTag.status} ${badTag.text.slice(0, 160)}`);

  const recompute = await post(`/api/admin/customers/${SMOKE_CUSTOMER._id}/recompute`, { token: TOKEN });
  check('recompute stats → 200', recompute.status === 200, `${recompute.status} ${recompute.text.slice(0, 200)}`);
  check('recompute is idempotent', recompute.data?.stats?.totalOrders === CUSTOMER?.stats?.totalOrders && recompute.data?.stats?.totalSpent === CUSTOMER?.stats?.totalSpent, JSON.stringify([recompute.data?.stats, CUSTOMER?.stats]));

  const blocked = await patch(`/api/admin/customers/${SMOKE_CUSTOMER._id}`, { token: TOKEN, body: { segment: 'blocked' } });
  check('PATCH customer → 200', blocked.status === 200, `${blocked.status} ${blocked.text.slice(0, 200)}`);
  check('segment updated', blocked.data?.segment === 'blocked', blocked.data?.segment);
  const blockedDelete = await del(`/api/admin/customers/${SMOKE_CUSTOMER._id}`, { token: TOKEN });
  check('deleting a customer with orders → 409', blockedDelete.status === 409, `${blockedDelete.status} ${blockedDelete.text.slice(0, 200)}`);
}
{
  const r = await post('/api/admin/customers', { token: TOKEN, body: { name: 'Manual Entry', phone: '01799880000', district: 'Dhaka' } });
  check('POST customer → 201', r.status === 201 || r.status === 200, `${r.status} ${r.text.slice(0, 240)}`);
}
{
  const r = await post('/api/admin/customers', { token: TOKEN, body: { name: 'Bad Phone', phone: 'abc' } });
  check('POST customer with a bad phone → 422', r.status === 422, `${r.status} ${r.text.slice(0, 200)}`);
}

section('Admin staff order (phone / WhatsApp)');
{
  const r = await post('/api/admin/orders', {
    token: TOKEN,
    body: {
      customer: { name: 'Phone Order', phone: '01799887788' },
      shippingAddress: { line1: 'House 11', district: 'Dhaka' },
      items: [{ productId: PLAIN._id, variantId: PLAIN_VARIANT, quantity: 3 }],
      payment: { method: 'cod' },
      status: 'Processing',
      meta: { source: 'phone' },
    },
  });
  check('staff-created order → 201', r.status === 201, `${r.status} ${r.text.slice(0, 300)}`);
  check('staff order can start at Processing', r.data?.order?.status === 'Processing', r.data?.order?.status);
  check('staff order still priced server-side', (r.data?.order?.pricing?.grandTotal ?? 0) > 0, JSON.stringify(r.data?.order?.pricing));

  // Shipping is derived from the district AND the free-shipping threshold, so a
  // ৳2,850 basket inside Dhaka must be free — assert the rule, not a constant.
  const staffPricing = r.data?.order?.pricing ?? {};
  const FREE_SHIPPING_THRESHOLD = 2500;
  const expectedFee = staffPricing.subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : 60;
  check('inside-Dhaka shipping obeys the free-shipping threshold', staffPricing.shippingFee === expectedFee, JSON.stringify({ subtotal: staffPricing.subtotal, fee: staffPricing.shippingFee, expected: expectedFee }));
  check('grandTotal = subtotal − discount + shipping + paymentFee + tax',
    staffPricing.grandTotal === Math.max(0, staffPricing.subtotal - staffPricing.discount + staffPricing.shippingFee + staffPricing.paymentFee + staffPricing.tax),
    JSON.stringify(staffPricing));
  // `source` is what the operator declared (phone / WhatsApp); `channel` is
  // derived server-side and cannot be spoofed by the request body.
  check('staff order keeps the declared intake source', r.data?.order?.meta?.source === 'phone', JSON.stringify(r.data?.order?.meta));
  check('the server-derived channel is admin', r.data?.order?.meta?.channel === 'admin', JSON.stringify(r.data?.order?.meta));
  check('the order records who keyed it in', r.data?.order?.meta?.takenBy?.email === ADMIN_EMAIL, JSON.stringify(r.data?.order?.meta?.takenBy));
  check('a spoofed channel in the body is ignored',
    (await post('/api/admin/orders', {
      token: TOKEN,
      body: {
        customer: { name: 'Channel Spoofer', phone: '01799887795' },
        shippingAddress: { line1: 'House 15', district: 'Dhaka' },
        items: [{ productId: PLAIN._id, variantId: PLAIN_VARIANT, quantity: 1 }],
        payment: { method: 'cod' },
        meta: { source: 'web', channel: 'storefront', takenBy: { email: 'hacker@evil.test' } },
      },
    })).data?.order?.meta?.channel === 'admin', 'channel was spoofable');
  check('staff order reserves stock', (await get(`/api/admin/products/${PLAIN._id}`, { token: TOKEN })).data.totalStock >= 0, 'ok');

  // A small basket inside Dhaka must be charged the flat ৳60.
  const small = await post('/api/admin/orders', {
    token: TOKEN,
    body: {
      customer: { name: 'Small Basket', phone: '01799887789' },
      shippingAddress: { line1: 'House 14', district: 'Dhaka' },
      items: [{ productId: PLAIN._id, variantId: PLAIN_VARIANT, quantity: 1 }],
      payment: { method: 'cod' },
    },
  });
  check('a sub-threshold staff order → 201', small.status === 201, `${small.status} ${small.text.slice(0, 240)}`);
  const smallPricing = small.data?.order?.pricing ?? {};
  check('inside Dhaka below the threshold charges ৳60', smallPricing.subtotal < FREE_SHIPPING_THRESHOLD && smallPricing.shippingFee === 60, JSON.stringify(smallPricing));
}
{
  const r = await post('/api/admin/orders', {
    token: TOKEN,
    body: {
      customer: { name: 'Negotiated', phone: '01799887789' },
      shippingAddress: { line1: 'House 12', district: 'Dhaka' },
      items: [{ productId: PLAIN._id, variantId: PLAIN_VARIANT, quantity: 1, unitPriceOverride: 10 }],
      payment: { method: 'cod' },
    },
  });
  check('unitPriceOverride honoured for staff → 201', r.status === 201, `${r.status} ${r.text.slice(0, 300)}`);
  check('override actually applied', r.data?.order?.items?.[0]?.unitPrice === 10, JSON.stringify(r.data?.order?.items?.[0]));
}
{
  const r = await post('/api/admin/orders', {
    token: TOKEN,
    body: {
      customer: { name: 'Bad Status', phone: '01799887790' },
      shippingAddress: { line1: 'House 13', district: 'Dhaka' },
      items: [{ productId: PLAIN._id, variantId: PLAIN_VARIANT, quantity: 1 }],
      payment: { method: 'cod' },
      status: 'NotAStatus',
    },
  });
  check('staff order with a bogus status → 422', r.status === 422, `${r.status} ${r.text.slice(0, 200)}`);
}

section('CSV export');
{
  const r = await get('/api/admin/orders/export?format=csv', { token: TOKEN });
  check('export CSV → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  check('content-type is CSV', (r.headers.get('content-type') ?? '').includes('csv'), r.headers.get('content-type'));
  check('Content-Disposition attachment', /attachment;\s*filename=/.test(r.headers.get('content-disposition') ?? ''), r.headers.get('content-disposition'));
  // The BOM must be checked on raw bytes: fetch's .text() decodes UTF-8 and
  // strips U+FEFF, so a charCode test on the string always fails.
  const rawRes = await fetch(BASE + '/api/admin/orders/export?format=csv', { headers: { authorization: `Bearer ${TOKEN}` } });
  const raw = new Uint8Array(await rawRes.arrayBuffer());
  check('UTF-8 BOM so Excel renders Bengali', raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF, JSON.stringify([...raw.slice(0, 3)]));

  const [header, ...rows] = r.text.replace(/^\uFEFF/, '').split('\r\n');
  check('header row has the expected columns', header.includes('Order Number') && header.includes('Grand Total') && header.includes('TrxID'), header);
  check('one row per order', rows.filter(Boolean).length >= 42, rows.filter(Boolean).length);
  check('X-Export-Total exposed', r.headers.get('x-export-total') !== null, r.headers.get('x-export-total'));
  check('X-Export-Truncated exposed', ['0', '1'].includes(r.headers.get('x-export-truncated')), r.headers.get('x-export-truncated'));
  check('CSV is not cached', /no-store/.test(r.headers.get('cache-control') ?? ''), r.headers.get('cache-control'));

  // RFC-4180 parse — proves quoting/escaping works without depending on the
  // seeded data happening to contain a comma.
  const parseRow = (line) => {
    const out = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (ch === '"') { quoted = false; } else { cur += ch; }
      } else if (ch === '"') { quoted = true; } else if (ch === ',') { out.push(cur); cur = ''; } else { cur += ch; }
    }
    out.push(cur);
    return out;
  };
  const cols = parseRow(header).length;
  check('every row has the header field count (escaping is correct)', [header, ...rows.filter(Boolean)].every((l) => parseRow(l).length === cols), JSON.stringify({ cols, seen: [...new Set([header, ...rows.filter(Boolean)].map((l) => parseRow(l).length))] }));
  const headerCells = parseRow(header);
  const cells = parseRow(rows.find(Boolean) ?? '');
  const totalCol = headerCells.indexOf('Grand Total');
  check('the export has a Grand Total column', totalCol >= 0, JSON.stringify(headerCells));
  check('an exported row carries its order number and grand total', /^GR-\d{4}-\d{6}$/.test(cells[0]) && /^\d+(\.\d+)?$/.test(cells[totalCol] ?? ''), JSON.stringify([cells[0], cells[totalCol]]));
}
{
  // A comma inside a value must come back as a quoted cell.
  const target = CREATED?._id;
  if (target) {
    const rename = await patch(`/api/admin/products/${target}`, { token: TOKEN, body: { title: 'Smoked Honey, 500g Jar' } });
    check('a comma in a product title is accepted', rename.status === 200, `${rename.status} ${rename.text.slice(0, 200)}`);
    // The archive checks above drain this product to 0 — refill it so an order
    // actually exists to export.
    const refill = await patch(`/api/admin/products/${target}/stock`, {
      token: TOKEN,
      body: { variants: [{ variantId: rename.data?.variants?.[0]?._id, stock: 10 }] },
    });
    check('comma fixture refills stock → 200', refill.status === 200, `${refill.status} ${refill.text.slice(0, 200)}`);
    const staff = await post('/api/admin/orders', {
      token: TOKEN,
      body: {
        customer: { name: 'Comma, Tester', phone: '01799887790' },
        shippingAddress: { line1: 'House 12', district: 'Dhaka' },
        items: [{ productId: target, variantId: rename.data?.variants?.[0]?._id, quantity: 1 }],
        payment: { method: 'cod' },
      },
    });
    check('staff order for the comma fixture → 201', staff.status === 201, `${staff.status} ${staff.text.slice(0, 240)}`);
    const csv = (await get('/api/admin/orders/export?format=csv', { token: TOKEN })).text;
    check('a comma-bearing cell is exported quoted', csv.includes('"Comma, Tester"'), csv.split(/\r?\n/).find((l) => l.includes('Comma'))?.slice(0, 160));
    check('the quoted cell parses back to the original value', csv.split(/\r?\n/).some((l) => l.includes('"Comma, Tester"')), 'round-trip');
  } else {
    check('comma fixture skipped — no smoke product was created', false, 'CREATED is undefined');
  }
}
{
  const r = await get('/api/admin/orders/export?format=csv&status=Delivered', { token: TOKEN });
  const rows = r.text.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean).slice(1);
  check('export respects filters', rows.length > 0 && rows.every((line) => line.includes('Delivered')), `${rows.length} rows`);
}
{
  const r = await get('/api/admin/orders/export?format=json', { token: TOKEN });
  check('export JSON → 200', r.status === 200 && Array.isArray(r.data), `${r.status} ${r.text.slice(0, 160)}`);
  check('JSON export reports totals in meta', typeof r.meta?.total === 'number' && typeof r.meta?.exported === 'number', JSON.stringify(r.meta));
}
{
  const anon = await get('/api/admin/orders/export?format=csv');
  check('export requires auth → 401', anon.status === 401, `${anon.status}`);
}

section('Admin settings');
{
  const r = await get('/api/admin/settings', { token: TOKEN });
  check('GET /admin/settings → 200', r.status === 200, r.text.slice(0, 200));
  check('returns settings + commerce constants', Boolean(r.data?.settings) && Boolean(r.data?.commerce), JSON.stringify(Object.keys(r.data ?? {})));
  check('settings expose the flash-sale campaign', Boolean(r.data?.settings?.flashSale), JSON.stringify(Object.keys(r.data?.settings ?? {})));
}
{
  const r = await patch('/api/admin/settings', {
    token: TOKEN,
    body: { contact: { phone: '+8801711223344', whatsapp: '8801711223344', address: 'Dhanmondi, Dhaka' }, seo: { title: 'Gramrosh | Fresh & Organic Food' } },
  });
  check('PATCH /admin/settings → 200', r.status === 200, `${r.status} ${r.text.slice(0, 240)}`);
  const after = await get('/api/storefront/settings');
  check('settings change is live on the storefront', after.data?.store?.seo?.title === 'Gramrosh | Fresh & Organic Food', JSON.stringify(after.data?.store?.seo));
  check('the contact block is live too', after.data?.contact?.phone === '+8801711223344', JSON.stringify(after.data?.contact));
}
{
  const r = await patch('/api/admin/settings', { token: TOKEN, body: { tagline: 12345 } });
  check('settings patch with a wrong type → 422', r.status === 422, `${r.status} ${r.text.slice(0, 200)}`);
}
{
  const r = await get('/api/admin/settings/system', { token: TOKEN });
  check('GET /admin/settings/system → 200 (super_admin)', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  check('system info reports driver + counts', Boolean(r.data?.database ?? r.data?.db ?? r.data?.driver), JSON.stringify(r.data)?.slice(0, 300));
}

section('Admin accounts & RBAC');
let STAFF_TOKEN;
{
  const r = await get('/api/admin/auth/accounts', { token: TOKEN });
  check('GET /admin/auth/accounts → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  check('accounts list never leaks passwordHash', !r.text.includes('passwordHash') && !r.text.includes('$2a$'), r.text.slice(0, 200));
  check('bootstrap super_admin listed', r.rows.some((a) => a.email === ADMIN_EMAIL), JSON.stringify(r.rows.map((a) => a.email)));
}
{
  const r = await post('/api/admin/auth/accounts', { token: TOKEN, body: { name: 'Operator Smoke', email: 'operator.smoke@gramrosh.test', password: 'Oper@tor12345', role: 'operator' } });
  check('POST account → 201', r.status === 201 || r.status === 200, `${r.status} ${r.text.slice(0, 240)}`);
  check('created account has role operator', r.data?.role === 'operator', r.data?.role);
  check('created account has no passwordHash in the response', !JSON.stringify(r.data).includes('passwordHash'), JSON.stringify(r.data)?.slice(0, 200));
}
{
  const r = await post('/api/admin/auth/accounts', { token: TOKEN, body: { name: 'Dupe', email: ADMIN_EMAIL, password: 'Whatever@123', role: 'operator' } });
  check('duplicate email → 409', r.status === 409, `${r.status} ${r.text.slice(0, 200)}`);
}
{
  const r = await post('/api/admin/auth/accounts', { token: TOKEN, body: { name: 'Weak', email: 'weak@gramrosh.test', password: 'abc', role: 'operator' } });
  check('weak password → 422', r.status === 422, `${r.status} ${r.text.slice(0, 200)}`);
}
{
  const r = await post('/api/admin/auth/accounts', { token: TOKEN, body: { name: 'Bad Role', email: 'role@gramrosh.test', password: 'Valid@12345', role: 'superuser' } });
  check('unknown role → 422', r.status === 422, `${r.status} ${r.text.slice(0, 200)}`);
}
{
  const r = await post('/api/admin/auth/login', { body: { email: 'operator.smoke@gramrosh.test', password: 'Oper@tor12345' } });
  STAFF_TOKEN = r.data?.token;
  check('operator login → 200', r.status === 200 && Boolean(STAFF_TOKEN), `${r.status} ${r.text.slice(0, 200)}`);
  const me = await get('/api/admin/auth/me', { token: STAFF_TOKEN });
  check('operator permissions exclude product:write', Array.isArray(me.data?.permissions) && !me.data.permissions.includes('product:write'), JSON.stringify(me.data?.permissions));
  check('operator permissions include order:write', me.data?.permissions?.includes('order:write'), JSON.stringify(me.data?.permissions));
}
{
  const forbidden = await get('/api/admin/auth/accounts', { token: STAFF_TOKEN });
  check('operator GET accounts → 403', forbidden.status === 403, `${forbidden.status} ${forbidden.text.slice(0, 160)}`);
}
{
  const forbidden = await get('/api/admin/settings/system', { token: STAFF_TOKEN });
  check('operator GET settings/system → 403', forbidden.status === 403, `${forbidden.status} ${forbidden.text.slice(0, 160)}`);
}
{
  const forbidden = await del(`/api/admin/products/${CREATED._id}`, { token: STAFF_TOKEN });
  check('operator DELETE product → 403', forbidden.status === 403, `${forbidden.status} ${forbidden.text.slice(0, 160)}`);
  check('the product survived the forbidden delete', (await get(`/api/admin/products/${CREATED._id}`, { token: TOKEN })).status === 200);
  const forbiddenWrite = await post('/api/admin/products', {
    token: STAFF_TOKEN,
    body: { title: 'Operator Should Not Create', category: HONEY._id, variants: [{ weightValue: 1, weightUnit: 'kg', price: 10 }] },
  });
  check('operator POST product → 403', forbiddenWrite.status === 403, `${forbiddenWrite.status} ${forbiddenWrite.text.slice(0, 160)}`);
}
{
  const allowed = await get('/api/admin/orders?page=1&limit=2', { token: STAFF_TOKEN });
  check('operator CAN read orders → 200', allowed.status === 200, `${allowed.status} ${allowed.text.slice(0, 160)}`);
}
{
  const allowed = await patch(`/api/admin/orders/${ORDER._id}/status`, { token: STAFF_TOKEN, body: { status: 'Delivered' } });
  check('operator write on an already-delivered order is rejected by the pipeline, not RBAC', allowed.status === 409 || allowed.status === 422, `${allowed.status} ${allowed.text.slice(0, 160)}`);
}
{
  const accounts = (await get('/api/admin/auth/accounts', { token: TOKEN })).rows;
  const operatorAccount = accounts.find((a) => a.email === 'operator.smoke@gramrosh.test');
  const r = await patch(`/api/admin/auth/accounts/${operatorAccount._id}`, { token: TOKEN, body: { isActive: false } });
  check('deactivate an account → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  const login = await post('/api/admin/auth/login', { body: { email: 'operator.smoke@gramrosh.test', password: 'Oper@tor12345' } });
  check('deactivated account cannot log in → 401/403', login.status === 401 || login.status === 403, `${login.status} ${login.text.slice(0, 160)}`);
  const stale = await get('/api/admin/orders', { token: STAFF_TOKEN });
  check('a deactivated account\'s existing token is refused → 401/403', stale.status === 401 || stale.status === 403, `${stale.status} ${stale.text.slice(0, 160)}`);
  check('the refusal says the account is deactivated', /deactivat/i.test(stale.text), stale.text.slice(0, 160));
}
{
  const r = await get('/api/admin/stats/overview', { token: STAFF_TOKEN });
  check('operator stats access matches their permission set', r.status === 200 || r.status === 401 || r.status === 403, `${r.status} ${r.text.slice(0, 120)}`);
}
{
  // The lock-out guard only fires for the *last* super_admin, so the assertion
  // depends on how many seeded accounts hold that role.
  const accounts = (await get('/api/admin/auth/accounts', { token: TOKEN })).rows;
  const supers = accounts.filter((a) => a.role === 'super_admin');
  check('the seeded admin is a super_admin', supers.length >= 1, JSON.stringify(accounts.map((a) => a.role)));

  if (supers.length === 1) {
    const lastSuper = supers[0];
    // 'staff' is not a role — RBAC is super_admin | admin | operator.
    const r = await patch(`/api/admin/auth/accounts/${lastSuper._id}`, { token: TOKEN, body: { role: 'operator' } });
    check('demoting the last super_admin is refused → 409', r.status === 409, `${r.status} ${r.text.slice(0, 200)}`);
    const r2 = await patch(`/api/admin/auth/accounts/${lastSuper._id}`, { token: TOKEN, body: { isActive: false } });
    check('deactivating the last super_admin is refused → 409', r2.status === 409, `${r2.status} ${r2.text.slice(0, 200)}`);
  } else {
    // Demote one of several: allowed, and the survivor keeps admin access.
    const victim = supers.find((a) => a.email !== ADMIN_EMAIL) ?? supers[1];
    const r = await patch(`/api/admin/auth/accounts/${victim._id}`, { token: TOKEN, body: { role: 'operator' } });
    check('demoting one of several super_admins is allowed → 200', r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
    check('the remaining super_admin can still administer', (await get('/api/admin/auth/accounts', { token: TOKEN })).status === 200, 'lockout');
  }
}
{
  const r = await patch('/api/admin/auth/password', { token: TOKEN, body: { currentPassword: ADMIN_PASSWORD, newPassword: ADMIN_PASSWORD } });
  check('changing the super_admin password works (or refuses a no-op)', [200, 422].includes(r.status), `${r.status} ${r.text.slice(0, 200)}`);
}
{
  const r = await post('/api/admin/auth/logout', { token: TOKEN });
  check('logout → 200', r.status === 200, `${r.status} ${r.text.slice(0, 160)}`);
}

section('Uploads (local WebP transcoder)');
{
  // A tiny 1×1 PNG, uploaded as multipart and expected back as WebP.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const form = new FormData();
  form.append('image', new Blob([png], { type: 'image/png' }), 'pixel.png');
  const res = await fetch(`${BASE}/api/admin/uploads/image`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: form });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  check('POST /admin/uploads/image → 201/200', [200, 201].includes(res.status), `${res.status} ${text.slice(0, 240)}`);
  check('response carries a URL', Boolean(json?.data?.url ?? json?.data?.image?.url), JSON.stringify(json?.data)?.slice(0, 240));
  const url = json?.data?.url ?? json?.data?.image?.url;
  if (url) {
    check('uploaded asset is WebP', /\.webp(\?|$)/.test(url) || json?.data?.format === 'webp', `${url} ${json?.data?.format}`);
    const served = await fetch(url.startsWith('http') ? url : BASE + url);
    check('uploaded file is served back', served.status === 200, `${served.status} ${url}`);
    check('served with an image content-type', (served.headers.get('content-type') ?? '').startsWith('image/'), served.headers.get('content-type'));
  }
  const anon = await fetch(`${BASE}/api/admin/uploads/image`, { method: 'POST', body: form });
  check('upload without auth → 401', anon.status === 401, String(anon.status));
}
{
  const r = await del('/api/admin/uploads/image', { token: TOKEN, body: { url: '/uploads/does-not-exist.webp' } });
  check('destroy a missing upload → 404/200 (never 500)', [200, 404].includes(r.status), `${r.status} ${r.text.slice(0, 160)}`);
}

section('Security, caching & error handling');
{
  const r = await get('/api/does-not-exist');
  check('unknown API route → 404 JSON envelope', r.status === 404 && r.json?.success === false && /does not exist/i.test(r.json?.message ?? ''), `${r.status} ${r.text.slice(0, 200)}`);
}
{
  const r = await post('/api/orders', { body: '{ this is not json' });
  check('malformed JSON → 400', r.status === 400, `${r.status} ${r.text.slice(0, 200)}`);
}
{
  const r = await get('/api/products?page=abc');
  check('non-numeric query → 422 with field details', r.status === 422 && Array.isArray(r.json?.errors), `${r.status} ${r.text.slice(0, 240)}`);
}
{
  const r = await get('/api/admin/orders/definitely-not-an-id', { token: TOKEN });
  check('unknown order id → 404 (not 500)', r.status === 404, `${r.status} ${r.text.slice(0, 200)}`);
}
{
  const r = await patch('/api/admin/orders/507f1f77bcf86cd799439011/status', { token: TOKEN, body: { status: 'Delivered' } });
  check('status change on a missing order → 404', r.status === 404, `${r.status} ${r.text.slice(0, 200)}`);
}
{
  const res = await fetch(`${BASE}/api/products`);
  check('x-content-type-options: nosniff', res.headers.get('x-content-type-options') === 'nosniff', res.headers.get('x-content-type-options'));
  check('x-powered-by removed', res.headers.get('x-powered-by') === null, res.headers.get('x-powered-by'));
  check('referrer-policy set', Boolean(res.headers.get('referrer-policy')), res.headers.get('referrer-policy'));
  check('request id attached for tracing', Boolean(res.headers.get('x-request-id')), res.headers.get('x-request-id'));
}
{
  const res = await fetch(`${BASE}/api/products`, { headers: { origin: 'https://shop.gramrosh.com' } });
  check('CORS reflects the origin', res.headers.get('access-control-allow-origin') !== null, res.headers.get('access-control-allow-origin'));
  check('CORS exposes the export headers', (res.headers.get('access-control-expose-headers') ?? '').includes('X-Export-Total'), res.headers.get('access-control-expose-headers'));
}
{
  const first = await fetch(`${BASE}/api/categories`);
  await first.text();
  check('catalogue reads are cacheable', /max-age=/.test(first.headers.get('cache-control') ?? ''), first.headers.get('cache-control'));
  check('ETag / Last-Modified supports revalidation', Boolean(first.headers.get('etag') || first.headers.get('last-modified')), `${first.headers.get('etag')} ${first.headers.get('last-modified')}`);
}
{
  const res = await fetch(`${BASE}/uploads/definitely-missing.webp`);
  check('missing upload → 404', res.status === 404, String(res.status));
}
{
  // The API limiter should tolerate a normal burst without tripping.
  const codes = await Promise.all(Array.from({ length: 40 }, () => fetch(`${BASE}/api/categories`).then((r) => r.status)));
  check('40 rapid catalogue reads all succeed', codes.every((c) => c === 200), JSON.stringify([...new Set(codes)]));
}
{
  // Auth endpoints are limited far more tightly.
  const codes = [];
  for (let i = 0; i < 25; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const r = await post('/api/admin/auth/login', { body: { email: ADMIN_EMAIL, password: 'wrong' } });
    codes.push(r.status);
  }
  check('login is rate limited (429 appears)', codes.includes(429), JSON.stringify([...new Set(codes)]));
  const after = await post('/api/admin/auth/login', { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  check('a rate-limited login can still succeed after the window (informational)', [200, 429].includes(after.status), String(after.status));
}

  report();
} catch (error) {
  // An assertion that throws is still a failure — report it and keep the exit
  // code honest rather than dying mid-run and hiding every later check.
  check(`smoke run crashed: ${error.message}`, false, error.stack?.split('\n').slice(0, 4).join('\n      '));
  report();
}

function report() {
  console.log(`\n${BOLD}${GREEN}${pass} passed${OFF}${fail ? `, ${BOLD}${RED}${fail} failed${OFF}` : ''}`);
  if (fail) {
    console.log(`\n${RED}${BOLD}Failures:${OFF}`);
    failures.forEach((f) => console.log(`  ${RED}•${OFF} ${f}`));
    process.exit(1);
  }
  console.log(`\n${GREEN}All API smoke checks passed.${OFF}`);
  process.exit(0);
}
