/**
 * -----------------------------------------------------------------------------
 *  cloudinary.service.js — Image ingest → WebP on a CDN
 * -----------------------------------------------------------------------------
 *  Product photography is the heaviest thing on the storefront, so the rule is:
 *  nothing reaches a shopper's phone that isn't a WebP served from a CDN.
 *
 *  Two providers, one interface:
 *
 *    • Cloudinary (production) — set CLOUDINARY_CLOUD_NAME / _API_KEY /
 *      _API_SECRET. The original is uploaded once and every size is delivered as
 *      `…/image/upload/f_webp,q_auto,w_<n>/<publicId>`, so the CDN does the
 *      transcoding, resizing and edge caching. Put CLOUDINARY `f_auto` behind a
 *      custom domain (CDN_BASE_URL) for AVIF negotiation.
 *
 *    • Local disk (development / sandbox) — when no credentials are present the
 *      same function transcodes to WebP with `sharp` and writes to
 *      `server/.data/uploads`, served at `/uploads`. The API contract is
 *      identical, so the admin panel and the storefront work unchanged.
 * -----------------------------------------------------------------------------
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import sharp from 'sharp';

import { env, SERVER_DIR } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { slugify } from '../utils/slugify.js';

/** Where locally transcoded WebP files live (git-ignored). */
export const LOCAL_UPLOAD_DIR = path.join(SERVER_DIR, '.data', 'uploads');
/** URL prefix the API serves that directory from. */
export const LOCAL_UPLOAD_URL = '/uploads';

/** Delivery widths used to build `srcset` — mobile, tablet, desktop, retina. */
export const RESPONSIVE_WIDTHS = Object.freeze([360, 640, 960, 1280]);

let configured = false;

/** Wire up the Cloudinary SDK when credentials exist. Call once at boot. */
export function configureCloudinary() {
  if (env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET) {
    cloudinary.config({
      cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET,
      secure: true,
    });
    configured = true;
    logger.info('[images] Cloudinary configured', { cloud: env.CLOUDINARY_CLOUD_NAME });
  } else {
    configured = false;
    logger.info('[images] Cloudinary not configured — using local WebP transcoder');
  }
  return configured;
}

/** Which provider is live: `cloudinary` or `local`. */
export function getImageProvider() {
  return configured ? 'cloudinary' : 'local';
}

export function isCloudinaryConfigured() {
  return configured;
}

/* -------------------------------------------------------------------------- */
/*  URL helpers                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Build a WebP delivery URL for a Cloudinary public id.
 *
 * @param {string} publicId
 * @param {{width?:number, format?:string, quality?:string|number, crop?:string}} [options]
 */
export function buildDeliveryUrl(publicId, { width, format = 'webp', quality = 'auto', crop = 'limit' } = {}) {
  const cloud = env.CLOUDINARY_CLOUD_NAME;
  const base = env.CDN_BASE_URL || `https://res.cloudinary.com/${cloud}/image/upload`;
  const transforms = [`f_${format}`, `q_${quality}`, `c_${crop}`, ...(width ? [`w_${width}`] : [])].join(',');
  return `${base}/${transforms}/${publicId}`;
}

/**
 * Rewrite an arbitrary Cloudinary URL so it is delivered as WebP at `width`.
 * Non-Cloudinary URLs (local uploads, third-party CDNs) are returned untouched.
 */
export function optimizeUrl(url, { width, format = 'webp', quality = 'auto' } = {}) {
  if (!url || typeof url !== 'string') return url;
  const marker = '/image/upload/';
  const index = url.indexOf(marker);
  if (index === -1) return url;

  const head = url.slice(0, index + marker.length);
  let tail = url.slice(index + marker.length);

  // Drop any existing transform segment (v1234567890 or f_auto,q_auto).
  const segments = tail.split('/');
  while (segments.length && !segments[0].includes('.')) segments.shift();

  const transforms = [`f_${format}`, `q_${quality}`, ...(width ? [`w_${width}`] : [])].join(',');
  return `${head}${transforms}/${segments.join('/')}`;
}

/** Extract the Cloudinary public id from a delivery URL. */
export function publicIdFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const marker = '/image/upload/';
  const index = url.indexOf(marker);
  if (index === -1) return url; // already a bare public id
  const tail = url.slice(index + marker.length).split('/');
  while (tail.length && !tail[0].includes('.')) tail.shift();
  return tail.join('/').replace(/\.(webp|avif|jpg|jpeg|png|gif)$/i, '');
}

/* -------------------------------------------------------------------------- */
/*  Upload                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Upload & transcode one image.
 *
 * @param {{buffer:Buffer, originalname:string, mimetype:string}} file  Multer memory file
 * @param {{folder?:string, nameHint?:string, maxWidth?:number}} [options]
 * @returns {Promise<{url:string, publicId:string, format:string, width:number, height:number, bytes:number, provider:string, srcset?:string}>}
 */
export async function uploadImage(file, { folder = env.CLOUDINARY_FOLDER, nameHint = '', maxWidth = 1600 } = {}) {
  if (!file?.buffer?.length) throw ApiError.badRequest('No image data received');

  return configured
    ? uploadToCloudinary(file, { folder, nameHint })
    : uploadToLocal(file, { folder, nameHint, maxWidth });
}

async function uploadToCloudinary(file, { folder, nameHint }) {
  const baseName = slugify(nameHint || path.parse(file.originalname ?? 'image').name) || 'image';

  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
        type: 'upload',
        access_mode: 'public',
        use_filename: true,
        unique_filename: true,
        overwrite: false,
        filename_override: `${baseName}-${Date.now().toString(36)}.${extensionOf(file)}`,
        // Store the original; deliver WebP/AVIF from the CDN on read.
        tags: ['gramrosh', folder].filter(Boolean),
      },
      (error, uploaded) => (error ? reject(error) : resolve(uploaded)),
    );
    stream.end(file.buffer);
  });

  const url = buildDeliveryUrl(result.public_id, { width: 1280 });
  logger.info('[images] uploaded to Cloudinary', { publicId: result.public_id, bytes: result.bytes });

  return {
    url,
    secureUrl: result.secure_url,
    publicId: result.public_id,
    format: 'webp',
    width: result.width,
    height: result.height,
    bytes: result.bytes,
    provider: 'cloudinary',
    srcset: RESPONSIVE_WIDTHS.map((w) => `${buildDeliveryUrl(result.public_id, { width: w })} ${w}w`).join(', '),
  };
}

/**
 * Development fallback: transcode to WebP with sharp and write to local disk.
 * Same return shape, so nothing upstream has to branch.
 */
async function uploadToLocal(file, { folder, nameHint, maxWidth }) {
  await fsp.mkdir(LOCAL_UPLOAD_DIR, { recursive: true });

  const baseName = slugify(nameHint || path.parse(file.originalname ?? 'image').name) || 'image';
  const hash = crypto.createHash('sha1').update(file.buffer).digest('hex').slice(0, 10);
  const fileName = `${baseName}-${hash}.webp`;

  const image = sharp(file.buffer, { failOn: 'none' }).rotate(); // honour EXIF orientation
  const metadata = await image.metadata();

  const targetWidth = Math.min(maxWidth, metadata.width ?? maxWidth);
  const webp = await image
    .resize({ width: targetWidth, withoutEnlargement: true })
    .webp({ quality: 82, effort: 5 })
    .toBuffer({ resolveWithObject: true });

  const destination = path.join(LOCAL_UPLOAD_DIR, folder ? `${slugify(folder)}-${fileName}` : fileName);
  await fsp.writeFile(destination, webp.data);

  const servedName = path.basename(destination);
  const url = `${LOCAL_UPLOAD_URL}/${servedName}`;
  logger.info('[images] transcoded to WebP locally', {
    file: servedName,
    bytes: webp.data.length,
    savedFrom: file.buffer.length,
  });

  return {
    url,
    publicId: servedName.replace(/\.webp$/, ''),
    format: 'webp',
    width: webp.info.width,
    height: webp.info.height,
    bytes: webp.data.length,
    originalBytes: file.buffer.length,
    provider: 'local',
  };
}

function extensionOf(file) {
  const ext = path.extname(file.originalname ?? '').replace('.', '').toLowerCase();
  return ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif'].includes(ext) ? ext : 'jpg';
}

/** Delete an asset (best effort — a failed cleanup must not fail the request). */
export async function destroyImage(publicIdOrUrl) {
  const publicId = publicIdFromUrl(publicIdOrUrl);
  if (!publicId) return { destroyed: false };
  try {
    if (configured) {
      await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
      return { destroyed: true, provider: 'cloudinary', publicId };
    }
    const localPath = path.join(LOCAL_UPLOAD_DIR, path.basename(publicId) + (publicId.endsWith('.webp') ? '' : '.webp'));
    if (fs.existsSync(localPath)) await fsp.unlink(localPath);
    return { destroyed: true, provider: 'local', publicId };
  } catch (error) {
    logger.warn('[images] cleanup failed', { publicId, error: error.message });
    return { destroyed: false, error: error.message };
  }
}

/**
 * Build a responsive `srcset` for any stored image URL.
 * Cloudinary URLs get real width variants; local files fall back to the single
 * transcoded asset (still WebP, still one small request).
 */
export function buildSrcSet(url) {
  if (!url) return undefined;
  if (!url.includes('/image/upload/')) return undefined;
  const publicId = publicIdFromUrl(url);
  return RESPONSIVE_WIDTHS.map((width) => `${buildDeliveryUrl(publicId, { width })} ${width}w`).join(', ');
}
