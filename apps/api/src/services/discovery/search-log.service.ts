import { sql } from 'drizzle-orm';
import { DISCOVERY_LIMITS, type ListingKind } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { IST_TODAY } from '../../lib/ist.js';

// The anonymous search log (F4 + F5 spec §5.13, R14): normalised query, how many words, result total, kind, the IST day.
// No user, device, IP or location. Written once per search (first page, words or part numbers only; never count-only
// or suggest). A query that looks like personal data is never written: the check runs on the RAW input, lower-cased
// but not normalised (the normaliser turns `@` and `+` into spaces).

type Conn = Db | Tx;

const INDIA_TODAY = IST_TODAY;
const GSTIN_RE = /\d{2}[a-z]{5}\d{4}[a-z][a-z\d]z[a-z\d]/;
const PAN_RE = /[a-z]{5}\d{4}[a-z]/;
/** Maximal digit runs: digits not touching another digit. */
const RUN_RE = /(?<!\d)\d+(?!\d)/g;

function personalRun(run: string): boolean {
  if (run.length === 10 && /^[6-9]/.test(run)) return true; // mobile
  if (run.length === 11 && /^0[6-9]/.test(run)) return true; // mobile with a 0 prefix
  if (run.length === 12) return true; // Aadhaar (also a mobile with 91)
  return false;
}

/**
 * Whether a raw query looks like personal data (§5.13): an Indian mobile number (a 10-digit run starting 6–9, optionally
 * with 0, 91 or +91), a 12-digit run (Aadhaar), `@` (email), a GSTIN or a PAN. A run is a maximal run of digits, read
 * after removing spaces and dashes between digits ("+91 98765 43210"); the runs as typed are checked too, so a mobile
 * number typed next to another number is still caught. Other long numbers (numeric part numbers) are not personal.
 */
export function isPersonalQuery(raw: string): boolean {
  const s = raw.toLowerCase();
  if (s.includes('@')) return true;
  if (GSTIN_RE.test(s) || PAN_RE.test(s)) return true;
  const joined = s.replace(/(?<=\d)[\s-]+(?=\d)/g, '');
  for (const text of [joined, s]) {
    for (const run of text.match(RUN_RE) ?? []) if (personalRun(run)) return true;
  }
  return false;
}

export interface SearchLogRow {
  /** The query as typed (checked for personal data). */
  raw: string;
  /** The normalised query (stored). */
  normalized: string;
  words: number;
  resultTotal: number;
  kind: ListingKind | null;
}

/** Writes one log row unless the query is empty or looks like personal data. Returns whether it wrote. */
export async function logSearch(conn: Conn, row: SearchLogRow): Promise<boolean> {
  if (row.normalized === '' || isPersonalQuery(row.raw)) return false;
  const normalized = [...row.normalized].slice(0, DISCOVERY_LIMITS.logQueryMaxLength).join('').trim();
  await conn.execute(sql`
    INSERT INTO search_queries (normalized, words, result_total, kind, day)
    VALUES (${normalized}, ${Math.min(row.words, 32_767)}, ${row.resultTotal}, ${row.kind}, ${INDIA_TODAY})`);
  return true;
}

/**
 * The `search-query-retention` job (§5.13): deletes rows older than 90 days in batches (`FOR UPDATE SKIP LOCKED`, so two
 * API processes never fight over a batch). Returns how many went.
 */
export async function deleteOldSearchQueries(db: Db, opts: { batchSize?: number } = {}): Promise<number> {
  const batch = opts.batchSize ?? 1_000;
  let total = 0;
  for (;;) {
    const result = await db.execute(sql`
      DELETE FROM search_queries WHERE id IN (
        SELECT id FROM search_queries
        WHERE day < ${INDIA_TODAY} - ${DISCOVERY_LIMITS.logRetentionDays}::int
        ORDER BY id LIMIT ${batch}
        FOR UPDATE SKIP LOCKED)`);
    const n = result.rowCount ?? 0;
    total += n;
    if (n < batch) break;
  }
  return total;
}
