import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { ListingReportReason } from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { listings, reports } from '../../db/schema.js';
import { ConflictError, ForbiddenError, TooManyRequestsError, ValidationError } from '../../lib/errors.js';
import { isUniqueViolation } from '../../lib/pg-errors.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { listingNotFound } from './locks.js';
import { publicListingWhere } from './public-where.service.js';

// Report listing (F2 spec §8.4, R15). Reports never hide a listing: they put it in the moderation queue's Reported tab
// and make side / fit edits go to review (§7.3).

/** At most this many reports per user per 24 hours, counted on the table (`429 REPORT_LIMIT`). */
export const REPORTS_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReportInput {
  reason: ListingReportReason;
  details?: string | null;
}

/**
 * `POST /listings/:id/reports`. The reporter needs a business (`409 ONBOARDING_INCOMPLETE`): one open report per
 * business and listing is a partial unique index on `reporter_business_id`, which NULLs would slip past; both reporter
 * columns are always set. Public listings only (`404`); not one's own (`403 REPORT_OWN_LISTING`); one open report per
 * business (`409 REPORT_EXISTS`); 10 per user per 24 h (`429 REPORT_LIMIT`, serialised per user by an advisory lock);
 * `something_else` needs details (`400`).
 */
export async function createReport(tx: Tx, user: UserTokenPayload, listingId: string, input: ReportInput): Promise<{ id: string; status: 'open' }> {
  if (!user.businessId) throw new ConflictError('Finish setting up your business first', 'ONBOARDING_INCOMPLETE');
  const details = input.details?.trim() || null;
  if (input.reason === 'something_else' && !details) {
    throw new ValidationError('Tell us what is wrong', { field: 'details' });
  }

  const [listing] = await tx
    .select({ id: listings.id, businessId: listings.businessId })
    .from(listings)
    .where(and(eq(listings.id, listingId), publicListingWhere()));
  if (!listing) throw listingNotFound();
  if (listing.businessId === user.businessId) throw new ForbiddenError("You can't report your own listing", 'REPORT_OWN_LISTING');

  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`listing-report:${user.userId}`}))`);
  const recent = await tx
    .select({ createdAt: reports.createdAt })
    .from(reports)
    .where(and(eq(reports.reporterUserId, user.userId), gt(reports.createdAt, sql`now() - interval '24 hours'`)))
    .orderBy(asc(reports.createdAt));
  if (recent.length >= REPORTS_PER_DAY) {
    const retryAt = new Date(recent[0]!.createdAt.getTime() + DAY_MS).toISOString();
    throw new TooManyRequestsError('You have sent a lot of reports today. Try again later.', 'REPORT_LIMIT', { retryAt });
  }

  const exists = () => new ConflictError('You have already reported this listing', 'REPORT_EXISTS');
  const [open] = await tx
    .select({ id: reports.id })
    .from(reports)
    .where(
      and(
        eq(reports.reporterBusinessId, user.businessId),
        eq(reports.targetType, 'listing'),
        eq(reports.targetId, listingId),
        inArray(reports.status, ['open', 'reviewing']),
      ),
    );
  if (open) throw exists();
  try {
    const [row] = await tx
      .insert(reports)
      .values({
        targetType: 'listing',
        targetId: listingId,
        reporterUserId: user.userId,
        reporterBusinessId: user.businessId,
        reason: input.reason,
        details,
      })
      .returning({ id: reports.id });
    return { id: row!.id, status: 'open' };
  } catch (err) {
    // A teammate's report raced this one past the check above.
    if (isUniqueViolation(err, 'reports_one_open_uq')) throw exists();
    throw err;
  }
}
