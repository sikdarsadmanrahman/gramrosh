/**
 * -----------------------------------------------------------------------------
 *  admin.upload.controller.js — Image upload → WebP on the CDN
 * -----------------------------------------------------------------------------
 *  Multer buffers the file in memory, `cloudinary.service.js` transcodes it to
 *  WebP and returns a CDN URL. The API never writes images to its own disk in
 *  production, which keeps it stateless and horizontally scalable.
 * -----------------------------------------------------------------------------
 */
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { uploadImage, getImageProvider, buildSrcSet, destroyImage } from '../services/cloudinary.service.js';

/**
 * POST /api/admin/uploads/image     (multipart, field: `image`)
 * POST /api/admin/uploads/images    (multipart, field: `images`, up to 8)
 */
export const uploadSingleHandler = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Attach an image in the "image" field');

  const uploaded = await uploadImage(req.file, {
    folder: req.body.folder || 'products',
    nameHint: req.body.nameHint || req.file.originalname,
    maxWidth: Number(req.body.maxWidth) || 1600,
  });

  return sendSuccess(res, {
    statusCode: 201,
    message: `Image uploaded and converted to ${uploaded.format.toUpperCase()} (${Math.round(uploaded.bytes / 1024)} KB)`,
    data: { ...uploaded, srcset: uploaded.srcset ?? buildSrcSet(uploaded.url), provider: getImageProvider() },
  });
});

export const uploadManyHandler = asyncHandler(async (req, res) => {
  const files = req.files ?? [];
  if (!files.length) throw ApiError.badRequest('Attach at least one image in the "images" field');

  // Sequential on purpose: Cloudinary rate-limits bursts, and the admin UI
  // shows a per-file progress list anyway.
  const uploaded = [];
  const failed = [];
  for (const file of files) {
    try {
      const result = await uploadImage(file, {
        folder: req.body.folder || 'products',
        nameHint: file.originalname,
      });
      uploaded.push({ ...result, srcset: result.srcset ?? buildSrcSet(result.url), originalName: file.originalname });
    } catch (error) {
      failed.push({ originalName: file.originalname, error: error.message });
    }
  }

  return sendSuccess(res, {
    statusCode: uploaded.length ? 201 : 400,
    message: `${uploaded.length} image(s) uploaded${failed.length ? `, ${failed.length} failed` : ''}`,
    data: { images: uploaded, failed, provider: getImageProvider() },
  });
});

/** DELETE /api/admin/uploads/image?url=… — remove an asset from the CDN. */
export const destroyHandler = asyncHandler(async (req, res) => {
  const target = req.query.url ?? req.body?.url;
  if (!target) throw ApiError.badRequest('Provide the image "url" to delete');
  const result = await destroyImage(target);
  return sendSuccess(res, { message: result.destroyed ? 'Asset deleted' : 'Asset not found', data: result });
});
