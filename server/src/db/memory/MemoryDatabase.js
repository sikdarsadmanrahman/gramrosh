/**
 * -----------------------------------------------------------------------------
 *  db/memory/MemoryDatabase.js — The in-process database itself
 * -----------------------------------------------------------------------------
 *  Holds one array of documents per model and (optionally) mirrors it to a JSON
 *  file so a restart keeps the catalogue, orders and customers. Writes are
 *  debounced: a burst of order creation produces a single disk write, which is
 *  what keeps checkout latency flat during seeding and load.
 *
 *  This driver exists for three reasons:
 *    1. zero-config local development (no MongoDB install needed),
 *    2. CI + unit tests that run in milliseconds with no external service,
 *    3. sandboxed demos where outbound access to a database is unavailable.
 *
 *  Production always sets MONGO_URI, which selects the real Mongoose driver.
 * -----------------------------------------------------------------------------
 */
import fs from 'node:fs';
import path from 'node:path';

import { MemoryModel } from './MemoryModel.js';
import { dehydrate, rehydrate } from './schemaUtils.js';
import { logger } from '../../utils/logger.js';

const SAVE_DEBOUNCE_MS = 25;

export class MemoryDatabase {
  /**
   * @param {{filePath?:string, persist?:boolean, name?:string}} options
   */
  constructor({ filePath = null, persist = false, name = 'gramrosh' } = {}) {
    this.name = name;
    this.filePath = filePath;
    this.persist = Boolean(persist && filePath);
    /** @type {Record<string, object[]>} */
    this.data = {};
    /** @type {Map<string, MemoryModel>} */
    this.models = new Map();
    this._saveTimer = null;
    this._loaded = false;
  }

  /* ---------------------------------------------------------------------- */
  /*  Lifecycle                                                             */
  /* ---------------------------------------------------------------------- */

  /** Load the on-disk snapshot (when persistence is enabled). */
  async connect() {
    if (this._loaded) return this;
    if (this.persist && fs.existsSync(this.filePath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        for (const [modelName, docs] of Object.entries(raw.collections ?? {})) {
          this.data[modelName] = Array.isArray(docs) ? docs.map(rehydrate) : [];
        }
        logger.info('[memory-db] snapshot loaded', {
          file: this.filePath,
          collections: Object.keys(raw.collections ?? {}).length,
          documents: Object.values(this.data).reduce((sum, docs) => sum + docs.length, 0),
          savedAt: raw.savedAt ?? null,
        });
      } catch (error) {
        logger.warn('[memory-db] snapshot unreadable, starting empty', { error: error.message });
        this.data = {};
      }
    }
    this._loaded = true;
    return this;
  }

  async disconnect() {
    this.flush();
    this._loaded = false;
    return this;
  }

  /** Remove every document (used between test cases). */
  async clear() {
    for (const modelName of Object.keys(this.data)) this.data[modelName] = [];
    this.flush();
    return this;
  }

  /* ---------------------------------------------------------------------- */
  /*  Model registry                                                        */
  /* ---------------------------------------------------------------------- */

  /**
   * Wrap a registered Mongoose model.
   * @param {import('mongoose').Model} mongooseModel
   */
  register(mongooseModel) {
    const existing = this.models.get(mongooseModel.modelName);
    if (existing) return existing;
    const model = new MemoryModel(mongooseModel, this);
    this.models.set(model.modelName, model);
    return model;
  }

  /** @param {string} name */
  model(name) {
    const model = this.models.get(name);
    if (!model) throw new Error(`[memory-db] Model "${name}" is not registered`);
    return model;
  }

  /* ---------------------------------------------------------------------- */
  /*  Persistence                                                           */
  /* ---------------------------------------------------------------------- */

  /** Coalesce writes: many mutations in one tick ⇒ one file write. */
  scheduleSave() {
    if (!this.persist) return;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.flush();
    }, SAVE_DEBOUNCE_MS);
    // Never hold the event loop open just to persist a snapshot.
    this._saveTimer.unref?.();
  }

  /** Write the snapshot synchronously. */
  flush() {
    if (!this.persist) return;
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const collections = {};
      for (const [modelName, docs] of Object.entries(this.data)) {
        collections[modelName] = docs.map(dehydrate);
      }
      const payload = {
        driver: 'memory',
        version: 1,
        savedAt: new Date().toISOString(),
        collections,
      };
      // Atomic-ish write: temp file then rename, so a crash can't truncate data.
      const tmp = `${this.filePath}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload));
      fs.renameSync(tmp, this.filePath);
    } catch (error) {
      logger.warn('[memory-db] snapshot write failed', { error: error.message });
    }
  }

  /** Collection sizes — surfaced by `/api/health` in memory mode. */
  stats() {
    const collections = {};
    let documents = 0;
    for (const [modelName, docs] of Object.entries(this.data)) {
      collections[modelName] = docs.length;
      documents += docs.length;
    }
    return { driver: 'memory', collections, documents, persisted: this.persist };
  }
}

export default MemoryDatabase;
