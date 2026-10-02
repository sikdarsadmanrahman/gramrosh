/**
 * -----------------------------------------------------------------------------
 *  db/memory/MemoryModel.js — A Mongoose-compatible model backed by an array
 * -----------------------------------------------------------------------------
 *  Implements the model surface the API uses (`find`, `findOne`, `findById`,
 *  `findOneAndUpdate`, `updateOne`, `countDocuments`, `distinct`, `aggregate`,
 *  `create`, `insertMany`, `deleteMany`, `syncIndexes`) and enforces the same
 *  guarantees a real MongoDB would: schema defaults, type casting, validation
 *  errors and **unique indexes** (so a duplicate customer phone number fails
 *  here exactly like it fails in production).
 * -----------------------------------------------------------------------------
 */
import { MemoryQuery } from './MemoryQuery.js';
import { runAggregation } from './aggregator.js';
import {
  applyDefaults,
  castDocument,
  validateDocument,
  collectUniqueIndexes,
  newObjectId,
  applyProjection,
} from './schemaUtils.js';
import { deepClone, getPath, isPlainObject, toObjectId, isObjectId } from './util.js';
import { applyDerivations } from '../../models/derivations.js';

/** Error shaped like the driver's duplicate-key failure (code 11000). */
function duplicateKeyError({ collection, indexName, keyValue }) {
  const error = new Error(
    `E11000 duplicate key error collection: gramrosh.${collection} index: ${indexName} dup key: ${JSON.stringify(keyValue)}`,
  );
  error.name = 'MongoServerError';
  error.code = 11000;
  error.keyPattern = { [indexName]: 1 };
  error.keyValue = keyValue;
  return error;
}

/** Error shaped like Mongoose's `ValidationError`. */
function validationError(modelName, details) {
  const error = new Error(`${modelName} validation failed: ${details.map((d) => `${d.path}: ${d.message}`).join(', ')}`);
  error.name = 'ValidationError';
  error.errors = Object.fromEntries(details.map((d) => [d.path, { message: d.message, kind: d.kind, path: d.path }]));
  return error;
}

export class MemoryModel {
  /**
   * @param {import('mongoose').Model} mongooseModel registered Mongoose model
   * @param {import('./MemoryDatabase.js').MemoryDatabase} database
   */
  constructor(mongooseModel, database) {
    this.mongooseModel = mongooseModel;
    this.modelName = mongooseModel.modelName;
    this.schema = mongooseModel.schema;
    this.database = database;
    this.collection = { name: mongooseModel.collection?.name ?? `${modelNameToCollection(this.modelName)}` };
    this.uniqueIndexes = collectUniqueIndexes(this.schema);
    this.timestamps = Boolean(this.schema.options?.timestamps);
    /**
     * Paths declared `select: false` (e.g. `Admin.passwordHash`). Mongoose omits
     * these from every query unless the caller opts back in with `+field`, so the
     * in-process engine has to do the same or it would leak secrets that the
     * production driver hides.
     */
    this.hiddenFields = [];
    this.schema.eachPath((path, type) => {
      if (type.options?.select === false) this.hiddenFields.push(path);
    });

    // Ensure the bucket exists.
    if (!this.database.data[this.modelName]) this.database.data[this.modelName] = [];

    // Expose schema statics (`Product.findByVariantSku`, `Order.pushStatus`, …)
    // bound to this model so business helpers work on both drivers.
    for (const [name, fn] of Object.entries(this.schema.statics ?? {})) {
      if (typeof fn === 'function' && !(name in this)) this[name] = fn.bind(this);
    }
  }

  /* ---------------------------------------------------------------------- */
  /*  Internal storage helpers                                              */
  /* ---------------------------------------------------------------------- */

  /** Live reference to this model's documents (never hand this out directly). */
  _documents() {
    return this.database.data[this.modelName];
  }

  _persist() {
    this.database.scheduleSave();
  }

  _touchUpdatedAt(doc) {
    if (!this.timestamps) return;
    const now = new Date();
    doc.updatedAt = now;
    if (!doc.createdAt) doc.createdAt = now;
  }

  _assertValid(doc) {
    const details = validateDocument(this.schema, doc);
    if (details.length) throw validationError(this.modelName, details);
  }

  /** Enforce unique indexes against every *other* document. */
  _assertUnique(doc, previousVersion = null) {
    for (const index of this.uniqueIndexes) {
      const candidateKeys = indexKeysFor(doc, index.fields);
      if (!candidateKeys.length) continue; // sparse-ish: nothing to collide with

      for (const other of this._documents()) {
        if (other === doc) continue;
        if (previousVersion && String(other._id) === String(previousVersion._id)) continue;
        const otherKeys = indexKeysFor(other, index.fields);
        for (const key of candidateKeys) {
          if (otherKeys.includes(key)) {
            const keyValue = Object.fromEntries(index.fields.map((f) => [f, getPath(doc, f)]));
            throw duplicateKeyError({ collection: this.collection.name, indexName: index.name, keyValue });
          }
        }
      }
    }
  }

  /** Full insert path: id + defaults + casting + validation + uniqueness. */
  _insertDocument(input, { validate = true } = {}) {
    const doc = deepClone(isPlainObject(input) || Array.isArray(input) ? input : { ...input });
    if (!doc._id) doc._id = newObjectId();
    else if (!isObjectId(doc._id)) doc._id = toObjectId(doc._id) ?? newObjectId();

    if (this.timestamps) {
      const now = new Date();
      doc.createdAt = doc.createdAt ? new Date(doc.createdAt) : now;
      doc.updatedAt = doc.updatedAt ? new Date(doc.updatedAt) : now;
    }

    applyDefaults(this.schema, doc);
    castDocument(this.schema, doc);
    // Same write-time derivations Mongoose runs from its pre-validate/pre-save
    // hooks (slug, phone canonicalisation, totals, denormalised aggregates).
    applyDerivations(this.modelName, doc, { isNew: true });
    if (validate) this._assertValid(doc);
    this._assertUnique(doc);

    this._documents().push(doc);
    return doc;
  }

  _removeDocument(doc) {
    const docs = this._documents();
    const index = docs.indexOf(doc);
    if (index !== -1) docs.splice(index, 1);
  }

  /**
   * Wrap a plain object so it behaves like a Mongoose document for the small
   * set of behaviours the controllers rely on (`save`, `toObject`, `set`, `id`).
   */
  _wrapDocument(plain) {
    const model = this;
    const doc = Object.assign(Object.create(memoryDocumentPrototype), deepClone(plain));
    Object.defineProperty(doc, '$__model', { value: model, enumerable: false, writable: true });
    Object.defineProperty(doc, 'isNew', { value: false, enumerable: false, writable: true });
    Object.defineProperty(doc, '$isNew', { value: false, enumerable: false, writable: true });
    return doc;
  }

  /* ---------------------------------------------------------------------- */
  /*  Public query API                                                      */
  /* ---------------------------------------------------------------------- */

  find(filter = {}, projection = null, options = {}) {
    return new MemoryQuery(this, 'find', filter, { ...options, projection });
  }

  findOne(filter = {}, projection = null, options = {}) {
    return new MemoryQuery(this, 'findOne', filter, { ...options, projection });
  }

  findById(id, projection = null, options = {}) {
    return new MemoryQuery(this, 'findOne', { _id: id }, { ...options, projection });
  }

  findOneAndUpdate(filter = {}, update = {}, options = {}) {
    return new MemoryQuery(this, 'findOneAndUpdate', filter, { ...options, update });
  }

  findByIdAndUpdate(id, update = {}, options = {}) {
    return new MemoryQuery(this, 'findOneAndUpdate', { _id: id }, { ...options, update });
  }

  findOneAndDelete(filter = {}, options = {}) {
    return new MemoryQuery(this, 'findOneAndDelete', filter, options);
  }

  findOneAndRemove(filter = {}, options = {}) {
    return this.findOneAndDelete(filter, options);
  }

  findByIdAndDelete(id, options = {}) {
    return new MemoryQuery(this, 'findOneAndDelete', { _id: id }, options);
  }

  updateOne(filter = {}, update = {}, options = {}) {
    return new MemoryQuery(this, 'updateOne', filter, { ...options, update });
  }

  updateMany(filter = {}, update = {}, options = {}) {
    return new MemoryQuery(this, 'updateMany', filter, { ...options, update });
  }

  deleteOne(filter = {}, options = {}) {
    return new MemoryQuery(this, 'deleteOne', filter, options);
  }

  deleteMany(filter = {}, options = {}) {
    return new MemoryQuery(this, 'deleteMany', filter, options);
  }

  remove(filter = {}, options = {}) {
    return this.deleteMany(filter, options);
  }

  countDocuments(filter = {}, options = {}) {
    return new MemoryQuery(this, 'countDocuments', filter, options);
  }

  estimatedDocumentCount() {
    return Promise.resolve(this._documents().length);
  }

  distinct(field, filter = {}, options = {}) {
    return new MemoryQuery(this, 'distinct', filter, { ...options, field });
  }

  exists(filter = {}, options = {}) {
    return new MemoryQuery(this, 'exists', filter, options);
  }

  /** Mongoose returns a Promise of Document(s); so do we. */
  async create(input) {
    const isArray = Array.isArray(input);
    const inputs = isArray ? input : [input];
    const created = inputs.map((doc) => this._insertDocument(doc));
    this._persist();
    const wrapped = created.map((doc) => this._wrapDocument(doc));
    return isArray ? wrapped : wrapped[0];
  }

  async insertMany(inputs, options = {}) {
    const list = Array.isArray(inputs) ? inputs : [inputs];
    const created = list.map((doc) => this._insertDocument(doc, { validate: options.validateBeforeSave !== false }));
    this._persist();
    return created.map((doc) => this._wrapDocument(doc));
  }

  /** Thenable aggregate, matching `Model.aggregate([...])`. */
  aggregate(pipeline = [], options = {}) {
    const model = this;
    const run = () => {
      const allowDiskUse = options.allowDiskUse;
      const result = runAggregation(model._documents(), pipeline);
      if (allowDiskUse === undefined && result.length > 100_000) {
        // Mirrors Mongo's 100MB in-memory sort/group guard.
        throw new Error('[memory-driver] aggregation result too large; add $limit or set allowDiskUse');
      }
      return result;
    };
    return {
      then: (resolve, reject) => { try { resolve(run()); } catch (e) { reject(e); } },
      catch: (reject) => { try { run(); return Promise.resolve(); } catch (e) { return Promise.reject(e).catch(reject); } },
      option() { return this; },
      allowDiskUse() { return this; },
      exec: () => Promise.resolve().then(run),
    };
  }

  hydrate(obj) {
    return this._wrapDocument(deepClone(obj));
  }

  /**
   * No-op that returns the index names, and logs coverage so `npm run seed`
   * proves the required indexes are declared. Real creation happens on MongoDB.
   */
  async syncIndexes() {
    const names = (this.schema.indexes() ?? [])
      .map(([key, options]) => options?.name ?? Object.keys(key).map((f) => `${f}_${key[f]}`).join('_'));
    for (const [path, type] of Object.entries(uniqueFieldPaths(this.schema))) {
      names.push(`${path}_1`);
    }
    return names;
  }

  async listIndexes() {
    return (await this.syncIndexes()).map((name) => ({ name, v: 2 }));
  }

  async createIndexes() {
    return this.syncIndexes();
  }

  /** Number of documents — handy for the boot log & health check. */
  get documentCount() {
    return this._documents().length;
  }
}

/* -------------------------------------------------------------------------- */
/*  Document prototype                                                        */
/* -------------------------------------------------------------------------- */

const memoryDocumentPrototype = {
  /** Persist in-place mutations, re-validating exactly like Mongoose does. */
  save() {
    const model = this.$__model;
    const plain = this.toObject();
    applyDerivations(model.modelName, plain, { isNew: false });
    model._touchUpdatedAt(plain);
    model._assertValid(plain);

    const docs = model._documents();
    const index = docs.findIndex((d) => String(d._id) === String(this._id));
    if (index === -1) {
      // Re-insert (acts like an upsert of the whole document).
      model._assertUnique(plain);
      docs.push(plain);
    } else {
      model._assertUnique(plain, docs[index]);
      docs[index] = plain;
    }
    model._persist();

    // Reflect persisted state back onto this instance.
    for (const key of Object.keys(this)) {
      if (key === '$__model') continue;
      delete this[key];
    }
    Object.assign(this, deepClone(plain));
    return Promise.resolve(this);
  },

  toObject() {
    const out = {};
    for (const key of Object.keys(this)) {
      if (key === '$__model') continue;
      out[key] = deepClone(this[key]);
    }
    return out;
  },

  toJSON() {
    return this.toObject();
  },

  set(pathOrObj, value) {
    if (isPlainObject(pathOrObj)) {
      for (const [k, v] of Object.entries(pathOrObj)) this[k] = deepClone(v);
      return this;
    }
    const target = this.toObject();
    setPathLocal(target, String(pathOrObj), value);
    Object.assign(this, target);
    return this;
  },

  get(path) {
    return getPath(this.toObject(), String(path));
  },

  isModified() {
    return true;
  },

  equals(other) {
    return String(this._id) === String(other?._id ?? other);
  },

  $set(...args) {
    return this.set(...args);
  },
  $get(...args) {
    return this.get(...args);
  },
  $toObject(...args) {
    return this.toObject(...args);
  },
};

Object.defineProperty(memoryDocumentPrototype, 'id', {
  get() {
    return this._id ? String(this._id) : undefined;
  },
  enumerable: false,
});

Object.defineProperty(memoryDocumentPrototype, 'collection', {
  get() {
    return this.$__model?.collection;
  },
  enumerable: false,
});

function setPathLocal(obj, path, value) {
  const segments = path.split('.');
  let cursor = obj;
  for (let i = 0; i < segments.length - 1; i += 1) {
    if (!isPlainObject(cursor[segments[i]])) cursor[segments[i]] = {};
    cursor = cursor[segments[i]];
  }
  cursor[segments[segments.length - 1]] = deepClone(value);
}

/* -------------------------------------------------------------------------- */
/*  Index helpers                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Compute the set of unique-key signatures a document contributes.
 *
 * Array paths are multikey: `variants.sku` yields one key per variant, which is
 * exactly how MongoDB enforces uniqueness across a document array.
 */
function indexKeysFor(doc, fields) {
  let combos = [''];
  for (const field of fields) {
    const values = collectValues(doc, field);
    const next = [];
    for (const combo of combos) {
      for (const value of values) {
        if (value === undefined || value === null || value === '') continue;
        next.push(`${combo}\u0000${stringifyKey(value)}`);
      }
    }
    combos = next;
    if (!combos.length) return []; // any missing field ⇒ no key (sparse semantics)
  }
  return combos;
}

function collectValues(doc, field) {
  const segments = field.split('.');
  let values = [doc];
  for (const segment of segments) {
    const next = [];
    for (const value of values) {
      if (Array.isArray(value)) next.push(...value.map((el) => (isPlainObject(el) ? el[segment] : undefined)));
      else if (isPlainObject(value)) next.push(value[segment]);
      else next.push(undefined);
    }
    values = next;
  }
  return values.filter((v) => v !== undefined);
}

function stringifyKey(value) {
  if (isObjectId(value)) return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function* uniqueFieldPathsEntries(schema) {
  const paths = {};
  schema.eachPath((path, type) => {
    if (type.options?.unique) paths[path] = type;
  });
  yield paths;
}

function uniqueFieldPaths(schema) {
  return [...uniqueFieldPathsEntries(schema)][0];
}

function modelNameToCollection(name) {
  return `${name.toLowerCase()}s`;
}

export { applyProjection };
