import { eq, sql, type SQL } from 'drizzle-orm';
import {
  REVIEW_FACETS,
  reviewWindowEnd,
  type MemberRole,
  type PartySide,
  type ReviewFacet,
  type ReviewRatings,
  type ReviewState,
  type ReviewSubjectKind,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { dealReviews, deals, users } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { getSettings } from '../settings.service.js';
import { loadSubject, subjectOf, type LoadedSubject, type ReviewSubjectRef } from './subject.js';

/**
 * A reader's review state on a deal or a rental booking (F6 + F7 spec §10.1–§10.3; M14 R11, §5.5a; ported from textile
 * `services/reviews/review-state.ts`, without photos, sample facts or dispute shifts). Shared by `GET /deals/:id/review`,
 * `GET /rental-bookings/:id/review`, the submit reply and the Deal / Booking record. Blind: the other side's review is
 * never read here beyond "submitted". The subject (`subject.ts`) decides the facets (`REVIEW_FACETS[kind][side]`) and
 * which column links the rows; for a booking the renter is the `buyer` side and the owner the `seller` side.
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

export const bookingNotFound = (): AppError => new AppError('Booking not found', 404, 'RENTAL_BOOKING_NOT_FOUND');

/**
 * The subject and the caller's side and role, read from the database (never the token alone). `404 DEAL_NOT_FOUND` /
 * `404 RENTAL_BOOKING_NOT_FOUND` for a subject that doesn't exist or isn't the caller's business's.
 */
export async function subjectForParty(
  conn: Conn,
  user: UserTokenPayload,
  ref: ReviewSubjectRef,
): Promise<{ subject: LoadedSubject; side: PartySide; memberRole: MemberRole }> {
  const notFound = ref.kind === 'deal' ? dealNotFound : bookingNotFound;
  if (!user.businessId) throw notFound();
  const subject = await loadSubject(conn, ref);
  const side = subject ? dealSideOf({ buyerBusinessId: subject.buyerBusinessId, sellerBusinessId: subject.sellerBusinessId }, user.businessId) : null;
  if (!subject || !side) throw notFound();
  const [member] = await conn.select({ memberRole: users.memberRole, businessId: users.businessId }).from(users).where(eq(users.id, user.userId));
  if (!member || member.businessId !== user.businessId) throw notFound();
  return { subject, side, memberRole: member.memberRole };
}

/** The review rows' link to their subject (`deal_id` or `rental_booking_id`). */
export function reviewsOfSubject(ref: ReviewSubjectRef): SQL {
  return ref.kind === 'deal' ? eq(dealReviews.dealId, ref.id) : eq(dealReviews.rentalBookingId, ref.id);
}

/** The facets a side rates on a subject (§10.2, M14 R11: a rental's owner rates `care` in place of `pickup`). */
export function facetsFor(kind: ReviewSubjectKind, side: PartySide): readonly ReviewFacet[] {
  return REVIEW_FACETS[kind][side];
}

const COLUMN: Record<
  ReviewFacet,
  keyof Pick<ReviewRow, 'rMatchedListing' | 'rCommunication' | 'rOnTime' | 'rPayment' | 'rPickup' | 'rCare'>
> = {
  matched_listing: 'rMatchedListing',
  communication: 'rCommunication',
  on_time: 'rOnTime',
  payment: 'rPayment',
  pickup: 'rPickup',
  care: 'rCare',
};

/** The row's ratings for its subject's and side's facets (§10.2). */
export function ratingsOf(row: ReviewRow): ReviewRatings {
  const out: ReviewRatings = {};
  for (const facet of facetsFor(subjectOf(row).kind, row.reviewerSide)) {
    const value = row[COLUMN[facet]];
    if (value !== null) out[facet] = value;
  }
  return out;
}

/** The facet columns for an insert: the subject's and side's facets set, the others null. */
export function ratingColumns(
  side: PartySide,
  ratings: Record<ReviewFacet, number>,
  kind: ReviewSubjectKind = 'deal',
): Pick<ReviewRow, (typeof COLUMN)[ReviewFacet]> {
  const out = { rMatchedListing: null, rCommunication: null, rOnTime: null, rPayment: null, rPickup: null, rCare: null } as Pick<
    ReviewRow,
    (typeof COLUMN)[ReviewFacet]
  >;
  for (const facet of facetsFor(kind, side)) out[COLUMN[facet]] = ratings[facet];
  return out;
}

/**
 * The state for one reader. `eligible` = "may submit now": completed, inside the window by the database clock, not a
 * viewer, not yet submitted by the reader's side, and the other side's review not already published (once a single
 * review publishes, the other side can no longer review, §10.3). `publishDueAt` is the unpublished review's due time.
 */
export async function reviewStateFor(
  conn: Conn,
  /** A deal row (F6 callers), or a subject's facts with `kind: 'rental'` for a booking. */
  deal: { id: string; status: string; completedAt: Date | null; kind?: ReviewSubjectKind },
  side: PartySide,
  memberRole: MemberRole,
): Promise<ReviewState> {
  const ref: ReviewSubjectRef = { kind: deal.kind ?? 'deal', id: deal.id };
  // Sequential: `conn` may be a transaction (one client, one query at a time).
  const settings = await getSettings(conn);
  const now = await dbNow(conn);
  const rows = await conn.select().from(dealReviews).where(reviewsOfSubject(ref));
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
    subject: { kind: ref.kind, id: ref.id },
    dealId: ref.kind === 'deal' ? ref.id : null,
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

/** The state for a subject's party member (viewers read too): `GET /rental-bookings/:id/review` and the deal one. */
export async function subjectReviewState(conn: Conn, user: UserTokenPayload, ref: ReviewSubjectRef): Promise<ReviewState> {
  const { subject, side, memberRole } = await subjectForParty(conn, user, ref);
  return reviewStateFor(conn, { kind: ref.kind, id: ref.id, status: subject.status, completedAt: subject.completedAt }, side, memberRole);
}
