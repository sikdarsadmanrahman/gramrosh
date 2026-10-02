/**
 * -----------------------------------------------------------------------------
 *  ApiError.js — Operational errors with an HTTP status attached
 * -----------------------------------------------------------------------------
 *  Anything thrown as an `ApiError` is treated as *expected* (bad input,
 *  not-found, forbidden) and rendered as a clean JSON payload by the global
 *  error handler. Everything else is a *programmer* error: logged with a stack
 *  trace and returned as an opaque 500 so internals never leak.
 * -----------------------------------------------------------------------------
 */
export class ApiError extends Error {
  /**
   * @param {number} statusCode HTTP status to respond with.
   * @param {string} message    Human readable message (safe to show the client).
   * @param {object} [options]
   * @param {Array<{path:string,message:string}>} [options.errors] Field level errors.
   * @param {unknown} [options.cause]  Underlying error for logging.
   * @param {Record<string, unknown>} [options.headers] Extra response headers.
   */
  constructor(statusCode, message, options = {}) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.errors = options.errors ?? [];
    this.headers = options.headers;
    this.isOperational = true;
    if (options.cause) this.cause = options.cause;
    Error.captureStackTrace?.(this, this.constructor);
  }

  static badRequest(message = 'Bad request', options) {
    return new ApiError(400, message, options);
  }

  static unauthorized(message = 'Authentication required', options) {
    return new ApiError(401, message, options);
  }

  static forbidden(message = 'You do not have permission to do that', options) {
    return new ApiError(403, message, options);
  }

  static notFound(message = 'Resource not found', options) {
    return new ApiError(404, message, options);
  }

  static conflict(message = 'Resource already exists', options) {
    return new ApiError(409, message, options);
  }

  static unprocessable(message = 'Validation failed', options) {
    return new ApiError(422, message, options);
  }

  static tooMany(message = 'Too many requests', options) {
    return new ApiError(429, message, options);
  }

  static internal(message = 'Something went wrong', options) {
    return new ApiError(500, message, options);
  }

  static serviceUnavailable(message = 'Service temporarily unavailable', options) {
    return new ApiError(503, message, options);
  }

  /** Serialise to the envelope used by `apiResponse`. */
  toJSON() {
    return {
      success: false,
      message: this.message,
      ...(this.errors?.length ? { errors: this.errors } : {}),
    };
  }
}

export default ApiError;
