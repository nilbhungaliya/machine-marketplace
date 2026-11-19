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

/** `GET /discover/trending`: at most `top` queries, most searched first. */
export async function trending(db: Db, opts: { now?: Date; top?: number } = {}): Promise<string[]> {
  const L = DISCOVERY_LIMITS;
  const today = indiaDay(opts.now ?? new Date());
  const { rows } = await db.execute<{ normalized: string }>(sql`
    SELECT q.normalized
    FROM search_queries q
    WHERE q.day > ${today}::date - ${L.trendingWindowDays}::int AND q.day <= ${today}::date
      AND q.result_total > 0
      AND NOT EXISTS (SELECT 1 FROM search_trending_hidden h WHERE h.normalized = q.normalized)
    GROUP BY q.normalized
    HAVING count(DISTINCT q.day) >= ${L.trendingMinDays} AND count(*) >= ${L.trendingMinSearches}
    ORDER BY count(*) DESC, q.normalized
    LIMIT ${opts.top ?? L.trendingTop}`);
  return rows.map((r) => r.normalized);
}
