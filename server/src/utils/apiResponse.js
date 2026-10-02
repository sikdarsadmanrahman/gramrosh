/**
 * -----------------------------------------------------------------------------
 *  apiResponse.js — One consistent JSON envelope for the whole API
 * -----------------------------------------------------------------------------
 *  Success:  { success: true,  message, data, meta? }
 *  Failure:  { success: false, message, errors? }        (see errorHandler)
 *
 * A stable envelope means the React client has exactly one axios interceptor to
 * write, and paginated lists always carry `meta.pagination` in the same shape.
 * -----------------------------------------------------------------------------
 */

/**
 * Build the pagination meta block returned with every list endpoint.
 *
 * @param {object}  params
 * @param {number}  params.page      1-based current page.
 * @param {number}  params.limit     Page size actually applied.
 * @param {number}  params.total     Total documents matching the filter.
 * @param {number} [params.returned] Documents returned in this response.
 */
export function buildPaginationMeta({ page, limit, total, returned }) {
  const totalPages = limit > 0 ? Math.max(1, Math.ceil(total / limit)) : 1;
  return {
    pagination: {
      page,
      limit,
      total,
      totalPages,
      returned: returned ?? Math.min(limit, Math.max(0, total - (page - 1) * limit)),
      hasPrevPage: page > 1,
      hasNextPage: page < totalPages,
      nextPage: page < totalPages ? page + 1 : null,
      prevPage: page > 1 ? page - 1 : null,
      /** Skip count, echoed back because the API supports `skip` directly. */
      skip: (page - 1) * limit,
    },
  };
}

/**
 * Send a success envelope.
 *
 * @param {import('express').Response} res
 * @param {object}  options
 * @param {number} [options.statusCode=200]
 * @param {string} [options.message='OK']
 * @param {unknown}[options.data]
 * @param {object} [options.meta] Merged into the top-level `meta` object.
 */
export function sendSuccess(res, { statusCode = 200, message = 'OK', data = null, meta } = {}) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    ...(meta ? { meta } : {}),
  });
}

/**
 * Send a paginated list envelope (data + pagination meta in one call).
 */
export function sendPaginated(res, { items, page, limit, total, message = 'OK', statusCode = 200, extraMeta }) {
  return sendSuccess(res, {
    statusCode,
    message,
    data: items,
    meta: { ...buildPaginationMeta({ page, limit, total, returned: items?.length ?? 0 }), ...extraMeta },
  });
}

export default sendSuccess;
