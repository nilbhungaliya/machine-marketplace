import { and, desc, eq, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import {
  DEAL_LIMITS,
  REVIEW_FACETS,
  publishDueAt,
  reviewWindowEnd,
  type PartySide,
  type PublicReview,
  type ReviewFacet,
  type ReviewState,
  type SellerReviewsPage,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { businesses, dealReviews, deals, users } from '../../db/schema.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { maskContact } from '../../lib/mask-contact.js';
import { isUniqueViolation } from '../../lib/pg-errors.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { lockDeal } from '../deals/locks.js';
import { notify } from '../notifications/notify.js';
import { getSettings } from '../settings.service.js';
import { roundHalfUp1, sellerScore } from './review-scores.js';
import {
  dbNow,
  dealForParty,
  ratingColumns,
  ratingsOf,
  reviewNotFound,
  reviewStateFor,
  type ReviewRow,
} from './review-state.js';

/**
 * Reviews (F6 + F7 spec §10, R22; ported from textile `services/reviews/review.service.ts` without photos, the match
 * question, sample facts or dispute shifts). One review per completed deal and side, blind: a review is visible only to
 * its author until both sides have reviewed, or until its `publish_due_at` = min(submitted + 7 d, completed + 14 d)
 * passes (the `review-publish` job, `review-jobs.ts`). Text is masked when written (it can be public).
 *
 * Lock order: the deal (its §8.5 place; no listing is touched), then the deal's reviews. The publish job takes review
 * rows `SKIP LOCKED` only, so a submit holding them publishes both itself.
 */

type Conn = Db | Tx;

const PAGE_SIZE = 20;

function answersInvalid(details: Record<string, unknown>): ValidationError {
  return new ValidationError('These ratings do not fit this review', details, 'REVIEW_ANSWERS_INVALID');
}

/**
 * Exactly the side's three facets, each a whole 1–5 (§10.2); text only on the buyer's review, ≤ 1 000. Anything else is
 * `400 REVIEW_ANSWERS_INVALID`, so the form and the API can't disagree.
 */
export function validateReviewInput(
  side: PartySide,
  input: { ratings: Record<string, unknown>; text?: string | null },
): { ratings: Record<ReviewFacet, number>; text: string | null } {
  const expected = REVIEW_FACETS[side] as readonly string[];
  const given = Object.keys(input.ratings);
  const extra = given.filter((k) => !expected.includes(k));
  if (extra.length) throw answersInvalid({ notApplicable: extra });
  const missing = expected.filter((k) => input.ratings[k] === undefined || input.ratings[k] === null);
  if (missing.length) throw answersInvalid({ missing });
  const notWhole = expected.filter((k) => {
    const v = input.ratings[k];
    return typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5;
  });
  if (notWhole.length) throw answersInvalid({ notWholeStars: notWhole });

  const text = input.text?.trim() ? input.text.trim() : null;
  if (text !== null && side === 'seller') throw answersInvalid({ notApplicable: ['text'] });
  if (text !== null && text.length > DEAL_LIMITS.reviewTextMax) {
    throw answersInvalid({ field: 'text', max: DEAL_LIMITS.reviewTextMax });
  }
  return { ratings: input.ratings as Record<ReviewFacet, number>, text };
}

async function tradeNameOf(conn: Conn, businessId: string): Promise<string> {
  const [b] = await conn.select({ name: businesses.tradeName }).from(businesses).where(eq(businesses.id, businessId));
  return b?.name ?? '';
}

/**
 * After rows publish: a buyer → seller review tells the seller (`review_received`, §10.3); a seller → buyer review
 * publishes silently (nothing about it shows yet, review change 11).
 */
export async function notifyPublished(
  tx: Tx,
  published: ReviewRow[],
  deal: Pick<typeof deals.$inferSelect, 'id' | 'ref' | 'listingTitle'>,
): Promise<void> {
  for (const row of published) {
    if (row.reviewerSide !== 'buyer') continue;
    await notify(tx, {
      type: 'review_received',
      recipientBusinessId: row.reviewedBusinessId,
      params: { businessName: await tradeNameOf(tx, row.reviewerBusinessId), listingTitle: deal.listingTitle, dealRef: deal.ref },
      destination: { dealId: deal.id, reviewId: row.id },
      dedupeKey: `review_received:${row.id}`,
    });
  }
}

/**
 * `POST /deals/:id/review` (§10.1–§10.3). Refusals in order: not a party `404 DEAL_NOT_FOUND`; viewer
 * `403 VIEWER_READ_ONLY`; not completed `409 REVIEW_NOT_ELIGIBLE`; past `completed_at + review_window_days` (database
 * clock) `409 REVIEW_WINDOW_CLOSED`; the side already reviewed `409 REVIEW_EXISTS`; the other side's single review
 * already published (its wait ran out) `409 REVIEW_WINDOW_CLOSED`; bad ratings `400 REVIEW_ANSWERS_INVALID`.
 *
 * The first review sets `publish_due_at` and tells the other business it has until then (`review_waiting`); the second,
 * before that, publishes both in this transaction.
 */
export async function submitReview(
  tx: Tx,
  user: UserTokenPayload,
  dealId: string,
  input: { ratings: Record<string, unknown>; text?: string | null },
): Promise<ReviewState> {
  const { side, memberRole } = await dealForParty(tx, user, dealId);
  if (memberRole === 'viewer') throw new ForbiddenError('Viewers can read but not write', 'VIEWER_READ_ONLY');
  const deal = await lockDeal(tx, dealId);
  if (deal.status !== 'completed' || deal.completedAt === null) {
    throw new ConflictError('Only a completed deal can be reviewed', 'REVIEW_NOT_ELIGIBLE', { status: deal.status });
  }
  const settings = await getSettings(tx);
  const now = await dbNow(tx);
  const windowEnds = reviewWindowEnd(deal.completedAt, settings.review_window_days);
  if (now.getTime() >= windowEnds.getTime()) {
    throw new ConflictError('The time to review this deal has ended', 'REVIEW_WINDOW_CLOSED', { windowEndsAt: windowEnds.toISOString() });
  }

  const existing = await tx.select().from(dealReviews).where(eq(dealReviews.dealId, deal.id)).for('update');
  if (existing.some((r) => r.reviewerSide === side)) throw new ConflictError('This deal already has your review', 'REVIEW_EXISTS');
  const theirs = existing.find((r) => r.reviewerSide !== side);
  if (theirs?.publishedAt) {
    throw new ConflictError('The time to review this deal has ended', 'REVIEW_WINDOW_CLOSED', { windowEndsAt: theirs.publishedAt.toISOString() });
  }

  const answers = validateReviewInput(side, input);
  const otherBusinessId = side === 'buyer' ? deal.sellerBusinessId : deal.buyerBusinessId;
  const dueAt = publishDueAt(now, deal.completedAt, settings.review_blind_days, settings.review_window_days);
  let row: ReviewRow;
  try {
    [row] = (await tx
      .insert(dealReviews)
      .values({
        dealId: deal.id,
        reviewerSide: side,
        reviewerBusinessId: user.businessId!,
        reviewedBusinessId: otherBusinessId,
        reviewerUserId: user.userId,
        ...ratingColumns(side, answers.ratings),
        // Public text: masked once, when written (§10.2). No scam flag column exists for reviews (C0 schema), so the
        // scam check of §10.2 has nothing to store; the masking is what protects readers.
        text: answers.text === null ? null : maskContact(answers.text),
        submittedAt: now,
        publishDueAt: dueAt,
      })
      .returning()) as [ReviewRow];
  } catch (err) {
    if (isUniqueViolation(err, 'deal_reviews_deal_side_uq')) throw new ConflictError('This deal already has your review', 'REVIEW_EXISTS');
    throw err;
  }

  if (theirs) {
    const published = await tx
      .update(dealReviews)
      .set({ publishedAt: sql`now()` })
      .where(and(eq(dealReviews.dealId, deal.id), isNull(dealReviews.publishedAt)))
      .returning();
    await notifyPublished(tx, published, deal);
  } else {
    // P14: only the other business; it has until `publish_due_at` (§10.3, plan review I6).
    await notify(tx, {
      type: 'review_waiting',
      recipientBusinessId: otherBusinessId,
      params: { businessName: await tradeNameOf(tx, user.businessId!), dealRef: deal.ref, dueAt: dueAt.toISOString() },
      destination: { dealId: deal.id },
      dedupeKey: `review_waiting:${deal.id}`,
    });
  }
  return reviewStateFor(tx, deal, side, memberRole);
}

// ─── Public reviews, the seller's reply ───

interface PublicRowSource {
  review: ReviewRow;
  reviewerName: string;
  listingTitle: string;
}

/** A published buyer → seller review as the public reads it (§10.4). Hidden replies are left out. */
export function toPublicReview(r: PublicRowSource): PublicReview {
  const ratings = ratingsOf(r.review);
  const values = Object.values(ratings).filter((v): v is number => typeof v === 'number');
  const stars = values.length ? roundHalfUp1(values.reduce((a, b) => a + b, 0) / values.length) : 0;
  const { replyText, replyAt, replyHiddenAt } = r.review;
  return {
    id: r.review.id,
    reviewerName: maskContact(r.reviewerName),
    listingTitle: maskContact(r.listingTitle),
    ratings,
    stars,
    text: r.review.text === null ? null : maskContact(r.review.text),
    publishedAt: (r.review.publishedAt ?? r.review.submittedAt).toISOString(),
    reply: replyText !== null && replyAt !== null && replyHiddenAt === null ? { text: maskContact(replyText), at: replyAt.toISOString() } : null,
    hidden: r.review.hiddenAt !== null,
  };
}

/** Published, not hidden reviews of a seller written by buyers (§10.4): what scores and lists count. */
export const visibleSellerReviews = (businessId: string): SQL =>
  and(
    eq(dealReviews.reviewedBusinessId, businessId),
    eq(dealReviews.reviewerSide, 'buyer'),
    isNotNull(dealReviews.publishedAt),
    isNull(dealReviews.hiddenAt),
  )!;

function decodeCursor(raw: string): { t: string; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { t?: unknown; id?: unknown };
    if (typeof parsed.t === 'string' && typeof parsed.id === 'string' && /^[0-9a-f-]{36}$/i.test(parsed.id) && !Number.isNaN(Date.parse(parsed.t))) {
      return { t: parsed.t, id: parsed.id };
    }
  } catch {
    // falls through
  }
  throw new ValidationError('Invalid cursor', undefined, 'INVALID_CURSOR');
}

async function publicRows(conn: Conn, where: SQL, cursor?: string) {
  const conditions: SQL[] = [where];
  if (cursor) {
    const c = decodeCursor(cursor);
    conditions.push(sql`(${dealReviews.publishedAt}, ${dealReviews.id}) < (${c.t}::timestamptz, ${c.id}::uuid)`);
  }
  return conn
    .select({
      review: dealReviews,
      sortAt: sql<string>`${dealReviews.publishedAt}::text`,
      reviewerName: businesses.tradeName,
      listingTitle: deals.listingTitle,
    })
    .from(dealReviews)
    .innerJoin(deals, eq(deals.id, dealReviews.dealId))
    .innerJoin(businesses, eq(businesses.id, dealReviews.reviewerBusinessId))
    .where(and(...conditions))
    .orderBy(desc(dealReviews.publishedAt), desc(dealReviews.id))
    .limit(PAGE_SIZE + 1);
}

/**
 * `GET /businesses/:id/reviews` (public, guests too) and `GET /users/me/reviews`: the seller's score (null below
 * `review_min_published`), the count of counted reviews and the reviews newest first with replies. Unpublished, hidden
 * and seller → buyer reviews never appear (§10.4).
 */
export async function listSellerReviews(conn: Conn, businessId: string, cursor?: string): Promise<SellerReviewsPage> {
  const [b] = await conn.select({ id: businesses.id }).from(businesses).where(eq(businesses.id, businessId));
  if (!b) throw new NotFoundError('Business');
  const rows = await publicRows(conn, visibleSellerReviews(businessId), cursor);
  const score = await sellerScore(conn, businessId);
  const counted = await conn.select({ n: sql<number>`count(*)::int` }).from(dealReviews).where(visibleSellerReviews(businessId));
  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    score,
    count: counted[0]?.n ?? 0,
    items: page.map(toPublicReview),
    nextCursor: rows.length > PAGE_SIZE && last ? Buffer.from(JSON.stringify({ t: last.sortAt, id: last.review.id })).toString('base64url') : null,
  };
}

/** `GET /users/me/reviews`: my business's seller score and the reviews it received. */
export async function myReceivedReviews(conn: Conn, user: UserTokenPayload, cursor?: string): Promise<SellerReviewsPage> {
  if (!user.businessId) throw new ConflictError('Finish setting up your business first', 'ONBOARDING_INCOMPLETE');
  return listSellerReviews(conn, user.businessId, cursor);
}

async function publicReviewById(conn: Conn, reviewId: string): Promise<PublicReview> {
  const [r] = await conn
    .select({ review: dealReviews, reviewerName: businesses.tradeName, listingTitle: deals.listingTitle })
    .from(dealReviews)
    .innerJoin(deals, eq(deals.id, dealReviews.dealId))
    .innerJoin(businesses, eq(businesses.id, dealReviews.reviewerBusinessId))
    .where(eq(dealReviews.id, reviewId));
  if (!r) throw reviewNotFound();
  return toPublicReview(r);
}

/**
 * `POST /reviews/:id/reply` (§10.5): a non-viewer member of the reviewed seller replies once to a published, not
 * hidden buyer → seller review, 1–300 characters, masked, no edit. `404 REVIEW_NOT_FOUND` for anyone else's review (a
 * seller → buyer review included), `409 REVIEW_NOT_PUBLISHED`, `409 REPLY_EXISTS`.
 */
export async function postReply(tx: Tx, user: UserTokenPayload, reviewId: string, text: string): Promise<PublicReview> {
  if (!user.businessId) throw reviewNotFound();
  const [member] = await tx.select({ memberRole: users.memberRole }).from(users).where(eq(users.id, user.userId));
  if (member?.memberRole === 'viewer') throw new ForbiddenError('Viewers can read but not write', 'VIEWER_READ_ONLY');
  const ofMine = and(
    eq(dealReviews.id, reviewId),
    eq(dealReviews.reviewerSide, 'buyer'),
    eq(dealReviews.reviewedBusinessId, user.businessId),
    isNull(dealReviews.hiddenAt),
  );
  const [seen] = await tx.select({ dealId: dealReviews.dealId }).from(dealReviews).where(ofMine);
  if (!seen) throw reviewNotFound();
  await lockDeal(tx, seen.dealId);
  const [row] = await tx.select().from(dealReviews).where(ofMine).for('update');
  if (!row) throw reviewNotFound();
  if (row.publishedAt === null) throw new ConflictError('This review is not published yet', 'REVIEW_NOT_PUBLISHED');
  if (row.replyText !== null) throw new ConflictError('This review already has your reply', 'REPLY_EXISTS');
  const trimmed = text.trim();
  if (trimmed === '' || trimmed.length > DEAL_LIMITS.replyMax) {
    throw new ValidationError(`A reply is 1 to ${DEAL_LIMITS.replyMax} characters`, { field: 'text' });
  }
  await tx
    .update(dealReviews)
    .set({ replyText: maskContact(trimmed), replyUserId: user.userId, replyAt: sql`now()` })
    .where(eq(dealReviews.id, row.id));
  return publicReviewById(tx, row.id);
}
