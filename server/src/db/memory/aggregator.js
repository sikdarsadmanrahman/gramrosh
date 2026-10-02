/**
 * -----------------------------------------------------------------------------
 *  db/memory/aggregator.js — Aggregation pipeline subset
 * -----------------------------------------------------------------------------
 *  Implements the stages and accumulators used by the reporting endpoints
 *  (revenue by status, units sold per product, orders per district). Unsupported
 *  stages throw loudly rather than returning partial results.
 *
 *  NOTE: `$lookup` is intentionally unsupported — the reporting queries are
 *  written against denormalised order snapshots instead, which is both faster on
 *  a real MongoDB and keeps this engine honest.
 * -----------------------------------------------------------------------------
 */
import { getPath, setPath, deepClone, compareValues, isPlainObject } from './util.js';
import { matchDocument, UnsupportedQueryError } from './matcher.js';

/* -------------------------------------------------------------------------- */
/*  Expression evaluation                                                     */
/* -------------------------------------------------------------------------- */

/** Evaluate an aggregation expression against a document. */
export function evalExpression(expr, doc) {
  if (expr === null || expr === undefined) return expr;
  if (typeof expr === 'string') {
    if (expr.startsWith('$$')) return resolveSystemVariable(expr.slice(2), doc);
    if (expr.startsWith('$')) return getPath(doc, expr.slice(1));
    return expr;
  }
  if (typeof expr !== 'object') return expr;
  if (Array.isArray(expr)) return expr.map((item) => evalExpression(item, doc));

  const keys = Object.keys(expr);
  if (keys.length !== 1) {
    // A literal object document (e.g. `{ _id: '$x', total: { $sum: '$y' } }` is
    // handled by the caller); anything else is treated as a literal.
    const out = {};
    for (const [k, v] of Object.entries(expr)) out[k] = evalExpression(v, doc);
    return out;
  }

  const op = keys[0];

  // A single *non*-operator key is a literal object expression
  // (e.g. `{ month: { $dateToString: … } }`), not an operator call.
  if (!op.startsWith('$')) {
    const out = {};
    for (const [key, value] of Object.entries(expr)) out[key] = evalExpression(value, doc);
    return out;
  }

  const arg = expr[op];

  switch (op) {
    case '$literal': return deepClone(arg);
    case '$add': return numericList(arg, doc).reduce((a, b) => a + b, 0);
    case '$subtract': {
      const [a, b] = arg.map((x) => evalExpression(x, doc));
      return toNumber(a) - toNumber(b);
    }
    case '$multiply': return numericList(arg, doc).reduce((a, b) => a * b, 1);
    case '$divide': {
      const [a, b] = arg.map((x) => evalExpression(x, doc));
      return b === 0 ? null : toNumber(a) / toNumber(b);
    }
    case '$round': {
      const [value, places = 0] = arg.map((x) => evalExpression(x, doc));
      const factor = 10 ** toNumber(places);
      return Math.round(toNumber(value) * factor) / factor;
    }
    case '$abs': return Math.abs(toNumber(evalExpression(arg, doc)));
    case '$cond': {
      const { if: condition, then: whenTrue, else: whenFalse } = Array.isArray(arg)
        ? { if: arg[0], then: arg[1], else: arg[2] }
        : arg;
      return truthy(evalExpression(condition, doc)) ? evalExpression(whenTrue, doc) : evalExpression(whenFalse, doc);
    }
    case '$ifNull': {
      const [value, fallback] = arg.map((x) => evalExpression(x, doc));
      return value === null || value === undefined ? fallback : value;
    }
    case '$eq':
    case '$ne':
    case '$gt':
    case '$gte':
    case '$lt':
    case '$lte': {
      const [a, b] = arg.map((x) => evalExpression(x, doc));
      const cmp = compareValues(a, b) ?? (a === b ? 0 : NaN);
      switch (op) {
        case '$eq': return cmp === 0;
        case '$ne': return cmp !== 0;
        case '$gt': return cmp > 0;
        case '$gte': return cmp >= 0;
        case '$lt': return cmp < 0;
        default: return cmp <= 0;
      }
    }
    case '$and': return arg.every((x) => truthy(evalExpression(x, doc)));
    case '$or': return arg.some((x) => truthy(evalExpression(x, doc)));
    case '$not': return !truthy(evalExpression(arg, doc));
    case '$size': {
      const value = evalExpression(arg, doc);
      return Array.isArray(value) ? value.length : 0;
    }
    case '$toLower': return String(evalExpression(arg, doc) ?? '').toLowerCase();
    case '$toUpper': return String(evalExpression(arg, doc) ?? '').toUpperCase();
    case '$concat': return arg.map((x) => String(evalExpression(x, doc) ?? '')).join('');
    case '$isArray': return Array.isArray(evalExpression(arg, doc));
    case '$year': return dateOf(evalExpression(arg, doc)).getUTCFullYear();
    case '$month': return dateOf(evalExpression(arg, doc)).getUTCMonth() + 1;
    case '$dayOfMonth': return dateOf(evalExpression(arg, doc)).getUTCDate();
    case '$dateToString': return formatDateToString(arg, doc);
    case '$sum': {
      // Inside `$project`/`$addFields`, `$sum` over an array totals its items.
      const value = evalExpression(arg, doc);
      if (Array.isArray(value)) return value.reduce((acc, v) => acc + toNumber(v), 0);
      return toNumber(value);
    }
    default:
      throw new UnsupportedQueryError(`aggregation expression ${op}`);
  }
}

function resolveSystemVariable(name, doc) {
  if (name === 'ROOT') return doc;
  if (name === 'NOW') return new Date();
  return getPath(doc, name);
}

function numericList(arg, doc) {
  return (Array.isArray(arg) ? arg : [arg]).map((x) => toNumber(evalExpression(x, doc)));
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  return Number.isNaN(n) ? 0 : n;
}

function truthy(value) {
  return !(value === false || value === null || value === undefined || value === 0 || Number.isNaN(value));
}

function dateOf(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}

/** Minimal `$dateToString` supporting `%Y %m %d %H %M %S`. */
function formatDateToString(arg, doc) {
  const format = arg.format ?? '%Y-%m-%dT%H:%M:%S';
  const date = dateOf(evalExpression(arg.date, doc));
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return format
    .replace(/%Y/g, String(date.getUTCFullYear()))
    .replace(/%m/g, pad(date.getUTCMonth() + 1))
    .replace(/%d/g, pad(date.getUTCDate()))
    .replace(/%H/g, pad(date.getUTCHours()))
    .replace(/%M/g, pad(date.getUTCMinutes()))
    .replace(/%S/g, pad(date.getUTCSeconds()));
}

/* -------------------------------------------------------------------------- */
/*  Group accumulators                                                        */
/* -------------------------------------------------------------------------- */

function newAccumulator(spec) {
  const [op] = Object.keys(spec);
  const expr = spec[op];
  switch (op) {
    case '$sum': return { op, expr, value: 0, add(doc) { this.value += toNumber(evalExpression(this.expr, doc)); } };
    case '$avg': {
      let sum = 0;
      let count = 0;
      return {
        op, expr,
        add(doc) {
          const v = evalExpression(expr, doc);
          if (v === null || v === undefined) return;
          sum += toNumber(v);
          count += 1;
        },
        result: () => (count ? sum / count : null),
      };
    }
    case '$min': return { op, expr, value: undefined, add(doc) {
      const v = evalExpression(expr, doc);
      if (v === null || v === undefined) return;
      if (this.value === undefined || (compareValues(v, this.value) ?? 0) < 0) this.value = v;
    } };
    case '$max': return { op, expr, value: undefined, add(doc) {
      const v = evalExpression(expr, doc);
      if (v === null || v === undefined) return;
      if (this.value === undefined || (compareValues(v, this.value) ?? 0) > 0) this.value = v;
    } };
    case '$first': return { op, expr, value: undefined, add(doc) { if (this.value === undefined) this.value = evalExpression(expr, doc); } };
    case '$last': return { op, expr, value: undefined, add(doc) { this.value = evalExpression(expr, doc); } };
    case '$push': return { op, expr, value: [], add(doc) { this.value.push(evalExpression(expr, doc)); } };
    case '$addToSet': return { op, expr, value: [], add(doc) {
      const v = evalExpression(expr, doc);
      if (!this.value.some((existing) => JSON.stringify(existing) === JSON.stringify(v))) this.value.push(v);
    } };
    case '$count': return { op, expr, value: 0, add() { this.value += 1; } };
    case '$stdDevPop':
    case '$stdDevSamp':
      throw new UnsupportedQueryError(`accumulator ${op}`);
    default:
      throw new UnsupportedQueryError(`accumulator ${op}`);
  }
}

function accumulatorResult(acc) {
  if (typeof acc.result === 'function') return acc.result();
  if (acc.op === '$min' || acc.op === '$max' || acc.op === '$first' || acc.op === '$last') {
    return acc.value === undefined ? null : acc.value;
  }
  return acc.value;
}

/** Evaluate a `_id` group specification. */
function evalGroupId(idSpec, doc) {
  if (idSpec === null) return null;
  const value = evalExpression(idSpec, doc);
  // Composite group keys must produce a stable, comparable string.
  return isPlainObject(value) ? stableStringify(value) : value;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/**
 * Reverse `stableStringify` for composite group ids so results match MongoDB's
 * shape (`{ _id: { month: '2026-09' } }` rather than `{ _id: '{"month":…}' }`).
 */
function reviveGroupId(raw) {
  if (typeof raw !== 'string') return raw;
  if (!raw.startsWith('{') || !raw.endsWith('}')) return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/* -------------------------------------------------------------------------- */
/*  Stage implementations                                                     */
/* -------------------------------------------------------------------------- */

function stageMatch(docs, spec) {
  return docs.filter((doc) => matchDocument(doc, spec, { positional: {} }));
}

function stageGroup(docs, spec) {
  const { _id: idSpec, ...fields } = spec;
  const groups = new Map();

  for (const doc of docs) {
    const rawId = evalGroupId(idSpec, doc);
    const key = typeof rawId === 'object' && rawId !== null ? stableStringify(rawId) : String(rawId) ?? 'null';
    if (!groups.has(key)) {
      groups.set(key, {
        rawId,
        accumulators: Object.fromEntries(Object.entries(fields).map(([name, accSpec]) => [name, newAccumulator(accSpec)])),
      });
    }
    const group = groups.get(key);
    for (const acc of Object.values(group.accumulators)) acc.add(doc);
  }

  return [...groups.values()].map((group) => {
    const out = { _id: reviveGroupId(group.rawId) };
    for (const [name, acc] of Object.entries(group.accumulators)) out[name] = accumulatorResult(acc);
    return out;
  });
}

function buildSortComparator(sortSpec) {
  const entries = normalizeSort(sortSpec);
  return (a, b) => {
    for (const [field, direction] of entries) {
      const cmp = compareValues(getPath(a, field), getPath(b, field));
      if (cmp) return cmp * direction;
    }
    return 0;
  };
}

/** Accept `{a:1}`, `[['a',1]]`, `'a -b'` or `'-a'`. */
export function normalizeSort(sortSpec) {
  if (!sortSpec) return [];
  if (typeof sortSpec === 'string') {
    return sortSpec.split(/[,\s]+/).filter(Boolean).map((token) =>
      token.startsWith('-') ? [token.slice(1), -1] : [token, 1],
    );
  }
  if (Array.isArray(sortSpec)) {
    return sortSpec.flatMap((entry) => (Array.isArray(entry) ? [[entry[0], entry[1] < 0 ? -1 : 1]] : normalizeSort(entry)));
  }
  return Object.entries(sortSpec).map(([field, direction]) => [field, direction === 'desc' || direction < 0 ? -1 : 1]);
}

function stageSort(docs, spec) {
  return [...docs].sort(buildSortComparator(spec));
}

function stageProject(docs, spec) {
  const entries = Object.entries(spec);
  const exclusions = entries.filter(([, v]) => v === 0 || v === false);
  const inclusions = entries.filter(([, v]) => v !== 0 && v !== false);

  return docs.map((doc) => {
    if (exclusions.length && inclusions.every(([k]) => k === '_id')) {
      const out = deepClone(doc);
      for (const [field] of exclusions) {
        const segments = field.split('.');
        let cursor = out;
        for (let i = 0; i < segments.length - 1; i += 1) cursor = cursor?.[segments[i]];
        if (cursor) delete cursor[segments[segments.length - 1]];
      }
      return out;
    }
    const out = {};
    const idExcluded = exclusions.some(([k]) => k === '_id');
    if (!idExcluded && doc._id !== undefined) out._id = doc._id;
    for (const [field, expr] of inclusions) {
      if (field === '_id') {
        if (expr) out._id = doc._id;
        continue;
      }
      const value = expr === 1 || expr === true ? getPath(doc, field) : evalExpression(expr, doc);
      if (value !== undefined) setPath(out, field, value);
    }
    return out;
  });
}

function stageAddFields(docs, spec) {
  return docs.map((doc) => {
    const out = deepClone(doc);
    for (const [field, expr] of Object.entries(spec)) setPath(out, field, evalExpression(expr, out));
    return out;
  });
}

function stageUnwind(docs, spec) {
  const path = typeof spec === 'string' ? spec : spec.path;
  const preserveNull = typeof spec === 'object' && Boolean(spec.preserveNullAndEmptyArrays);
  const includeIndex = typeof spec === 'object' ? spec.includeArrayIndex : null;
  const field = path.startsWith('$') ? path.slice(1) : path;
  const out = [];

  for (const doc of docs) {
    const value = getPath(doc, field);
    if (Array.isArray(value)) {
      if (!value.length && preserveNull) out.push(deepClone(doc));
      value.forEach((element, index) => {
        const copy = deepClone(doc);
        setPath(copy, field, element);
        if (includeIndex) copy[includeIndex] = index;
        out.push(copy);
      });
    } else if (value === null || value === undefined) {
      if (preserveNull) out.push(deepClone(doc));
    } else {
      out.push(deepClone(doc));
    }
  }
  return out;
}

function stageLookup() {
  throw new UnsupportedQueryError('$lookup (denormalise the data or use two queries instead)');
}

const STAGES = {
  $match: stageMatch,
  $group: stageGroup,
  $sort: stageSort,
  $project: stageProject,
  $addFields: stageAddFields,
  $set: stageAddFields,
  $unwind: stageUnwind,
  $lookup: stageLookup,
  $limit: (docs, spec) => docs.slice(0, Math.max(0, Number(spec))),
  $skip: (docs, spec) => docs.slice(Math.max(0, Number(spec))),
  $count: (docs, spec) => [{ [spec]: docs.length }],
  $sortByCount: (docs, spec) => stageSort(stageGroup(docs, { _id: spec, count: { $sum: 1 } }), { count: -1 }),
  $replaceRoot: (docs, spec) => docs.map((doc) => evalExpression(spec.newRoot, doc)),
  $sample: (docs, spec) => [...docs].sort(() => Math.random() - 0.5).slice(0, Number(spec.size ?? docs.length)),
};

/**
 * Run a pipeline.
 *
 * @param {object[]} docs  input collection snapshot
 * @param {object[]} pipeline
 * @returns {object[]}
 */
export function runAggregation(docs, pipeline) {
  if (!Array.isArray(pipeline)) throw new UnsupportedQueryError('aggregate expects a pipeline array');
  let cursor = docs.map(deepClone);

  for (const stage of pipeline) {
    const [name] = Object.keys(stage ?? {});
    const handler = STAGES[name];
    if (!handler) throw new UnsupportedQueryError(`aggregation stage ${name}`);
    cursor = handler(cursor, stage[name]);
  }
  return cursor;
}
