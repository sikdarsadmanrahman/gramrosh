/**
 * -----------------------------------------------------------------------------
 *  storefront.service.js — Homepage content, flash-sale campaign & trust docs
 * -----------------------------------------------------------------------------
 *  The storefront settings live in ONE singleton document, so the homepage
 *  bootstrap is a single indexed read that can be cached hard at the CDN.
 * -----------------------------------------------------------------------------
 */
import { db } from '../db/index.js';
import { STOREFRONT_ID } from '../models/storefront.model.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { CERTIFICATION_TYPES } from '../config/constants.js';

/** Fallback content so a fresh install still renders a complete homepage. */
const DEFAULTS = Object.freeze({
  key: STOREFRONT_ID,
  storeName: 'Gramrosh',
  tagline: 'Fresh & Organic, straight from the village',
  announcement: {
    text: 'Free delivery on orders above ৳2,500 · 100% authentic & lab-tested',
    isActive: true,
  },
  contact: {
    phone: '+8801711223344',
    whatsapp: '8801711223344',
    hotline: '16247',
    email: 'hello@gramrosh.com',
    address: 'House 12, Road 5, Dhanmondi, Dhaka 1205, Bangladesh',
    hours: 'Sat–Thu, 9:00 AM – 9:00 PM',
  },
  flashSale: { isActive: false, title: 'Flash Sale', endsAt: new Date(Date.now() + 86_400_000) },
});

/**
 * Read the singleton (creating it from defaults on a fresh database).
 * @returns {Promise<object>}
 */
export async function getStorefront() {
  const existing = await db.Storefront.findOne({ key: STOREFRONT_ID }).lean();
  if (existing) return existing;

  const created = await db.Storefront.create({ ...DEFAULTS });
  logger.info('[storefront] settings document initialised');
  return { ...DEFAULTS, ...created.toObject?.() };
}

/** Partial update of the singleton (admin → Settings screen). */
export async function updateStorefront(patch, { updatedBy = '' } = {}) {
  const current = await getStorefront();
  if (!current?._id) throw ApiError.internal('Storefront settings are unavailable');

  if (patch.certifications) {
    const invalid = patch.certifications.filter((c) => !CERTIFICATION_TYPES.includes(String(c.type).toLowerCase()));
    if (invalid.length) {
      throw ApiError.unprocessable('Unknown certification type', {
        errors: invalid.map((c) => ({ path: 'certifications.type', message: `"${c.type}" is not one of ${CERTIFICATION_TYPES.join(', ')}` })),
      });
    }
  }

  const updated = await db.Storefront.findByIdAndUpdate(
    current._id,
    { $set: { ...patch, updatedAtBy: updatedBy } },
    { new: true },
  ).lean();

  logger.info('[storefront] settings updated', { fields: Object.keys(patch).length, updatedBy });
  return updated;
}

/**
 * The flash-sale campaign, only when it is actually running.
 * The sticky countdown bar hides itself when this returns null.
 */
export async function getActiveFlashSale() {
  const settings = await getStorefront();
  const campaign = settings?.flashSale;
  if (!campaign?.isActive || !campaign.endsAt) return null;

  const now = Date.now();
  const startsAt = campaign.startsAt ? new Date(campaign.startsAt).getTime() : 0;
  const endsAt = new Date(campaign.endsAt).getTime();
  if (now < startsAt || now > endsAt) return null;

  return {
    ...campaign,
    startsAt: campaign.startsAt ?? null,
    endsAt: campaign.endsAt,
    /** Server clock reference so the client countdown never drifts. */
    serverTime: new Date().toISOString(),
    secondsRemaining: Math.max(0, Math.floor((endsAt - now) / 1000)),
  };
}

/** Public (downloadable) trust documents — BSTI certificates, lab reports… */
export async function getCertifications({ type } = {}) {
  const settings = await getStorefront();
  const all = (settings.certifications ?? []).filter((c) => c.isPublic !== false);
  const filtered = type ? all.filter((c) => String(c.type).toLowerCase() === String(type).toLowerCase()) : all;
  return [...filtered].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

/** Sourcing / origin stories for the "Where it comes from" section. */
export async function getOriginStories() {
  const settings = await getStorefront();
  return (settings.originStories ?? [])
    .filter((story) => story.isActive !== false)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

export async function getTestimonials() {
  const settings = await getStorefront();
  return (settings.testimonials ?? []).filter((t) => t.isActive !== false);
}
