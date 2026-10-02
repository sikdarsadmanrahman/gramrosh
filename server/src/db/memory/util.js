/**
 * -----------------------------------------------------------------------------
 *  db/memory/util.js — Primitive helpers for the in-process document engine
 * -----------------------------------------------------------------------------
 *  Dot-path traversal that understands arrays (MongoDB semantics: a query on
 *  `variants.stock` inspects *every* element), value comparison that treats
 *  ObjectId / Date / Number consistently, and a deep clone that preserves BSON
 *  types (`structuredClone` would silently flatten an ObjectId into a plain
 *  object, which is exactly the kind of bug that is miserable to trace).
 * -----------------------------------------------------------------------------
 */
import mongoose from 'mongoose';

const { ObjectId } = mongoose.Types;

/** True for a BSON ObjectId (works across duplicate bson module copies). */
export function isObjectId(value) {
  return value instanceof ObjectId || value?._bsontype === 'ObjectID' || value?._bsontype === 'ObjectId';
}

/** Coerce a hex string / ObjectId into an ObjectId, or return null. */
export function toObjectId(value) {
  if (value === null || value === undefined || value === '') return null;
  if (isObjectId(value)) return value;
  if (typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value)) return new ObjectId(value);
  return null;
}

/** True for a plain `{}` object (not Date/Array/ObjectId/RegExp). */
export function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value) || value instanceof Date || value instanceof RegExp) return false;
  return !isObjectId(value);
}

/** Deep clone preserving Date, ObjectId, RegExp and Buffer. */
export function deepClone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof RegExp) return new RegExp(value.source, value.flags);
  if (isObjectId(value)) return value; // immutable — safe to share
  if (Array.isArray(value)) return value.map(deepClone);
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer?.(value)) return Buffer.from(value);
  const out = {};
  for (const key of Object.keys(value)) out[key] = deepClone(value[key]);
  return out;
}

/** Split a dot path, ignoring numeric array indices for type resolution. */
export function splitPath(path) {
  return String(path).split('.');
}

/**
 * Read `path` out of `obj`.
 *
 * Returns **every** matching leaf: when an intermediate segment is an array the
 * path fans out over its elements, exactly like MongoDB.
 *
 * @returns {Array<{value:unknown, arrayPath:string|null, arrayIndex:number|null}>}
 */
export function resolvePathNodes(obj, path) {
  const segments = splitPath(path);
  let nodes = [{ value: obj, arrayPath: null, arrayIndex: null, traversed: '' }];

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const next = [];
    for (const node of nodes) {
      const current = node.value;
      if (Array.isArray(current)) {
        // A numeric segment indexes directly; anything else fans out.
        if (/^\d+$/.test(segment)) {
          const idx = Number(segment);
          next.push({
            value: current[idx],
            arrayPath: node.arrayPath,
            arrayIndex: node.arrayIndex,
            traversed: node.traversed ? `${node.traversed}.${segment}` : segment,
          });
        } else {
          current.forEach((element, idx) => {
            next.push({
              value: isPlainObject(element) || Array.isArray(element) ? element[segment] : undefined,
              arrayPath: node.traversed || null,
              arrayIndex: idx,
              traversed: node.traversed ? `${node.traversed}.${segment}` : segment,
            });
          });
        }
      } else if (isPlainObject(current)) {
        next.push({
          value: current[segment],
          arrayPath: node.arrayPath,
          arrayIndex: node.arrayIndex,
          traversed: node.traversed ? `${node.traversed}.${segment}` : segment,
        });
      } else {
        next.push({ value: undefined, arrayPath: node.arrayPath, arrayIndex: node.arrayIndex, traversed: node.traversed });
      }
    }
    nodes = next;
    if (!nodes.length) return [];
  }
  return nodes;
}

/** Convenience: all values at `path` (empty array when absent). */
export function getValues(obj, path) {
  return resolvePathNodes(obj, path).map((n) => n.value);
}

/** Convenience: the first value at `path`, or undefined. */
export function getPath(obj, path) {
  const nodes = resolvePathNodes(obj, path);
  return nodes.length ? nodes[0].value : undefined;
}

/** True when `path` exists on `obj` (even if its value is null/undefined). */
export function hasPath(obj, path) {
  return resolvePathNodes(obj, path).some((n) => n.value !== undefined);
}

/** Create intermediate objects/arrays as needed and assign `value`. */
export function setPath(obj, path, value) {
  const segments = splitPath(path);
  let cursor = obj;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    const nextSegment = segments[i + 1];
    const wantsArray = /^\d+$/.test(nextSegment);
    if (cursor[segment] === undefined || cursor[segment] === null) {
      cursor[segment] = wantsArray ? [] : {};
    }
    cursor = cursor[segment];
  }
  cursor[segments[segments.length - 1]] = value;
  return obj;
}

/** Delete `path` from `obj`. */
export function unsetPath(obj, path) {
  const segments = splitPath(path);
  const nodes = segments.length === 1 ? [{ value: obj }] : resolveParentNodes(obj, path);
  for (const node of nodes) {
    if (isPlainObject(node.value)) delete node.value[segments[segments.length - 1]];
  }
  return obj;
}

/** Resolve the *parent* container(s) of `path`. */
function resolveParentNodes(obj, path) {
  const segments = splitPath(path);
  return resolvePathNodes(obj, segments.slice(0, -1).join('.'));
}

/**
 * MongoDB-flavoured value comparison.
 * @returns {number} -1 | 0 | 1 ; `null` when the pair is not orderable
 */
export function compareValues(a, b) {
  if (a === b) return 0;

  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull && bNull) return 0;
  if (aNull) return -1;
  if (bNull) return 1;

  if (isObjectId(a) || isObjectId(b)) {
    const sa = String(a);
    const sb = String(b);
    return sa === sb ? 0 : sa < sb ? -1 : 1;
  }
  if (a instanceof Date || b instanceof Date) {
    const ta = new Date(a).getTime();
    const tb = new Date(b).getTime();
    if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
    return ta === tb ? 0 : ta < tb ? -1 : 1;
  }
  if (typeof a === 'number' || typeof b === 'number') {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isNaN(na) || Number.isNaN(nb)) return null;
    return na === nb ? 0 : na < nb ? -1 : 1;
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    return Number(Boolean(a)) === Number(Boolean(b)) ? 0 : Number(Boolean(a)) < Number(Boolean(b)) ? -1 : 1;
  }
  const sa = String(a);
  const sb = String(b);
  return sa === sb ? 0 : sa < sb ? -1 : 1;
}

/** Equality with array-contains and ObjectId/Date coercion. */
export function valuesEqual(docValue, queryValue) {
  if (docValue === queryValue) return true;

  // Array field: matches when the array itself equals, or contains, the value.
  if (Array.isArray(docValue)) {
    if (Array.isArray(queryValue)) {
      return docValue.length === queryValue.length && docValue.every((v, i) => valuesEqual(v, queryValue[i]));
    }
    return docValue.some((element) => scalarEqual(element, queryValue));
  }
  return scalarEqual(docValue, queryValue);
}

function scalarEqual(a, b) {
  if (a === b) return true;
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  if (isObjectId(a) || isObjectId(b)) return String(a) === String(b);
  if (a instanceof Date || b instanceof Date) {
    return new Date(a).getTime() === new Date(b).getTime();
  }
  if (typeof a === 'number' && typeof b === 'string') return a === Number(b);
  if (typeof a === 'string' && typeof b === 'number') return Number(a) === b;
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => scalarEqual(a[k], b[k]));
  }
  return false;
}

/** BSON-ish type name, used by the `$type` operator. */
export function bsonType(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'date';
  if (value instanceof RegExp) return 'regex';
  if (isObjectId(value)) return 'objectId';
  switch (typeof value) {
    case 'number': return Number.isInteger(value) ? 'int' : 'double';
    case 'string': return 'string';
    case 'boolean': return 'bool';
    case 'object': return 'object';
    default: return typeof value;
  }
}

/** Turn a value into a RegExp honouring `$options`. */
export function toRegExp(pattern, options) {
  if (pattern instanceof RegExp) {
    return options ? new RegExp(pattern.source, options) : pattern;
  }
  return new RegExp(String(pattern), options || '');
}
