import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { partNumberBase, type SearchSide } from '@mpm/shared-types';
import { listings } from '../../db/schema.js';
import { charLength } from './normalize.js';

// Text matching (F4 + F5 spec §5.4, §5.5, §5.6, R1). Every hit is written in a form the indexes serve:
// - a word of 3+ characters: `search_text LIKE '%w%'` on the column itself (`listings_search_text_trgm_idx`), and for
//   5+ characters without a digit also `w <% search_text` (typos) at the threshold the search transaction sets;
// - a word of 1–2 characters: a whole-word match (not indexed; rare once side words are read);
// - a part number: `part_number_norm = N` / `part_number_base = B` (btree) or the compact form in the search text.
// Normalised words hold only a–z, 0–9 and Indic letters, so they never contain a LIKE wildcard.

/** Words this long or longer (in characters) use the trigram index; shorter ones match whole words. */
export const MIN_INDEXED_WORD = 3;
/** Words this long or longer without a digit also match typos (`<%`). */
export const MIN_TYPO_WORD = 5;
/** A side-stripped part-number base shorter than this is never matched (F2 §4.3). */
const MIN_BASE = 3;

/** Match weights (§5.5): substring hit in the title 4, elsewhere 2; a typo hit half; part number 20, its base 12. */
export const MATCH_WEIGHTS = { title: 4, text: 2, typoTitle: 2, typoText: 1, partNumber: 20, partNumberBase: 12 } as const;

export interface MatchTerms {
  words: string[];
  /** Normalised part numbers (F2's `normalizePartNumber`). */
  partNumbers: string[];
  /** The side in play: picks the side-stripped base of a typed part number. */
  side: SearchSide | null;
}

/** A constant inlined into the SQL text (weights are code, never input). */
const lit = (n: number): SQL => sql.raw(String(n));

const typoAllowed = (w: string) => charLength(w) >= MIN_TYPO_WORD && !/\d/.test(w);

function substring(w: string, column: AnyColumn): SQL {
  if (charLength(w) < MIN_INDEXED_WORD) return sql`((' ' || ${column} || ' ') LIKE ${`% ${w} %`})`;
  return sql`(${column} LIKE ${`%${w}%`})`;
}

/** A word hits the listing (anywhere in its search text, typos included). */
export function wordHitSql(w: string): SQL {
  const hit = substring(w, listings.searchText);
  return typoAllowed(w) ? sql`(${hit} OR ${w}::text <% ${listings.searchText})` : hit;
}

/** A word hits the listing's title text (title, part number, part brand, category names). */
export function wordTitleHitSql(w: string): SQL {
  const hit = substring(w, listings.searchTitleText);
  return typoAllowed(w) ? sql`(${hit} OR ${w}::text <% ${listings.searchTitleText})` : hit;
}

/** A word's best hit: title 4, elsewhere 2, typo in the title 2, typo elsewhere 1, else 0. */
export function wordScoreSql(w: string): SQL<number> {
  const W = MATCH_WEIGHTS;
  const typo = typoAllowed(w)
    ? sql` WHEN ${w}::text <% ${listings.searchTitleText} THEN ${lit(W.typoTitle)} WHEN ${w}::text <% ${listings.searchText} THEN ${lit(W.typoText)}`
    : sql``;
  return sql<number>`(CASE WHEN ${substring(w, listings.searchTitleText)} THEN ${lit(W.title)} WHEN ${substring(w, listings.searchText)} THEN ${lit(W.text)}${typo} ELSE 0 END)`;
}

/** The base of a typed part number for the side in play (Left strips L / LH / LEFT …); the number itself otherwise. */
function baseOf(pn: string, side: SearchSide | null): string {
  return side === 'left' || side === 'right' ? partNumberBase(pn, side) : pn;
}

/** A part number hits: exact normalised number, side-stripped base, or the compact form stored in the search text. */
export function partNumberHitSql(pn: string, side: SearchSide | null): SQL {
  const base = baseOf(pn, side);
  const baseHit = base.length >= MIN_BASE ? sql` OR ${listings.partNumberBase} = ${base}` : sql``;
  return sql`(${listings.partNumberNorm} = ${pn}${baseHit} OR ${listings.searchText} LIKE ${`%${pn.toLowerCase()}%`})`;
}

/** A part number's score: exact 20, base 12, compact form in the title 4, elsewhere 2. */
export function partNumberScoreSql(pn: string, side: SearchSide | null): SQL<number> {
  const W = MATCH_WEIGHTS;
  const base = baseOf(pn, side);
  const baseHit = base.length >= MIN_BASE ? sql` WHEN ${listings.partNumberBase} = ${base} THEN ${lit(W.partNumberBase)}` : sql``;
  const lower = `%${pn.toLowerCase()}%`;
  return sql<number>`(CASE WHEN ${listings.partNumberNorm} = ${pn} THEN ${lit(W.partNumber)}${baseHit}
    WHEN ${listings.searchTitleText} LIKE ${lower} THEN ${lit(W.title)} WHEN ${listings.searchText} LIKE ${lower} THEN ${lit(W.text)} ELSE 0 END)`;
}

/** Full match (§5.6 step 1): every word and every part number hits. Null when there is nothing to match. */
export function fullMatchSql(m: MatchTerms): SQL | null {
  const parts = [...m.words.map(wordHitSql), ...m.partNumbers.map((pn) => partNumberHitSql(pn, m.side))];
  return parts.length ? sql.join(parts, sql` AND `) : null;
}

/**
 * Partial match (§5.6 step 2), only with 2+ words: at least ceil(n/2) words hit, at least one of them in the title text,
 * and every part number still hits (a part number is exact; only words relax). The OR of the word hits comes first so
 * the trigram index serves it.
 */
export function partialMatchSql(m: MatchTerms): SQL | null {
  if (m.words.length < 2) return null;
  const need = Math.ceil(m.words.length / 2);
  const anyHit = sql.join(m.words.map(wordHitSql), sql` OR `);
  const count = sql.join(
    m.words.map((w) => sql`(CASE WHEN ${wordHitSql(w)} THEN 1 ELSE 0 END)`),
    sql` + `,
  );
  const anyTitle = sql.join(m.words.map(wordTitleHitSql), sql` OR `);
  const pns = m.partNumbers.map((pn) => partNumberHitSql(pn, m.side));
  return sql.join([sql`(${anyHit})`, sql`(${count}) >= ${need}`, sql`(${anyTitle})`, ...pns], sql` AND `);
}

/** Σ of the words' and part numbers' scores (§5.5); chips filter, so they add nothing. */
export function matchScoreSql(m: MatchTerms): SQL<number> {
  const parts = [...m.words.map(wordScoreSql), ...m.partNumbers.map((pn) => partNumberScoreSql(pn, m.side))];
  return parts.length ? sql<number>`(${sql.join(parts, sql` + `)})` : sql<number>`0`;
}
