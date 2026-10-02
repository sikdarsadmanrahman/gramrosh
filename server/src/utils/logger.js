/**
 * -----------------------------------------------------------------------------
 *  logger.js — Dependency-free structured logger
 * -----------------------------------------------------------------------------
 *  Emits JSON in production (so CloudWatch / Loki / Datadog can ingest it) and
 *  pretty colourised lines in development. Deliberately tiny: pulling in pino
 *  or winston for this scale is unnecessary weight.
 * -----------------------------------------------------------------------------
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

const COLORS = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m', reset: '\x1b[0m' };

const NODE_ENV = process.env.NODE_ENV ?? 'development';
const isProduction = NODE_ENV === 'production';
const threshold = LEVELS[(process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug')).toLowerCase()] ?? LEVELS.info;

/** Redact secrets before anything reaches stdout. */
const SENSITIVE_KEYS = ['password', 'token', 'secret', 'authorization', 'cookie', 'apikey', 'api_key', 'trxid'];

function redact(value, depth = 0) {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = SENSITIVE_KEYS.includes(key.toLowerCase()) ? '[redacted]' : redact(val, depth + 1);
  }
  return out;
}

function emit(level, message, meta) {
  if (LEVELS[level] < threshold) return;
  const entry = { level, message, ...(meta ? redact(meta) : {}), time: new Date().toISOString() };

  if (isProduction) {
    // One JSON document per line — machine parseable.
    const line = JSON.stringify(entry);
    if (level === 'error') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
    return;
  }

  const color = COLORS[level] ?? '';
  const stamp = entry.time.slice(11, 23);
  const tail = meta ? ` ${JSON.stringify(redact(meta))}` : '';
  const line = `${color}${stamp} ${level.toUpperCase().padEnd(5)}${COLORS.reset} ${message}${tail}\n`;
  if (level === 'error') process.stderr.write(line);
  else process.stdout.write(line);
}

export const logger = {
  debug: (msg, meta) => emit('debug', msg, meta),
  info: (msg, meta) => emit('info', msg, meta),
  warn: (msg, meta) => emit('warn', msg, meta),
  error: (msg, meta) => emit('error', msg, meta),
  /** Wrap a child context, e.g. `logger.child({ scope: 'db' })`. */
  child(base) {
    return {
      debug: (msg, meta) => emit('debug', msg, { ...base, ...meta }),
      info: (msg, meta) => emit('info', msg, { ...base, ...meta }),
      warn: (msg, meta) => emit('warn', msg, { ...base, ...meta }),
      error: (msg, meta) => emit('error', msg, { ...base, ...meta }),
    };
  },
};

export default logger;
