/**
 * -----------------------------------------------------------------------------
 *  slugify.js — URL-safe slugs (SEO friendly product & category URLs)
 * -----------------------------------------------------------------------------
 *  Bengali characters are *preserved* (they are valid in URLs and far better for
 *  Bangladeshi SEO); Latin characters are lower-cased and anything that is not a
 *  letter, digit or Bengali codepoint becomes a hyphen.
 * -----------------------------------------------------------------------------
 */

/** Unicode range covering Bengali script (U+0980 – U+09FF). */
const BENGALI = '\\u0980-\\u09FF';

/**
 * @param {string} input
 * @param {{maxLength?:number}} [options]
 * @returns {string}
 */
export function slugify(input, { maxLength = 90 } = {}) {
  if (!input) return '';
  return String(input)
    .normalize('NFKC')
    .toLowerCase()
    // Keep letters (incl. Bengali), digits; turn everything else into a space.
    .replace(new RegExp(`[^a-z0-9${BENGALI}\\s-]`, 'g'), '')
    .trim()
    .replace(/[\s_-]+/g, '-')   // collapse separators
    .replace(/^-+|-+$/g, '')    // trim leading/trailing hyphens
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

/**
 * Produce a slug guaranteed to be unique against a lookup function.
 * Appends `-2`, `-3`, … when the base slug is already taken.
 *
 * @param {string} input
 * @param {(slug:string)=>Promise<boolean>} exists async predicate
 * @param {string} [ignoreId] id of the document being updated (excluded from the check)
 */
export async function uniqueSlug(input, exists, ignoreId) {
  const base = slugify(input) || `item-${Date.now().toString(36)}`;
  let candidate = base;
  let suffix = 1;
  // Bounded loop: a catalogue will never realistically need more than this.
  while (suffix < 1000 && (await exists(candidate, ignoreId))) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}

export default slugify;
