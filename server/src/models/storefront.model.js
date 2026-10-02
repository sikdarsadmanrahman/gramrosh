/**
 * -----------------------------------------------------------------------------
 *  storefront.model.js — Singleton "settings" document
 * -----------------------------------------------------------------------------
 *  Everything the marketing team edits without a deploy: the homepage hero, the
 *  global flash-sale countdown, certification documents (BSTI / lab reports),
 *  sourcing stories, testimonials and the floating contact widget.
 *
 *  A single document is read once per page load and cached with a strong ETag,
 *  which keeps the storefront's first paint cheap.
 * -----------------------------------------------------------------------------
 */
import mongoose from 'mongoose';
import { imageSchema } from './category.model.js';

const { Schema } = mongoose;

export const STOREFRONT_ID = 'gramrosh-storefront';

const flashSaleCampaignSchema = new Schema(
  {
    isActive: { type: Boolean, default: false },
    title: { type: String, trim: true, default: 'Flash Sale' },
    subtitle: { type: String, trim: true, default: '' },
    /** Powers the sticky countdown bar. */
    startsAt: { type: Date, default: () => new Date() },
    endsAt: { type: Date, default: () => new Date(Date.now() + 86_400_000) },
    /** Coupon code revealed in the bar (optional). */
    couponCode: { type: String, trim: true, uppercase: true, default: '' },
    couponValue: { type: Number, min: 0, default: 0 },
    productIds: { type: [Schema.Types.ObjectId], default: [] },
  },
  { _id: false },
);

const certificationSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 140 },
    /** bsti | lab_report | organic_certificate | halal | iso | sourcing_story */
    type: { type: String, required: true, trim: true, lowercase: true },
    issuer: { type: String, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 500 },
    /** Downloadable PDF / image URL. */
    url: { type: String, trim: true, default: '' },
    reference: { type: String, trim: true, maxlength: 80 },
    issuedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    image: { type: imageSchema, default: undefined },
    isPublic: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: true },
);

const originStorySchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 140 },
    region: { type: String, trim: true, maxlength: 100 },
    farmer: { type: String, trim: true, maxlength: 120 },
    body: { type: String, trim: true, maxlength: 1500 },
    image: { type: imageSchema, default: undefined },
    /** Product ids featured in this story. */
    productIds: { type: [Schema.Types.ObjectId], default: [] },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { _id: true },
);

const testimonialSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    location: { type: String, trim: true, maxlength: 100 },
    rating: { type: Number, min: 1, max: 5, default: 5 },
    quote: { type: String, required: true, trim: true, maxlength: 400 },
    isActive: { type: Boolean, default: true },
  },
  { _id: true },
);

const heroSlideSchema = new Schema(
  {
    eyebrow: { type: String, trim: true, default: '' },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    titleBn: { type: String, trim: true, maxlength: 120 },
    subtitle: { type: String, trim: true, maxlength: 240 },
    image: { type: imageSchema, default: undefined },
    ctaLabel: { type: String, trim: true, default: 'Shop now' },
    ctaHref: { type: String, trim: true, default: '/shop' },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: true },
);

const contactSchema = new Schema(
  {
    phone: { type: String, trim: true, default: '+8801711223344' },
    whatsapp: { type: String, trim: true, default: '8801711223344' },
    hotline: { type: String, trim: true, default: '16247' },
    email: { type: String, trim: true, default: 'hello@gramrosh.com' },
    address: { type: String, trim: true, default: 'Dhaka, Bangladesh' },
    hours: { type: String, trim: true, default: 'Sat–Thu, 9:00 AM – 9:00 PM' },
    facebook: { type: String, trim: true, default: '' },
    instagram: { type: String, trim: true, default: '' },
    youtube: { type: String, trim: true, default: '' },
  },
  { _id: false },
);

const storefrontSchema = new Schema(
  {
    /** Fixed id — there is only ever one of these documents. */
    key: { type: String, default: STOREFRONT_ID, unique: true },
    storeName: { type: String, trim: true, default: 'Gramrosh' },
    tagline: { type: String, trim: true, default: 'Fresh & Organic, straight from the village' },
    announcement: {
      text: { type: String, trim: true, default: 'Free delivery on orders above ৳2,500 · 100% authentic, lab-tested' },
      isActive: { type: Boolean, default: true },
    },
    hero: { type: [heroSlideSchema], default: [] },
    flashSale: { type: flashSaleCampaignSchema, default: () => ({}) },
    certifications: { type: [certificationSchema], default: [] },
    originStories: { type: [originStorySchema], default: [] },
    testimonials: { type: [testimonialSchema], default: [] },
    contact: { type: contactSchema, default: () => ({}) },
    /** Trust bar items rendered under the hero. */
    trustPoints: {
      type: [
        {
          icon: { type: String, trim: true, default: 'shield-check' },
          title: { type: String, trim: true, required: true },
          description: { type: String, trim: true, default: '' },
          _id: false,
        },
      ],
      default: [],
    },
    seo: {
      title: { type: String, trim: true, default: 'Gramrosh — Fresh & Organic Food from Bangladesh' },
      description: { type: String, trim: true, default: '' },
    },
    updatedAtBy: { type: String, trim: true, default: '' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

// `key` already carries `unique: true` inline — no duplicate index needed.

/** Static: always resolves to the singleton, creating it on first use. */
storefrontSchema.statics.getSingleton = async function getSingleton() {
  const existing = await this.findOne({ key: STOREFRONT_ID }).lean();
  return existing;
};

export const Storefront = mongoose.models.Storefront || mongoose.model('Storefront', storefrontSchema);
export default Storefront;
