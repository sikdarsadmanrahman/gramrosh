/**
 * -----------------------------------------------------------------------------
 *  middleware/error.js — 404 handler + the single global error boundary
 * -----------------------------------------------------------------------------
 *  Every failure in the app funnels through here, so this is the one place that
 *  knows how to translate driver/validator/library errors into the JSON envelope
 *  the React client expects — and the one place that guarantees a stack trace
 *  never reaches a shopper.
 * -----------------------------------------------------------------------------
 */
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { ApiError } from '../utils/ApiError.js';

/** 404 for unmatched routes. Must be registered after all routers. */
export function notFoundHandler(req, _res, next) {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} does not exist`));
}

/**
 * Translate known error shapes into an {@link ApiError}.
 * @returns {ApiError}
 */
export function normalizeError(error) {
  if (error instanceof ApiError) return error;

  // --- duplicate key (MongoDB code 11000) ---------------------------------
  if (error?.code === 11000 || /E11000 duplicate key/.test(error?.message ?? '')) {
    const keyValue = error.keyValue ?? {};
    const field = Object.keys(keyValue)[0] ?? 'field';
    return ApiError.conflict(`A record with this ${field} already exists (${String(keyValue[field]).slice(0, 60)})`);
  }

  // --- Mongoose validation -------------------------------------------------
  if (error?.name === 'ValidationError' && error.errors) {
    const fields = Object.entries(error.errors).map(([path, e]) => ({
      path,
      message: e.message ?? 'Invalid value',
    }));
    return ApiError.unprocessable('Validation failed', { errors: fields, cause: error });
  }

  // --- bad ObjectId / type cast --------------------------------------------
  if (error?.name === 'CastError') {
    return ApiError.badRequest(`Invalid value for "${error.path}": ${String(error.value).slice(0, 40)}`, { cause: error });
  }
  if (error?.name === 'MongoServerError' || error?.name === 'MongoNetworkError' || error?.name === 'MongoTimeoutError') {
    logger.error('[db] driver error', { name: error.name, message: error.message });
    return ApiError.serviceUnavailable('Database is temporarily unavailable', { cause: error });
  }

  // --- Zod -----------------------------------------------------------------
  if (error instanceof ZodError) {
    return ApiError.unprocessable('Validation failed', {
      errors: error.issues.map((issue) => ({
        path: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
      cause: error,
    });
  }

  // --- Multer (file uploads) ------------------------------------------------
  if (error?.name === 'MulterError') {
    const messages = {
      LIMIT_FILE_SIZE: `File is too large (max ${env.UPLOAD_MAX_MB}MB)`,
      LIMIT_UNEXPECTED_FILE: 'Unexpected file field',
      LIMIT_FILE_COUNT: 'Too many files',
    };
    return ApiError.badRequest(messages[error.code] ?? error.message, { cause: error });
  }

  // --- JWT ------------------------------------------------------------------
  if (error?.name === 'JsonWebTokenError') return ApiError.unauthorized('Invalid authentication token');
  if (error?.name === 'TokenExpiredError') return ApiError.unauthorized('Session expired, please sign in again');

  // --- unsupported feature in the in-process driver -------------------------
  if (error?.name === 'UnsupportedQueryError') {
    logger.error('[memory-driver] unsupported operation', { message: error.message });
    return new ApiError(501, error.message, { cause: error });
  }

  // --- anything else is a bug: log it, hide it ------------------------------
  return new ApiError(error?.statusCode ?? 500, error?.statusCode ? (error.message ?? 'Request failed') : 'Something went wrong', {
    cause: error,
  });
}

/** Global error handler. Must be registered last, with 4 arguments. */
// eslint-disable-next-line no-unused-vars
export function errorHandler(error, req, res, _next) {
  const apiError = normalizeError(error);
  const { statusCode, message } = apiError;

  // 5xx = programmer/infra error → full stack in the logs.
  if (statusCode >= 500) {
    logger.error(`${req.method} ${req.originalUrl} → ${statusCode}`, {
      message,
      stack: apiError.cause?.stack ?? error?.stack,
      requestId: req.id,
    });
  } else {
    logger.debug(`${req.method} ${req.originalUrl} → ${statusCode}`, { message, requestId: req.id });
  }

  if (res.headersSent) return;

  res.status(statusCode).json({
    success: false,
    message,
    ...(apiError.errors?.length ? { errors: apiError.errors } : {}),
    ...(env.isDevelopment && statusCode >= 500 ? { stack: String(error?.stack ?? '').split('\n').slice(0, 6) } : {}),
  });
}

export default errorHandler;
