/**
 * -----------------------------------------------------------------------------
 *  asyncHandler.js — Removes try/catch boilerplate from every controller
 * -----------------------------------------------------------------------------
 *  Express 4 does not forward rejected promises to the error middleware, so we
 *  wrap each async route handler. Any throw (sync or async) lands in the
 *  centralised error handler instead of hanging the request.
 * -----------------------------------------------------------------------------
 */

/**
 * @template {import('express').RequestHandler} T
 * @param {T} fn async route handler
 * @returns {import('express').RequestHandler}
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export default asyncHandler;
