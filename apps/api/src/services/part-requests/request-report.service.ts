import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import { PART_REQUEST_LIMITS, type PartRequestReportReason } from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { reports } from '../../db/schema.js';
import { ConflictError, TooManyRequestsError, ValidationError } from '../../lib/errors.js';
import { isUniqueViolation } from '../../lib/pg-errors.js';
import { queueAdminEmit } from '../../lib/tx-effects.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { REPORTS_PER_DAY } from '../listings/listing-reports.service.js';
import { requestRoleFor } from './eligibility.js';
import { partRequestNotFound } from './locks.js';
import { assertOnboarded } from './request-input.js';

// Report a request (spec §14, §15; plan A1-4; textile `services/requirements/requirement-reports.service.ts`): eligible
// sellers only (anyone else 404, the buyer included). One open report per business and request (`409 REPORT_EXISTS`);
// 10 reports a day per user across every target, counted on the table under F2's per-user advisory lock (`429
// REPORT_LIMIT`). `report:new` (ids only) to moderators and support after commit.

const DAY_MS = 24 * 60 * 60 * 1000;

/** `POST /part-requests/:id/report { reason, details? }` → `{ reported: true }`. `other` needs details (≤ 500). */
export async function reportPartRequest(
  tx: Tx,
  user: UserTokenPayload,
  id: string,
  body: { reason: PartRequestReportReason; details?: string | null },
): Promise<{ reported: true }> {
  const businessId = await assertOnboarded(tx, user);
  if ((await requestRoleFor(tx, id, businessId)) !== 'seller') throw partRequestNotFound();
  const details = body.details?.trim() || null;
  if (body.reason === 'other' && !details) throw new ValidationError('Tell us what is wrong', { field: 'details' });
  if (details && details.length > PART_REQUEST_LIMITS.noteMax) {
    throw new ValidationError('Keep it shorter', { field: 'details', max: PART_REQUEST_LIMITS.noteMax });
  }

  // F2's key, so every report target counts toward one daily limit without racing.
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

  const exists = () => new ConflictError('You have already reported this requirement', 'REPORT_EXISTS');
  const [open] = await tx
    .select({ id: reports.id })
    .from(reports)
    .where(
      and(
        eq(reports.reporterBusinessId, businessId),
        eq(reports.targetType, 'part_request'),
        eq(reports.targetId, id),
        inArray(reports.status, ['open', 'reviewing']),
      ),
    );
  if (open) throw exists();
  let reportId: string;
  try {
    const [row] = await tx
      .insert(reports)
      .values({ targetType: 'part_request', targetId: id, reporterUserId: user.userId, reporterBusinessId: businessId, reason: body.reason, details })
      .returning({ id: reports.id });
    reportId = row!.id;
  } catch (err) {
    if (isUniqueViolation(err, 'reports_one_open_uq')) throw exists();
    throw err;
  }
  for (const role of ['moderator', 'support'] as const) queueAdminEmit(tx, role, 'report:new', { reportId, target: 'part_request' });
  return { reported: true };
}
