import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../../db/index.js';
import { partRequestTargets, partRequests, units } from '../../db/schema.js';
import { snappedKmBetweenSql } from '../discovery/distance.js';
import { centroidSql } from '../listings/listing-validate.service.js';
import { notify } from '../notifications/notify.js';
import { getSettings } from '../settings.service.js';
import { backfillAtPost } from './auto-match.js';
import { eligibleSellerSql } from './eligibility.js';
import { lockPartRequest, type PartRequestRow } from './locks.js';
import {
  conditionAcceptsSql,
  listingHasFitmentsSql,
  listingHasMachineBrandSql,
  machineFitOverlapSql,
  nameSimilaritySql,
  partFitOverlapSql,
  partNumberBaseHitSql,
  partNumberNormHitSql,
  reachSql,
  sideAcceptsSql,
} from './match-rule.js';
import { allowSellerPushes } from './push-caps.js';
import { maskedRequestName } from './reply-views.js';

// Seller targeting (spec §7.2, §7.3, R7; plan A2-2; ports textile `services/requirements/matching.ts` scoring and the
// notified set). One SQL statement scores every eligible seller; the pass adds the newcomers of the top N to
// `part_request_targets` (never re-notifying anyone) and tells them with `part_request_new`, subject to the seller's
// daily push cap.

/**
 * Targeting weights (§7.2): code constants, like F4's `MATCH_WEIGHTS` (a wrong tune would silently break reach).
 * Distance: `distance × max(0, 1 − d / D)` with D per reach (`distanceKm`), `distanceUrgent` when the request is urgent.
 */
export const TARGET_WEIGHTS = {
  partNumber: 40,
  partNumberBase: 30,
  category: 15,
  categoryProfileOnly: 5,
  name: 15,
  nameFloor: 0.3,
  fit: 12,
  fitNoListingRows: 3,
  side: 8,
  condition: 5,
  quantity: 5,
  quantityOtherUnit: 2.5,
  distance: 10,
  distanceUrgent: 20,
  distanceKm: { radius_50: 50, radius_200: 200, state: 500, all_india: 2000 },
  verified: 5,
} as const;

const W = TARGET_WEIGHTS;
const R = sql.raw('r');
const L = sql.raw('l');

/** `weight × max(0, 1 − d / D)` from the request's point to `point` (snapped whole km); 0 when either point is unknown. */
function distancePartSql(point: SQL): SQL {
  const km = snappedKmBetweenSql(sql`r.point`, point);
  return sql`(CASE WHEN r.urgent THEN ${W.distanceUrgent} ELSE ${W.distance} END)::float8
    * COALESCE(GREATEST(0::float8, 1 - (${km})::float8 / (CASE r.reach
        WHEN 'radius_50' THEN ${W.distanceKm.radius_50}
        WHEN 'radius_200' THEN ${W.distanceKm.radius_200}
        WHEN 'state' THEN ${W.distanceKm.state}
        ELSE ${W.distanceKm.all_india} END)::float8), 0::float8)`;
}

/** A listing's score for the request (every term but verified; §7.2). */
const LISTING_SCORE = sql`(
  (CASE WHEN ${partNumberNormHitSql(R, L)} THEN ${W.partNumber}
        WHEN ${partNumberBaseHitSql(R, L)} THEN ${W.partNumberBase} ELSE 0 END)::float8
  + ${W.category}::float8
  + (CASE WHEN ${nameSimilaritySql(R, L)} >= ${W.nameFloor}::float8 THEN ${W.name}::float8 * ${nameSimilaritySql(R, L)} ELSE 0 END)::float8
  + (CASE
      WHEN NOT r.has_fits THEN ${W.fit}
      WHEN r.kind = 'part' THEN
        CASE WHEN ${partFitOverlapSql(R, L)} THEN ${W.fit} WHEN NOT ${listingHasFitmentsSql(L)} THEN ${W.fitNoListingRows} ELSE 0 END
      ELSE
        CASE WHEN ${machineFitOverlapSql(R, L)} THEN ${W.fit} WHEN NOT ${listingHasMachineBrandSql(L)} THEN ${W.fitNoListingRows} ELSE 0 END
    END)::float8
  + (CASE WHEN ${sideAcceptsSql(R, L)} THEN ${W.side} ELSE 0 END)::float8
  + (CASE WHEN ${conditionAcceptsSql(R, L)} THEN ${W.condition} ELSE 0 END)::float8
  + (CASE
      WHEN l.unit_id IS DISTINCT FROM r.unit_id THEN ${W.quantityOtherUnit}::float8
      WHEN (COALESCE(l.quantity, 0) - l.held_quantity) >= r.quantity THEN ${W.quantity}::float8
      ELSE ${W.quantity}::float8 * GREATEST(0, COALESCE(l.quantity, 0) - l.held_quantity)::float8 / r.quantity::float8
    END)
  + ${distancePartSql(sql`l.search_point`)}
)`;

/** A row of `topCandidatesSql`. */
export type TargetCandidate = {
  business_id: string;
  score: string;
  best_listing_id: string | null;
  /** The business already has a target row on the request. */
  targeted: boolean;
};

/**
 * The top `n` sellers for the request (§7.3), one statement:
 * - `cands`: every eligible seller (§6) except those who marked it Not relevant — **already-targeted sellers included**,
 *   so the top N is the same set whatever was targeted before;
 * - `ls`: their live listings of the kind in the request's subtree with a listing score; `best` the best per business;
 * - a seller without one (profile category only) scores category 5 + distance from its business point;
 * - + verified 5;
 * - reach gate on the distance point (best listing's `search_point`, else the business pin / pincode centroid) and the
 *   matching state;
 * - ordered by score, verified, nearer, the older business, business id (deterministic).
 */
export function topCandidatesSql(request: PartRequestRow, n: number): SQL {
  return sql`
    WITH r AS (
      SELECT pr.*, rc.path AS cat_path,
        EXISTS (SELECT 1 FROM part_request_fitments f WHERE f.part_request_id = pr.id) AS has_fits
      FROM part_requests pr JOIN categories rc ON rc.id = pr.category_id
      WHERE pr.id = ${request.id}::uuid
    ),
    cands AS (
      SELECT b.id, b.created_at, b.state, (b.verification_levels ? 'gst') AS verified,
        COALESCE(b.location, ${centroidSql(sql`b.pincode`)}) AS bpoint,
        EXISTS (
          SELECT 1 FROM part_request_targets t WHERE t.part_request_id = part_requests.id AND t.business_id = b.id
        ) AS targeted
      FROM part_requests CROSS JOIN businesses b
      WHERE part_requests.id = ${request.id}::uuid
        AND ${eligibleSellerSql(sql`b.id`)}
        AND NOT EXISTS (
          SELECT 1 FROM part_request_feedback fb WHERE fb.part_request_id = part_requests.id AND fb.business_id = b.id
        )
    ),
    ls AS (
      SELECT l.id, l.business_id, l.search_point, l.state, ${LISTING_SCORE} AS lscore
      FROM listings l
      JOIN categories lc ON lc.id = l.category_id
      CROSS JOIN r
      WHERE l.business_id IN (SELECT id FROM cands)
        AND l.status = 'live'
        AND l.kind::text = r.kind::text
        AND (lc.path = r.cat_path OR lc.path LIKE r.cat_path || '/%')
    ),
    best AS (
      SELECT DISTINCT ON (business_id) id, business_id, search_point, state, lscore
      FROM ls ORDER BY business_id, lscore DESC, id
    ),
    scored AS (
      SELECT c.id AS business_id, c.created_at, c.verified, c.targeted, bl.id AS best_listing_id,
        CASE WHEN bl.id IS NULL THEN c.bpoint ELSE COALESCE(bl.search_point, c.bpoint) END AS dpoint,
        CASE WHEN bl.id IS NULL THEN c.state ELSE bl.state END AS dstate,
        COALESCE(bl.lscore, ${W.categoryProfileOnly}::float8 + ${distancePartSql(sql`c.bpoint`)})
          + (CASE WHEN c.verified THEN ${W.verified} ELSE 0 END)::float8 AS score
      FROM cands c CROSS JOIN r
      LEFT JOIN best bl ON bl.business_id = c.id
    )
    SELECT s.business_id, round(s.score::numeric, 2)::text AS score, s.best_listing_id, s.targeted
    FROM scored s CROSS JOIN r
    WHERE ${reachSql(R, sql`s.dpoint`, sql`s.dstate`)}
    ORDER BY round(s.score::numeric, 2) DESC, s.verified DESC, ST_Distance(r.point, s.dpoint) ASC NULLS LAST,
      s.created_at ASC, s.business_id ASC
    LIMIT ${n}::int`;
}

/**
 * The `target_request` work (§7.3), under the request lock (`FOR NO KEY UPDATE`); a request no longer `active` is
 * skipped. Takes the top N (`part_request_reach_n`); the **newcomers** are those of the top N without a target row, in
 * rank order, capped so the stored set never exceeds 2N. Each is inserted (`ON CONFLICT DO NOTHING`, so running twice
 * notifies once) and told with `part_request_new` (dedupe `part_request_new:<id>`), pushed when under its daily cap.
 * Then `target_pass + 1`, `targeted_at`, and the at-post match backfill (§7.4). An edit whose top N is unchanged tells
 * nobody; a seller who dropped out of the top N keeps its row and is never told again.
 */
export async function processTargetRequest(tx: Tx, requestId: string): Promise<void> {
  const request = await lockPartRequest(tx, requestId, 'no_key_update');
  if (!request || request.status !== 'active') return;
  const settings = await getSettings(tx);
  const n = settings.part_request_reach_n;

  const { rows } = await tx.execute<TargetCandidate>(topCandidatesSql(request, n));
  const [existing] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(partRequestTargets)
    .where(eq(partRequestTargets.partRequestId, request.id));
  const slots = Math.max(0, 2 * n - Number(existing?.n ?? 0));
  const pass = request.targetPass + 1;
  const newcomers = rows
    .map((c, i) => ({ ...c, rank: i + 1 }))
    .filter((c) => !c.targeted)
    .slice(0, slots);

  if (newcomers.length > 0) {
    const inserted = await tx
      .insert(partRequestTargets)
      .values(
        newcomers.map((c) => ({
          partRequestId: request.id,
          businessId: c.business_id,
          score: c.score,
          rank: c.rank,
          pass,
          bestListingId: c.best_listing_id,
        })),
      )
      .onConflictDoNothing()
      .returning({ businessId: partRequestTargets.businessId });
    const insertedIds = new Set(inserted.map((r) => r.businessId));
    const pushed = await allowSellerPushes(tx, [...insertedIds], settings.part_request_seller_push_daily_cap);
    if (pushed.size > 0) {
      await tx
        .update(partRequestTargets)
        .set({ pushed: true })
        .where(and(eq(partRequestTargets.partRequestId, request.id), inArray(partRequestTargets.businessId, [...pushed])));
    }
    const [unit] = await tx.select({ label: units.label }).from(units).where(eq(units.id, request.unitId));
    const params = {
      requestTitle: maskedRequestName(request.name),
      side: request.side,
      quantity: request.quantity,
      unitLabel: unit?.label ?? '',
      city: request.city,
    };
    for (const c of newcomers) {
      if (!insertedIds.has(c.business_id)) continue;
      await notify(tx, {
        type: 'part_request_new',
        recipientBusinessId: c.business_id,
        params,
        destination: { partRequestId: request.id },
        dedupeKey: `part_request_new:${request.id}`,
        push: pushed.has(c.business_id),
      });
    }
  }

  await tx
    .update(partRequests)
    .set({ targetPass: pass, targetedAt: sql`now()` as unknown as Date })
    .where(eq(partRequests.id, request.id));
  await backfillAtPost(tx, request);
}
