import { and, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  OTHER_SIDE_LIMIT,
  OTHER_SIDE_MIN_SIMILARITY,
  complementarySide,
  type OtherSideCard,
  type OtherSideResult,
  type PartSide,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { listings } from '../../db/schema.js';
import type { Viewer } from './listing-read.service.js';
import { businessPointSql, loadCards } from './listing-view.service.js';
import { listingNotFound, type ListingRow } from './locks.js';
import { publicListingWhere } from './public-where.service.js';

// Left / Right / Pair matching (F2 spec §9, R22, R38, R54; plan Task 14). For a left or right part, the public part
// listings with the other side or a pair, in three tiers: (1) the same part number, or the same side-stripped base;
// (2) the same part group, a similar normalised name and fitment rows that overlap; (3) the same part group and a similar
// name, one of the two without fitment rows ("Possibly the other side", shown with a label, never dropped). Both with
// fitments that don't overlap → not a match. Cards come from `loadCards`, the mapper public reads use, so they never carry
// a pincode, an address line, a point or a serial number.

type Conn = Db | Tx;

const emptyResult = (complement: PartSide | null): OtherSideResult => ({ complement, best: {}, counts: {}, items: [] });

interface Ranked {
  id: string;
  side: 'left' | 'right' | 'pair';
  tier: 1 | 2 | 3;
  rn: number;
  side_rn: number;
  side_n: number;
}

/**
 * `GET /listings/:id/other-side` (§9.1). The listing must be public, or the viewer's own (any status: "Find the other
 * side" from My listings); anyone else gets `404 LISTING_NOT_FOUND`. A machine, a pair or a sideless part has no other
 * side: an empty result.
 *
 * One query ranks every candidate: tier; the wanted side before `pair`; the distance from the viewer's business point
 * (pin, else its pincode's centroid) when signed in and known, else from this listing's point (nulls last);
 * `refreshed_at` newest. `items` are the first 20; `best` and `counts` per side come from a window partitioned by side,
 * so a pair match isn't lost when 20 exact-side matches fill `items`.
 */
export async function findOtherSide(conn: Conn, listingId: string, viewer: Viewer): Promise<OtherSideResult> {
  const own = viewer?.businessId ? eq(listings.businessId, viewer.businessId) : sql`false`;
  const [row] = await conn
    .select()
    .from(listings)
    .where(and(eq(listings.id, listingId), sql`(${own} OR ${publicListingWhere()})`));
  if (!row) throw listingNotFound();

  const want = row.kind === 'part' && row.side ? complementarySide(row.side) : null;
  if (!want) return emptyResult(want);

  const c = alias(listings, 'c');
  const origin = viewer?.businessId ? sql`COALESCE(${businessPointSql(viewer.businessId)}, me.point)` : sql`me.point`;
  const similar = sql`(s.category_id = me.category_id AND similarity(s.title_norm, me.title_norm) >= ${OTHER_SIDE_MIN_SIMILARITY})`;

  // Fitment overlap (§9.1 tier 2): the same catalogue model (or the same "Other" model text, compared without case and
  // with runs of whitespace collapsed), or the same brand where either row covers all its models (no model, no "Other"
  // text); year ranges overlap, open ends overlapping anything.
  const otherText = (col: string) => sql.raw(`btrim(regexp_replace(lower(${col}), '[[:space:]]+', ' ', 'g'))`);
  const overlap = sql`EXISTS (
    SELECT 1 FROM listing_fitments a JOIN listing_fitments b ON b.brand_id = a.brand_id
    WHERE a.listing_id = me.id AND b.listing_id = s.id
      AND (
        (a.model_id IS NOT NULL AND a.model_id = b.model_id)
        OR (a.model_other IS NOT NULL AND b.model_other IS NOT NULL AND ${otherText('a.model_other')} = ${otherText('b.model_other')})
        OR (a.model_id IS NULL AND a.model_other IS NULL)
        OR (b.model_id IS NULL AND b.model_other IS NULL)
      )
      AND COALESCE(a.year_from, -32768) <= COALESCE(b.year_to, 32767)
      AND COALESCE(b.year_from, -32768) <= COALESCE(a.year_to, 32767)
  )`;

  // Prefilter (index use: `listings_category_id_idx`, `listings_part_number_{norm,base}_idx`): every candidate a tier can
  // score has this listing's part group (tiers 2, 3) or its part number / base (tier 1, three characters or more), so
  // the filter drops only rows `scored` would leave without a tier. Results are unchanged.
  const reach = [
    row.categoryId ? eq(c.categoryId, row.categoryId) : null,
    row.partNumberNorm && row.partNumberNorm.length >= 3 ? eq(c.partNumberNorm, row.partNumberNorm) : null,
    row.partNumberBase && row.partNumberBase.length >= 3 ? eq(c.partNumberBase, row.partNumberBase) : null,
  ].filter((x) => x !== null);
  const result: OtherSideResult = { complement: want, best: { [want]: null, pair: null }, counts: { [want]: 0, pair: 0 }, items: [] };
  if (reach.length === 0) return result;

  const { rows } = await conn.execute<Ranked & Record<string, unknown>>(sql`
    WITH me AS (
      SELECT l.id, l.category_id, l.title_norm, l.part_number_norm, l.part_number_base, l.point,
             EXISTS (SELECT 1 FROM listing_fitments f WHERE f.listing_id = l.id) AS has_fit
      FROM listings l WHERE l.id = ${row.id}
    ),
    cand AS (
      SELECT ${c.id} AS id, ${c.side}::text AS side, ${c.categoryId} AS category_id, ${c.titleNorm} AS title_norm,
             ${c.partNumberNorm} AS part_number_norm, ${c.partNumberBase} AS part_number_base, ${c.point} AS point,
             ${c.refreshedAt} AS refreshed_at,
             EXISTS (SELECT 1 FROM listing_fitments f WHERE f.listing_id = ${c.id}) AS has_fit
      FROM listings "c"
      WHERE ${c.kind} = 'part' AND ${c.side} IN (${want}, 'pair') AND ${c.id} <> ${row.id} AND ${publicListingWhere(c)}
        AND (${sql.join(reach, sql` OR `)})
    ),
    scored AS (
      SELECT s.id, s.side, s.refreshed_at, ST_Distance(s.point, ${origin}) AS dist,
        CASE
          WHEN (length(me.part_number_norm) >= 3 AND s.part_number_norm = me.part_number_norm)
            OR (length(me.part_number_base) >= 3 AND s.part_number_base = me.part_number_base) THEN 1
          WHEN ${similar} AND me.has_fit AND s.has_fit AND ${overlap} THEN 2
          WHEN ${similar} AND NOT (me.has_fit AND s.has_fit) THEN 3
        END AS tier
      FROM cand s CROSS JOIN me
    ),
    ranked AS (
      SELECT id, side, tier,
        ROW_NUMBER() OVER (ORDER BY tier, (side = 'pair'), dist ASC NULLS LAST, refreshed_at DESC NULLS LAST, id)::int AS rn,
        ROW_NUMBER() OVER (PARTITION BY side ORDER BY tier, dist ASC NULLS LAST, refreshed_at DESC NULLS LAST, id)::int AS side_rn,
        (COUNT(*) OVER (PARTITION BY side))::int AS side_n
      FROM scored WHERE tier IS NOT NULL
    )
    SELECT id, side, tier, rn, side_rn, side_n FROM ranked
    WHERE rn <= ${OTHER_SIDE_LIMIT} OR side_rn = 1
    ORDER BY rn
  `);

  if (rows.length === 0) return result;

  const listingRows: ListingRow[] = await conn.select().from(listings).where(inArray(listings.id, rows.map((r) => r.id)));
  const byId = new Map(listingRows.map((l) => [l.id, l]));
  const ordered = rows.filter((r) => byId.has(r.id));
  const cards = await loadCards(conn, ordered.map((r) => byId.get(r.id)!), { viewerBusinessId: viewer?.businessId });

  ordered.forEach((r, i) => {
    const card: OtherSideCard = { ...cards[i]!, tier: Number(r.tier) as 1 | 2 | 3, possible: Number(r.tier) === 3 };
    const side = r.side === 'pair' ? 'pair' : want;
    if (Number(r.side_rn) === 1) {
      result.best[side as 'left' | 'right' | 'pair'] = card;
      result.counts[side as 'left' | 'right' | 'pair'] = Number(r.side_n);
    }
    if (Number(r.rn) <= OTHER_SIDE_LIMIT) result.items.push(card);
  });
  return result;
}
