import { and, asc, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import type { BusinessReportRequest } from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { businesses, reports, users } from '../../db/schema.js';
import { AppError, ConflictError, TooManyRequestsError, ValidationError } from '../../lib/errors.js';
import { isUniqueViolation } from '../../lib/pg-errors.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { onboardingForUser } from '../business/profile.service.js';
import { REPORTS_PER_DAY } from '../listings/listing-reports.service.js';

/**
 * Report a business (admin close-out §7.1, R6, plan D8; textile `services/reports/business-report.service.ts`, ours
 * `listing-reports.service.ts`). No automatic effect: the report waits in Reports & flags (Businesses tab) and counts in
 * the business detail and the `reports_against` fraud rule. The reported side is never told (no notification, no
 * emit). A `viewer` member may report (a safety action, as listing reports); a block between the two doesn't stop it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function businessNotFound(): AppError {
  return new AppError('Business not found', 404, 'BUSINESS_NOT_FOUND');
}

/**
 * `POST /businesses/:id/reports { reason, details? }`: the reporter's business onboarded (`409
 * ONBOARDING_INCOMPLETE`); `other` needs details (`400 VALIDATION_ERROR`, field `details`); not one's own business
 * (`400 CANNOT_REPORT_SELF`); the target an onboarded business (`404 BUSINESS_NOT_FOUND`); 10 reports per user per
 * 24 h across every target (`429 REPORT_LIMIT`, serialised per user by listing reports' advisory lock); one open report
 * per reporting business and business (`409 REPORT_EXISTS`). Details are stored as typed (staff read them as stored).
 */
export async function reportBusiness(
  tx: Tx,
  user: UserTokenPayload,
  businessId: string,
  input: BusinessReportRequest,
): Promise<{ reportId: string }> {
  const incomplete = () => new ConflictError('Finish setting up your business first', 'ONBOARDING_INCOMPLETE');
  const [me] = await tx.select({ name: users.name, businessId: users.businessId }).from(users).where(eq(users.id, user.userId));
  if (!me?.businessId || (await onboardingForUser(tx, me)) !== 'done') throw incomplete();
  const reporterBusinessId = me.businessId;

  const details = input.details?.trim() || null;
  if (input.reason === 'other' && !details) throw new ValidationError('Tell us what is wrong', { field: 'details' });
  if (businessId === reporterBusinessId) {
    throw new ValidationError("You can't report your own business", undefined, 'CANNOT_REPORT_SELF');
  }

  // Onboarded = the location step is done (the last step; `eligibleSellerSql` reads it the same way).
  const [target] = await tx
    .select({ id: businesses.id })
    .from(businesses)
    .where(and(eq(businesses.id, businessId), isNotNull(businesses.pincode)));
  if (!target) throw businessNotFound();

  // The same per-user lock and count as listing reports (plan D8): 10 per user per 24 h across every target.
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

  const exists = () => new ConflictError('You have already reported this business', 'REPORT_EXISTS');
  const [open] = await tx
    .select({ id: reports.id })
    .from(reports)
    .where(
      and(
        eq(reports.reporterBusinessId, reporterBusinessId),
        eq(reports.targetType, 'business'),
        eq(reports.targetId, businessId),
        inArray(reports.status, ['open', 'reviewing']),
      ),
    );
  if (open) throw exists();
  try {
    // A savepoint, so a teammate's racing report leaves the transaction usable for the 409.
    const [row] = await tx.transaction((sp) =>
      sp
        .insert(reports)
        .values({
          targetType: 'business',
          targetId: businessId,
          reporterUserId: user.userId,
          reporterBusinessId,
          reason: input.reason,
          details,
        })
        .returning({ id: reports.id }),
    );
    return { reportId: row!.id };
  } catch (err) {
    if (isUniqueViolation(err, 'reports_one_open_uq')) throw exists();
    throw err;
  }
}
