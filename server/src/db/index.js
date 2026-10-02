/**
 * -----------------------------------------------------------------------------
 *  db/index.js — Storage driver selection & the model registry the app imports
 * -----------------------------------------------------------------------------
 *  Controllers and services import models from *here*, never from `mongoose`
 *  directly:
 *
 *      import { db } from '../db/index.js';
 *      const products = await db.Product.find({ status: 'active' }).lean();
 *
 *  Depending on `DB_DRIVER` the exported models are either the real Mongoose
 *  models (connected to MongoDB) or `MemoryModel` instances backed by the
 *  in-process engine. Both expose the same query surface, so no service knows or
 *  cares which one is active.
 * -----------------------------------------------------------------------------
 */
import mongoose from 'mongoose';

import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { MODELS, MODEL_NAMES, collectIndexDefinitions } from '../models/index.js';
import { MemoryDatabase } from './memory/MemoryDatabase.js';

/** @type {MemoryDatabase|null} */
let memoryDatabase = null;
let activeDriver = null;
let connectionState = 'disconnected';
const registry = {};

/** Which storage engine is live: `mongodb` | `memory`. */
export function getDriver() {
  return activeDriver;
}

export function getConnectionState() {
  return connectionState;
}

/** The in-process database (null when running on MongoDB). */
export function getMemoryDatabase() {
  return memoryDatabase;
}

/**
 * Proxy object exposing the active model for each name.
 * Resolved lazily so importing this module before `connectDatabase()` is safe.
 */
export const db = {};
for (const name of MODEL_NAMES) {
  Object.defineProperty(db, name, {
    enumerable: true,
    get() {
      const model = registry[name];
      if (!model) throw new Error(`Database not connected — call connectDatabase() before using db.${name}`);
      return model;
    },
  });
}
Object.defineProperty(db, 'driver', { enumerable: true, get: () => activeDriver });
Object.defineProperty(db, 'mongoose', { enumerable: false, get: () => mongoose });

/* -------------------------------------------------------------------------- */
/*  Connection                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Open the configured storage backend and register every model.
 *
 * @returns {Promise<typeof db>}
 */
export async function connectDatabase() {
  if (connectionState === 'connected') return db;

  const driver = env.DB_DRIVER === 'mongodb' ? 'mongodb' : 'memory';
  activeDriver = driver;

  if (driver === 'mongodb') {
    await connectMongo();
  } else {
    await connectMemory();
  }

  connectionState = 'connected';
  logIndexCoverage();
  return db;
}

async function connectMongo() {
  mongoose.set('strictQuery', true);
  // Return fast instead of hanging for 30s when the replica set is unreachable.
  mongoose.set('sanitizeFilter', true);

  await mongoose.connect(env.MONGO_URI, {
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 20,
    minPoolSize: 2,
    autoIndex: !env.isProduction, // production creates indexes in the deploy step
    retryWrites: true,
    retryReads: true,
  });

  if (env.isProduction) {
    // Belt & braces: indexes must exist even though Terraform/deploy normally
    // owns DDL. `syncIndexes` is idempotent.
    await Promise.all(MODEL_NAMES.map((name) => MODELS[name].syncIndexes()));
  }

  mongoose.connection.on('error', (error) => logger.error('[mongo] connection error', { error: error.message }));
  mongoose.connection.on('disconnected', () => { connectionState = 'disconnected'; logger.warn('[mongo] disconnected'); });
  mongoose.connection.on('reconnected', () => { connectionState = 'connected'; logger.info('[mongo] reconnected'); });

  for (const name of MODEL_NAMES) registry[name] = MODELS[name];
  logger.info('[mongo] connected', { uri: redactUri(env.MONGO_URI), db: mongoose.connection.name });
}

async function connectMemory() {
  memoryDatabase = new MemoryDatabase({
    filePath: env.MEMORY_DB_PATH,
    persist: env.MEMORY_DB_PERSIST,
  });
  await memoryDatabase.connect();

  for (const name of MODEL_NAMES) {
    registry[name] = memoryDatabase.register(MODELS[name]);
  }
  logger.info('[memory-db] in-process engine ready', memoryDatabase.stats());
  logger.warn(
    '[memory-db] running WITHOUT MongoDB — set MONGO_URI (and DB_DRIVER=mongodb) for production',
  );
}

/** Print every declared index so the required coverage is auditable at boot. */
function logIndexCoverage() {
  if (env.isTest) return;
  const definitions = collectIndexDefinitions();
  const required = ['category', 'phone', 'orderNumber', 'createdAt'];
  const covered = required.filter((field) =>
    definitions.some(({ key }) => Object.keys(key).some((k) => k === field || k.endsWith(`.${field}`))),
  );
  logger.info('[db] index coverage', {
    driver: activeDriver,
    totalIndexes: definitions.length,
    requiredFieldsCovered: covered,
    missing: required.filter((f) => !covered.includes(f)),
  });
}

/** Strip credentials from a connection string before logging it. */
function redactUri(uri) {
  return String(uri).replace(/\/\/([^@/]+)@/, '//***:***@');
}

/** Close the active backend. */
export async function disconnectDatabase() {
  if (activeDriver === 'mongodb') await mongoose.disconnect();
  if (memoryDatabase) await memoryDatabase.disconnect();
  connectionState = 'disconnected';
}

/** Test helper: wipe the in-process dataset. */
export async function resetMemoryDatabase() {
  if (memoryDatabase) await memoryDatabase.clear();
}

export { mongoose };
