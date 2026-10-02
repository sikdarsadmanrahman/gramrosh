/**
 * -----------------------------------------------------------------------------
 *  validators/storefront.validator.js — Homepage content, flash sale & reports
 * -----------------------------------------------------------------------------
 */
import { z } from 'zod';
import { optionalText, text, objectId, blankToUndefined, queryBoolean } from './common.validator.js';

const imageInput = z.object({
  url: text(600),
  placeholderUrl: optionalText(600),
  alt: optionalText(180),
  width: z.coerce.number().int().min(0).optional(),
  height: z.coerce.number().int().min(0).optional(),
  format: z.enum(['webp', 'avif', 'jpg', 'jpeg', 'png']).optional(),
  isPrimary: z.boolean().optional(),
}).optional();

const heroSlide = z.object({
  _id: z.preprocess(blankToUndefined, objectId.optional()),
  eyebrow: optionalText(80),
  title: text(120),
  titleBn: optionalText(120),
  subtitle: optionalText(240),
  image: imageInput,
  ctaLabel: optionalText(40),
  ctaHref: optionalText(200),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).default(0),
});

const certification = z.object({
  _id: z.preprocess(blankToUndefined, objectId.optional()),
  title: text(140),
  type: z.string().trim().toLowerCase().min(2).max(40),
  issuer: optionalText(120),
  description: optionalText(500),
  url: optionalText(600),
  reference: optionalText(80),
  issuedAt: z.preprocess(blankToUndefined, z.coerce.date().nullable().optional()),
  expiresAt: z.preprocess(blankToUndefined, z.coerce.date().nullable().optional()),
  image: imageInput,
  isPublic: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).default(0),
});

const originStory = z.object({
  _id: z.preprocess(blankToUndefined, objectId.optional()),
  title: text(140),
  region: optionalText(100),
  farmer: optionalText(120),
  body: optionalText(1500),
  image: imageInput,
  productIds: z.preprocess(
    (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v),
    z.array(objectId).max(12).optional(),
  ),
  sortOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

const testimonial = z.object({
  _id: z.preprocess(blankToUndefined, objectId.optional()),
  name: text(100),
  location: optionalText(100),
  rating: z.coerce.number().min(1).max(5).default(5),
  quote: text(400),
  isActive: z.boolean().default(true),
});

const trustPoint = z.object({
  icon: optionalText(40),
  title: text(80),
  description: optionalText(160),
});

/** PATCH /api/admin/settings — partial update of the storefront singleton. */
export const updateStorefrontBody = z.object({
  storeName: z.preprocess(blankToUndefined, text(80).optional()),
  tagline: z.preprocess(blankToUndefined, text(160).optional()),
  announcement: z.object({
    text: optionalText(200),
    isActive: z.boolean().optional(),
  }).optional(),
  hero: z.array(heroSlide).max(5).optional(),
  flashSale: z.object({
    isActive: z.boolean(),
    title: optionalText(120),
    subtitle: optionalText(200),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date(),
    couponCode: optionalText(30),
    couponValue: z.coerce.number().min(0).optional(),
    productIds: z.preprocess(
      (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v),
      z.array(objectId).max(50).optional(),
    ),
  }).refine((v) => !v.startsAt || v.endsAt > v.startsAt, { message: 'Campaign must end after it starts', path: ['endsAt'] }).optional(),
  certifications: z.array(certification).max(30).optional(),
  originStories: z.array(originStory).max(20).optional(),
  testimonials: z.array(testimonial).max(20).optional(),
  trustPoints: z.array(trustPoint).max(8).optional(),
  contact: z.object({
    phone: optionalText(30),
    whatsapp: optionalText(30),
    hotline: optionalText(20),
    email: optionalText(160),
    address: optionalText(240),
    hours: optionalText(120),
    facebook: optionalText(300),
    instagram: optionalText(300),
    youtube: optionalText(300),
  }).optional(),
  seo: z.object({
    title: optionalText(120),
    description: optionalText(300),
  }).optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

/** GET /api/admin/stats/* — shared date-range filter. */
export const statsQuery = z.object({
  from: z.preprocess(blankToUndefined, z.coerce.date().optional()),
  to: z.preprocess(blankToUndefined, z.coerce.date().optional()),
  days: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(365).optional()),
  groupBy: z.preprocess(blankToUndefined, z.enum(['day', 'week', 'month']).optional()),
  includeCancelled: queryBoolean,
}).refine((v) => !v.from || !v.to || v.from <= v.to, { message: '"from" must be before "to"', path: ['to'] });

/** POST /api/newsletter */
export const newsletterBody = z.object({
  phone: z.preprocess(blankToUndefined, text(24).optional()),
  email: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.string().email().max(160).optional(),
  ),
}).refine((v) => Boolean(v.phone || v.email), { message: 'Provide a phone number or an email address' });
