import { and, eq, sql } from 'drizzle-orm';
import { PART_REQUEST_LIMITS, type PartRequestMatchTier } from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { partRequestMatches } from '../../db/schema.js';
import { snappedKmBetweenSql } from '../discovery/distance.js';
import type { ListingRow } from '../listings/locks.js';
import { upsertRequestNotification } from '../notifications/request-rows.js';
import { getSettings } from '../settings.service.js';
import { categoryAncestorIds } from './categories.js';
import { emitRequestUpdated } from './emit.js';
import type { PartRequestRow } from './locks.js';
import { matchRuleSql, matchTierSql, requestCandidateSql } from './match-rule.js';
import { IST_TODAY } from './push-caps.js';
import { maskedRequestName } from './reply-views.js';

// Auto matches (spec §7.4, §7.5, R8; plan A2-3; ports textile `services/alerts/{alerts.consumer,alert-rows}.ts`): a
// listing that goes live is matched against active requests under the strict rule; each new match tells the buyer
// through the grouped `part_match` row, within the request's push caps. The at-post backfill stores the best current
// listings without telling anyone.

const L = sql.raw('l');
const R = sql.raw('r');

/** A match row this run inserted. */
export interface NewMatch {
  partRequestId: string;
  tier: PartRequestMatchTier;
  distanceKm: number | null;
}

/**
 * Inserts the listing's new matches (§7.4), **without a request lock**: one `INSERT … SELECT` over the 200 newest
 * candidate requests (active, same kind, node on the listing's path), `status = 'active'` re-checked by the statement,
 * the rule as `matchRuleSql(…, { requireLive: true })`, tier and snapped distance, `ON CONFLICT DO NOTHING`, so an
 * existing match is never returned again. The match's FK takes only `KEY SHARE` on the request, compatible with every
 * F8 request lock. Callers lock the returned requests afterwards and tell the buyers (`notifyNewMatch`).
 */
export async function insertNewMatches(tx: Tx, listing: ListingRow): Promise<NewMatch[]> {
  if ((listing.kind !== 'part' && listing.kind !== 'machine') || !listing.categoryId) return [];
  const ancestors = await categoryAncestorIds(tx, listing.categoryId);
  if (ancestors.length === 0) return [];
  const { rows } = await tx.execute<{ part_request_id: string; tier: PartRequestMatchTier; distance_km: number | null }>(sql`
    INSERT INTO part_request_matches (part_request_id, listing_id, seller_business_id, tier, distance_km, source)
    SELECT r.id, l.id, l.business_id, ${matchTierSql(R, L)}, ${snappedKmBetweenSql(sql`r.point`, sql`l.search_point`)},
      'listing_live'
    FROM (
      SELECT * FROM part_requests c
      WHERE ${requestCandidateSql(sql.raw('c'), listing.kind, ancestors)}
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT ${PART_REQUEST_LIMITS.matchCandidatesMax}
    ) r
    JOIN listings l ON l.id = ${listing.id}::uuid
    WHERE r.status = 'active' AND ${matchRuleSql(L, R, { requireLive: true })}
    ON CONFLICT DO NOTHING
    RETURNING part_request_id, tier, distance_km`);
  return rows
    .map((r) => ({
      partRequestId: r.part_request_id,
      tier: r.tier,
      distanceKm: r.distance_km === null ? null : Number(r.distance_km),
    }))
    .sort((a, b) => a.partRequestId.localeCompare(b.partRequestId));
}

/**
 * Tells the buyer about a match `insertNewMatches` just made (§7.5), with the request **already locked**
 * (`FOR NO KEY UPDATE`); nothing when it is no longer `active` (the match row stays). Push caps per request: the IST
 * day's count restarts on a new day; a push while the day's count is under `part_request_match_push_daily_cap` and the
 * total under `…_total_cap`, both counted in the same conditional update. Then the grouped `part_match` row (dedupe
 * `part_match:<requestId>:<listingId>`), whose version is bumped only when pushed, and `part_request:updated`.
 */
export async function notifyNewMatch(tx: Tx, request: PartRequestRow, listing: ListingRow, match: NewMatch): Promise<void> {
  if (request.status !== 'active') return;
  const settings = await getSettings(tx);
  const { rows } = await tx.execute(sql`
    UPDATE part_requests SET
      match_push_day = ${IST_TODAY},
      match_push_day_count = (CASE WHEN match_push_day IS DISTINCT FROM ${IST_TODAY} THEN 0 ELSE match_push_day_count END) + 1,
      match_push_total = match_push_total + 1
    WHERE id = ${request.id}::uuid
      AND (CASE WHEN match_push_day IS DISTINCT FROM ${IST_TODAY} THEN 0 ELSE match_push_day_count END)
          < ${settings.part_request_match_push_daily_cap}::int
      AND match_push_total < ${settings.part_request_match_push_total_cap}::int
    RETURNING id`);
  const push = rows.length > 0;
  if (push) {
    await tx
      .update(partRequestMatches)
      .set({ pushed: true })
      .where(and(eq(partRequestMatches.partRequestId, request.id), eq(partRequestMatches.listingId, listing.id)));
  }
  await upsertRequestNotification(tx, {
    type: 'part_match',
    partRequestId: request.id,
    recipientBusinessId: request.businessId,
    eventKey: `part_match:${request.id}:${listing.id}`,
    push,
    params: {
      requestTitle: maskedRequestName(request.name),
      side: request.side,
      listingTitle: listing.title,
      distanceKm: match.distanceKm,
    },
  });
  emitRequestUpdated(tx, request, 'match');
}

/**
 * The at-post backfill (§7.1, §7.4): up to 20 currently-live listings that match the request now and aren't matched
 * yet, nearest first, stored as `at_post` matches with no notification ("2 listings already match" on Posted). Runs at
 * the end of every targeting pass (post, a matching edit, renew from expired). Returns how many it inserted.
 */
export async function backfillAtPost(tx: Tx, request: PartRequestRow): Promise<number> {
  if (request.status !== 'active') return 0;
  const { rows } = await tx.execute(sql`
    INSERT INTO part_request_matches (part_request_id, listing_id, seller_business_id, tier, distance_km, source)
    SELECT r.id, l.id, l.business_id, ${matchTierSql(R, L)}, ${snappedKmBetweenSql(sql`r.point`, sql`l.search_point`)},
      'at_post'
    FROM part_requests r
    JOIN categories rc ON rc.id = r.category_id
    JOIN listings l ON l.kind::text = r.kind::text
    JOIN categories lc ON lc.id = l.category_id AND (lc.path = rc.path OR lc.path LIKE rc.path || '/%')
    WHERE r.id = ${request.id}::uuid AND r.status = 'active'
      AND ${matchRuleSql(L, R, { requireLive: true })}
      AND NOT EXISTS (SELECT 1 FROM part_request_matches em WHERE em.part_request_id = r.id AND em.listing_id = l.id)
    ORDER BY ST_Distance(r.point, l.search_point) ASC NULLS LAST, l.id
    LIMIT ${PART_REQUEST_LIMITS.backfillMax}
    ON CONFLICT DO NOTHING
    RETURNING listing_id`);
  return rows.length;
}
