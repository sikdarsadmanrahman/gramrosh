/**
 * -----------------------------------------------------------------------------
 *  client/scripts/build-images.mjs — the WebP asset pipeline
 * -----------------------------------------------------------------------------
 *  Every catalogue image ships as WebP with the exact dimensions the API
 *  declares (`width`/`height` on each `images[]` entry), so the browser can
 *  reserve the box and the page never reflows on a slow phone connection.
 *
 *      npm run images            # from the repo root or client/
 *
 *  Sources are looked for in `client/assets-src/<name>.{jpg,jpeg,png,webp}`.
 *  When a source photo is missing the script paints a brand-consistent
 *  vector "plate" instead, so a fresh clone always produces a complete,
 *  non-broken image set with no network access and no manual step.
 *
 *  In production you would point `PUBLIC_ASSET_BASE` / `CDN_BASE_URL` at
 *  Cloudinary or S3 + CloudFront and skip this script entirely — the API then
 *  emits real multi-width `srcset` URLs (see `buildSrcSet` on the server).
 * -----------------------------------------------------------------------------
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const CLIENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(CLIENT, 'assets-src');
const OUT_DIR = path.join(CLIENT, 'public', 'img', 'products');
const DOCS_DIR = path.join(OUT_DIR, 'docs');

/** WebP quality/effort trade-off: ~78 is visually lossless for photography. */
const QUALITY = Number(process.env.IMG_QUALITY ?? 78);
const EFFORT = 5;

/* -------------------------------------------------------------------------- */
/*  Manifest — one entry per seeded asset                                     */
/* -------------------------------------------------------------------------- */

/**
 * `art` drives the fallback plate: a two-stop palette plus a silhouette motif.
 * Kept abstract on purpose (no text) because the container has no fonts
 * installed, and unrasterised SVG text would render as blank boxes.
 */
const PRODUCTS = [
  { name: 'honey-sundarban', width: 1200, height: 1200, art: ['#f6c453', '#a35c11'], motif: 'jar', alt: 'Jar of raw Sundarban honey with a wooden dipper' },
  { name: 'honeycomb-wild', width: 1200, height: 1200, art: ['#f0b429', '#8a5a12'], motif: 'comb', alt: 'Cut wild honeycomb dripping honey' },
  { name: 'ghee-cow', width: 1200, height: 1200, art: ['#f8e3a3', '#c9962c'], motif: 'jar', alt: 'Glass jar of grass-fed cow ghee' },
  { name: 'jaggery-date', width: 1200, height: 1200, art: ['#c98a4b', '#5c3317'], motif: 'block', alt: 'Blocks of date jaggery (gur) on palm leaves' },
  { name: 'kalijira-rice', width: 1200, height: 1200, art: ['#e8e4d3', '#7d8f5a'], motif: 'sack', alt: 'Aromatic kalijira rice grains in a jute sack' },
  { name: 'mustard-oil', width: 1200, height: 1200, art: ['#e7c94f', '#6f7f2c'], motif: 'bottle', alt: 'Bottle of cold-pressed mustard oil with seeds' },
  { name: 'turmeric-powder', width: 1200, height: 1200, art: ['#f0a72c', '#9c4a12'], motif: 'bowl', alt: 'Bowl of organic turmeric powder with fresh roots' },
  { name: 'mixed-nuts', width: 1200, height: 1200, art: ['#d9a86c', '#6b4423'], motif: 'bowl', alt: 'Mixed nuts and dry fruits in a wooden bowl' },
  { name: 'cashew-premium', width: 1200, height: 1200, art: ['#f0dcc0', '#a9793f'], motif: 'bowl', alt: 'Premium whole cashew nuts' },
  { name: 'combo-honey-ghee', width: 1200, height: 1200, art: ['#e9b949', '#2c7432'], motif: 'gift', alt: 'Honey and ghee gift combo box' },
  { name: 'combo-dryfruits', width: 1200, height: 1200, art: ['#c98a4b', '#2c7432'], motif: 'gift', alt: 'Partitioned dry fruits, cashew and honey gift box' },
  { name: 'combo-winter', width: 1200, height: 1200, art: ['#8fa86a', '#3f5c2a'], motif: 'gift', alt: 'Winter harvest combo box with gur, mustard oil and honey' },
];

const WIDE = [
  { name: 'hero-market', width: 1600, height: 1000, art: ['#9dc26a', '#2c5f2d'], motif: 'field', alt: 'Fresh organic produce from Bangladeshi farms' },
  { name: 'story-sundarban', width: 1200, height: 800, art: ['#7fa8a0', '#1f4b47'], motif: 'field', alt: 'Mangrove creeks of the Sundarbans during the Mouchak season' },
  { name: 'story-farm', width: 1200, height: 800, art: ['#b8c46a', '#4a5c23'], motif: 'field', alt: 'A smallholder farm plot in the Bangladeshi countryside' },
  { name: 'story-palm', width: 1200, height: 800, art: ['#d8b46a', '#6b4a1f'], motif: 'field', alt: 'Date palm trees tapped for winter jaggery' },
];

const MANIFEST = [...PRODUCTS, ...WIDE];

/**
 * Certification and lab documents the product pages link to. Generated as real
 * (if minimal) single-page PDFs so the "View lab report" buttons never 404.
 */
const DOCS = [
  { file: 'bsti-honey.pdf', title: 'BSTI Certification Mark (CM) Licence', type: 'bsti', reference: 'BSTI/CM/DHK/2026-0417', issuer: 'Bangladesh Standards and Testing Institution', product: 'Sundarban Raw Honey' },
  { file: 'lab-honey.pdf', title: 'Lab report — sugar profile & moisture', type: 'lab_report', reference: 'LAB-2026-HNY-091', issuer: 'Central Testing Laboratory, Dhaka', product: 'Sundarban Raw Honey' },
  { file: 'lab-honeycomb.pdf', title: 'Lab report — pollen count & moisture', type: 'lab_report', reference: 'LAB-2026-CMB-014', issuer: 'Central Testing Laboratory, Dhaka', product: 'Wild Honeycomb' },
  { file: 'bsti-ghee.pdf', title: 'BSTI Certification Mark (CM) Licence', type: 'bsti', reference: 'BSTI/CM/DHK/2026-0388', issuer: 'Bangladesh Standards and Testing Institution', product: 'Grass-Fed Cow Ghee' },
  { file: 'lab-ghee.pdf', title: 'Lab report — fat profile & adulteration screen', type: 'lab_report', reference: 'LAB-2026-GHE-055', issuer: 'Central Testing Laboratory, Dhaka', product: 'Grass-Fed Cow Ghee' },
  { file: 'lab-gur.pdf', title: 'Lab report — sulphur & heavy metals', type: 'lab_report', reference: 'LAB-2026-GUR-031', issuer: 'Central Testing Laboratory, Dhaka', product: 'Date Jaggery (Gur)' },
  { file: 'bsti-oil.pdf', title: 'BSTI Certification Mark (CM) Licence', type: 'bsti', reference: 'BSTI/CM/DHK/2026-0502', issuer: 'Bangladesh Standards and Testing Institution', product: 'Cold-Pressed Mustard Oil' },
  { file: 'lab-nuts.pdf', title: 'Lab report — aflatoxin screen', type: 'lab_report', reference: 'LAB-2026-NUT-077', issuer: 'Central Testing Laboratory, Dhaka', product: 'Mixed Nuts & Dry Fruits' },
  { file: 'lab-turmeric.pdf', title: 'Lab report — lead chromate screen (ND)', type: 'lab_report', reference: 'LAB-2026-TRM-118', issuer: 'Central Testing Laboratory, Dhaka', product: 'Organic Turmeric Powder' },
  { file: 'organic-turmeric.pdf', title: 'Organic certificate — Bangladesh Organic Federation', type: 'organic_certificate', reference: 'BOF/ORG/2026/112', issuer: 'Bangladesh Organic Federation', product: 'Organic Turmeric Powder' },
  { file: 'lab-catalogue.pdf', title: 'Heavy metals & pesticide screen — full catalogue', type: 'lab_report', reference: 'CTL/2026/Q3-014', issuer: 'Central Testing Laboratory, Dhaka', product: 'All lines' },
  { file: 'halal.pdf', title: 'Halal certification', type: 'halal', reference: 'IFB/HALAL/2026/0771', issuer: 'Islamic Foundation Bangladesh', product: 'All dairy, honey and spice lines' },
  { file: 'story-sundarban.pdf', title: 'Where the honey comes from', type: 'sourcing_story', reference: 'GR-STORY-001', issuer: 'Gramrosh', product: 'Sundarban Raw Honey' },
];

/* -------------------------------------------------------------------------- */
/*  Fallback artwork — vector only, no text (the container has no fonts)       */
/* -------------------------------------------------------------------------- */

/** A silhouette per product family, drawn at the centre of the plate. */
function motif(motifName, cx, cy, scale, ink) {
  const s = scale;
  switch (motifName) {
    case 'jar':
      return `
        <rect x="${cx - 0.30 * s}" y="${cy - 0.34 * s}" width="${0.60 * s}" height="${0.72 * s}" rx="${0.10 * s}" fill="${ink}" opacity="0.92"/>
        <rect x="${cx - 0.22 * s}" y="${cy - 0.44 * s}" width="${0.44 * s}" height="${0.12 * s}" rx="${0.05 * s}" fill="${ink}"/>
        <rect x="${cx - 0.20 * s}" y="${cy - 0.14 * s}" width="${0.40 * s}" height="${0.30 * s}" rx="${0.04 * s}" fill="#fffdf8" opacity="0.28"/>`;
    case 'bottle':
      return `
        <rect x="${cx - 0.09 * s}" y="${cy - 0.52 * s}" width="${0.18 * s}" height="${0.22 * s}" rx="${0.05 * s}" fill="${ink}"/>
        <path d="M ${cx - 0.26 * s} ${cy - 0.24 * s} Q ${cx - 0.09 * s} ${cy - 0.34 * s} ${cx - 0.09 * s} ${cy - 0.30 * s} L ${cx + 0.09 * s} ${cy - 0.30 * s} Q ${cx + 0.09 * s} ${cy - 0.34 * s} ${cx + 0.26 * s} ${cy - 0.24 * s} L ${cx + 0.26 * s} ${cy + 0.40 * s} Q ${cx + 0.26 * s} ${cy + 0.46 * s} ${cx + 0.20 * s} ${cy + 0.46 * s} L ${cx - 0.20 * s} ${cy + 0.46 * s} Q ${cx - 0.26 * s} ${cy + 0.46 * s} ${cx - 0.26 * s} ${cy + 0.40 * s} Z" fill="${ink}" opacity="0.92"/>`;
    case 'bowl':
      return `
        <path d="M ${cx - 0.44 * s} ${cy - 0.06 * s} A ${0.44 * s} ${0.40 * s} 0 0 0 ${cx + 0.44 * s} ${cy - 0.06 * s} Z" fill="${ink}" opacity="0.92"/>
        <ellipse cx="${cx}" cy="${cy - 0.06 * s}" rx="${0.44 * s}" ry="${0.13 * s}" fill="#fffdf8" opacity="0.30"/>
        <circle cx="${cx - 0.16 * s}" cy="${cy - 0.12 * s}" r="${0.07 * s}" fill="${ink}"/>
        <circle cx="${cx + 0.04 * s}" cy="${cy - 0.17 * s}" r="${0.08 * s}" fill="${ink}"/>
        <circle cx="${cx + 0.22 * s}" cy="${cy - 0.10 * s}" r="${0.06 * s}" fill="${ink}"/>`;
    case 'block':
      return `
        <rect x="${cx - 0.38 * s}" y="${cy - 0.24 * s}" width="${0.34 * s}" height="${0.34 * s}" rx="${0.05 * s}" fill="${ink}" opacity="0.95" transform="rotate(-8 ${cx} ${cy})"/>
        <rect x="${cx + 0.02 * s}" y="${cy - 0.18 * s}" width="${0.34 * s}" height="${0.34 * s}" rx="${0.05 * s}" fill="${ink}" opacity="0.80" transform="rotate(6 ${cx} ${cy})"/>`;
    case 'sack':
      return `
        <path d="M ${cx - 0.30 * s} ${cy - 0.30 * s} L ${cx + 0.30 * s} ${cy - 0.30 * s} L ${cx + 0.40 * s} ${cy + 0.40 * s} Q ${cx} ${cy + 0.52 * s} ${cx - 0.40 * s} ${cy + 0.40 * s} Z" fill="${ink}" opacity="0.92"/>
        <path d="M ${cx - 0.24 * s} ${cy - 0.38 * s} Q ${cx} ${cy - 0.28 * s} ${cx + 0.24 * s} ${cy - 0.38 * s}" stroke="${ink}" stroke-width="${0.06 * s}" fill="none" stroke-linecap="round"/>`;
    case 'gift':
      return `
        <rect x="${cx - 0.40 * s}" y="${cy - 0.18 * s}" width="${0.80 * s}" height="${0.56 * s}" rx="${0.06 * s}" fill="${ink}" opacity="0.92"/>
        <rect x="${cx - 0.44 * s}" y="${cy - 0.30 * s}" width="${0.88 * s}" height="${0.16 * s}" rx="${0.05 * s}" fill="${ink}"/>
        <rect x="${cx - 0.05 * s}" y="${cy - 0.30 * s}" width="${0.10 * s}" height="${0.74 * s}" fill="#fffdf8" opacity="0.45"/>
        <path d="M ${cx} ${cy - 0.30 * s} Q ${cx - 0.22 * s} ${cy - 0.52 * s} ${cx - 0.06 * s} ${cy - 0.30 * s} Z" fill="#fffdf8" opacity="0.55"/>
        <path d="M ${cx} ${cy - 0.30 * s} Q ${cx + 0.22 * s} ${cy - 0.52 * s} ${cx + 0.06 * s} ${cy - 0.30 * s} Z" fill="#fffdf8" opacity="0.55"/>`;
    case 'comb': {
      // Hexagon cluster — the one motif that reads instantly as honeycomb.
      const r = 0.13 * s;
      const hex = (hx, hy) => {
        const pts = Array.from({ length: 6 }, (_, i) => {
          const a = (Math.PI / 3) * i - Math.PI / 6;
          return `${(hx + r * Math.cos(a)).toFixed(2)},${(hy + r * Math.sin(a)).toFixed(2)}`;
        }).join(' ');
        return `<polygon points="${pts}" fill="${ink}" opacity="0.9" stroke="#fffdf8" stroke-opacity="0.35" stroke-width="${(0.02 * s).toFixed(2)}"/>`;
      };
      const dx = r * Math.sqrt(3);
      return [
        hex(cx, cy), hex(cx - dx, cy), hex(cx + dx, cy),
        hex(cx - dx / 2, cy - r * 1.5), hex(cx + dx / 2, cy - r * 1.5),
        hex(cx - dx / 2, cy + r * 1.5), hex(cx + dx / 2, cy + r * 1.5),
      ].join('');
    }
    case 'field':
    default:
      // Rolling rows receding to a horizon — used for hero and origin stories.
      return `
        <circle cx="${cx + 0.30 * s}" cy="${cy - 0.34 * s}" r="${0.14 * s}" fill="#fffdf8" opacity="0.55"/>
        <path d="M ${cx - 0.9 * s} ${cy + 0.10 * s} Q ${cx - 0.2 * s} ${cy - 0.20 * s} ${cx + 0.9 * s} ${cy + 0.06 * s} L ${cx + 0.9 * s} ${cy + 0.7 * s} L ${cx - 0.9 * s} ${cy + 0.7 * s} Z" fill="${ink}" opacity="0.55"/>
        <path d="M ${cx - 0.9 * s} ${cy + 0.34 * s} Q ${cx} ${cy + 0.10 * s} ${cx + 0.9 * s} ${cy + 0.32 * s} L ${cx + 0.9 * s} ${cy + 0.7 * s} L ${cx - 0.9 * s} ${cy + 0.7 * s} Z" fill="${ink}" opacity="0.85"/>`;
  }
}

/**
 * A brand plate: warm two-stop wash, a soft light source, a faint leaf texture
 * and the motif silhouette. Deliberately text-free — see the note on `motif`.
 */
function plate({ name, width, height, art, motif: motifName }) {
  const [light, dark] = art;
  const cx = width / 2;
  const cy = height / 2;
  const scale = Math.min(width, height) * 0.72;

  // Deterministic leaf scatter so each plate differs but never changes run to run.
  const leaves = Array.from({ length: 14 }, (_, i) => {
    const seedA = (i * 9301 + name.length * 49297) % 233280;
    const seedB = (i * 4111 + name.charCodeAt(0) * 7919) % 233280;
    const lx = (seedA / 233280) * width;
    const ly = (seedB / 233280) * height;
    const lr = 18 + ((seedA + seedB) % 46);
    const rot = (seedB % 360);
    return `<ellipse cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" rx="${lr}" ry="${(lr * 0.42).toFixed(1)}" transform="rotate(${rot} ${lx.toFixed(1)} ${ly.toFixed(1)})" fill="#fffdf8" opacity="0.05"/>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="wash" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${light}"/>
      <stop offset="100%" stop-color="${dark}"/>
    </linearGradient>
    <radialGradient id="glow" cx="26%" cy="18%" r="72%">
      <stop offset="0%" stop-color="#fffdf8" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#fffdf8" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vignette" cx="50%" cy="50%" r="72%">
      <stop offset="60%" stop-color="#30201e" stop-opacity="0"/>
      <stop offset="100%" stop-color="#30201e" stop-opacity="0.30"/>
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#wash)"/>
  ${leaves}
  <rect width="${width}" height="${height}" fill="url(#glow)"/>
  ${motif(motifName, cx, cy, scale, dark)}
  <rect width="${width}" height="${height}" fill="url(#vignette)"/>
</svg>`;
}

/* -------------------------------------------------------------------------- */
/*  Minimal PDF writer (no dependency, no font needed — Helvetica is a PDF     */
/*  base-14 font and is resolved by the viewer, not by us)                    */
/* -------------------------------------------------------------------------- */

const esc = (text) => String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** Wrap `text` to roughly `max` characters on word boundaries. */
function wrap(text, max) {
  const out = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    if ((line + (line ? ' ' : '') + word).length > max) {
      if (line) out.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) out.push(line);
  return out;
}

/**
 * Render a one-page A4 certificate/report. Enough structure to be a believable
 * artefact (letterhead, reference table, findings, footer) without pulling in a
 * PDF library.
 */
function buildPdf(doc) {
  const W = 595;
  const H = 842;
  const M = 56;
  const lines = [];
  let y = H - M;

  const text = (value, { size = 10, bold = false, gap = 15, color = '0.2 0.15 0.14' } = {}) => {
    for (const row of wrap(value, Math.floor((W - 2 * M) / (size * 0.52)))) {
      lines.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${color} rg 1 0 0 1 ${M} ${y} Tm (${esc(row)}) Tj ET`);
      y -= gap;
    }
  };
  const rule = (width = 0.8, color = '0.85 0.82 0.78') => {
    lines.push(`${color} RG ${width} w ${M} ${y + 4} m ${W - M} ${y + 4} l S`);
    y -= 16;
  };
  const space = (amount = 12) => { y -= amount; };

  // Letterhead
  text('GRAMROSH', { size: 20, bold: true, gap: 24, color: '0.17 0.45 0.20' });
  text('Fresh & Organic Food — Bangladesh', { size: 9, gap: 20, color: '0.45 0.38 0.35' });
  rule(1.2, '0.17 0.45 0.20');
  space(6);

  text(doc.title, { size: 15, bold: true, gap: 20 });
  text(`${doc.type === 'lab_report' ? 'Laboratory Analysis Report' : doc.type === 'bsti' ? 'Certification Mark Licence' : doc.type === 'halal' ? 'Halal Compliance Certificate' : doc.type === 'organic_certificate' ? 'Organic Production Certificate' : 'Sourcing Record'}`, { size: 9, gap: 18, color: '0.45 0.38 0.35' });
  space(8);

  const rows = [
    ['Document reference', doc.reference],
    ['Issuing body', doc.issuer],
    ['Covered product line', doc.product],
    ['Document type', doc.type.replace(/_/g, ' ')],
    ['Generated', new Date().toISOString().slice(0, 10)],
  ];
  for (const [label, value] of rows) {
    lines.push(`BT /F2 9 Tf 0.45 0.38 0.35 rg 1 0 0 1 ${M} ${y} Tm (${esc(label)}) Tj ET`);
    lines.push(`BT /F1 10 Tf 0.2 0.15 0.14 rg 1 0 0 1 ${M + 160} ${y} Tm (${esc(value)}) Tj ET`);
    y -= 17;
  }

  space(10);
  rule();
  space(2);
  text('Scope of assessment', { size: 11, bold: true, gap: 17 });
  text(
    doc.type === 'lab_report'
      ? 'Samples were drawn from the current production batch under Gramrosh batch-sampling SOP-04 and sealed in the presence of the production supervisor. Analysis covered adulteration markers, heavy metals, microbiological load and moisture content against BSTI BDS 1143 and EU Commission Regulation 1881/2006 limits.'
      : 'This certificate confirms that the named product line is produced, stored, handled and transported in accordance with the applicable certification scheme. The licence is subject to annual surveillance audit and to unannounced market sampling.',
    { size: 10, gap: 15 },
  );

  space(8);
  text('Declaration', { size: 11, bold: true, gap: 17 });
  text(
    'Gramrosh publishes this document on every product page as part of its batch-transparency commitment. Results apply to the batch referenced above and are re-issued whenever a new harvest enters the packing line.',
    { size: 10, gap: 15 },
  );

  space(24);
  rule();
  text('Gramrosh · House 12, Road 5, Dhanmondi, Dhaka 1205, Bangladesh · hello@gramrosh.com · +880 1711-223344', { size: 8, gap: 12, color: '0.50 0.44 0.41' });
  text('This is a sample document generated for the Gramrosh demo catalogue.', { size: 8, gap: 12, color: '0.62 0.56 0.53' });

  const content = lines.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefAt = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info << /Title (${esc(doc.title)}) /Author (Gramrosh) /Producer (Gramrosh asset pipeline) >> >>\nstartxref\n${xrefAt}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

/* -------------------------------------------------------------------------- */
/*  Runner                                                                     */
/* -------------------------------------------------------------------------- */

const SOURCE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

/** Find a supplied photo for `name`, or null when we must paint a plate. */
async function findSource(name) {
  for (const ext of SOURCE_EXTENSIONS) {
    const candidate = path.join(SRC_DIR, `${name}${ext}`);
    try {
      await fs.access(candidate);
      return candidate;
    } catch { /* try the next extension */ }
  }
  return null;
}

async function buildImage(entry) {
  const out = path.join(OUT_DIR, `${entry.name}.webp`);
  const source = await findSource(entry.name);

  const pipeline = source
    // A real photo: cover-crop to the declared aspect ratio, then downscale.
    ? sharp(source, { failOn: 'none' }).resize(entry.width, entry.height, {
      fit: 'cover',
      position: sharp.strategy.attention,
    })
    // No photo supplied: rasterise the vector plate at the exact size.
    : sharp(Buffer.from(plate(entry)), { density: 150 }).resize(entry.width, entry.height);

  const buffer = await pipeline
    .webp({ quality: QUALITY, effort: EFFORT })
    .toBuffer();

  await fs.writeFile(out, buffer);
  return { ...entry, out, bytes: buffer.length, generated: !source };
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(DOCS_DIR, { recursive: true });
  await fs.mkdir(SRC_DIR, { recursive: true });

  console.log(`Building ${MANIFEST.length} WebP assets → ${path.relative(process.cwd(), OUT_DIR)}`);

  const built = [];
  for (const entry of MANIFEST) {
    // eslint-disable-next-line no-await-in-loop — sequential keeps peak memory flat
    built.push(await buildImage(entry));
  }

  let docBytes = 0;
  for (const doc of DOCS) {
    const buffer = buildPdf(doc);
    // eslint-disable-next-line no-await-in-loop
    await fs.writeFile(path.join(DOCS_DIR, doc.file), buffer);
    docBytes += buffer.length;
  }

  const total = built.reduce((sum, item) => sum + item.bytes, 0);
  const kb = (n) => `${(n / 1024).toFixed(1)} kB`;

  for (const item of built) {
    const tag = item.generated ? 'plate' : 'photo';
    console.log(`  ${tag}  ${item.name.padEnd(20)} ${String(item.width).padStart(4)}×${item.height}  ${kb(item.bytes).padStart(9)}`);
  }

  console.log(`\n${built.length} images (${kb(total)} total), ${DOCS.length} documents (${kb(docBytes)}).`);
  console.log(`Source photos are read from ${path.relative(process.cwd(), SRC_DIR)}/ — drop a <name>.jpg there to replace a plate.`);

  // A storefront with a 2 MB hero image is a failed build, so say so loudly.
  const heavy = built.filter((item) => item.bytes > 350 * 1024);
  if (heavy.length) {
    console.warn(`\nWARNING: ${heavy.length} image(s) exceed 350 kB — re-run with a lower IMG_QUALITY or recompress the source:`);
    for (const item of heavy) console.warn(`  ${item.name}: ${kb(item.bytes)}`);
  }
}

main().catch((error) => {
  console.error('Image build failed:', error);
  process.exit(1);
});
