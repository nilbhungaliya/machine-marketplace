import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { SellerScore } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { dealReviews } from '../../db/schema.js';
import { getSettings } from '../settings.service.js';

/**
 * Seller scores (F6 + F7 spec §10.4; ported from textile `services/reviews/review-scores.ts`). Counted: published,
 * not hidden reviews written by buyers. Sums and counts come exact from SQL; rounding happens once, here. Computed on
 * read from the partial index (no stored aggregate, §5.11), so a hidden review leaves the score at once. Buyer scores
 * are cut for MVP (review change 11): the seller → buyer stars are stored, never counted here.
 */

/** Absorbs binary error in ratios of small whole numbers (4.25 stored as 4.2499…) without moving a real value across a half. */
const EPSILON = 1e-9;

/** Half up to a whole number: 86.5 → 87. */
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5 + EPSILON);
}

/** Half up to one decimal: 4.25 → 4.3. */
export function roundHalfUp1(x: number): number {
  return Math.floor(x * 10 + 0.5 + EPSILON) / 10;
}

const int = (expr: ReturnType<typeof sql>) => sql<number>`COALESCE(${expr}, 0)::int`;

/** Published, not hidden buyer reviews of the business; null under `review_min_published` (§10.4: "New seller"). */
export async function sellerScore(conn: Db | Tx, businessId: string): Promise<SellerScore | null> {
  const { review_min_published: minPublished } = await getSettings(conn);
  const [s] = await conn
    .select({
      n: sql<number>`count(*)::int`,
      matched: int(sql`sum(${dealReviews.rMatchedListing})`),
      matchedN: sql<number>`count(${dealReviews.rMatchedListing})::int`,
      communication: int(sql`sum(${dealReviews.rCommunication})`),
      communicationN: sql<number>`count(${dealReviews.rCommunication})::int`,
      onTime: int(sql`sum(${dealReviews.rOnTime})`),
      onTimeN: sql<number>`count(${dealReviews.rOnTime})::int`,
    })
    .from(dealReviews)
    .where(
      and(
        eq(dealReviews.reviewedBusinessId, businessId),
        eq(dealReviews.reviewerSide, 'buyer'),
        isNotNull(dealReviews.publishedAt),
        isNull(dealReviews.hiddenAt),
      ),
    );
  if (!s || s.n < minPublished) return null;
  const allSum = s.matched + s.communication + s.onTime;
  const allN = s.matchedN + s.communicationN + s.onTimeN;
  if (allN === 0) return null;
  const pct = (sum: number, n: number) => (n === 0 ? 0 : roundHalfUp((sum / n) * 20));
  return {
    count: s.n,
    stars: roundHalfUp1(allSum / allN),
    facetsPercent: {
      matched_listing: pct(s.matched, s.matchedN),
      communication: pct(s.communication, s.communicationN),
      on_time: pct(s.onTime, s.onTimeN),
    },
  };
}
