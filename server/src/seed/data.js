/**
 * -----------------------------------------------------------------------------
 *  seed/data.js — The demo catalogue
 * -----------------------------------------------------------------------------
 *  Realistic Bangladeshi fresh & organic produce: pack sizes, BDT pricing,
 *  strike-through prices, origin stories, BSTI/lab documentation and three combo
 *  bundles whose stock is derived from their components.
 *
 *  Images are served as WebP from the storefront's `public/img/products/`
 *  directory (in production the same URLs come from the CDN).
 * -----------------------------------------------------------------------------
 */

const IMG = '/img/products';
const HOURS = 3_600_000;
const DAYS = 86_400_000;

/** Relative dates so the countdown bar and "new arrivals" are always live. */
export const fromNow = (ms) => new Date(Date.now() + ms);
/**
 * A timestamp `n` days in the past at `hour`:minute. Deterministic (no RNG) so
 * repeated seeds produce identical history and reproducible dashboard numbers.
 */
export const daysAgo = (n, hour = 10, minute = 15) => {
  const d = new Date(Date.now() - n * DAYS);
  d.setUTCHours(hour, minute, 0, 0);
  return d;
};

/* -------------------------------------------------------------------------- */
/*  Categories                                                                */
/* -------------------------------------------------------------------------- */

export const categories = [
  {
    name: { en: 'Honey', bn: 'মধু' },
    slug: 'honey',
    summary: 'Wild-collected and farm-raised raw honey, never heated, never blended with syrup.',
    icon: 'droplets',
    accent: '#d97706',
    sortOrder: 1,
  },
  {
    name: { en: 'Ghee', bn: 'ঘি' },
    summary: 'Grass-fed cow ghee churned in small batches from cream, not from butter oil.',
    icon: 'milk',
    accent: '#ca8a04',
    sortOrder: 2,
  },
  {
    name: { en: 'Organic Sugar & Jaggery', bn: 'গুড় ও চিনি' },
    slug: 'organic-sugar',
    summary: 'Date-palm and sugarcane jaggery made in open pans, with no chemical clarifiers.',
    icon: 'candy',
    accent: '#92400e',
    sortOrder: 3,
  },
  {
    name: { en: 'Cold-Pressed Oil', bn: 'কাঠের ঘানির তেল' },
    slug: 'cold-pressed-oil',
    summary: 'Wood-churned (ghani) mustard oil pressed at low temperature so the aroma survives.',
    icon: 'droplet',
    accent: '#65a30d',
    sortOrder: 4,
  },
  {
    name: { en: 'Nuts & Dry Fruits', bn: 'বাদাম' },
    slug: 'nuts',
    summary: 'Grade-sorted cashew, almond and mixed dry fruit — no oil roasting, no additives.',
    icon: 'nut',
    accent: '#a16207',
    sortOrder: 5,
  },
  {
    name: { en: 'Rice & Grains', bn: 'চাল ও শস্য' },
    slug: 'rice',
    summary: 'Aromatic heritage rice and grains, sun-dried and milled within the season.',
    icon: 'wheat',
    accent: '#16a34a',
    sortOrder: 6,
  },
  {
    name: { en: 'Spices', bn: 'মসলা' },
    slug: 'spices',
    summary: 'Single-origin spices ground in small batches, with the harvest date on the pack.',
    icon: 'flame',
    accent: '#dc2626',
    sortOrder: 7,
  },
  {
    name: { en: 'Combos & Gifts', bn: 'কম্বো ও উপহার' },
    slug: 'combos',
    summary: 'Curated bundles that save you money and make a proper gift — packed in a reusable box.',
    icon: 'gift',
    accent: '#7c3aed',
    sortOrder: 8,
  },
];

/* -------------------------------------------------------------------------- */
/*  Products                                                                  */
/* -------------------------------------------------------------------------- */

export const products = [
  {
    title: 'Sundarban Raw Honey',
    titleBn: 'সুন্দরবনের কাঁচা মধু',
    slug: 'sundarban-raw-honey',
    summary: 'Wild honey collected from the Sundarbans mangrove forest during the Mouchak season — unheated, unfiltered and never blended with sugar syrup.',
    description: `Our honey comes from wild bee colonies inside the Sundarbans reserve, harvested by licensed *mouali* families who have worked the same creeks for generations.

**What "raw" means here**
- Never heated above 35 °C, so the natural pollen and enzymes survive.
- Strained through a 200-micron cloth only — no fine filtration, no pressure.
- No sugar syrup, no corn syrup, no water. One ingredient: honey.

**Tasting notes**
Deep amber, thick pour, with a floral start and a faint woody finish from the *gewa* and *keora* blossoms. Crystallisation in winter is natural and is the best proof the honey is raw — gently warm the jar in water below 40 °C to liquefy it again.

**How to use**
One spoon on an empty stomach with warm water, stirred into *lassi*, or drizzled over *pitha*. Never add it to boiling liquid if you want the enzymes intact.`,
    category: 'honey',
    origin: {
      name: 'Sundarbans East, Khulna',
      district: 'Khulna',
      harvestSeason: 'March – May (Mouchak season)',
      story: 'Collected by 14 licensed mouali families from the Kalabogi and Sharankhola creeks. Each batch is traced to a single collection window and tested before it is bottled.',
    },
    tags: ['raw', 'unheated', 'wild', 'single-origin', 'honey'],
    badges: ['raw', 'farm-direct', 'bsti-certified', 'chemical-free'],
    images: [{ url: `${IMG}/honey-sundarban.webp`, alt: 'Glass jar of raw Sundarban honey with a wooden dipper', isPrimary: true, format: 'webp', width: 1200, height: 1200 }],
    rating: 4.8,
    reviewCount: 214,
    isFeatured: true,
    sortOrder: 1,
    stats: { views: 8420, sold: 612, addToCarts: 1930 },
    variants: [
      { sku: 'GR-HNY-250', label: '250 g', weightValue: 250, weightUnit: 'g', price: 480, compareAtPrice: 560, stock: 64, isDefault: false },
      { sku: 'GR-HNY-500', label: '500 g', weightValue: 500, weightUnit: 'g', price: 900, compareAtPrice: 1050, stock: 38, isDefault: true },
      { sku: 'GR-HNY-1KG', label: '1 kg', weightValue: 1, weightUnit: 'kg', price: 1700, compareAtPrice: 1950, stock: 15 },
    ],
    flashSale: { isActive: true, startsAt: fromNow(-1 * DAYS), endsAt: fromNow(2 * DAYS + 6 * HOURS), label: 'Mouchak Harvest Sale', stockLimit: 200 },
    documents: [
      { title: 'BSTI Certification Mark (CM) Licence', type: 'bsti', url: `${IMG}/docs/bsti-honey.pdf`, reference: 'BSTI/CM/DHK/2026-0417', issuedAt: daysAgo(210), expiresAt: fromNow(520 * DAYS) },
      { title: 'Lab report — sugar profile & moisture', type: 'lab_report', url: `${IMG}/docs/lab-honey.pdf`, reference: 'LAB-2026-HNY-091', issuedAt: daysAgo(28) },
    ],
    seo: { title: 'Sundarban Raw Honey (Unheated) — 250g / 500g / 1kg | Gramrosh', description: 'Genuine raw Sundarban honey, unheated and unfiltered. Lab-tested for purity. 250g, 500g and 1kg jars. Delivery all over Bangladesh.' },
  },

  {
    title: 'Wild Forest Honeycomb',
    titleBn: 'বনের মৌচাক',
    slug: 'wild-forest-honeycomb',
    summary: 'A whole slice of comb with the honey still in it — cut from a single wild hive and packed the same day.',
    description: `The most honest way to be sure your honey is real: eat it out of the wax.

Each pack is a hand-cut section of comb taken from one wild hive, drained only by gravity and sealed immediately. The wax is food-grade and edible — chew it like gum, or spread the whole slice over warm *ruti*.

**Why comb?**
- Impossible to adulterate: syrup cannot be built into beeswax cells.
- Carries the pollen of whatever the colony was foraging that week.
- Small-batch: we get a few hundred packs per season, then it is gone until next year.

Store at room temperature away from sunlight. Do not refrigerate — the wax turns brittle.`,
    category: 'honey',
    origin: { name: 'Sharankhola Range', district: 'Bagerhat', harvestSeason: 'April – May', story: 'Cut and packed within six hours of harvest so the comb keeps its structure and aroma.' },
    tags: ['honeycomb', 'raw', 'wild', 'limited', 'wax'],
    badges: ['raw', 'limited', 'farm-direct'],
    images: [{ url: `${IMG}/honeycomb-wild.webp`, alt: 'Cut section of wild honeycomb dripping with honey', isPrimary: true, format: 'webp', width: 1200, height: 1200 }],
    rating: 4.9,
    reviewCount: 76,
    isFeatured: true,
    sortOrder: 2,
    stats: { views: 3110, sold: 188, addToCarts: 640 },
    variants: [
      { sku: 'GR-CMB-400', label: '400 g', weightValue: 400, weightUnit: 'g', price: 850, compareAtPrice: 950, stock: 22, isDefault: true },
      { sku: 'GR-CMB-800', label: '800 g', weightValue: 800, weightUnit: 'g', price: 1600, stock: 6 },
    ],
    documents: [
      { title: 'Lab report — pollen count & moisture', type: 'lab_report', url: `${IMG}/docs/lab-honeycomb.pdf`, reference: 'LAB-2026-CMB-014', issuedAt: daysAgo(41) },
    ],
  },

  {
    title: 'Premium Cow Ghee',
    titleBn: 'খাঁটি গরুর ঘি',
    slug: 'premium-cow-ghee',
    summary: 'Small-batch ghee churned from the cream of grass-fed cows — grainy texture, nutty aroma, no vanaspati.',
    description: `Made the slow way: milk cream is cultured overnight, churned into butter, then simmered in an open pan until the milk solids turn golden and sink.

**How to tell it is real ghee**
- It sets grainy (*dana*) at room temperature, not smooth like vegetable shortening.
- Rubbed between the fingers it melts at body temperature and smells of caramelised milk.
- A spoonful in hot water leaves a single clean oil lens — no cloudy residue.

From cows grazed on pasture in Pabna and Sirajganj, collected twice a week. Nothing is added: no colour, no preservative, no palm oil.

Use for *biriyani*, *khichuri*, tempering dal, or simply a spoon over hot rice.`,
    category: 'ghee',
    origin: { name: 'Pabna Dairy Belt', district: 'Pabna', harvestSeason: 'Year-round, best in winter', story: 'Cream is collected from 40 smallholder families every Tuesday and Friday and churned the same day.' },
    tags: ['ghee', 'grass-fed', 'dairy', 'small-batch'],
    badges: ['organic', 'farm-direct', 'bsti-certified'],
    images: [{ url: `${IMG}/ghee-cow.webp`, alt: 'Jar of golden cow ghee with a spoon', isPrimary: true, format: 'webp', width: 1200, height: 1200 }],
    rating: 4.7,
    reviewCount: 158,
    isFeatured: true,
    sortOrder: 3,
    stats: { views: 6240, sold: 430, addToCarts: 1410 },
    variants: [
      { sku: 'GR-GHE-250', label: '250 g', weightValue: 250, weightUnit: 'g', price: 750, stock: 44, isDefault: true },
      { sku: 'GR-GHE-500', label: '500 g', weightValue: 500, weightUnit: 'g', price: 1400, compareAtPrice: 1550, stock: 26 },
      { sku: 'GR-GHE-1KG', label: '1 kg', weightValue: 1, weightUnit: 'kg', price: 2700, compareAtPrice: 2990, stock: 9 },
    ],
    documents: [
      { title: 'BSTI Certification Mark (CM) Licence', type: 'bsti', url: `${IMG}/docs/bsti-ghee.pdf`, reference: 'BSTI/CM/DHK/2026-0388', issuedAt: daysAgo(240), expiresAt: fromNow(490 * DAYS) },
      { title: 'Lab report — fat profile & adulteration screen', type: 'lab_report', url: `${IMG}/docs/lab-ghee.pdf`, reference: 'LAB-2026-GHE-055', issuedAt: daysAgo(19) },
    ],
  },

  {
    title: 'Date Palm Jaggery',
    titleBn: 'খেজুরের গুড়',
    slug: 'date-palm-jaggery',
    summary: 'Winter khejur gur boiled in open pans from the sap of date palms — no chemical clarifiers, no colour.',
    description: `The sap is collected overnight from February to March, then boiled within hours in a wide open pan until it reduces to a soft, pourable *jhola* or a firm *dana* gur.

**No clarifiers.** Most commercial gur is cleared with lime, alum or synthetic bleaching agents. Ours is only strained through cloth, which is why the colour is deep and uneven rather than uniform gold.

**Taste**
Caramel and dried fig, with the faint smokiness of a wood fire. Melts on warm *pitha*, or stir a spoon into hot milk on a winter night.

Seasonal and deliberately limited: once the tapping season ends, we sell what remains and wait for the next year.`,
    category: 'organic-sugar',
    origin: { name: 'Jashore & Chuadanga', district: 'Jashore', harvestSeason: 'January – March', story: 'Tapped by 22 gachhi (tree climbers) who work the same palms every winter; the sap is boiled in the village within four hours of collection.' },
    tags: ['jaggery', 'gur', 'date-palm', 'winter', 'unrefined'],
    badges: ['organic', 'unprocessed', 'chemical-free'],
    images: [{ url: `${IMG}/jaggery-date.webp`, alt: 'Block and jar of dark date palm jaggery', isPrimary: true, format: 'webp', width: 1200, height: 1200 }],
    rating: 4.6,
    reviewCount: 121,
    isFeatured: false,
    sortOrder: 4,
    stats: { views: 4180, sold: 356, addToCarts: 902 },
    variants: [
      { sku: 'GR-GUR-500', label: '500 g', weightValue: 500, weightUnit: 'g', price: 320, stock: 70, isDefault: true },
      { sku: 'GR-GUR-1KG', label: '1 kg', weightValue: 1, weightUnit: 'kg', price: 600, compareAtPrice: 680, stock: 34 },
    ],
    flashSale: { isActive: true, startsAt: fromNow(-2 * DAYS), endsAt: fromNow(2 * DAYS + 6 * HOURS), label: 'Winter Harvest Sale' },
    documents: [
      { title: 'Lab report — sulphur & heavy metals', type: 'lab_report', url: `${IMG}/docs/lab-gur.pdf`, reference: 'LAB-2026-GUR-031', issuedAt: daysAgo(52) },
    ],
  },

  {
    title: 'Cold-Pressed Mustard Oil',
    titleBn: 'কাঠের ঘানির সরিষার তেল',
    slug: 'cold-pressed-mustard-oil',
    summary: 'Pressed on a traditional wooden ghani at low temperature, so the pungency and aroma survive — not solvent-extracted.',
    description: `Expeller and solvent extraction strip the oil and then bleach and deodorise it back to something pale and neutral. A wooden *ghani* turns slowly and stays cool, which keeps the allyl isothiocyanate — the compound that makes mustard oil sting your nose — intact.

**What you should notice**
- A sharp, clean pungency when you open the bottle.
- Deep golden colour, and a little natural sediment at the bottom.
- It smokes later than refined oil, so your *baghaar* tastes of mustard, not of burnt oil.

Filtered through cloth and settled for seven days before bottling. Nothing added, nothing removed.`,
    category: 'cold-pressed-oil',
    origin: { name: 'Tangail Ghani Works', district: 'Tangail', harvestSeason: 'Mustard harvested Feb–Mar, pressed monthly', story: 'Pressed to order twice a month in a family ghani that has run since 1974, so no bottle sits in a warehouse for long.' },
    tags: ['mustard-oil', 'cold-pressed', 'ghani', 'cooking-oil'],
    badges: ['unprocessed', 'chemical-free', 'farm-direct'],
    images: [{ url: `${IMG}/mustard-oil.webp`, alt: 'Glass bottle of golden cold-pressed mustard oil', isPrimary: true, format: 'webp', width: 1200, height: 1200 }],
    rating: 4.5,
    reviewCount: 94,
    sortOrder: 5,
    stats: { views: 2960, sold: 244, addToCarts: 610 },
    variants: [
      { sku: 'GR-OIL-500', label: '500 ml', weightValue: 500, weightUnit: 'ml', price: 380, stock: 58, isDefault: true },
      { sku: 'GR-OIL-1L', label: '1 litre', weightValue: 1, weightUnit: 'l', price: 720, compareAtPrice: 800, stock: 31 },
    ],
    documents: [
      { title: 'BSTI Certification Mark (CM) Licence', type: 'bsti', url: `${IMG}/docs/bsti-oil.pdf`, reference: 'BSTI/CM/DHK/2026-0502', issuedAt: daysAgo(160), expiresAt: fromNow(570 * DAYS) },
    ],
  },

  {
    title: 'Premium Cashew Nuts',
    titleBn: 'প্রিমিয়াম কাজু বাদাম',
    slug: 'premium-cashew-nuts',
    summary: 'Whole W240-grade cashews, sun-dried and hand-sorted. No oil roasting, no salt, no coating.',
    description: `Grade **W240** means whole kernels, roughly 240 per pound — the size that is creamy rather than chalky. Every batch is hand-sorted twice: once for broken pieces, once for discolouration.

Raw and unroasted, so you can toast them yourself at the temperature you like, or grind them into *korma* paste without fighting an oil coating.

**Storage.** Cashews go rancid faster than people expect. Keep them in the fridge once opened, in an airtight jar, and they will stay sweet for months.`,
    category: 'nuts',
    origin: { name: 'Imported raw, processed in Dhaka', district: 'Dhaka', story: 'Raw cashew is sourced from Ivory Coast and Vietnam, then steamed, shelled and graded in a Dhaka facility we audit twice a year.' },
    tags: ['cashew', 'nuts', 'w240', 'snack', 'raw'],
    badges: ['new', 'chemical-free'],
    images: [{ url: `${IMG}/cashew-premium.webp`, alt: 'Bowl of whole premium cashew nuts', isPrimary: true, format: 'webp', width: 1200, height: 1200 }],
    rating: 4.7,
    reviewCount: 88,
    sortOrder: 6,
    stats: { views: 2410, sold: 176, addToCarts: 505 },
    variants: [
      { sku: 'GR-CSH-250', label: '250 g', weightValue: 250, weightUnit: 'g', price: 620, stock: 40, isDefault: true },
      { sku: 'GR-CSH-500', label: '500 g', weightValue: 500, weightUnit: 'g', price: 1180, compareAtPrice: 1300, stock: 18 },
      { sku: 'GR-CSH-1KG', label: '1 kg', weightValue: 1, weightUnit: 'kg', price: 2250, stock: 0 },
    ],
  },

  {
    title: 'Mixed Nuts & Dry Fruits',
    titleBn: 'মিক্সড বাদাম ও শুকনো ফল',
    slug: 'mixed-nuts-dry-fruits',
    summary: 'Almond, cashew, walnut, pistachio and raisin in one jar — sorted by hand, nothing broken, nothing stale.',
    description: `A working mix rather than a decorative one: roughly equal almond and cashew, with walnut and pistachio for richness and raisin for sweetness.

No salt, no sugar, no oil, no preservative. Just five ingredients you can name.

Good for *iftar*, for a desk drawer, or ground into *halwa*. Resealable jar; keep it cool and dark once opened.`,
    category: 'nuts',
    origin: { name: 'Blended in Dhaka', district: 'Dhaka', story: 'Components are sourced separately (almond from California, walnut from Kashmir, pistachio from Iran) and blended weekly in small batches so nothing sits.' },
    tags: ['mixed-nuts', 'almond', 'walnut', 'pistachio', 'dry-fruit'],
    badges: ['bestseller'],
    images: [{ url: `${IMG}/mixed-nuts.webp`, alt: 'Jar of mixed nuts and dry fruits', isPrimary: true, format: 'webp', width: 1200, height: 1200 }],
    rating: 4.6,
    reviewCount: 143,
    isFeatured: true,
    sortOrder: 7,
    stats: { views: 5120, sold: 398, addToCarts: 1105 },
    variants: [
      { sku: 'GR-MIX-500', label: '500 g', weightValue: 500, weightUnit: 'g', price: 950, compareAtPrice: 1080, stock: 33, isDefault: true },
      { sku: 'GR-MIX-1KG', label: '1 kg', weightValue: 1, weightUnit: 'kg', price: 1800, compareAtPrice: 2050, stock: 12 },
    ],
    documents: [
      { title: 'Lab report — aflatoxin screen', type: 'lab_report', url: `${IMG}/docs/lab-nuts.pdf`, reference: 'LAB-2026-NUT-077', issuedAt: daysAgo(15) },
    ],
  },

  {
    title: 'Kalijira Aromatic Rice',
    titleBn: 'কালিজিরা সুগন্ধি চাল',
    slug: 'kalijira-aromatic-rice',
    summary: 'The small-grain heirloom rice of Dinajpur, sun-dried and milled in-season so the aroma is still in the bag.',
    description: `Kalijira is sometimes called the "rice of kings": the grains are barely half the size of regular rice and perfume the whole kitchen while cooking.

**Cooking.** Wash gently once. Use 1½ cups of water per cup of rice, soak 20 minutes, then cook on low heat covered. Do not stir. It should come out separate and slightly soft, never sticky.

Grown in Dinajpur's clay-loam, sun-dried on mats rather than machine-dried (which cracks the grain), and milled only when an order needs it.`,
    category: 'rice',
    origin: { name: 'Dinajpur Sadar', district: 'Dinajpur', harvestSeason: 'Aman season, November – December', story: 'From 31 farmers in four villages who still sun-dry on mats; we buy the whole paddy at harvest and mill monthly.' },
    tags: ['rice', 'kalijira', 'aromatic', 'heirloom', 'polao'],
    badges: ['organic', 'farm-direct'],
    images: [{ url: `${IMG}/kalijira-rice.webp`, alt: 'Bowl of small-grain kalijira aromatic rice', isPrimary: true, format: 'webp', width: 1200, height: 1200 }],
    rating: 4.8,
    reviewCount: 205,
    sortOrder: 8,
    stats: { views: 6890, sold: 720, addToCarts: 1620 },
    variants: [
      { sku: 'GR-RIC-1KG', label: '1 kg', weightValue: 1, weightUnit: 'kg', price: 180, stock: 120, isDefault: true },
      { sku: 'GR-RIC-5KG', label: '5 kg', weightValue: 5, weightUnit: 'kg', price: 850, compareAtPrice: 920, stock: 45 },
      { sku: 'GR-RIC-10KG', label: '10 kg', weightValue: 10, weightUnit: 'kg', price: 1620, stock: 8 },
    ],
  },

  {
    title: 'Organic Turmeric Powder',
    titleBn: 'অর্গানিক হলুদ গুঁড়া',
    slug: 'organic-turmeric-powder',
    summary: 'High-curcumin turmeric from Bogura, sun-dried and ground in small batches with no lead chromate, no colour.',
    description: `Ground within two weeks of your order, in a batch small enough that we can tell you the date on the pack.

**Why that matters.** Turmeric loses its volatile oils quickly once ground, and cheap powder is often bulk-ground a year ahead and brightened with lead chromate — a real, documented adulterant in Bangladesh. Ours is tested for lead every batch (report downloadable below) and its colour is a dull, honest orange rather than a fluorescent one.

Curcumin content measured at 4.1% — high enough to matter for *golden milk*, dal and fish curry alike.`,
    category: 'spices',
    origin: { name: 'Bogura', district: 'Bogura', harvestSeason: 'Harvested February, ground monthly', story: 'Boiled briefly, sun-dried on raised nets (never on the road), then ground in a stainless mill that is cleared between batches.' },
    tags: ['turmeric', 'holud', 'spice', 'high-curcumin', 'ground-fresh'],
    badges: ['organic', 'chemical-free', 'bsti-certified'],
    images: [{ url: `${IMG}/turmeric-powder.webp`, alt: 'Bowl of orange organic turmeric powder with fresh roots', isPrimary: true, format: 'webp', width: 1200, height: 1200 }],
    rating: 4.9,
    reviewCount: 167,
    isFeatured: true,
    sortOrder: 9,
    stats: { views: 4410, sold: 512, addToCarts: 1180 },
    variants: [
      { sku: 'GR-SPC-200', label: '200 g', weightValue: 200, weightUnit: 'g', price: 120, stock: 95, isDefault: true },
      { sku: 'GR-SPC-500', label: '500 g', weightValue: 500, weightUnit: 'g', price: 270, compareAtPrice: 310, stock: 40 },
    ],
    documents: [
      { title: 'Lab report — lead chromate screen (ND)', type: 'lab_report', url: `${IMG}/docs/lab-turmeric.pdf`, reference: 'LAB-2026-TRM-118', issuedAt: daysAgo(9) },
      { title: 'Organic certificate — Bangladesh Organic Federation', type: 'organic_certificate', url: `${IMG}/docs/organic-turmeric.pdf`, reference: 'BOF/ORG/2026/112', issuedAt: daysAgo(120), expiresAt: fromNow(245 * DAYS) },
    ],
  },

  /* ------------------------------ Combos -------------------------------- */

  {
    title: 'Honey & Ghee Gift Combo',
    titleBn: 'মধু ও ঘি উপহার কম্বো',
    slug: 'honey-ghee-gift-combo',
    summary: '500 g Sundarban raw honey + 250 g cow ghee in a reusable gift box — saves ৳230 against buying separately.',
    description: `The two things everybody asks us for, in one box.

**Inside**
- Sundarban Raw Honey, 500 g
- Premium Cow Ghee, 250 g
- Reusable rigid gift box with a hand-written note card
- Both lab reports printed and tucked into the lid

Buying the two separately costs ৳1,650. The combo is ৳1,420 — you save ৳230, and the box means you do not need to wrap anything.

**Note on stock.** This combo's availability is calculated automatically from the honey and ghee in the warehouse, so it can never sell more than we can actually pack.`,
    category: 'combos',
    tags: ['combo', 'gift', 'honey', 'ghee', 'bundle'],
    badges: ['bestseller', 'farm-direct'],
    images: [{ url: `${IMG}/combo-honey-ghee.webp`, alt: 'Gift box containing a jar of honey and a jar of ghee', isPrimary: true, format: 'webp', width: 1200, height: 1200 }],
    rating: 4.8,
    reviewCount: 64,
    isCombo: true,
    isFeatured: true,
    sortOrder: 10,
    stats: { views: 2210, sold: 148, addToCarts: 402 },
    variants: [
      { sku: 'GR-CMB-HG-BOX', label: 'Gift box', weightValue: 750, weightUnit: 'g', price: 1420, compareAtPrice: 1650, stock: 25, isDefault: true },
    ],
    bundle: {
      isActive: true,
      badge: 'Save ৳230',
      headline: 'The two most-gifted jars in one box',
      autoStock: true,
      combinedPrice: 1650,
      items: [
        { productSlug: 'sundarban-raw-honey', variantSku: 'GR-HNY-500', quantity: 1, label: 'Sundarban Raw Honey — 500 g' },
        { productSlug: 'premium-cow-ghee', variantSku: 'GR-GHE-250', quantity: 1, label: 'Premium Cow Ghee — 250 g' },
      ],
    },
  },

  {
    title: 'Winter Breakfast Combo',
    titleBn: 'শীতের সকালের নাস্তা কম্বো',
    slug: 'winter-breakfast-combo',
    summary: 'Date palm jaggery + cold-pressed mustard oil + kalijira rice — the classic Bhapa Pitha set, saves ৳210.',
    description: `Everything you need for a proper winter morning, in one order.

**Inside**
- Date Palm Jaggery, 1 kg
- Cold-Pressed Mustard Oil, 500 ml
- Kalijira Aromatic Rice, 1 kg

Together these cost ৳1,220 separately; the combo is ৳1,010.

The jaggery and oil are the seasonal ones — when the tapping season ends in March, this combo goes off the shelf until next winter rather than being quietly refilled with something else.`,
    category: 'combos',
    tags: ['combo', 'winter', 'jaggery', 'pitha', 'bundle'],
    badges: ['limited'],
    images: [{ url: `${IMG}/combo-winter.webp`, alt: 'Winter breakfast combo with jaggery, mustard oil and rice', isPrimary: true, format: 'webp', width: 1200, height: 1200 }],
    rating: 4.7,
    reviewCount: 51,
    isCombo: true,
    sortOrder: 11,
    stats: { views: 1740, sold: 96, addToCarts: 310 },
    variants: [
      { sku: 'GR-CMB-WN-BOX', label: 'Combo pack', weightValue: 2500, weightUnit: 'g', price: 1010, compareAtPrice: 1220, stock: 18, isDefault: true },
    ],
    bundle: {
      isActive: true,
      badge: 'Save ৳210',
      headline: 'Bhapa pitha season, sorted in one click',
      autoStock: true,
      combinedPrice: 1220,
      items: [
        { productSlug: 'date-palm-jaggery', variantSku: 'GR-GUR-1KG', quantity: 1, label: 'Date Palm Jaggery — 1 kg' },
        { productSlug: 'cold-pressed-mustard-oil', variantSku: 'GR-OIL-500', quantity: 1, label: 'Cold-Pressed Mustard Oil — 500 ml' },
        { productSlug: 'kalijira-aromatic-rice', variantSku: 'GR-RIC-1KG', quantity: 1, label: 'Kalijira Aromatic Rice — 1 kg' },
      ],
    },
  },

  {
    title: 'Premium Dry Fruits Box',
    titleBn: 'প্রিমিয়াম শুকনো ফলের বাক্স',
    slug: 'premium-dry-fruits-box',
    summary: 'Mixed nuts 500 g + cashew 250 g + honey 250 g in a partitioned gift box — saves ৳430.',
    description: `The box people send when they want it to look like they thought about it.

**Inside**
- Mixed Nuts & Dry Fruits, 500 g
- Premium Cashew Nuts, 250 g
- Sundarban Raw Honey, 250 g
- Partitioned rigid gift box with ribbon

Separately ৳2,050; as a box ৳1,620.

Popular for corporate gifting — order five or more and we will ship them in one consignment with individual note cards.`,
    category: 'combos',
    tags: ['combo', 'gift', 'dry-fruits', 'corporate', 'bundle'],
    badges: ['bestseller', 'limited'],
    images: [{ url: `${IMG}/combo-dryfruits.webp`, alt: 'Partitioned gift box of dry fruits, cashews and honey', isPrimary: true, format: 'webp', width: 1200, height: 1200 }],
    rating: 4.9,
    reviewCount: 79,
    isCombo: true,
    isFeatured: true,
    sortOrder: 12,
    stats: { views: 3320, sold: 201, addToCarts: 640 },
    variants: [
      { sku: 'GR-CMB-DF-BOX', label: 'Gift box', weightValue: 1000, weightUnit: 'g', price: 1620, compareAtPrice: 2050, stock: 14, isDefault: true },
    ],
    bundle: {
      isActive: true,
      badge: 'Save ৳430',
      headline: 'Three jars, one ribboned box',
      autoStock: true,
      combinedPrice: 2050,
      items: [
        { productSlug: 'mixed-nuts-dry-fruits', variantSku: 'GR-MIX-500', quantity: 1, label: 'Mixed Nuts & Dry Fruits — 500 g' },
        { productSlug: 'premium-cashew-nuts', variantSku: 'GR-CSH-250', quantity: 1, label: 'Premium Cashew Nuts — 250 g' },
        { productSlug: 'sundarban-raw-honey', variantSku: 'GR-HNY-250', quantity: 1, label: 'Sundarban Raw Honey — 250 g' },
      ],
    },
    flashSale: { isActive: true, startsAt: fromNow(-6 * HOURS), endsAt: fromNow(2 * DAYS + 6 * HOURS), label: 'Eid Gifting Sale' },
  },
];

/* -------------------------------------------------------------------------- */
/*  Storefront content                                                        */
/* -------------------------------------------------------------------------- */

export const storefront = {
  storeName: 'Gramrosh',
  tagline: 'Fresh & organic, straight from the village',
  announcement: {
    text: 'Free delivery over ৳2,500 · Lab-tested every batch · Cash on Delivery nationwide',
    isActive: true,
  },
  seo: {
    title: 'Gramrosh — Fresh & Organic Food from Bangladesh',
    description: 'Raw Sundarban honey, grass-fed cow ghee, cold-pressed mustard oil, khejur gur and heritage rice. Lab-tested, BSTI certified, delivered all over Bangladesh.',
  },
  hero: [
    {
      eyebrow: 'Mouchak harvest is in',
      title: 'Raw honey, cut from the Sundarbans',
      titleBn: 'সুন্দরবনের কাঁচা মধু',
      subtitle: 'Unheated, unfiltered and lab-tested batch by batch. If it crystallises in winter, that is the proof.',
      image: { url: `${IMG}/hero-market.webp`, alt: 'Fresh organic produce from Bangladeshi farms', format: 'webp', width: 1600, height: 1000 },
      ctaLabel: 'Shop honey',
      ctaHref: '/shop?category=honey',
      sortOrder: 1,
    },
  ],
  trustPoints: [
    { icon: 'flask-conical', title: 'Lab-tested every batch', description: 'Adulteration, lead and aflatoxin screens published on each product page.' },
    { icon: 'badge-check', title: 'BSTI certified', description: 'Certification Mark licence held for honey, ghee and mustard oil.' },
    { icon: 'truck', title: 'Delivered nationwide', description: '৳60 inside Dhaka, ৳120 outside. Free above ৳2,500.' },
    { icon: 'hand-coins', title: 'Cash on Delivery', description: 'Or pay by bKash, Nagad and Rocket — pay after you inspect the parcel.' },
  ],
  flashSale: {
    isActive: true,
    title: 'Mouchak Harvest Flash Sale',
    subtitle: 'Up to 20% off raw honey, ghee and gifting boxes',
    startsAt: fromNow(-1 * DAYS),
    endsAt: fromNow(2 * DAYS + 6 * HOURS),
    couponCode: 'GRAMROSH200',
    couponValue: 200,
    /** Resolved to ObjectIds by the seeder — mirrors the products' own flashSale. */
    productSlugs: ['sundarban-raw-honey', 'date-palm-jaggery', 'premium-dry-fruits-box'],
  },
  certifications: [
    {
      title: 'BSTI Certification Mark (CM) — Honey',
      type: 'bsti',
      issuer: 'Bangladesh Standards and Testing Institution',
      description: 'Licence to affix the BSTI Certification Mark on packaged raw honey.',
      url: `${IMG}/docs/bsti-honey.pdf`,
      reference: 'BSTI/CM/DHK/2026-0417',
      issuedAt: daysAgo(210),
      expiresAt: fromNow(520 * DAYS),
      sortOrder: 1,
    },
    {
      title: 'BSTI Certification Mark (CM) — Ghee',
      type: 'bsti',
      issuer: 'Bangladesh Standards and Testing Institution',
      description: 'Licence covering cow ghee packed in 250 g, 500 g and 1 kg jars.',
      url: `${IMG}/docs/bsti-ghee.pdf`,
      reference: 'BSTI/CM/DHK/2026-0388',
      issuedAt: daysAgo(240),
      expiresAt: fromNow(490 * DAYS),
      sortOrder: 2,
    },
    {
      title: 'Heavy metals & pesticide screen — full catalogue',
      type: 'lab_report',
      issuer: 'Central Testing Laboratory, Dhaka',
      description: 'Lead, cadmium, arsenic and organophosphate residues across the current harvest. All results below detection limits.',
      url: `${IMG}/docs/lab-catalogue.pdf`,
      reference: 'CTL/2026/Q3-014',
      issuedAt: daysAgo(12),
      sortOrder: 3,
    },
    {
      title: 'Aflatoxin screen — nuts & dry fruits',
      type: 'lab_report',
      issuer: 'Bangladesh Council of Scientific and Industrial Research',
      description: 'Total aflatoxin B1 and B-complex for every incoming nut consignment.',
      url: `${IMG}/docs/lab-nuts.pdf`,
      reference: 'LAB-2026-NUT-077',
      issuedAt: daysAgo(15),
      sortOrder: 4,
    },
    {
      title: 'Bangladesh Organic Federation certificate',
      type: 'organic_certificate',
      issuer: 'Bangladesh Organic Federation',
      description: 'Certifies the Bogura turmeric and Dinajpur rice plots under organic management.',
      url: `${IMG}/docs/organic-turmeric.pdf`,
      reference: 'BOF/ORG/2026/112',
      issuedAt: daysAgo(120),
      expiresAt: fromNow(245 * DAYS),
      sortOrder: 5,
    },
    {
      title: 'Halal certification',
      type: 'halal',
      issuer: 'Islamic Foundation Bangladesh',
      description: 'All dairy, honey and spice lines are produced, stored and transported under halal supervision.',
      url: `${IMG}/docs/halal.pdf`,
      reference: 'IFB/HALAL/2026/0771',
      issuedAt: daysAgo(300),
      expiresAt: fromNow(65 * DAYS),
      sortOrder: 6,
    },
    {
      title: 'Where the honey comes from',
      type: 'sourcing_story',
      issuer: 'Gramrosh',
      description: 'A photo record of the Mouchak season: the creeks, the mouali families and the same-day bottling line.',
      url: `${IMG}/docs/story-sundarban.pdf`,
      sortOrder: 7,
    },
  ],
  originStories: [
    {
      title: 'Fourteen families, one creek',
      region: 'Sundarbans East, Khulna',
      farmer: 'The Sharankhola mouali co-operative',
      body: 'Honey collection inside the reserve is licensed and timed. Our fourteen families work the Kalabogi and Sharankhola creeks during a single six-week window each spring. They climb at dawn, cut the comb by hand, and walk it out in sealed buckets so nothing ferments on the way. We buy the entire window\'s harvest at a fixed price agreed before the season starts — so their income does not depend on how much syrup is on the market that year.',
      image: { url: `${IMG}/story-sundarban.webp`, alt: 'Mangrove creek in the Sundarbans at dawn', format: 'webp', width: 1200, height: 800 },
      /**
       * Resolved to ObjectIds by the seeder (see seed.js) — slugs keep this file
       * readable and independent of database ids.
       */
      productSlugs: ['sundarban-raw-honey', 'wild-forest-honeycomb'],
      sortOrder: 1,
    },
    {
      title: 'Cream collected twice a week',
      region: 'Pabna & Sirajganj',
      farmer: '40 smallholder dairy families',
      body: 'Ghee is only as good as the cream, and cream does not wait. Our families graze cattle on pasture and hand over cream every Tuesday and Friday morning; it is churned that afternoon. Culturing the cream overnight before churning is the step almost everybody skips, and it is the reason this ghee tastes of caramel rather than of nothing.',
      image: { url: `${IMG}/story-farm.webp`, alt: 'Dairy farm at Pabna with grazing cattle', format: 'webp', width: 1200, height: 800 },
      productSlugs: ['premium-cow-ghee'],
      sortOrder: 2,
    },
    {
      title: 'Boiled within four hours',
      region: 'Jashore & Chuadanga',
      farmer: '22 gachhi (palm tappers)',
      body: 'Date palm sap starts fermenting almost immediately in this heat. Our tappers hang the pots at dusk and collect before sunrise, and the sap reaches the boiling shed within four hours. Open pans, wood fire, no lime and no alum — which is why the gur is dark and slightly uneven instead of uniform gold.',
      image: { url: `${IMG}/story-palm.webp`, alt: 'Date palm sap pots hanging on a tree at dusk', format: 'webp', width: 1200, height: 800 },
      productSlugs: ['date-palm-jaggery'],
      sortOrder: 3,
    },
  ],
  testimonials: [
    { name: 'Nusrat Jahan', location: 'Uttara, Dhaka', rating: 5, quote: 'The honey crystallised in January and I panicked — then I read the note on the jar. That is exactly what raw honey is supposed to do. Third order now.' },
    { name: 'Tanvir Ahmed', location: 'Chattogram', rating: 5, quote: 'Ordered the ghee on Tuesday night, delivered Thursday morning with the lab report printed inside the box. The grain is proper dana.' },
    { name: 'Shirin Akter', location: 'Sylhet', rating: 4, quote: 'Mustard oil actually stings your nose when you open it, like it should. Delivery took four days to Sylhet which is fair for outside Dhaka.' },
    { name: 'Mahmudul Hasan', location: 'Dhanmondi, Dhaka', rating: 5, quote: 'Bought the dry fruits box for my mother-in-law and she called to ask where I got it. The box itself is good enough that you do not need to wrap it.' },
  ],
  contact: {
    phone: '+8801711223344',
    whatsapp: '8801711223344',
    hotline: '16247',
    email: 'hello@gramrosh.com',
    address: 'House 12, Road 5, Dhanmondi, Dhaka 1205, Bangladesh',
    hours: 'Sat–Thu, 9:00 AM – 9:00 PM',
    facebook: 'https://facebook.com/gramrosh',
    instagram: 'https://instagram.com/gramrosh',
    youtube: 'https://youtube.com/@gramrosh',
  },
};

/* -------------------------------------------------------------------------- */
/*  Demo customers & orders                                                   */
/* -------------------------------------------------------------------------- */

/** Names and districts used to build a realistic order history. */
export const demoCustomers = [
  { name: 'Nusrat Jahan', phone: '01711223344', district: 'Dhaka', area: 'Uttara Sector 7', email: 'nusrat@example.com' },
  { name: 'Tanvir Ahmed', phone: '01812334455', district: 'Chattogram', area: 'Nasirabad', email: 'tanvir@example.com' },
  { name: 'Shirin Akter', phone: '01913445566', district: 'Sylhet', area: 'Zindabazar' },
  { name: 'Mahmudul Hasan', phone: '01614556677', district: 'Dhaka', area: 'Dhanmondi 27', email: 'mahmud@example.com' },
  { name: 'Farhana Kabir', phone: '01515667788', district: 'Gazipur', area: 'Tongi' },
  { name: 'Rakibul Islam', phone: '01716778899', district: 'Rajshahi', area: 'Kazla' },
  { name: 'Ayesha Siddiqua', phone: '01817889900', district: 'Dhaka', area: 'Mirpur DOHS' },
  { name: 'Jahangir Alam', phone: '01918990011', district: 'Cumilla', area: 'Kandirpar' },
  { name: 'Sabrina Yasmin', phone: '01619001122', district: 'Khulna', area: 'Sonadanga' },
  { name: 'Imran Hossain', phone: '01520112233', district: 'Dhaka', area: 'Banani 11' },
  { name: 'Rezwana Chowdhury', phone: '01721223344', district: 'Barishal', area: 'Nathullabad' },
  { name: 'Kamrul Ahsan', phone: '01822334455', district: 'Dhaka', area: 'Bashundhara R/A' },
];

/** Street addresses used when composing demo shipping addresses. */
export const demoStreets = [
  'House 14, Road 3', 'Flat 5B, Green View Apartments', 'House 27/A, Lane 2',
  'Plot 9, Sector 4', 'Holding 112, Main Road', 'House 8, Road 11',
];
