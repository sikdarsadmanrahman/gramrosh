/**
 * -----------------------------------------------------------------------------
 *  middleware/validate.js — Zod request validation
 * -----------------------------------------------------------------------------
 *  One factory covers params, query and body. Parsing *replaces* the incoming
 *  values, so controllers work with already-coerced, already-trimmed data and
 *  never have to defend themselves against `?limit=<script>`.
 *
 *  Query strings arrive as strings; every validator uses `z.coerce.*`, so
 *  `?page=2&limit=12` reaches the service layer as real numbers.
 * -----------------------------------------------------------------------------
 */
import { ApiError } from '../utils/ApiError.js';

/**
 * @param {{params?:import('zod').ZodTypeAny, query?:import('zod').ZodTypeAny, body?:import('zod').ZodTypeAny}} schemas
 * @returns {import('express').RequestHandler}
 */
export function validate(schemas = {}) {
  return (req, _res, next) => {
    const failures = [];

    for (const target of ['params', 'query', 'body']) {
      const schema = schemas[target];
      if (!schema) continue;

      const result = schema.safeParse(req[target] ?? {});
      if (!result.success) {
        for (const issue of result.error.issues) {
          failures.push({
            location: target,
            path: issue.path.join('.') || '(root)',
            message: issue.message,
          });
        }
        continue;
      }

      const parsed = result.data;
      if (target === 'query') {
        // Express 4 exposes `query` as a prototype getter — redefining it on the
        // instance is the only safe way to swap in the parsed (coerced) values.
        Object.defineProperty(req, 'query', { value: parsed, writable: true, configurable: true, enumerable: true });
      } else {
        req[target] = parsed;
      }

      // Keep validated values reachable without re-parsing.
      req.validated = { ...(req.validated ?? {}), [target]: parsed };
    }

    if (failures.length) {
      return next(ApiError.unprocessable('Validation failed', { errors: failures }));
    }
    next();
  };
}

export default validate;
