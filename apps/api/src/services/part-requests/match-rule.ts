import { sql, type SQL } from 'drizzle-orm';
import { PART_REQUEST_LIMITS, PART_REQUEST_REACH_KM } from '@mpm/shared-types';

// The SQL of F8 matching (spec §7.2 targeting terms, §7.4 the strict auto-match rule; textile
// `services/alerts/alerts.consumer.ts`). Every builder takes the **aliases** of a `listings` row (`l`) and a
// `part_requests` row (`r`) as SQL (`sql.raw('l')`, `sql.identifier('part_requests')`) and returns a boolean or a
// value over their columns, so targeting, auto matching, the at-post backfill and demand read one definition.

const MIN_NAME = PART_REQUEST_LIMITS.minNameSimilarity;
const R50 = PART_REQUEST_REACH_KM.radius_50 * 1000;
const R200 = PART_REQUEST_REACH_KM.radius_200 * 1000;

/** `requestSideAccepts` (shared-types) as SQL: Left ← Left / Pair; Right ← Right / Pair; Pair ← Pair; no side ← any. */
export function sideAcceptsSql(r: SQL, l: SQL): SQL {
  return sql`(
    ${r}.side IS NULL OR ${r}.side = 'not_applicable'
    OR (${r}.side = 'pair' AND ${l}.side = 'pair')
    OR (${r}.side IN ('left', 'right') AND (${l}.side = ${r}.side OR ${l}.side = 'pair'))
  )`;
}

/** Same normalised part number (40 in targeting) — three characters or more, else never a hit (F2 §4.3). */
export function partNumberNormHitSql(r: SQL, l: SQL): SQL {
  return sql`(length(${r}.part_number_norm) >= 3 AND ${l}.part_number_norm = ${r}.part_number_norm)`;
}

/** Same side-stripped base (30 in targeting), three characters or more. */
export function partNumberBaseHitSql(r: SQL, l: SQL): SQL {
  return sql`(length(${r}.part_number_base) >= 3 AND ${l}.part_number_base = ${r}.part_number_base)`;
}

/** A part number hit: the norm or the base. */
export function partNumberHitSql(r: SQL, l: SQL): SQL {
  return sql`(${partNumberNormHitSql(r, l)} OR ${partNumberBaseHitSql(r, l)})`;
}

/** The request has fits rows. */
export function requestHasFitsSql(r: SQL): SQL {
  return sql`EXISTS (SELECT 1 FROM part_request_fitments hf WHERE hf.part_request_id = ${r}.id)`;
}

/**
 * A part request's fits overlap the listing's fitments (F2's other-side overlap rule): the same brand; the same model,
 * or either side covering all the brand's models (request without a model, listing row without a model or "Other"
 * text); year ranges overlap, open ends overlapping anything.
 */
export function partFitOverlapSql(r: SQL, l: SQL): SQL {
  return sql`EXISTS (
    SELECT 1 FROM part_request_fitments pf JOIN listing_fitments lf ON lf.brand_id = pf.brand_id
    WHERE pf.part_request_id = ${r}.id AND lf.listing_id = ${l}.id
      AND (pf.model_id IS NULL OR (lf.model_id IS NULL AND lf.model_other IS NULL) OR lf.model_id = pf.model_id)
      AND COALESCE(pf.year_from, -32768) <= COALESCE(lf.year_to, 32767)
      AND COALESCE(lf.year_from, -32768) <= COALESCE(pf.year_to, 32767)
  )`;
}

/** The listing has fitment rows (parts). */
export function listingHasFitmentsSql(l: SQL): SQL {
  return sql`EXISTS (SELECT 1 FROM listing_fitments hlf WHERE hlf.listing_id = ${l}.id)`;
}

/**
 * A machine request's fits overlap the listing's `listing_machines` row: the same brand, the request's model (or any
 * model when it names none), the listing's year inside the request's range (an unknown year or an open end passes).
 */
export function machineFitOverlapSql(r: SQL, l: SQL): SQL {
  return sql`EXISTS (
    SELECT 1 FROM part_request_fitments mf JOIN listing_machines lm ON lm.brand_id = mf.brand_id
    WHERE mf.part_request_id = ${r}.id AND lm.listing_id = ${l}.id
      AND (mf.model_id IS NULL OR lm.model_id = mf.model_id)
      AND (lm.year IS NULL OR ((mf.year_from IS NULL OR lm.year >= mf.year_from) AND (mf.year_to IS NULL OR lm.year <= mf.year_to)))
  )`;
}

/** The listing names a catalogue machine brand (machines: "has fit rows"). */
export function listingHasMachineBrandSql(l: SQL): SQL {
  return sql`EXISTS (SELECT 1 FROM listing_machines hlm WHERE hlm.listing_id = ${l}.id AND hlm.brand_id IS NOT NULL)`;
}

/** `similarity(l.title_norm, r.name_norm)` (`pg_trgm`). */
export function nameSimilaritySql(r: SQL, l: SQL): SQL<number> {
  return sql<number>`similarity(COALESCE(${l}.title_norm, ''), ${r}.name_norm)`;
}

/** The listing's condition is accepted (an empty list accepts every condition). */
export function conditionAcceptsSql(r: SQL, l: SQL): SQL {
  return sql`(cardinality(${r}.condition_ids) = 0 OR ${l}.condition_id = ANY(${r}.condition_ids))`;
}

/**
 * Inside the request's reach (§7.4 rule 4): radii by `ST_DWithin` on the raw points (matching isn't a shown number);
 * `state` by the same state; anything for all India. A point that is NULL on either side passes only `state` /
 * `all_india`.
 */
export function reachSql(r: SQL, point: SQL, state: SQL): SQL {
  return sql`(CASE ${r}.reach
    WHEN 'radius_50' THEN COALESCE(ST_DWithin(${r}.point, ${point}, ${R50}::float8), false)
    WHEN 'radius_200' THEN COALESCE(ST_DWithin(${r}.point, ${point}, ${R200}::float8), false)
    WHEN 'state' THEN COALESCE(${state} = ${r}.state, false)
    ELSE true
  END)`;
}

/** The owners of a business are suspended or blocked (the `publicListingWhere` sub-condition). */
export function ownerRestrictedSql(businessId: SQL): SQL {
  return sql`EXISTS (
    SELECT 1 FROM users mou
    WHERE mou.business_id = ${businessId} AND mou.member_role = 'owner' AND mou.status IN ('suspended', 'blocked')
  )`;
}

/**
 * §7.4 rule 3 (what the listing is): parts — side accepted and (a part number hit, or a name similarity ≥ 0.5 with no
 * fits on the request or a fit overlap); machines — a fit overlap with `listing_machines` when the request has fits,
 * else a name similarity ≥ 0.5.
 */
export function identityMatchSql(r: SQL, l: SQL): SQL {
  const nameOk = sql`${nameSimilaritySql(r, l)} >= ${MIN_NAME}::float8`;
  return sql`(
    (${r}.kind = 'part' AND ${sideAcceptsSql(r, l)} AND (
      ${partNumberHitSql(r, l)}
      OR (${nameOk} AND (NOT ${requestHasFitsSql(r)} OR ${partFitOverlapSql(r, l)}))
    ))
    OR (${r}.kind = 'machine' AND (
      CASE WHEN ${requestHasFitsSql(r)} THEN ${machineFitOverlapSql(r, l)} ELSE ${nameOk} END
    ))
  )`;
}

/**
 * §7.4 rules 2–7 for listing `l` and request `r` (rule 1 — `r` active, same kind, `r`'s node an ancestor of `l`'s — is
 * the caller's candidate filter, `requestCandidateSql`):
 * 2. with `requireLive`: `l` public and `live`, available (`quantity − held_quantity`) ≥ 1; without (demand on a draft
 *    or a listing in review) neither is required;
 * 3. `identityMatchSql`;
 * 4. inside the reach (`l.search_point`, `l.state`);
 * 5. condition accepted;
 * 6. `l`'s business passes the audience, isn't blocked either way with `r`'s, isn't `r`'s, its owner isn't suspended;
 *    nor is the buyer's owner (a suspended buyer's requests disappear, §6 condition 2);
 * 7. `l` isn't a reply on `r` (pending, delivered or withdrawn: withdraw is final; only a dropped reply may match).
 */
export function matchRuleSql(l: SQL, r: SQL, opts: { requireLive: boolean }): SQL {
  const live = opts.requireLive
    ? sql`AND ${l}.status = 'live' AND (COALESCE(${l}.quantity, 0) - ${l}.held_quantity) >= 1`
    : sql``;
  return sql`(
    ${l}.business_id <> ${r}.business_id
    ${live}
    AND ${identityMatchSql(r, l)}
    AND ${reachSql(r, sql`${l}.search_point`, sql`${l}.state`)}
    AND ${conditionAcceptsSql(r, l)}
    AND (${r}.audience = 'any_seller' OR EXISTS (
      SELECT 1 FROM businesses mab WHERE mab.id = ${l}.business_id AND mab.verification_levels ? 'gst'
    ))
    AND NOT EXISTS (
      SELECT 1 FROM business_blocks mbb
      WHERE (mbb.blocker_business_id = ${l}.business_id AND mbb.blocked_business_id = ${r}.business_id)
         OR (mbb.blocker_business_id = ${r}.business_id AND mbb.blocked_business_id = ${l}.business_id)
    )
    AND NOT ${ownerRestrictedSql(sql`${l}.business_id`)}
    AND NOT ${ownerRestrictedSql(sql`${r}.business_id`)}
    AND NOT EXISTS (
      SELECT 1 FROM part_request_replies mrr
      WHERE mrr.part_request_id = ${r}.id AND mrr.listing_id = ${l}.id AND mrr.status <> 'dropped'
    )
  )`;
}

/** The match's tier: part number, then a machine fit, a name + fit, else a name. */
export function matchTierSql(r: SQL, l: SQL): SQL {
  return sql`(CASE
    WHEN ${r}.kind = 'part' AND ${partNumberHitSql(r, l)} THEN 'part_number'
    WHEN ${r}.kind = 'machine' AND ${requestHasFitsSql(r)} THEN 'machine_fit'
    WHEN ${r}.kind = 'part' AND ${requestHasFitsSql(r)} THEN 'name_fit'
    ELSE 'name'
  END)::part_request_match_tier`;
}

/**
 * §7.4 rule 1 as a candidate filter: `r` is `active`, of `l`'s kind, and its node is `l`'s category or an ancestor
 * (`ancestorIds` read from `l`'s path first, so the partial `(kind, category_id)` index serves it).
 */
export function requestCandidateSql(r: SQL, kind: string, ancestorIds: string[]): SQL {
  const ids = ancestorIds.length ? sql.join(ancestorIds.map((id) => sql`${id}::uuid`), sql`, `) : sql`NULL::uuid`;
  return sql`(${r}.status = 'active' AND ${r}.kind::text = ${kind} AND ${r}.category_id IN (${ids}))`;
}
