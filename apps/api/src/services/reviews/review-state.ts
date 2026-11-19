import { eq, sql } from 'drizzle-orm';
import {
  REVIEW_FACETS,
  reviewWindowEnd,
  type MemberRole,
  type PartySide,
  type ReviewFacet,
  type ReviewRatings,
  type ReviewState,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { dealReviews, deals, users } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { getSettings } from '../settings.service.js';

/**
 * A reader's review state on a deal (F6 + F7 spec §10.1–§10.3; ported from textile `services/reviews/review-state.ts`,
 * without photos, sample facts or dispute shifts). Shared by `GET /deals/:id/review`, the submit reply and the Deal
 * record (`DealView.review`, L3). Blind: the other side's review is never read here beyond "submitted".
 */

export type DealRow = typeof deals.$inferSelect;
export type ReviewRow = typeof dealReviews.$inferSelect;

type Conn = Db | Tx;

export const dealNotFound = (): AppError => new AppError('Deal not found', 404, 'DEAL_NOT_FOUND');
export const reviewNotFound = (): AppError => new AppError('Review not found', 404, 'REVIEW_NOT_FOUND');

/** The database clock (P10: every rule uses `now()`; inside a transaction it is the transaction's start). */
export async function dbNow(conn: Conn): Promise<Date> {
  const { rows } = await conn.execute(sql`SELECT now() AS now`);
  return new Date((rows[0] as { now: Date | string }).now);
}

/** The deal's side of a business, or null for a business that isn't a party. */
export function dealSideOf(deal: Pick<DealRow, 'buyerBusinessId' | 'sellerBusinessId'>, businessId: string | null): PartySide | null {
  if (businessId === null) return null;
  if (deal.buyerBusinessId === businessId) return 'buyer';
  if (deal.sellerBusinessId === businessId) return 'seller';
  return null;
}

/**
 * The deal and the caller's side and role, read from the database (never the token alone, §12). `404 DEAL_NOT_FOUND`
 * for a deal that doesn't exist or isn't the caller's business's.
 */
export async function dealForParty(
  conn: Conn,
  user: UserTokenPayload,
  dealId: string,
): Promise<{ deal: DealRow; side: PartySide; memberRole: MemberRole }> {
  if (!user.businessId) throw dealNotFound();
  const [deal] = await conn.select().from(deals).where(eq(deals.id, dealId));
  const side = deal ? dealSideOf(deal, user.businessId) : null;
  if (!deal || !side) throw dealNotFound();
  const [member] = await conn.select({ memberRole: users.memberRole, businessId: users.businessId }).from(users).where(eq(users.id, user.userId));
  if (!member || member.businessId !== user.businessId) throw dealNotFound();
  return { deal, side, memberRole: member.memberRole };
}

const COLUMN: Record<ReviewFacet, keyof Pick<ReviewRow, 'rMatchedListing' | 'rCommunication' | 'rOnTime' | 'rPayment' | 'rPickup'>> = {
  matched_listing: 'rMatchedListing',
  communication: 'rCommunication',
  on_time: 'rOnTime',
  payment: 'rPayment',
  pickup: 'rPickup',
};

/** The row's ratings for its side's facets (§10.2). */
export function ratingsOf(row: ReviewRow): ReviewRatings {
  const out: ReviewRatings = {};
  for (const facet of REVIEW_FACETS[row.reviewerSide]) {
    const value = row[COLUMN[facet]];
    if (value !== null) out[facet] = value;
  }
  return out;
}

/** The facet columns for an insert: the side's facets set, the others null. */
export function ratingColumns(side: PartySide, ratings: Record<ReviewFacet, number>): Pick<ReviewRow, (typeof COLUMN)[ReviewFacet]> {
  const out = { rMatchedListing: null, rCommunication: null, rOnTime: null, rPayment: null, rPickup: null } as Pick<
    ReviewRow,
    (typeof COLUMN)[ReviewFacet]
  >;
  for (const facet of REVIEW_FACETS[side]) out[COLUMN[facet]] = ratings[facet];
  return out;
}

/**
 * The state for one reader. `eligible` = "may submit now": completed, inside the window by the database clock, not a
 * viewer, not yet submitted by the reader's side, and the other side's review not already published (once a single
 * review publishes, the other side can no longer review, §10.3). `publishDueAt` is the unpublished review's due time.
 */
export async function reviewStateFor(
  conn: Conn,
  deal: Pick<DealRow, 'id' | 'status' | 'completedAt'>,
  side: PartySide,
  memberRole: MemberRole,
): Promise<ReviewState> {
  // Sequential: `conn` may be a transaction (one client, one query at a time).
  const settings = await getSettings(conn);
  const now = await dbNow(conn);
  const rows = await conn.select().from(dealReviews).where(eq(dealReviews.dealId, deal.id));
  const windowEnds = deal.completedAt ? reviewWindowEnd(deal.completedAt, settings.review_window_days) : null;
  const mine = rows.find((r) => r.reviewerSide === side) ?? null;
  const theirs = rows.find((r) => r.reviewerSide !== side) ?? null;

  let reason: ReviewState['reason'] = null;
  if (mine) reason = 'submitted';
  else if (deal.status !== 'completed' || windowEnds === null) reason = 'not_completed';
  // Published, or due by the database clock even before the `review-publish` job runs (§10.3).
  else if (theirs && (theirs.publishedAt || now.getTime() >= theirs.publishDueAt.getTime())) reason = 'other_published';
  else if (now.getTime() >= windowEnds.getTime()) reason = 'window_closed';
  else if (memberRole === 'viewer') reason = 'viewer';

  const unpublished = rows.find((r) => r.publishedAt === null) ?? null;
  return {
    dealId: deal.id,
    mySide: side,
    eligible: reason === null,
    reason,
    windowEndsAt: windowEnds?.toISOString() ?? null,
    mine: mine
      ? {
          id: mine.id,
          ratings: ratingsOf(mine),
          text: mine.text,
          submittedAt: mine.submittedAt.toISOString(),
          publishedAt: mine.publishedAt?.toISOString() ?? null,
          hidden: mine.hiddenAt !== null,
        }
      : null,
    theirsSubmitted: theirs !== null,
    publishDueAt: unpublished?.publishDueAt.toISOString() ?? null,
  };
}

/** `GET /deals/:id/review`: party members only (viewers read too). */
export async function getReviewState(conn: Conn, user: UserTokenPayload, dealId: string): Promise<ReviewState> {
  const { deal, side, memberRole } = await dealForParty(conn, user, dealId);
  return reviewStateFor(conn, deal, side, memberRole);
}
