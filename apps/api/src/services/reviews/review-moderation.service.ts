import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import { DEAL_LIMITS, type AdminReportRow, type ReviewReportReason } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { businesses, dealReviews, reports } from '../../db/schema.js';
import { adminText } from '../../lib/admin-text.js';
import { ConflictError, TooManyRequestsError, ValidationError } from '../../lib/errors.js';
import { isUniqueViolation } from '../../lib/pg-errors.js';
import { queueAdminEmit } from '../../lib/tx-effects.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { writeAudit } from '../audit.service.js';
import { lockDeal } from '../deals/locks.js';
import { ratingsOf, reviewNotFound, type ReviewRow } from './review-state.js';

/**
 * Review reports and moderation (F6 + F7 spec §10.6, P9; ported from textile `services/reviews/review-reports.service.ts`
 * `reportReview` / `hideReviewContent`, without photos or legal preservation). Any signed-in user reports a published
 * review into the shared `reports` table (`target_type = review`; listed and resolved by L1's admin reports routes).
 * A moderator hides the review or only its reply, or unhides it, with a reason and an `audit_log` row; a hidden review
 * leaves the scores at once (they are computed on read). Lock order: the deal, then the review.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `POST /reviews/:id/report`. Published, not hidden reviews only (`404 REVIEW_NOT_FOUND`; unpublished
 * `409 REVIEW_NOT_PUBLISHED`); one open report per business and review (`409 REPORT_EXISTS`, the F2 partial unique
 * index); 10 reports per user per 24 h across targets (`429 REPORT_LIMIT`, as F2). Queues `report:new` to moderators.
 */
export async function reportReview(
  tx: Tx,
  user: UserTokenPayload,
  reviewId: string,
  input: { reason: ReviewReportReason; details?: string | null },
): Promise<{ reported: true }> {
  if (!user.businessId) throw new ConflictError('Finish setting up your business first', 'ONBOARDING_INCOMPLETE');
  const details = input.details?.trim() || null;
  if (details !== null && details.length > DEAL_LIMITS.messageToPartiesMax) {
    throw new ValidationError(`Details are at most ${DEAL_LIMITS.messageToPartiesMax} characters`, { field: 'details' });
  }
  const [review] = await tx.select({ publishedAt: dealReviews.publishedAt, hiddenAt: dealReviews.hiddenAt }).from(dealReviews).where(eq(dealReviews.id, reviewId));
  if (!review || review.hiddenAt !== null) throw reviewNotFound();
  if (review.publishedAt === null) throw new ConflictError('This review is not published yet', 'REVIEW_NOT_PUBLISHED');

  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`listing-report:${user.userId}`}))`);
  const recent = await tx
    .select({ createdAt: reports.createdAt })
    .from(reports)
    .where(and(eq(reports.reporterUserId, user.userId), gt(reports.createdAt, sql`now() - interval '24 hours'`)))
    .orderBy(asc(reports.createdAt));
  if (recent.length >= DEAL_LIMITS.reportsPerDay) {
    const retryAt = new Date(recent[0]!.createdAt.getTime() + DAY_MS).toISOString();
    throw new TooManyRequestsError('You have sent a lot of reports today. Try again later.', 'REPORT_LIMIT', { retryAt });
  }

  const exists = () => new ConflictError('You have already reported this review', 'REPORT_EXISTS');
  const [open] = await tx
    .select({ id: reports.id })
    .from(reports)
    .where(
      and(
        eq(reports.reporterBusinessId, user.businessId),
        eq(reports.targetType, 'review'),
        eq(reports.targetId, reviewId),
        inArray(reports.status, ['open', 'reviewing']),
      ),
    );
  if (open) throw exists();
  let reportId: string;
  try {
    const [row] = await tx
      .insert(reports)
      .values({ targetType: 'review', targetId: reviewId, reporterUserId: user.userId, reporterBusinessId: user.businessId, reason: input.reason, details })
      .returning({ id: reports.id });
    reportId = row!.id;
  } catch (err) {
    if (isUniqueViolation(err, 'reports_one_open_uq')) throw exists();
    throw err;
  }
  queueAdminEmit(tx, 'moderator', 'report:new', { reportId, target: 'review', targetId: reviewId });
  return { reported: true };
}

export type AdminReviewView = NonNullable<AdminReportRow['review']>;

async function adminView(conn: Db | Tx, row: ReviewRow): Promise<AdminReviewView> {
  const names = await conn
    .select({ id: businesses.id, name: businesses.tradeName })
    .from(businesses)
    .where(inArray(businesses.id, [row.reviewerBusinessId, row.reviewedBusinessId]));
  const nameOf = (id: string) => names.find((b) => b.id === id)?.name ?? '';
  return {
    id: row.id,
    reviewer: { businessId: row.reviewerBusinessId, name: nameOf(row.reviewerBusinessId) },
    reviewed: { businessId: row.reviewedBusinessId, name: nameOf(row.reviewedBusinessId) },
    ratings: ratingsOf(row),
    text: row.text,
    replyText: row.replyText,
    hidden: row.hiddenAt !== null,
    replyHidden: row.replyHiddenAt !== null,
  };
}

export type ReviewModeration = 'hide' | 'unhide' | 'hide_reply';

const AUDITED = (r: ReviewRow) => ({
  hiddenAt: r.hiddenAt?.toISOString() ?? null,
  hiddenReason: r.hiddenReason,
  replyHiddenAt: r.replyHiddenAt?.toISOString() ?? null,
});

/**
 * `POST /admin/reviews/:id/hide | unhide | hide-reply` (moderator, §10.6). Reason 3–500 (`adminText`). Hiding an
 * already hidden review, unhiding a visible one or hiding a missing / hidden reply is `409` (`REVIEW_ALREADY_HIDDEN`,
 * `REVIEW_NOT_HIDDEN`, `REPLY_NOT_FOUND`). Audit `review.hide` / `review.unhide` / `review.hide_reply`.
 */
export async function moderateReview(tx: Tx, adminId: string, reviewId: string, action: ReviewModeration, rawReason: string): Promise<AdminReviewView> {
  const reason = adminText(rawReason);
  const [seen] = await tx.select({ dealId: dealReviews.dealId }).from(dealReviews).where(eq(dealReviews.id, reviewId));
  if (!seen) throw reviewNotFound();
  await lockDeal(tx, seen.dealId);
  const [row] = await tx.select().from(dealReviews).where(eq(dealReviews.id, reviewId)).for('update');
  if (!row) throw reviewNotFound();

  let set: Partial<typeof dealReviews.$inferInsert>;
  if (action === 'hide') {
    if (row.hiddenAt !== null) throw new ConflictError('This review is already hidden', 'REVIEW_ALREADY_HIDDEN');
    set = { hiddenAt: sql`now()` as unknown as Date, hiddenByAdminId: adminId, hiddenReason: reason };
  } else if (action === 'unhide') {
    if (row.hiddenAt === null) throw new ConflictError('This review is not hidden', 'REVIEW_NOT_HIDDEN');
    set = { hiddenAt: null, hiddenByAdminId: null, hiddenReason: null };
  } else {
    if (row.replyText === null || row.replyHiddenAt !== null) throw new ConflictError('This review has no reply to hide', 'REPLY_NOT_FOUND');
    set = { replyHiddenAt: sql`now()` as unknown as Date };
  }
  const [after] = (await tx.update(dealReviews).set(set).where(eq(dealReviews.id, row.id)).returning()) as [ReviewRow];
  await writeAudit(tx, {
    adminId,
    action: `review.${action}`,
    entityType: 'review',
    entityId: row.id,
    before: AUDITED(row),
    after: { ...AUDITED(after), reason },
  });
  return adminView(tx, after);
}
