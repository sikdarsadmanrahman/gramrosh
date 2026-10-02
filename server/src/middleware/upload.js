/**
 * -----------------------------------------------------------------------------
 *  middleware/upload.js — Multer memory storage for image uploads
 * -----------------------------------------------------------------------------
 *  Files never touch the API's disk: Multer buffers them in memory and the
 *  Cloudinary service streams them straight to the CDN, which converts to WebP
 *  on ingest. Memory storage also keeps the API stateless, so any replica can
 *  handle an upload (no shared volume to mount).
 * -----------------------------------------------------------------------------
 */
import multer from 'multer';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

/** Accepted input formats — the CDN transcodes all of them to WebP/AVIF. */
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
]);

export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.UPLOAD_MAX_MB * 1024 * 1024,
    files: 8,
    fields: 20,
  },
  fileFilter(_req, file, cb) {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(ApiError.badRequest(`Unsupported image type "${file.mimetype}" — use JPG, PNG, WebP, AVIF or GIF`));
    }
    cb(null, true);
  },
});

/** Single product/category image. */
export const uploadSingleImage = imageUpload.single('image');

/** Up to 8 gallery images for a product. */
export const uploadGalleryImages = imageUpload.array('images', 8);

export default imageUpload;
