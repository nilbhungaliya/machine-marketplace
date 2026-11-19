import { sql } from 'drizzle-orm';
import { DISCOVERY_LIMITS } from '@mpm/shared-types';
import type { Db } from '../../db/index.js';

// Trending (F4 + F5 spec §5.12): the top normalised queries of the last 7 days (IST) that found something, searched on
// at least 3 distinct days and at least 5 times, minus what the category manager hid.

const IST_OFFSET_MS = 5.5 * 3_600_000;

/** The India calendar day of a moment, as `YYYY-MM-DD`. */
export function indiaDay(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Trending rows (§5.12): the window, the thresholds and the order shared by the public list and the admin's. */
export async function trendingRows(
  db: Db,
  opts: { now?: Date; top: number; includeHidden: boolean },
): Promise<Array<{ normalized: string; searches: number; days: number; hidden: boolean }>> {
  const L = DISCOVERY_LIMITS;
  const today = indiaDay(opts.now ?? new Date());
  const hidden = sql`EXISTS (SELECT 1 FROM search_trending_hidden h WHERE h.normalized = q.normalized)`;
  const { rows } = await db.execute<{ normalized: string; searches: number; days: number; hidden: boolean }>(sql`
    SELECT q.normalized, count(*)::int AS searches, count(DISTINCT q.day)::int AS days, ${hidden} AS hidden
    FROM search_queries q
    WHERE q.day > ${today}::date - ${L.trendingWindowDays}::int AND q.day <= ${today}::date
      AND q.result_total > 0
      ${opts.includeHidden ? sql`` : sql`AND NOT ${hidden}`}
    GROUP BY q.normalized
    HAVING count(DISTINCT q.day) >= ${L.trendingMinDays} AND count(*) >= ${L.trendingMinSearches}
    ORDER BY count(*) DESC, q.normalized
    LIMIT ${opts.top}`);
  return rows.map((r) => ({ normalized: r.normalized, searches: Number(r.searches), days: Number(r.days), hidden: Boolean(r.hidden) }));
}

/** `GET /discover/trending`: at most `top` queries, most searched first, hidden ones left out. */
export async function trending(db: Db, opts: { now?: Date; top?: number } = {}): Promise<string[]> {
  const rows = await trendingRows(db, { now: opts.now, top: opts.top ?? DISCOVERY_LIMITS.trendingTop, includeHidden: false });
  return rows.map((r) => r.normalized);
}
