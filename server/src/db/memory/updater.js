/**
 * -----------------------------------------------------------------------------
 *  db/memory/updater.js — MongoDB update-operator application
 * -----------------------------------------------------------------------------
 *  Mutates a document in place using the same operators the API issues, and
 *  resolves the positional `$` placeholder against the array index the query
 *  matched (captured by `matcher.js`).
 * -----------------------------------------------------------------------------
 */
import { getPath, setPath, unsetPath, resolvePathNodes, valuesEqual, compareValues, deepClone, isPlainObject } from './util.js';
import { matchDocument, UnsupportedQueryError } from './matcher.js';

const UPDATE_OPERATORS = new Set([
  '$set', '$setOnInsert', '$unset', '$inc', '$mul', '$min', '$max',
  '$push', '$addToSet', '$pull', '$pullAll', '$rename', '$currentDate',
]);

/**
 * Resolve a path that may contain the positional `$` placeholder.
 *
 * `variants.$.stock` + positional `{ variants: 2 }` → `variants.2.stock`
 */
function resolvePositionalPath(path, positional) {
  const segments = String(path).split('.');
  const out = [];
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (segment === '$') {
      const arrayPath = out.join('.');
      const index = positional?.[arrayPath];
      if (index === undefined) {
        throw new UnsupportedQueryError(
          `positional operator "$" in "${path}" — the query did not match a specific array element`,
        );
      }
      out.push(String(index));
    } else if (segment.startsWith('$[')) {
      throw new UnsupportedQueryError(`arrayFilters (${path}) — use $elemMatch with "$" instead`);
    } else {
      out.push(segment);
    }
  }
  return out.join('.');
}

/** True when the update document uses operators rather than being a replacement. */
export function isOperatorUpdate(update) {
  return isPlainObject(update) && Object.keys(update).some((k) => k.startsWith('$'));
}

/** Guard against replacement documents (they would wipe indexes we rely on). */
export function assertOperatorUpdate(update) {
  if (!isOperatorUpdate(update)) {
    throw new UnsupportedQueryError('document replacement in updateOne/findOneAndUpdate (use $set)');
  }
  const unknown = Object.keys(update).filter((k) => !UPDATE_OPERATORS.has(k));
  if (unknown.length) throw new UnsupportedQueryError(`update operator ${unknown[0]}`);
}

/**
 * Apply an operator update to `doc`.
 *
 * @param {object} doc        document to mutate
 * @param {object} update     operator document
 * @param {{positional?:object, isUpsert?:boolean}} [options]
 * @returns {object} the mutated document
 */
export function applyUpdate(doc, update, { positional = {}, isUpsert = false } = {}) {
  assertOperatorUpdate(update);

  // --- $set / $setOnInsert / $unset / $rename ------------------------------
  for (const [path, value] of Object.entries(update.$set ?? {})) {
    setPath(doc, resolvePositionalPath(path, positional), deepClone(value));
  }
  if (isUpsert) {
    for (const [path, value] of Object.entries(update.$setOnInsert ?? {})) {
      if (getPath(doc, resolvePositionalPath(path, positional)) === undefined) {
        setPath(doc, resolvePositionalPath(path, positional), deepClone(value));
      }
    }
  }
  for (const path of Object.keys(update.$unset ?? {})) {
    unsetPath(doc, resolvePositionalPath(path, positional));
  }
  for (const [from, to] of Object.entries(update.$rename ?? {})) {
    const source = resolvePositionalPath(from, positional);
    const target = resolvePositionalPath(to, positional);
    if (getPath(doc, source) !== undefined) {
      setPath(doc, target, getPath(doc, source));
      unsetPath(doc, source);
    }
  }

  // --- $inc / $mul / $min / $max -------------------------------------------
  for (const [path, amount] of Object.entries(update.$inc ?? {})) {
    const target = resolvePositionalPath(path, positional);
    const current = getPath(doc, target);
    if (current !== undefined && current !== null && typeof current !== 'number') {
      throw new TypeError(`$inc on non-numeric field "${path}" (got ${typeof current})`);
    }
    setPath(doc, target, (current ?? 0) + Number(amount));
  }
  for (const [path, factor] of Object.entries(update.$mul ?? {})) {
    const target = resolvePositionalPath(path, positional);
    const current = getPath(doc, target);
    setPath(doc, target, current === undefined || current === null ? 0 : Number(current) * Number(factor));
  }
  for (const [path, value] of Object.entries(update.$min ?? {})) {
    const target = resolvePositionalPath(path, positional);
    const current = getPath(doc, target);
    if (current === undefined || (compareValues(value, current) ?? 0) < 0) setPath(doc, target, value);
  }
  for (const [path, value] of Object.entries(update.$max ?? {})) {
    const target = resolvePositionalPath(path, positional);
    const current = getPath(doc, target);
    if (current === undefined || (compareValues(value, current) ?? 0) > 0) setPath(doc, target, value);
  }

  // --- $currentDate ---------------------------------------------------------
  for (const [path, spec] of Object.entries(update.$currentDate ?? {})) {
    const target = resolvePositionalPath(path, positional);
    const asTimestamp = spec === true || spec?.$type === 'date';
    setPath(doc, target, asTimestamp ? new Date() : Date.now());
  }

  // --- $push ----------------------------------------------------------------
  for (const [path, spec] of Object.entries(update.$push ?? {})) {
    const target = resolvePositionalPath(path, positional);
    const array = ensureArray(doc, target);
    if (isPlainObject(spec) && ('$each' in spec)) {
      const items = deepClone(spec.$each);
      const position = Number.isInteger(spec.$position) ? Math.max(0, spec.$position) : array.length;
      array.splice(position, 0, ...items);
      if (spec.$sort) applySortToArray(array, spec.$sort);
      if (Number.isInteger(spec.$slice)) applySlice(array, spec.$slice);
    } else {
      array.push(deepClone(spec));
    }
  }

  // --- $addToSet ------------------------------------------------------------
  for (const [path, spec] of Object.entries(update.$addToSet ?? {})) {
    const target = resolvePositionalPath(path, positional);
    const array = ensureArray(doc, target);
    const candidates = isPlainObject(spec) && '$each' in spec ? spec.$each : [spec];
    for (const candidate of candidates) {
      if (!array.some((existing) => valuesEqual(existing, candidate))) array.push(deepClone(candidate));
    }
  }

  // --- $pull / $pullAll -----------------------------------------------------
  for (const [path, condition] of Object.entries(update.$pull ?? {})) {
    const target = resolvePositionalPath(path, positional);
    const array = getPath(doc, target);
    if (!Array.isArray(array)) continue;
    const shouldRemove = (element) => {
      if (isPlainObject(condition) && Object.keys(condition).some((k) => k.startsWith('$'))) {
        // `{ $pull: { tags: { $in: [...] } } }` — condition applies to the element itself.
        return matchDocument({ __primitive: element }, { __primitive: condition }, { positional: {} });
      }
      if (isPlainObject(condition)) {
        return matchDocument(isPlainObject(element) ? element : {}, condition, { positional: {} });
      }
      return valuesEqual(element, condition);
    };
    setPath(doc, target, array.filter((element) => !shouldRemove(element)));
  }
  for (const [path, values] of Object.entries(update.$pullAll ?? {})) {
    const target = resolvePositionalPath(path, positional);
    const array = getPath(doc, target);
    if (!Array.isArray(array)) continue;
    setPath(doc, target, array.filter((element) => !values.some((v) => valuesEqual(element, v))));
  }

  return doc;
}

/** Read-or-create the array at `path`. */
function ensureArray(doc, path) {
  const existing = getPath(doc, path);
  if (Array.isArray(existing)) return existing;
  if (existing !== undefined && existing !== null) {
    throw new TypeError(`Expected an array at "${path}" but found ${typeof existing}`);
  }
  const created = [];
  setPath(doc, path, created);
  return created;
}

function applySortToArray(array, sortSpec) {
  const entries = Object.entries(sortSpec);
  array.sort((a, b) => {
    for (const [field, direction] of entries) {
      const cmp = compareValues(getPath(a, field), getPath(b, field));
      if (cmp) return cmp * (direction < 0 ? -1 : 1);
    }
    return 0;
  });
}

function applySlice(array, slice) {
  const kept = slice >= 0 ? array.slice(0, slice) : array.slice(Math.max(0, array.length + slice));
  array.length = 0;
  array.push(...kept);
}

/**
 * Build the seed document for an upsert from the query's equality clauses plus
 * `$set`/`$setOnInsert` — mirrors MongoDB's behaviour closely enough for the
 * handful of upserts the API performs.
 */
export function buildUpsertSeed(filter, update, positional) {
  const seed = {};
  const walk = (obj) => {
    for (const [key, value] of Object.entries(obj ?? {})) {
      if (key === '$and' && Array.isArray(value)) return value.forEach(walk);
      if (key.startsWith('$')) continue; // operators cannot seed fields
      if (isPlainObject(value) && Object.keys(value).some((k) => k.startsWith('$'))) {
        // Only a bare `$eq` can seed a value.
        if ('$eq' in value) setPath(seed, key, deepClone(value.$eq));
        continue;
      }
      if (value instanceof RegExp) continue;
      setPath(seed, key, deepClone(value));
    }
  };
  walk(filter);
  for (const [path, value] of Object.entries(update.$set ?? {})) {
    setPath(seed, resolvePositionalPath(path, positional), deepClone(value));
  }
  for (const [path, value] of Object.entries(update.$setOnInsert ?? {})) {
    if (getPath(seed, path) === undefined) setPath(seed, path, deepClone(value));
  }
  return seed;
}

/** Re-exported for the query layer, which needs to clone results per request. */
export { resolvePathNodes, deepClone };
