/**
 * -----------------------------------------------------------------------------
 *  db/memory/matcher.js — MongoDB query-filter evaluation
 * -----------------------------------------------------------------------------
 *  Supports the operator subset the API actually uses, with MongoDB's array
 *  semantics (a predicate on `variants.stock` is satisfied when *any* element
 *  matches) and positional-index capture so that `variants.$.stock` in an update
 *  resolves to the very element the query matched.
 *
 *  Anything outside the supported subset throws a descriptive error instead of
 *  silently returning the wrong rows — a wrong answer is far worse than a crash.
 * -----------------------------------------------------------------------------
 */
import {
  resolvePathNodes,
  valuesEqual,
  compareValues,
  isPlainObject,
  isObjectId,
  bsonType,
  toRegExp,
  hasPath,
} from './util.js';

const FIELD_OPERATORS = new Set([
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin',
  '$exists', '$regex', '$options', '$all', '$size', '$elemMatch',
  '$not', '$mod', '$type',
]);

const LOGICAL_OPERATORS = new Set(['$and', '$or', '$nor', '$comment']);

/** Raised when a query uses something the engine deliberately does not support. */
export class UnsupportedQueryError extends Error {
  constructor(feature) {
    super(`[memory-driver] Unsupported query feature: ${feature}. Use the MongoDB driver for this operation.`);
    this.name = 'UnsupportedQueryError';
  }
}

/** Collect every string leaf of a document (used by the `$text` approximation). */
function collectStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (isPlainObject(value)) Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

/**
 * Evaluate a whole filter object against a document.
 *
 * @param {object} doc
 * @param {object} filter
 * @param {{positional: Record<string, number>}} [ctx] mutated to record matched array indexes
 * @returns {boolean}
 */
export function matchDocument(doc, filter, ctx = { positional: {} }) {
  if (!filter || typeof filter !== 'object') return true;

  for (const [key, condition] of Object.entries(filter)) {
    if (key === '$comment') continue;

    if (LOGICAL_OPERATORS.has(key)) {
      if (!Array.isArray(condition)) throw new UnsupportedQueryError(`${key} expects an array`);
      if (key === '$and' && !condition.every((sub) => matchDocument(doc, sub, ctx))) return false;
      if (key === '$or' && !condition.some((sub) => matchDocument(doc, sub, ctx))) return false;
      if (key === '$nor' && condition.some((sub) => matchDocument(doc, sub, ctx))) return false;
      continue;
    }

    if (key === '$expr') throw new UnsupportedQueryError('$expr');
    if (key === '$where') throw new UnsupportedQueryError('$where');
    if (key === '$jsonSchema') throw new UnsupportedQueryError('$jsonSchema');

    if (key === '$text') {
      if (!matchText(doc, condition)) return false;
      continue;
    }

    if (key.startsWith('$')) throw new UnsupportedQueryError(`top-level operator ${key}`);

    if (!matchField(doc, key, condition, ctx)) return false;
  }
  return true;
}

/**
 * Approximation of `$text`.
 *
 * Real MongoDB uses the inverted index built by the text index; here we require
 * every whitespace separated token to appear (case-insensitively) somewhere in
 * the document's string values. Recall matches, ranking does not — the service
 * layer applies its own relevance ordering.
 */
function matchText(doc, condition) {
  const search = typeof condition === 'string' ? condition : condition?.$search;
  if (!search) return true;
  const haystack = collectStrings(doc).join(' \u0001 ').toLowerCase();
  const tokens = String(search).toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.every((token) => {
    // A leading "-" negates the term, mirroring $text syntax.
    if (token.startsWith('-')) return !haystack.includes(token.slice(1));
    if (token.startsWith('"') && token.endsWith('"')) return haystack.includes(token.slice(1, -1));
    return haystack.includes(token);
  });
}

/** Evaluate a single `field: condition` pair. */
function matchField(doc, path, condition, ctx) {
  // `{ field: { $gt: 1, $lt: 5 } }` — an operator object.
  if (isPlainObject(condition) && Object.keys(condition).some((k) => k.startsWith('$'))) {
    const keys = Object.keys(condition);
    const unknown = keys.filter((k) => k.startsWith('$') && !FIELD_OPERATORS.has(k));
    if (unknown.length) throw new UnsupportedQueryError(`operator ${unknown[0]}`);
    return keys.every((op) => matchOperator(doc, path, op, condition[op], condition, ctx));
  }

  // `{ field: /regex/ }`
  if (condition instanceof RegExp) {
    return someNode(doc, path, (value, node) => {
      const ok = typeof value === 'string' && condition.test(value);
      if (ok) recordPositional(ctx, node, path);
      return ok;
    });
  }

  // Plain equality (with array-contains semantics).
  return someNode(doc, path, (value, node) => {
    const ok = valuesEqual(value, condition);
    if (ok) recordPositional(ctx, node, path);
    return ok;
  }, { allowMissing: condition === null || condition === undefined });
}

/**
 * True when at least one resolved node satisfies `predicate`.
 *
 * A missing field only matches `null`/`undefined` queries — that is MongoDB's
 * rule and getting it wrong breaks every "is this optional field empty" filter.
 */
function someNode(doc, path, predicate, { allowMissing = false } = {}) {
  const nodes = resolvePathNodes(doc, path);
  if (!nodes.length) return allowMissing;
  const present = nodes.filter((n) => n.value !== undefined);
  if (!present.length) return allowMissing;
  return present.some((node) => predicate(node.value, node));
}

/** Remember which array element satisfied the predicate (for `$` in updates). */
function recordPositional(ctx, node, path) {
  if (!ctx || !node || node.arrayPath === null || node.arrayIndex === null) return;
  if (ctx.positional[node.arrayPath] === undefined) ctx.positional[node.arrayPath] = node.arrayIndex;
}

/** Dispatch one field operator. */
function matchOperator(doc, path, op, operand, siblings, ctx) {
  switch (op) {
    case '$options':
      // Handled together with `$regex`.
      return true;

    case '$eq':
      return someNode(doc, path, (value, node) => {
        const ok = valuesEqual(value, operand);
        if (ok) recordPositional(ctx, node, path);
        return ok;
      }, { allowMissing: operand === null || operand === undefined });

    case '$ne':
      return !someNode(doc, path, (value) => valuesEqual(value, operand), { allowMissing: false });

    case '$gt':
    case '$gte':
    case '$lt':
    case '$lte':
      return someNode(doc, path, (value, node) => {
        const cmp = compareValues(value, operand);
        if (cmp === null) return false;
        const ok = op === '$gt' ? cmp > 0 : op === '$gte' ? cmp >= 0 : op === '$lt' ? cmp < 0 : cmp <= 0;
        if (ok) recordPositional(ctx, node, path);
        return ok;
      });

    case '$in': {
      if (!Array.isArray(operand)) throw new UnsupportedQueryError('$in expects an array');
      return someNode(doc, path, (value, node) => {
        const ok = operand.some((candidate) => valuesEqual(value, candidate));
        if (ok) recordPositional(ctx, node, path);
        return ok;
      }, { allowMissing: operand.includes(null) });
    }

    case '$nin': {
      if (!Array.isArray(operand)) throw new UnsupportedQueryError('$nin expects an array');
      return !someNode(doc, path, (value) => operand.some((candidate) => valuesEqual(value, candidate)));
    }

    case '$exists': {
      const exists = hasPath(doc, path);
      return Boolean(operand) === exists;
    }

    case '$regex': {
      const regex = toRegExp(operand, siblings.$options);
      return someNode(doc, path, (value, node) => {
        const ok = typeof value === 'string' && regex.test(value);
        if (ok) recordPositional(ctx, node, path);
        return ok;
      });
    }

    case '$all': {
      if (!Array.isArray(operand)) throw new UnsupportedQueryError('$all expects an array');
      return someNode(doc, path, (value, node) => {
        const list = Array.isArray(value) ? value : [value];
        const ok = operand.every((required) =>
          required && required.$elemMatch
            ? list.some((el) => matchDocument(el ?? {}, required.$elemMatch, ctx))
            : list.some((el) => valuesEqual(el, required)),
        );
        if (ok) recordPositional(ctx, node, path);
        return ok;
      });
    }

    case '$size':
      return someNode(doc, path, (value) => Array.isArray(value) && value.length === Number(operand));

    case '$elemMatch': {
      if (!isPlainObject(operand)) throw new UnsupportedQueryError('$elemMatch expects an object');
      const nodes = resolvePathNodes(doc, path);
      // Only direct array values participate; we need the element index.
      return nodes.some((node) => {
        const value = node.value;
        if (!Array.isArray(value)) return false;
        // `path` may itself traverse arrays; re-resolve per element to get indexes.
        return value.some((element, index) => {
          const target = isPlainObject(element) ? element : { __primitive: element };
          const ok = matchDocument(target, rewriteElemMatch(operand), ctx);
          if (ok) {
            const root = node.arrayPath === null ? path : `${node.arrayPath}`;
            if (ctx && ctx.positional[root] === undefined) ctx.positional[root] = node.arrayPath === null ? index : node.arrayIndex;
            // Also expose the leaf array path so `variants.$` resolves.
            if (ctx && ctx.positional[path] === undefined) ctx.positional[path] = index;
          }
          return ok;
        });
      });
    }

    case '$not':
      return !matchField(doc, path, operand, { positional: {} });

    case '$mod': {
      if (!Array.isArray(operand) || operand.length !== 2) throw new UnsupportedQueryError('$mod expects [divisor, remainder]');
      const [divisor, remainder] = operand;
      return someNode(doc, path, (value) => typeof value === 'number' && value % divisor === remainder);
    }

    case '$type': {
      const wanted = Array.isArray(operand) ? operand : [operand];
      return someNode(doc, path, (value) => {
        const actual = bsonType(value);
        return wanted.some((t) => String(t).toLowerCase() === actual || String(t) === bsonAlias(actual));
      });
    }

    default:
      throw new UnsupportedQueryError(`operator ${op}`);
  }
}

/** Numeric BSON type aliases (`$type: 'number'` covers int/double/decimal). */
function bsonAlias(type) {
  if (type === 'int' || type === 'double') return 'number';
  return type;
}

/**
 * `$elemMatch` conditions are written relative to the element, so a bare
 * `{ $gte: 3 }` (primitive array) must become `{ __primitive: { $gte: 3 } }`.
 */
function rewriteElemMatch(operand) {
  const keys = Object.keys(operand);
  const allOperators = keys.length > 0 && keys.every((k) => k.startsWith('$') && FIELD_OPERATORS.has(k));
  return allOperators ? { __primitive: operand } : operand;
}

/** True when a value looks like an ObjectId reference rather than a filter. */
export function isIdLike(value) {
  return isObjectId(value) || (typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value));
}
