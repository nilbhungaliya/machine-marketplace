import { normalizePartNumber } from '@mpm/shared-types';

// Search normalisation (F4 + F5 spec §5.1). `normalizeSearchText` is the TypeScript twin of the SQL function
// `mpm_normalize_search` (migration 0011): the same steps in the same order, so a query and the stored search text
// always meet. A test feeds both the same 40 strings.
//
// 1. NFKD, drop Latin combining marks only (U+0300–U+036F), NFC: Devanagari / Gujarati vowel signs, virama and nukta stay.
// 2. Delete ZWJ, ZWNJ and soft hyphen outright (some Indic keyboards insert them inside words; a space would split one).
// 3. Lower-case; Devanagari and Gujarati digits to ASCII.
// 4. Everything outside a–z, 0–9, U+0900–U+097F and U+0A80–U+0AFF becomes a space, the dandas (U+0964, U+0965) too;
//    spaces collapsed, trimmed.

const INDIC_DIGITS = '०१२३४५६७८९૦૧૨૩૪૫૬૭૮૯';
const ASCII_DIGITS = '01234567890123456789';
const INDIC_DIGIT_RE = /[०-९૦-૯]/g;
const LATIN_MARKS_RE = /[̀-ͯ]/g;
const INVISIBLE_RE = /[‌‍­]/g;
/** Not kept: everything outside a–z, 0–9, Devanagari without the dandas, Gujarati. */
const NOT_KEPT_RE = /[^a-z0-9ऀ-ॣ०-ॿ઀-૿]+/g;

export function normalizeSearchText(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .normalize('NFKD')
    .replace(LATIN_MARKS_RE, '')
    .normalize('NFC')
    .replace(INVISIBLE_RE, '')
    .toLowerCase()
    .replace(INDIC_DIGIT_RE, (d) => ASCII_DIGITS[INDIC_DIGITS.indexOf(d)]!)
    .replace(NOT_KEPT_RE, ' ')
    .trim();
}

/** The normalised words of a text. */
export function searchTokens(raw: string | null | undefined): string[] {
  const s = normalizeSearchText(raw);
  return s === '' ? [] : s.split(' ');
}

/** Characters (code points) in a word: Devanagari and Gujarati count per code point, as `pg_trgm` and `char_length` do. */
export function charLength(word: string): number {
  return [...word].length;
}

/**
 * The compact, lower-case form of a part number stored in the search text (§4.1): F2's `normalizePartNumber` (upper-case,
 * everything outside A–Z0–9 removed) lower-cased: "AB-123/X" → `ab123x`.
 */
export function compactPartNumber(raw: string | null | undefined): string {
  return raw ? normalizePartNumber(raw).toLowerCase() : '';
}
