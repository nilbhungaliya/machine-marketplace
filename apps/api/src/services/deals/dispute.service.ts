import { eq, sql } from 'drizzle-orm';
import type { DealView, DisputeCategory, DisputeOutcome, PartySide } from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { dealDisputes, deals } from '../../db/schema.js';
import { AppError, ConflictError, ValidationError } from '../../lib/errors.js';
import { queueAdminEmit } from '../../lib/tx-effects.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { lockListingOnly } from '../listings/locks.js';
import { writeAudit } from '../audit.service.js';
import { getSettings } from '../settings.service.js';
import { resolveBookingDispute } from '../rentals/rental-disputes.js';
import { subjectOf, type ReviewSubjectRef } from '../reviews/subject.js';
import { problemWindowOpen } from './deal-actions.js';
import {
  afterDealChange,
  applyCancellation,
  completeDeal,
  dealLine,
  lockDealForParty,
  notifyDealSide,
  recordEvent,
  transitionNotAllowed,
  updateDeal,
  type DealActor,
} from './deal.service.js';
import { buildDealView, dbNow, type DealRow } from './deal-view.js';
import { lockDeal } from './locks.js';

/**
 * Problems and disputes (F6 + F7 spec §9.6, R20; ported from textile `services/deals/deal-problems.service.ts` and the
 * resolve of `deal-admin.service.ts`, D12 / D17 / D18). A reported problem freezes the deal (`disputed`, timers
 * stopped) for support, who closes it completed, cancelled (goods back or not) or resumed. The dispute rows are both
 * businesses' history.
 */

export type DisputeRow = typeof dealDisputes.$inferSelect;

export function disputeNotFound(): AppError {
  return new AppError('Dispute not found', 404, 'NOT_FOUND');
}

/**
 * `POST /deals/:id/problem` (§9.6): the buyer until `problem_deadline_at` (`409 PROBLEM_WINDOW_CLOSED`), the seller
 * until completion (§26 19), both only on `handed_over`. Photos are finalized before the transaction (`photoKeys`
 * here are final keys). The deal goes `disputed` with both timers cleared and a pending cancel request lapsed; the
 * dispute row, event and line; `deal_problem` to the other side; `dispute:new` (ids only) to support.
 */
export async function reportProblem(
  tx: Tx,
  user: UserTokenPayload,
  dealId: string,
  input: { category: DisputeCategory; description: string; photoKeys: string[] },
): Promise<DealView> {
  const { deal, reader } = await lockDealForParty(tx, user, dealId);
  const now = await dbNow(tx);
  if (deal.status !== 'handed_over' || reader.memberRole === 'viewer') throw transitionNotAllowed(deal, 'report_problem');
  if (reader.side === 'buyer' && !problemWindowOpen(deal, now)) {
    throw new ConflictError('The time to report a problem has passed', 'PROBLEM_WINDOW_CLOSED', {
      deadline: deal.problemDeadlineAt?.toISOString() ?? null,
    });
  }
  const updated = (await updateDeal(
    tx,
    deal.id,
    {
      status: 'disputed',
      problemDeadlineAt: null,
      autoCompleteAt: null,
      cancelRequestedSide: null,
      cancelRequestedAt: null,
      cancelRequestedReason: null,
      cancelRequestedByUserId: null,
    },
    ['handed_over'],
  ))!;
  const [dispute] = await tx
    .insert(dealDisputes)
    .values({
      dealId: deal.id,
      openedBySide: reader.side,
      openedByUserId: reader.userId,
      category: input.category,
      description: input.description,
      photoKeys: input.photoKeys,
    })
    .returning();
  const actor: DealActor = { side: reader.side, userId: reader.userId };
  await recordEvent(tx, updated, 'problem_reported', actor, { disputeId: dispute!.id, category: input.category, by: reader.side });
  await dealLine(tx, updated, 'deal_problem_reported', { by: reader.side, category: input.category }, actor);
  const otherSide: PartySide = reader.side === 'buyer' ? 'seller' : 'buyer';
  await notifyDealSide(tx, updated, otherSide, 'deal_problem', `deal_problem:${dispute!.id}`);
  queueAdminEmit(tx, 'support', 'dispute:new', { disputeId: dispute!.id, dealId: deal.id });
  await afterDealChange(tx, updated);
  return buildDealView(tx, updated, reader, now);
}

export interface ResolveInput {
  outcome: DisputeOutcome;
  /**
   * Deal disputes: required for `cancelled` (did the goods go back to the seller?), else ignored. Booking disputes:
   * must be absent (M14 R12: a booking resolve never touches stock), `400` when sent.
   */
  stockReturned?: boolean | null;
  internalNote: string;
  messageToParties: string | null;
}

function auditState(deal: DealRow, dispute: DisputeRow) {
  return {
    dealStatus: deal.status,
    disputeStatus: dispute.status,
    outcome: dispute.outcome,
    stockReturned: dispute.stockReturned,
    internalNote: dispute.internalNote,
    messageToParties: dispute.messageToParties,
  };
}

/**
 * `POST /admin/disputes/:id/resolve` (support, §9.6): `409 DISPUTE_NOT_OPEN` unless open. A rental booking's dispute
 * (M14 R12) goes to `resolveBookingDispute` (listing → booking → dispute; `stockReturned` refused). A deal's locks
 * listing → deal → dispute (§8.5). Deal outcomes (§9.2):
 * - `completed`: the deal completes (`support`), the hold converts;
 * - `cancelled` (`support_closed`): `stockReturned` true releases the hold, false converts it (the stock left);
 * - `resumed`: back to `handed_over` with both timers restarted from now.
 * The dispute row records the outcome; event and the `deal_dispute_resolved` line (with the message to the parties, as
 * written by staff); `deal_dispute_resolved` to both; audit `deal.dispute_resolve` with before / after.
 */
export async function resolveDispute(
  tx: Tx,
  adminId: string,
  disputeId: string,
  input: ResolveInput,
): Promise<{ disputeId: string; subject: ReviewSubjectRef }> {
  const [seen] = await tx
    .select({ dealId: dealDisputes.dealId, rentalBookingId: dealDisputes.rentalBookingId })
    .from(dealDisputes)
    .where(eq(dealDisputes.id, disputeId));
  if (!seen) throw disputeNotFound();
  const subject = subjectOf(seen);
  if (subject.kind === 'rental') {
    if (input.stockReturned !== undefined && input.stockReturned !== null) {
      throw new ValidationError('A rental booking has no stock to return', { field: 'stockReturned' });
    }
    await resolveBookingDispute(tx, adminId, disputeId, subject.id, {
      outcome: input.outcome,
      internalNote: input.internalNote,
      messageToParties: input.messageToParties,
    });
    return { disputeId, subject };
  }
  const stockReturned = input.stockReturned ?? null;
  if (input.outcome === 'cancelled' && stockReturned === null) {
    throw new ValidationError('Say whether the goods went back to the seller', { field: 'stockReturned' });
  }

  // §8.5: ids read unlocked first, then listing → deal → dispute.
  const [unlocked] = await tx.select({ listingId: deals.listingId }).from(deals).where(eq(deals.id, subject.id));
  if (!unlocked) throw disputeNotFound();
  await lockListingOnly(tx, unlocked.listingId);
  const deal = await lockDeal(tx, subject.id);
  const [dispute] = await tx.select().from(dealDisputes).where(eq(dealDisputes.id, disputeId)).for('update');
  if (!dispute || dispute.status !== 'open') throw new ConflictError('This dispute is already resolved', 'DISPUTE_NOT_OPEN');
  if (deal.status !== 'disputed') throw transitionNotAllowed(deal, 'resolve');

  const actor: DealActor = { side: 'support', userId: null, adminId };
  let after: DealRow | null;
  if (input.outcome === 'completed') {
    after = await completeDeal(tx, deal, 'support', actor, ['disputed']);
  } else if (input.outcome === 'cancelled') {
    after = await applyCancellation(
      tx,
      deal,
      { by: 'system', actor, reason: 'support_closed', note: null, stock: stockReturned ? 'release' : 'convert' },
      ['disputed'],
    );
  } else {
    const settings = await getSettings(tx);
    after = await updateDeal(
      tx,
      deal.id,
      {
        status: 'handed_over',
        problemDeadlineAt: sql`now() + make_interval(days => ${settings.deal_problem_window_days}::int)`,
        autoCompleteAt: sql`now() + make_interval(days => ${settings.deal_auto_complete_days}::int)`,
      },
      ['disputed'],
    );
  }
  if (!after) throw transitionNotAllowed(deal, 'resolve');

  const [resolved] = await tx
    .update(dealDisputes)
    .set({
      status: 'resolved',
      outcome: input.outcome,
      stockReturned: input.outcome === 'cancelled' ? stockReturned : null,
      internalNote: input.internalNote,
      messageToParties: input.messageToParties,
      resolvedByAdminId: adminId,
      resolvedAt: sql`now()`,
    })
    .where(eq(dealDisputes.id, disputeId))
    .returning();

  await recordEvent(tx, after, 'dispute_resolved', actor, {
    disputeId,
    outcome: input.outcome,
    stockReturned: input.outcome === 'cancelled' ? stockReturned : null,
  });
  await dealLine(tx, after, 'deal_dispute_resolved', {
    outcome: input.outcome,
    ...(input.messageToParties ? { message: input.messageToParties } : {}),
  });
  await notifyDealSide(tx, after, 'buyer', 'deal_dispute_resolved', `deal_dispute_resolved:${disputeId}`);
  await notifyDealSide(tx, after, 'seller', 'deal_dispute_resolved', `deal_dispute_resolved:${disputeId}`);
  await writeAudit(tx, {
    adminId,
    action: 'deal.dispute_resolve',
    entityType: 'deal_dispute',
    entityId: disputeId,
    before: auditState(deal, dispute),
    after: auditState(after, resolved!),
  });
  await afterDealChange(tx, after);
  return { disputeId, subject };
}
