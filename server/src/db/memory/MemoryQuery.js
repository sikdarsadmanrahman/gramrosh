/**
 * -----------------------------------------------------------------------------
 *  db/memory/MemoryQuery.js — Chainable, thenable query object
 * -----------------------------------------------------------------------------
 *  Mirrors the subset of the Mongoose `Query` API used by the services:
 *
 *      Product.find(filter).sort({ createdAt: -1 }).skip(24).limit(12)
 *             .select('title slug').populate('category', 'name slug').lean()
 *
 *  Every setter returns `this`, and `then()` makes the object awaitable, so the
 *  exact same controller code runs on MongoDB and here.
 * -----------------------------------------------------------------------------
 */
import { matchDocument } from './matcher.js';
import { applyUpdate, buildUpsertSeed } from './updater.js';
import { normalizeSort } from './aggregator.js';
import { applyProjection } from './schemaUtils.js';
import { deepClone, getPath, setPath, unsetPath, isPlainObject, isObjectId, toObjectId } from './util.js';

export class MemoryQuery {
  /**
   * @param {import('./MemoryModel.js').MemoryModel} model
   * @param {string} op  find | findOne | findOneAndUpdate | updateOne | …
   * @param {object} filter
   * @param {object} [options]
   */
  constructor(model, op, filter = {}, options = {}) {
    this.model = model;
    this.op = op;
    this._filter = filter ?? {};
    this._options = { ...options };
    this._update = options.update ?? null;
    this._projection = options.projection ?? null;
    this._sort = options.sort ?? null;
    this._skip = options.skip ?? 0;
    this._limit = options.limit ?? 0;
    this._populate = [];
    this._lean = Boolean(options.lean);
    this._executed = false;
  }

  /* ---------------------------- chainable API ---------------------------- */

  where(field, value) {
    if (typeof field === 'string') setPath(this._filter, field, value === undefined ? getPath(this._filter, field) : value);
    else if (isPlainObject(field)) Object.assign(this._filter, field);
    return this;
  }

  equals(value) {
    // `query.where('x').equals(1)` — the last `where` key receives the value.
    const keys = Object.keys(this._filter);
    if (keys.length) setPath(this._filter, keys[keys.length - 1], value);
    return this;
  }

  sort(spec) {
    this._sort = this._sort ? mergeSort(this._sort, spec) : spec;
    return this;
  }

  select(projection) {
    this._projection = mergeProjection(this._projection, projection);
    return this;
  }

  projection(projection) {
    return this.select(projection);
  }

  skip(n) {
    this._skip = Math.max(0, Number(n) || 0);
    return this;
  }

  limit(n) {
    this._limit = Math.max(0, Number(n) || 0);
    return this;
  }

  populate(spec, select) {
    if (!spec) return this;
    const specs = Array.isArray(spec) ? spec : String(spec).split(/\s+/).filter(Boolean).map((s) => ({ path: s }));
    for (const entry of specs) {
      this._populate.push(typeof entry === 'string' ? { path: entry, select } : { ...entry, select: entry.select ?? select });
    }
    return this;
  }

  lean(value = true) {
    this._lean = Boolean(value);
    return this;
  }

  setOptions(options) {
    Object.assign(this._options, options);
    if (options.sort !== undefined) this._sort = options.sort;
    if (options.select !== undefined) this._projection = mergeProjection(this._projection, options.select);
    if (options.projection !== undefined) this._projection = mergeProjection(this._projection, options.projection);
    if (options.skip !== undefined) this._skip = options.skip;
    if (options.limit !== undefined) this._limit = options.limit;
    if (options.lean !== undefined) this._lean = options.lean;
    if (options.populate) this.populate(options.populate);
    return this;
  }

  /** Accepted and ignored — collation does not change these datasets. */
  collation() {
    return this;
  }

  /** Accepted and ignored — there is a single in-process "session". */
  session() {
    return this;
  }

  read() {
    return this;
  }

  /* ------------------------------- execution ----------------------------- */

  then(resolve, reject) {
    return this.exec().then(resolve, reject);
  }

  catch(reject) {
    return this.exec().catch(reject);
  }

  exec() {
    if (this._executed) return Promise.resolve(this._result);
    this._executed = true;
    try {
      this._result = this._run();
      return Promise.resolve(this._result);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /** Synchronous core — wrapped by `exec()`. */
  _run() {
    switch (this.op) {
      case 'find': return this._execFind();
      case 'findOne': return this._execFindOne();
      case 'findOneAndUpdate':
      case 'findByIdAndUpdate': return this._execFindOneAndUpdate();
      case 'findOneAndDelete':
      case 'findByIdAndDelete': return this._execFindOneAndDelete();
      case 'updateOne': return this._execUpdate(false);
      case 'updateMany': return this._execUpdate(true);
      case 'deleteOne': return this._execDelete(false);
      case 'deleteMany': return this._execDelete(true);
      case 'countDocuments': return this._execCount();
      case 'distinct': return this._execDistinct();
      case 'exists': return this._execExists();
      default: throw new Error(`[memory-driver] Unknown operation "${this.op}"`);
    }
  }

  /* ------------------------------ operations ----------------------------- */

  _scan() {
    const ctx = { positional: {} };
    const filter = this._normalizedFilter();
    return this.model._documents().filter((doc) => matchDocument(doc, filter, ctx));
  }

  /** Coerce `_id` strings to ObjectId so equality matching works. */
  _normalizedFilter() {
    const filter = deepClone(this._filter);
    if (filter && filter._id !== undefined && !isPlainObject(filter._id) && !Array.isArray(filter._id)) {
      const id = toObjectId(filter._id);
      if (id) filter._id = id;
    }
    if (filter?._id?.$in) filter._id.$in = filter._id.$in.map((v) => toObjectId(v) ?? v);
    return filter;
  }

  _execFind() {
    let docs = this._scan();
    if (this._sort) docs.sort(sortComparator(this._sort));
    if (this._skip) docs = docs.slice(this._skip);
    if (this._limit) docs = docs.slice(0, this._limit);
    return this._materialize(docs);
  }

  _execFindOne() {
    const docs = this._scan();
    if (this._sort) docs.sort(sortComparator(this._sort));
    const [first] = docs;
    if (!first) return null;
    const [materialized] = this._materialize([first]);
    return materialized;
  }

  _execFindOneAndUpdate() {
    const docs = this._scan();
    if (this._sort) docs.sort(sortComparator(this._sort));
    const target = docs[0];

    if (!target) {
      if (this._options.upsert) {
        const seed = buildUpsertSeed(this._normalizedFilter(), this._update ?? {}, {});
        const created = this.model._insertDocument(seed, { validate: true });
        applyUpdate(created, this._update ?? {}, { isUpsert: true });
        this.model._touchUpdatedAt(created);
        this.model._persist();
        return this._materialize([this._options.new ? created : deepClone(created)])[0] ?? null;
      }
      return null;
    }

    const before = deepClone(target);
    const ctx = { positional: {} };
    matchDocument(target, this._normalizedFilter(), ctx); // capture `$` position
    applyUpdate(target, this._update ?? {}, { positional: ctx.positional });
    this.model._touchUpdatedAt(target);
    this.model._assertValid(target);
    this.model._assertUnique(target, before);
    this.model._persist();

    return this._materialize([this._options.new ? target : before])[0] ?? null;
  }

  _execFindOneAndDelete() {
    const docs = this._scan();
    if (this._sort) docs.sort(sortComparator(this._sort));
    const target = docs[0];
    if (!target) return null;
    const snapshot = deepClone(target);
    this.model._removeDocument(target);
    this.model._persist();
    return this._materialize([snapshot])[0] ?? null;
  }

  _execUpdate(many) {
    const docs = this._scan();
    const targets = many ? docs : docs.slice(0, 1);
    let modified = 0;
    let upsertedId = null;

    if (!targets.length && this._options.upsert) {
      const seed = buildUpsertSeed(this._normalizedFilter(), this._update ?? {}, {});
      const created = this.model._insertDocument(seed, { validate: true });
      applyUpdate(created, this._update ?? {}, { isUpsert: true });
      this.model._touchUpdatedAt(created);
      upsertedId = created._id;
      modified = 1;
    } else {
      for (const doc of targets) {
        const before = deepClone(doc);
        const ctx = { positional: {} };
        matchDocument(doc, this._normalizedFilter(), ctx);
        applyUpdate(doc, this._update ?? {}, { positional: ctx.positional });
        this.model._touchUpdatedAt(doc);
        this.model._assertValid(doc);
        this.model._assertUnique(doc, before);
        if (JSON.stringify(before) !== JSON.stringify(doc)) modified += 1;
      }
    }

    this.model._persist();
    return {
      acknowledged: true,
      matchedCount: targets.length,
      modifiedCount: modified,
      upsertedCount: upsertedId ? 1 : 0,
      upsertedId: upsertedId ? { _id: upsertedId } : null,
    };
  }

  _execDelete(many) {
    const docs = this._scan();
    const targets = many ? docs : docs.slice(0, 1);
    for (const doc of targets) this.model._removeDocument(doc);
    this.model._persist();
    return { acknowledged: true, deletedCount: targets.length };
  }

  _execCount() {
    let docs = this._scan();
    if (this._skip) docs = docs.slice(this._skip);
    if (this._limit) docs = docs.slice(0, this._limit);
    return docs.length;
  }

  _execDistinct() {
    const field = this._options.field;
    const seen = [];
    const unique = [];
    for (const doc of this._scan()) {
      const values = collectAll(doc, field);
      for (const value of values) {
        const key = isObjectId(value) ? value.toString() : JSON.stringify(value);
        if (value === undefined || seen.includes(key)) continue;
        seen.push(key);
        unique.push(deepClone(value));
      }
    }
    return unique;
  }

  _execExists() {
    const [doc] = this._scan();
    return doc ? { _id: doc._id } : null;
  }

  /* --------------------------- result shaping ---------------------------- */

  _materialize(docs) {
    let out = docs.map((doc) => projectDocument(doc, this._projection, this.model.hiddenFields));
    if (this._populate.length) out = out.map((doc) => this._applyPopulate(doc));
    if (this._lean) return out;
    return out.map((doc) => this.model._wrapDocument(doc));
  }

  _applyPopulate(doc) {
    for (const spec of this._populate) {
      const { path, select } = spec;
      const current = getPath(doc, path);
      if (current === undefined || current === null || current === '') continue;

      const schemaType = this.model.schema.path(path);
      const refName = spec.model ?? schemaType?.options?.ref;
      if (!refName) continue; // nothing to resolve against
      const refModel = this.model.database.models.get(refName);
      if (!refModel) continue;

      const project = (value) => {
        const id = toObjectId(value);
        if (!id) return null;
        const found = refModel._documents().find((candidate) => String(candidate._id) === String(id));
        if (!found) return null;
        return projectDocument(found, select, refModel.hiddenFields);
      };

      setPath(doc, path, Array.isArray(current) ? current.map(project).filter((v) => v !== null) : project(current));
    }
    return doc;
  }
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function sortComparator(spec) {
  const entries = normalizeSort(spec);
  return (a, b) => {
    for (const [field, direction] of entries) {
      const cmp = compareForSort(getPath(a, field), getPath(b, field));
      if (cmp) return cmp * direction;
    }
    return 0;
  };
}

function compareForSort(a, b) {
  // MongoDB sorts missing values first; keep that behaviour for stable paging.
  const aMissing = a === undefined || a === null;
  const bMissing = b === undefined || b === null;
  if (aMissing && bMissing) return 0;
  if (aMissing) return -1;
  if (bMissing) return 1;
  if (isObjectId(a) || isObjectId(b)) return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  if (a instanceof Date || b instanceof Date) {
    const ta = new Date(a).getTime();
    const tb = new Date(b).getTime();
    return ta === tb ? 0 : ta < tb ? -1 : 1;
  }
  if (typeof a === 'number' && typeof b === 'number') return a === b ? 0 : a < b ? -1 : 1;
  if (typeof a === 'boolean' || typeof b === 'boolean') return Number(a) === Number(b) ? 0 : Number(a) < Number(b) ? -1 : 1;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function mergeSort(existing, addition) {
  if (!existing) return addition;
  if (!addition) return existing;
  if (typeof existing === 'string' || typeof addition === 'string') {
    return [...normalizeSort(existing), ...normalizeSort(addition)];
  }
  return { ...existing, ...addition };
}

/** Accept `'a b -c'`, `['a','-c']` or `{a:1,c:-1}`. */
export function normalizeProjection(projection) {
  if (!projection) return null;
  if (isPlainObject(projection)) return projection;
  if (Array.isArray(projection)) {
    return Object.fromEntries(projection.map((field) => [field.replace(/^-/, ''), field.startsWith('-') ? 0 : 1]));
  }
  return Object.fromEntries(
    String(projection)
      .split(/[,\s]+/)
      .filter(Boolean)
      .map((field) => [field.replace(/^-/, ''), field.startsWith('-') ? 0 : 1]),
  );
}

/**
 * Apply a projection the way Mongoose would, including `select: false` fields.
 *
 *  • no projection            → every field except the model's hidden ones
 *  • `'+passwordHash'`        → default projection *plus* that hidden field
 *  • `{ a: 1, b: 1 }`         → only those fields (and `_id`)
 *  • `{ a: 0 }`               → everything except `a`
 *
 * Always returns a deep copy, so callers can hand the result straight to
 * `res.json()` without risking mutation of the stored document.
 */
export function projectDocument(doc, projection, hiddenFields = []) {
  const normalized = normalizeProjection(projection);

  if (!normalized || !Object.keys(normalized).length) {
    return excludeFields(deepClone(doc), hiddenFields);
  }

  const additive = Object.keys(normalized)
    .filter((key) => key.startsWith('+'))
    .map((key) => key.slice(1));

  if (additive.length) {
    const stillHidden = (hiddenFields ?? []).filter((field) => !additive.includes(field));
    return excludeFields(deepClone(doc), stillHidden);
  }

  return applyProjection(deepClone(doc), normalized);
}

function excludeFields(doc, fields) {
  for (const field of fields ?? []) unsetPath(doc, field);
  return doc;
}

/** Merge a chained `.select()` on top of an existing projection. */
function mergeProjection(existing, addition) {
  const a = normalizeProjection(existing);
  const b = normalizeProjection(addition);
  if (!a) return b;
  if (!b) return a;
  return { ...a, ...b };
}

function collectAll(doc, path) {
  const value = getPath(doc, path);
  if (Array.isArray(value)) return value;
  return value === undefined ? [] : [value];
}
