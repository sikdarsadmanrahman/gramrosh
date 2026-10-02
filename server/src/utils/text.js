/**
 * -----------------------------------------------------------------------------
 *  text.js — Search normalisation & safe regular expressions
 * -----------------------------------------------------------------------------
 *  The storefront search box must be forgiving: case-insensitive, tolerant of
 *  extra whitespace, and immune to ReDoS (a user typing `(((((` must not build a
 *  catastrophic regex that pins the Node process at 100% CPU).
 * -----------------------------------------------------------------------------
 */

/** Escape every regex metacharacter so user input can be embedded in a RegExp. */
export function escapeRegex(input = '') {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Collapse whitespace and trim — used before building search filters. */
export function normalizeWhitespace(input = '') {
  return String(input).replace(/\s+/g, ' ').trim();
}

/** Strip zero-width characters & bidi marks that break matching on pasted text. */
export function stripInvisibles(input = '') {
  // eslint-disable-next-line no-misleading-character-class
  return String(input).replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '');
}

/**
 * Full normalisation pipeline applied to every incoming search term.
 * @returns {string}
 */
export function normalizeSearchTerm(input = '') {
  return normalizeWhitespace(stripInvisibles(input)).slice(0, 120);
}

/**
 * Build a *prefix* regex — matches "hon" → "honey", "Honeycomb".
 * Prefix matching (as opposed to a leading wildcard) can still use a B-tree
 * index, which is why it is the default for the fast "as you type" box.
 *
 * @param {string} term
 * @returns {RegExp|null} null when the term is empty (caller should skip filtering)
 */
export function prefixRegex(term) {
  const value = normalizeSearchTerm(term);
  if (!value) return null;
  return new RegExp(`^${escapeRegex(value)}`, 'i');
}

/**
 * Build a *contains* regex for the "deep" search (matches anywhere in the
 * string). More recall, no index support — used only past the debounce.
 */
export function containsRegex(term) {
  const value = normalizeSearchTerm(term);
  if (!value) return null;
  return new RegExp(escapeRegex(value), 'i');
}

/**
 * Tokenise a search term so that "sundarban raw honey" matches documents that
 * contain all three words in any order (an `$and` of prefix regexes).
 *
 * @param {string} term
 * @param {{mode?: 'prefix'|'contains'}} [options]
 * @returns {RegExp[]}
 */
export function searchTokenRegexes(term, { mode = 'prefix' } = {}) {
  const value = normalizeSearchTerm(term);
  if (!value) return [];
  const build = mode === 'contains' ? containsRegex : prefixRegex;
  return value
    .split(' ')
    .filter(Boolean)
    .slice(0, 6)                       // cap tokens: keeps the query bounded
    .map(build)
    .filter(Boolean);
}

/**
 * Very small readability score used to rank search hits without an Atlas
 * Search node: exact title match > title starts-with > word match > description.
 *
 * @param {string} term
 * @param {{title?:string, summary?:string, description?:string, category?:string}} doc
 * @returns {number} higher is more relevant
 */
export function relevanceScore(term, doc = {}) {
  const needle = normalizeSearchTerm(term).toLowerCase();
  if (!needle) return 0;
  const title = String(doc.title ?? '').toLowerCase();
  const summary = String(doc.summary ?? '').toLowerCase();
  const description = String(doc.description ?? '').toLowerCase();
  const category = String(doc.category ?? '').toLowerCase();

  let score = 0;
  if (title === needle) score += 100;
  if (title.startsWith(needle)) score += 60;
  if (title.includes(needle)) score += 40;
  if (category.includes(needle)) score += 20;
  if (summary.includes(needle)) score += 10;
  if (description.includes(needle)) score += 5;
  return score;
}
