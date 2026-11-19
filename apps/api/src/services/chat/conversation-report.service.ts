import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import { CHAT_LIMITS, type ConversationReportReason } from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { reports } from '../../db/schema.js';
import { ConflictError, TooManyRequestsError, ValidationError } from '../../lib/errors.js';
import { isUniqueViolation } from '../../lib/pg-errors.js';
import { queueAdminEmit } from '../../lib/tx-effects.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { REPORTS_PER_DAY } from '../listings/listing-reports.service.js';
import { blockFromThread } from './block.service.js';
import { assertCanWrite, getThreadForParty } from './members.js';

/**
 * Report a conversation (F6 + F7 spec §6.12): reason + details (required for `other`, ≤ 500), optional "Also block" in
 * the same transaction. A `reports` row (`target_type = conversation`, `target_id = thread id`) opens the conversation
 * to admin reading (§16.3). One open report per business and thread (`409 REPORT_EXISTS`); 10 reports a day per user
 * across every target, counted on the table as F2 does (`429 REPORT_LIMIT`, serialised by F2's per-user advisory lock).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ConversationReportInput {
  reason: ConversationReportReason;
  details?: string | null;
  block?: boolean;
}

/** `POST /threads/:id/report` → `{ reported: true }`. `report:new` (ids only) to moderators and support. */
export async function reportConversation(
  tx: Tx,
  user: UserTokenPayload,
  threadId: string,
  input: ConversationReportInput,
): Promise<{ reported: true }> {
  const { thread, reader } = await getThreadForParty(tx, user, threadId);
  assertCanWrite(reader);
  const details = input.details?.trim() || null;
  if (input.reason === 'other' && !details) throw new ValidationError('Tell us what is wrong', { field: 'details' });
  if (details && details.length > CHAT_LIMITS.reportDetailsMax) {
    throw new ValidationError('Keep it shorter', { field: 'details', max: CHAT_LIMITS.reportDetailsMax });
  }

  // The same key as F2's listing reports, so both count toward one daily limit without racing.
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

  const exists = () => new ConflictError('You have already reported this conversation', 'REPORT_EXISTS');
  const [open] = await tx
    .select({ id: reports.id })
    .from(reports)
    .where(
      and(
        eq(reports.reporterBusinessId, reader.businessId),
        eq(reports.targetType, 'conversation'),
        eq(reports.targetId, thread.id),
        inArray(reports.status, ['open', 'reviewing']),
      ),
    );
  if (open) throw exists();
  let reportId: string;
  try {
    const [row] = await tx
      .insert(reports)
      .values({
        targetType: 'conversation',
        targetId: thread.id,
        reporterUserId: reader.userId,
        reporterBusinessId: reader.businessId,
        reason: input.reason,
        details,
      })
      .returning({ id: reports.id });
    reportId = row!.id;
  } catch (err) {
    if (isUniqueViolation(err, 'reports_one_open_uq')) throw exists();
    throw err;
  }

  if (input.block) await blockFromThread(tx, user, thread.id);
  for (const role of ['moderator', 'support'] as const) {
    queueAdminEmit(tx, role, 'report:new', { reportId, target: 'conversation' });
  }
  return { reported: true };
}
