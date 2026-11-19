import { sql, type SQL } from 'drizzle-orm';
import type { DiscoveryRadiusKm, SearchSide } from '@mpm/shared-types';
import { listings } from '../../db/schema.js';
import { snappedKmSql, type LatLng } from './distance.js';

// Ranking (F4 + F5 spec §5.5, §6.1). Every expression reads the `listings` table as named in the FROM clause; constants
// are here with tests (admin tuning is deferred, §15).

export const RELEVANCE_WEIGHTS = {
  freshness: 0.4,
  nearness: 0.3,
  photos: 0.1,
  gst: 0.1,
  completeness: 0.1,
} as const;
/** Freshness halves every 14 days from `refreshed_at` to the cursor's `asOf`. */
export const FRESHNESS_HALF_LIFE_DAYS = 14;
/** Nearness reaches 0 at `max(radius ?? 200, 50)` km. */
export const NEARNESS_ALL_INDIA_KM = 200;
export const NEARNESS_MIN_KM = 50;
/** Photos count with at least this many. */
export const PHOTOS_FOR_SCORE = 3;
/** `reserved` listings are ranked down (R7). */
export const RESERVED_FACTOR = 0.6;
/** Past this 0.5^x is effectively 0, and much further `power` underflows. */
const MAX_HALF_LIVES = 1000;

/**
 * Share of the template's required and recommended fields the listing filled; 1 when the template asks for none. The
 * catalogue has no "recommended" flag: a field with a card highlight rank counts as recommended. Template fields come
 * from the listing's node and its ancestors (path prefix), active, for the listing's kind (`applies_to`).
 */
function completenessSql(): SQL {
  return sql`COALESCE((
    SELECT avg(CASE
      WHEN ${listings.specs} -> f.key IS NULL OR ${listings.specs} -> f.key IN ('null'::jsonb, '""'::jsonb, '[]'::jsonb) THEN 0
      ELSE 1 END)::float8
    FROM template_fields f
    JOIN categories fc ON fc.id = f.category_id
    JOIN categories lc ON lc.id = ${listings.categoryId}
    WHERE (lc.path = fc.path OR lc.path LIKE fc.path || '/%')
      AND f.status = 'active'
      AND (f.required OR f.highlight_rank IS NOT NULL)
      AND f.applies_to::text IN ('both', CASE WHEN ${listings.kind} = 'part' THEN 'parts' ELSE 'machines' END)
  ), 1::float8)`;
}

/**
 * Relevance (§6.1): `0.40·0.5^(ageDays/14) + 0.30·nearness + 0.10·photos + 0.10·gst + 0.10·completeness`, × 0.6 for
 * `reserved`. `ageDays` runs from `refreshed_at` to `asOf` (the first page's time, carried by the cursor), never from
 * now, so scores don't move between pages. `nearness = max(0, 1 − km / max(radiusKm ?? 200, 50))`, 0 without an origin
 * or without a `search_point`.
 */
export function relevanceSql(opts: { asOf: Date; origin: LatLng | null; radiusKm: DiscoveryRadiusKm | number | null }): SQL<number> {
  const asOf = sql`${opts.asOf.toISOString()}::timestamptz`;
  const ageDays = sql`GREATEST(0::float8, EXTRACT(EPOCH FROM (${asOf} - ${listings.refreshedAt}))::float8 / 86400)`;
  // GREATEST ignores NULLs, so a listing never refreshed is caught first (public listings always have the time).
  const freshness = sql`(CASE WHEN ${listings.refreshedAt} IS NULL THEN 0::float8
    ELSE power(0.5::float8, LEAST(${ageDays} / ${FRESHNESS_HALF_LIFE_DAYS}::float8, ${MAX_HALF_LIVES}::float8)) END)`;
  const scaleKm = Math.max(opts.radiusKm ?? NEARNESS_ALL_INDIA_KM, NEARNESS_MIN_KM);
  const nearness = opts.origin
    ? sql`COALESCE(GREATEST(0::float8, 1 - ${snappedKmSql(listings.searchPoint, opts.origin)}::float8 / ${scaleKm}::float8), 0::float8)`
    : sql`0::float8`;
  const photos = sql`(CASE WHEN (SELECT count(*) FROM listing_media m WHERE m.listing_id = ${listings.id} AND m.type = 'photo') >= ${PHOTOS_FOR_SCORE} THEN 1 ELSE 0 END)::float8`;
  const gst = sql`(CASE WHEN EXISTS (SELECT 1 FROM businesses gb WHERE gb.id = ${listings.businessId} AND gb.verification_levels ? 'gst') THEN 1 ELSE 0 END)::float8`;
  const w = RELEVANCE_WEIGHTS;
  return sql<number>`((
    ${w.freshness}::float8 * ${freshness}
    + ${w.nearness}::float8 * ${nearness}
    + ${w.photos}::float8 * ${photos}
    + ${w.gst}::float8 * ${gst}
    + ${w.completeness}::float8 * ${completenessSql()}
  ) * (CASE WHEN ${listings.status} = 'reserved' THEN ${RESERVED_FACTOR}::float8 ELSE 1::float8 END))::float8`;
}

/**
 * The tier every sort orders by first, DESC (§5.5): `sideTier · 2 + rentTier`. `sideTier` is 1 for the exact side and
 * 0 for a Pair shown under Left / Right (1 for everything without a side filter); `rentTier` is 0 for a rented rental,
 * else 1. So under Left every Left comes before every Pair, and every available rental before every rented one.
 */
export function tierSql(opts: { side: SearchSide | null | undefined }): SQL<number> {
  const sideTier = opts.side ? sql`(CASE WHEN ${listings.side} = ${opts.side} THEN 1 ELSE 0 END)` : sql`1`;
  const rentTier = sql`(CASE WHEN ${listings.status} = 'rented' AND ${listings.kind} = 'machine_rental' THEN 0 ELSE 1 END)`;
  return sql<number>`(${sideTier} * 2 + ${rentTier})::int`;
}
