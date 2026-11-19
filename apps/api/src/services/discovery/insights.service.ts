import { eq, sql } from 'drizzle-orm';
import { DISCOVERY_LIMITS, type TrendingHiddenResult, type TrendingRow, type ZeroResultRow } from '@mpm/shared-types';
import type { Db } from '../../db/index.js';
import { searchTrendingHidden } from '../../db/schema.js';
import { ValidationError } from '../../lib/errors.js';
import { writeAudit } from '../audit.service.js';
import { normalizeSearchText } from './normalize.js';
import { indiaDay, trendingRows } from './trending.service.js';

// Search insights for the category manager (F4 + F5 spec §5.12, §5.13, §7.1, §9): the searches that found nothing, and
// trending with Hide / Unhide (audit-logged as `search_trending.hide / unhide`). Days are India days.

/** `GET /admin/search/zero-results`: top 50 normalised queries of the last 30 days that found nothing. */
export async function zeroResults(db: Db, opts: { now?: Date } = {}): Promise<ZeroResultRow[]> {
  const L = DISCOVERY_LIMITS;
  const today = indiaDay(opts.now ?? new Date());
  const { rows } = await db.execute<{ normalized: string; searches: number; last_day: string }>(sql`
    SELECT normalized, count(*)::int AS searches, max(day)::text AS last_day
    FROM search_queries
    WHERE result_total = 0 AND day > ${today}::date - ${L.zeroResultsWindowDays}::int AND day <= ${today}::date
    GROUP BY normalized
    ORDER BY count(*) DESC, max(day) DESC, normalized
    LIMIT ${L.zeroResultsTop}`);
  return rows.map((r) => ({ normalized: r.normalized, searches: Number(r.searches), lastDay: r.last_day }));
}

/** `GET /admin/search/trending`: top 20 of 7 days by the public thresholds, hidden ones included and marked. */
export async function adminTrending(db: Db, opts: { now?: Date } = {}): Promise<TrendingRow[]> {
  return trendingRows(db, { now: opts.now, top: DISCOVERY_LIMITS.adminTrendingTop, includeHidden: true });
}

/** The stored form of a query named in a URL: normalised, at most 200 characters; empty is a 400. */
function trendingKey(raw: string): string {
  const normalized = [...normalizeSearchText(raw)].slice(0, DISCOVERY_LIMITS.logQueryMaxLength).join('').trim();
  if (!normalized) throw new ValidationError('Name a search');
  return normalized;
}

/** `PUT /admin/search/trending-hidden/:normalized`: idempotent; audited when it changes something. */
export async function hideTrending(db: Db, adminId: string, raw: string): Promise<TrendingHiddenResult> {
  const normalized = trendingKey(raw);
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(searchTrendingHidden)
      .values({ normalized, createdBy: adminId })
      .onConflictDoNothing()
      .returning({ normalized: searchTrendingHidden.normalized });
    if (inserted.length) {
      await writeAudit(tx, {
        adminId, action: 'search_trending.hide', entityType: 'search_trending', entityId: normalized,
        before: { hidden: false }, after: { hidden: true },
      });
    }
  });
  return { normalized, hidden: true };
}

/** `DELETE /admin/search/trending-hidden/:normalized`: idempotent; audited when it changes something. */
export async function unhideTrending(db: Db, adminId: string, raw: string): Promise<TrendingHiddenResult> {
  const normalized = trendingKey(raw);
  await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(searchTrendingHidden)
      .where(eq(searchTrendingHidden.normalized, normalized))
      .returning({ normalized: searchTrendingHidden.normalized });
    if (deleted.length) {
      await writeAudit(tx, {
        adminId, action: 'search_trending.unhide', entityType: 'search_trending', entityId: normalized,
        before: { hidden: true }, after: { hidden: false },
      });
    }
  });
  return { normalized, hidden: false };
}
