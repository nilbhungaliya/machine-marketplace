import { and, eq } from 'drizzle-orm';
import type { PartRequestFeedbackReason } from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { partRequestFeedback } from '../../db/schema.js';
import { ConflictError } from '../../lib/errors.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { isEligibleSeller } from './eligibility.js';
import { lockOwnBusiness, lockPartRequest, partRequestNotFound, type PartRequestRow } from './locks.js';
import { assertOnboarded } from './request-input.js';

// "Not relevant" (spec §5.6, R7, plan A1-4): hides an active request from the business's For you and All lists (a
// direct link still opens, with Undo) and is kept as targeting feedback. Lock order (§9.5): the seller business, then
// the request `FOR SHARE`.

/** Locks and checks: onboarding, the seller business, the request `FOR SHARE`, eligible (else 404), `active` (else 409). */
async function lockForFeedback(tx: Tx, user: UserTokenPayload, id: string): Promise<{ businessId: string; row: PartRequestRow }> {
  const businessId = await assertOnboarded(tx, user);
  await lockOwnBusiness(tx, businessId);
  const row = await lockPartRequest(tx, id, 'share');
  if (!row || !(await isEligibleSeller(tx, id, businessId))) throw partRequestNotFound();
  if (row.status !== 'active') throw new ConflictError('This requirement is no longer open', 'PART_REQUEST_NOT_ACTIVE');
  return { businessId, row };
}

/** `POST /part-requests/:id/not-relevant { reason? }`: one row per business (a repeat updates the reason). */
export async function setNotRelevant(
  tx: Tx,
  user: UserTokenPayload,
  id: string,
  body: { reason?: PartRequestFeedbackReason | null },
): Promise<{ notRelevant: boolean }> {
  const { businessId, row } = await lockForFeedback(tx, user, id);
  await tx
    .insert(partRequestFeedback)
    .values({ partRequestId: row.id, businessId, userId: user.userId, reason: body.reason ?? null })
    .onConflictDoUpdate({
      target: [partRequestFeedback.partRequestId, partRequestFeedback.businessId],
      set: { reason: body.reason ?? null, userId: user.userId },
    });
  return { notRelevant: true };
}

/** `DELETE /part-requests/:id/not-relevant`: Undo. */
export async function clearNotRelevant(tx: Tx, user: UserTokenPayload, id: string): Promise<{ notRelevant: boolean }> {
  const { businessId, row } = await lockForFeedback(tx, user, id);
  await tx
    .delete(partRequestFeedback)
    .where(and(eq(partRequestFeedback.partRequestId, row.id), eq(partRequestFeedback.businessId, businessId)));
  return { notRelevant: false };
}
