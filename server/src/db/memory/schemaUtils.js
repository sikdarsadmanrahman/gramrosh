/**
 * -----------------------------------------------------------------------------
 *  db/memory/schemaUtils.js — Schema-driven defaults, casting, validation
 * -----------------------------------------------------------------------------
 *  The in-process engine does not re-declare the data model: it *reads the real
 *  Mongoose schemas* (`schema.eachPath`, `type.defaultValue`, `type.validators`,
 *  `schema.indexes()`), so a field added to `product.model.js` automatically gets
 *  its default, its enum check and its unique index here too. One model, two
 *  drivers, no drift.
 * -----------------------------------------------------------------------------
 */
import mongoose from 'mongoose';
import { deepClone, getPath, setPath, isPlainObject, isObjectId, toObjectId } from './util.js';

const { ObjectId } = mongoose.Types;

/** New ObjectId (works without an open connection). */
export function newObjectId() {
  return new ObjectId();
}

/** Invoke a schema type's default value. */
function resolveDefault(schemaType, doc) {
  const dv = schemaType.defaultValue;
  if (dv === undefined) return undefined;
  if (typeof dv === 'function') {
    // Mongoose passes the document to default functions that declare an arg.
    return dv.length > 0 ? dv.call(doc, doc) : dv.call(doc);
  }
  return deepClone(dv);
}

/**
 * Apply schema defaults (recursively, including sub-documents and arrays).
 *
 * @param {import('mongoose').Schema} schema
 * @param {object} doc  mutated in place
 * @returns {object} doc
 */
export function applyDefaults(schema, doc) {
  if (!isPlainObject(doc)) return doc;

  schema.eachPath((path, type) => {
    if (path === '__v') return;

    // --- single nested sub-document ---------------------------------------
    if (type.instance === 'Embedded' && type.schema) {
      const current = getPath(doc, path);
      if (isPlainObject(current)) {
        applyDefaults(type.schema, current);
        return;
      }
      if (current === undefined) {
        const dv = resolveDefault(type, doc);
        if (isPlainObject(dv)) {
          applyDefaults(type.schema, dv);
          setPath(doc, path, dv);
        }
      }
      return;
    }

    // --- arrays ------------------------------------------------------------
    if (type.instance === 'Array') {
      let current = getPath(doc, path);
      if (current === undefined || current === null) {
        const dv = resolveDefault(type, doc);
        current = Array.isArray(dv) ? dv : [];
        setPath(doc, path, current);
      }
      if (!Array.isArray(current)) return;
      if (type.schema) {
        for (const element of current) {
          if (isPlainObject(element)) applyDefaults(type.schema, element);
        }
      }
      return;
    }

    // --- scalar / objectid / date ------------------------------------------
    if (getPath(doc, path) === undefined) {
      const dv = resolveDefault(type, doc);
      if (dv !== undefined) setPath(doc, path, dv);
    }
  });

  return doc;
}

/**
 * Coerce incoming values to the type the schema declares.
 * Mirrors Mongoose's casting so `'500'` → `500` and `'2026-01-01'` → `Date`.
 */
export function castDocument(schema, doc) {
  if (!isPlainObject(doc)) return doc;

  schema.eachPath((path, type) => {
    if (path === '__v') return;

    if (type.instance === 'Embedded' && type.schema) {
      const current = getPath(doc, path);
      if (isPlainObject(current)) castDocument(type.schema, current);
      return;
    }

    if (type.instance === 'Array') {
      const current = getPath(doc, path);
      if (!Array.isArray(current)) return;
      if (type.schema) {
        current.forEach((element) => { if (isPlainObject(element)) castDocument(type.schema, element); });
      } else if (type.options?.type) {
        // Primitive array with a declared element type.
        const elementType = type.options.type.name?.toLowerCase?.() ?? '';
        setPath(doc, path, current.map((v) => castScalar(v, elementType, path)));
      }
      return;
    }

    const current = getPath(doc, path);
    if (current === undefined || current === null) return;
    const instance = (type.instance ?? '').toLowerCase();
    const casted = castScalar(current, instance, path);
    if (casted !== current) setPath(doc, path, casted);
  });

  return doc;
}

function castScalar(value, instance, path) {
  if (value === undefined || value === null) return value;
  switch (instance) {
    case 'objectid': {
      const id = toObjectId(value);
      if (!id) throw new TypeError(`"${path}" is not a valid ObjectId (received ${JSON.stringify(value)})`);
      return id;
    }
    case 'date':
      return value instanceof Date ? value : new Date(value);
    case 'number': {
      const n = Number(value);
      if (Number.isNaN(n)) throw new TypeError(`"${path}" must be a number (received ${JSON.stringify(value)})`);
      return n;
    }
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (value === 'true' || value === 1 || value === '1') return true;
      if (value === 'false' || value === 0 || value === '0') return false;
      return Boolean(value);
    case 'string':
      return typeof value === 'string' ? value : String(value);
    default:
      return value;
  }
}

/**
 * Validate a document against the schema.
 *
 * @returns {Array<{path:string, message:string, kind:string}>} empty when valid
 */
export function validateDocument(schema, doc, { prefix = '' } = {}) {
  const errors = [];

  schema.eachPath((path, type) => {
    if (path === '__v') return;
    const fullPath = prefix ? `${prefix}.${path}` : path;

    // Recurse into nested structures first.
    if (type.instance === 'Embedded' && type.schema) {
      const current = getPath(doc, path);
      if (isPlainObject(current)) errors.push(...validateDocument(type.schema, current, { prefix: fullPath }));
      return;
    }
    if (type.instance === 'Array' && type.schema) {
      const current = getPath(doc, path);
      if (Array.isArray(current)) {
        current.forEach((element, index) => {
          if (isPlainObject(element)) {
            errors.push(...validateDocument(type.schema, element, { prefix: `${fullPath}.${index}` }));
          }
        });
      }
    }

    const value = getPath(doc, path);

    // --- required ----------------------------------------------------------
    if (type.isRequired) {
      const ok = typeof type.checkRequired === 'function'
        ? type.checkRequired(value, doc)
        : value !== undefined && value !== null && value !== '';
      if (!ok) {
        const message = requiredMessage(type, fullPath);
        errors.push({ path: fullPath, message, kind: 'required' });
        return; // no point running the rest of the validators
      }
    }

    if (value === undefined || value === null) return;

    // --- enum --------------------------------------------------------------
    if (Array.isArray(type.enumValues) && type.enumValues.length) {
      const candidates = Array.isArray(value) ? value : [value];
      for (const candidate of candidates) {
        if (candidate === null || candidate === undefined) continue;
        if (!type.enumValues.some((allowed) => String(allowed) === String(candidate))) {
          errors.push({
            path: fullPath,
            message: `\`${candidate}\` is not a valid value for \`${fullPath}\`. Allowed: ${type.enumValues.join(', ')}`,
            kind: 'enum',
          });
        }
      }
    }

    // --- remaining validators (min/max/length/custom) ----------------------
    for (const rule of type.validators ?? []) {
      if (rule.type === 'required') continue;
      if (typeof rule.validator !== 'function') continue;
      // Mongoose skips non-required validators for empty arrays/strings.
      if (Array.isArray(value) && value.length === 0 && rule.type !== 'user defined') continue;

      let passed = true;
      try {
        const result = rule.validator.call(doc, value, doc);
        passed = result && typeof result.then === 'function' ? true : Boolean(result);
      } catch (err) {
        errors.push({ path: fullPath, message: err.message, kind: rule.type ?? 'user defined' });
        continue;
      }
      if (!passed) {
        errors.push({
          path: fullPath,
          message: String(rule.message ?? `Validation failed for \`${fullPath}\``)
            .replace(/\{PATH\}/g, fullPath)
            .replace(/\{VALUE\}/g, String(value)),
          kind: rule.type ?? 'user defined',
        });
      }
    }
  });

  return errors;
}

function requiredMessage(type, path) {
  const rule = (type.validators ?? []).find((v) => v.type === 'required');
  if (rule?.message) {
    return String(typeof rule.message === 'function' ? rule.message() : rule.message).replace(/\{PATH\}/g, path);
  }
  return `Path \`${path}\` is required.`;
}

/* -------------------------------------------------------------------------- */
/*  Projection                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Apply a Mongoose-style projection.
 *
 * Supports inclusive (`{ title: 1 }`), exclusive (`{ passwordHash: 0 }`) and
 * dot-path forms. `_id` is included unless explicitly excluded.
 */
export function applyProjection(doc, projection) {
  if (!projection) return doc;
  const entries = Object.entries(projection).filter(([, v]) => v !== undefined);
  if (!entries.length) return doc;

  const inclusion = entries.filter(([k, v]) => k !== '_id' && v !== 0 && v !== false);
  const exclusion = entries.filter(([k, v]) => k !== '_id' && (v === 0 || v === false));

  if (inclusion.length) {
    const out = {};
    const idExplicitlyExcluded = entries.some(([k, v]) => k === '_id' && (v === 0 || v === false));
    if (!idExplicitlyExcluded && doc._id !== undefined) out._id = doc._id;
    for (const [path] of inclusion) {
      const value = getPath(doc, path);
      if (value !== undefined) setPath(out, path, deepClone(value));
    }
    return out;
  }

  const out = deepClone(doc);
  for (const [path] of exclusion) unsetPathLocal(out, path);
  return out;
}

function unsetPathLocal(obj, path) {
  const segments = path.split('.');
  let cursor = obj;
  for (let i = 0; i < segments.length - 1; i += 1) {
    if (!isPlainObject(cursor)) return;
    cursor = cursor[segments[i]];
  }
  if (isPlainObject(cursor)) delete cursor[segments[segments.length - 1]];
}

/* -------------------------------------------------------------------------- */
/*  Unique index enforcement                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Extract every unique index (inline `unique: true` and `schema.index(...)`)
 * into a plain list the engine can enforce on write.
 *
 * @returns {Array<{fields:string[], partial:boolean, name:string}>}
 */
export function collectUniqueIndexes(schema) {
  const unique = [];

  for (const [key, options] of schema.indexes() ?? []) {
    if (!options?.unique) continue;
    const fields = Object.entries(key)
      .filter(([, direction]) => direction !== 'text' && direction !== '2dsphere')
      .map(([field]) => field);
    if (!fields.length) continue;
    unique.push({ fields, partial: Boolean(options.partialFilterExpression), name: options.name ?? fields.join('_') });
  }

  // Field-level `unique: true` declarations.
  schema.eachPath((path, type) => {
    if (!type.options?.unique) return;
    if (unique.some((idx) => idx.fields.length === 1 && idx.fields[0] === path)) return;
    unique.push({ fields: [path], partial: false, name: `${path}_1` });
  });

  return unique;
}

/* -------------------------------------------------------------------------- */
/*  JSON persistence (loss-less round trip of BSON types)                     */
/* -------------------------------------------------------------------------- */

/** ObjectId → `{ $oid }`, Date → `{ $date }` so the JSON file stays reversible. */
export function dehydrate(value) {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return { $date: value.toISOString() };
  if (isObjectId(value)) return { $oid: value.toString() };
  if (value instanceof RegExp) return { $regex: value.source, $flags: value.flags };
  if (Array.isArray(value)) return value.map(dehydrate);
  const out = {};
  for (const key of Object.keys(value)) out[key] = dehydrate(value[key]);
  return out;
}

/** Inverse of {@link dehydrate}. */
export function rehydrate(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(rehydrate);
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === '$oid') return new ObjectId(value.$oid);
  if (keys.length === 1 && keys[0] === '$date') return new Date(value.$date);
  if (keys.length === 2 && '$regex' in value && '$flags' in value) return new RegExp(value.$regex, value.$flags);
  const out = {};
  for (const key of keys) out[key] = rehydrate(value[key]);
  return out;
}
