import { eq, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import {
  DEAL_CANCEL_REASONS_BUYER,
  DEAL_CANCEL_REASONS_SELLER,
  type DealActorSide,
  type DealCancelReason,
  type DealCancelledBy,
  type DealCompletedHow,
  type DealEventCode,
  type DealFulfilment,
  type DealPaymentMethod,
  type DealStatus,
  type DealView,
  type NotificationType,
  type PartySide,
  type SystemLineCode,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { businesses, dealEvents, deals } from '../../db/schema.js';
import { ConflictError, ValidationError } from '../../lib/errors.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { publicText } from '../chat/chat-view.js';
import { emitToBusinesses } from '../chat/chat-emit.js';
import { assertCanWrite, type ChatReader } from '../chat/members.js';
import { finalizePrivatePhotos, presignPrivatePhoto } from '../chat/private-photo.js';
import { looksLikeScam } from '../chat/scam-patterns.js';
import { insertSystemLine, recomputeTurns } from '../chat/thread-lines.js';
import { lockListingOnly } from '../listings/locks.js';
import { notify } from '../notifications/notify.js';
import { reconcileOffersForListing } from '../offers/reconcile.js';
import { getSettings } from '../settings.service.js';
import { convertHold, releaseHold } from './holds.js';
import { dealActions, type DealStepAction } from './deal-actions.js';
import { lockDeal } from './locks.js';
import { buildDealView, dbNow, dealForParty, type DealRow } from './deal-view.js';

/**
 * The deal state machine (F6 + F7 spec §9.1–§9.5, R17–R21; ported from textile `services/deals/deal.service.ts`, without
 * payments, dispatch, samples or stock return). Every action:
 * 1. reads the deal's `listing_id` unlocked and checks the caller is a party (`404 DEAL_NOT_FOUND`) and not a `viewer`
 *    (`403 VIEWER_READ_ONLY`);
 * 2. locks the listing, then the deal (§8.5; F6 / F7 never lock the seller business) and re-checks status, side and role
 *    under the lock against `dealActions` (`409 DEAL_TRANSITION_NOT_ALLOWED`); only a notes edit checks `version`;
 * 3. writes the deal (`version + 1`), moves stock only through `holds.ts`, reconciles the listing's offers, then the
 *    deal event, the system line (thread last), `recomputeTurns`, notifications (§11.3 with P14: never the actor's own
 *    business for its own action) and `deal:updated` (ids only) to both businesses after commit.
 * Callers run these inside `runTx` / `runIdempotent`, so emits wait for the commit.
 */

type Conn = Db | Tx;

/** Who did it: a party (user), the system (a job, an admin removal) or support (a dispute resolution). */
export interface DealActor {
  side: DealActorSide;
  userId: string | null;
  adminId?: string | null;
}

export function transitionNotAllowed(deal: Pick<DealRow, 'status'>, action: string): ConflictError {
  return new ConflictError('This deal can’t do that now', 'DEAL_TRANSITION_NOT_ALLOWED', { status: deal.status, action });
}

/**
 * Step 1 and 2 for a party action: party check (unlocked read), viewer check, listing → deal locks. Returns the locked
 * deal and the reader.
 */
export async function lockDealForParty(tx: Tx, user: UserTokenPayload, dealId: string): Promise<{ deal: DealRow; reader: ChatReader }> {
  const { deal: unlocked, reader } = await dealForParty(tx, user, dealId);
  assertCanWrite(reader);
  await lockListingOnly(tx, unlocked.listingId);
  const deal = await lockDeal(tx, dealId);
  return { deal, reader };
}

/** Re-checks the action under the lock (§9.2); returns the database clock used for it. */
async function assertAction(tx: Tx, deal: DealRow, reader: ChatReader, action: DealStepAction): Promise<Date> {
  const now = await dbNow(tx);
  if (!dealActions(deal, reader.side, reader.memberRole, now).includes(action)) throw transitionNotAllowed(deal, action);
  return now;
}

/** Writes the deal: `version + 1`, `updated_at`. `onlyFrom` guards the status in the `UPDATE` itself. */
export async function updateDeal(
  tx: Tx,
  dealId: string,
  set: PgUpdateSetSource<typeof deals>,
  onlyFrom?: DealStatus[],
): Promise<DealRow | null> {
  const where = onlyFrom
    ? sql`${deals.id} = ${dealId} AND ${deals.status} IN (${sql.join(onlyFrom.map((s) => sql`${s}`), sql`, `)})`
    : eq(deals.id, dealId);
  const [row] = await tx
    .update(deals)
    .set({ ...set, version: sql`${deals.version} + 1`, updatedAt: sql`now()` })
    .where(where)
    .returning();
  return row ?? null;
}

/** A timeline event (§5.9). Values are codes, ids and numbers only, never free text. */
export async function recordEvent(
  tx: Tx,
  deal: Pick<DealRow, 'id'>,
  code: DealEventCode,
  actor: DealActor,
  values: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  await tx.insert(dealEvents).values({
    dealId: deal.id,
    code,
    actorSide: actor.side,
    actorUserId: actor.userId,
    actorAdminId: actor.adminId ?? null,
    values,
  });
}

/** The thread's system line for a deal event (§6.9); `actorSide` brings the thread back for the other side. */
export async function dealLine(
  tx: Tx,
  deal: Pick<DealRow, 'id' | 'ref' | 'threadId'>,
  code: SystemLineCode,
  values: Record<string, string | number> = {},
  actor?: DealActor,
): Promise<void> {
  const actorSide = actor && (actor.side === 'buyer' || actor.side === 'seller') ? actor.side : undefined;
  await insertSystemLine(tx, deal.threadId, code, { dealId: deal.id, ref: deal.ref, ...values }, actorSide ? { actorSide } : {});
}

/**
 * One notification to one side's business (§11.3). Params: ids and safe values only (§11.4): the deal ref, the listing
 * title snapshot and the other business's name, both masked.
 */
export async function notifyDealSide(
  tx: Tx,
  deal: DealRow,
  recipient: PartySide,
  type: NotificationType,
  dedupeKey: string,
): Promise<void> {
  const recipientId = recipient === 'buyer' ? deal.buyerBusinessId : deal.sellerBusinessId;
  const otherId = recipient === 'buyer' ? deal.sellerBusinessId : deal.buyerBusinessId;
  const [other] = await tx.select({ name: businesses.tradeName }).from(businesses).where(eq(businesses.id, otherId));
  await notify(tx, {
    type,
    recipientBusinessId: recipientId,
    params: { dealRef: deal.ref, listingTitle: publicText(deal.listingTitle), businessName: publicText(other?.name ?? null) },
    destination: { dealId: deal.id, threadId: deal.threadId },
    dedupeKey,
  });
}

/** After every change: the thread's turns, then `deal:updated` (ids, status, version: no text, R10) to both businesses. */
export async function afterDealChange(tx: Tx, deal: DealRow): Promise<void> {
  await recomputeTurns(tx, deal.threadId);
  emitToBusinesses(tx, [deal.buyerBusinessId, deal.sellerBusinessId], 'deal:updated', {
    dealId: deal.id,
    threadId: deal.threadId,
    status: deal.status,
    version: deal.version,
  });
}

const other = (side: PartySide): PartySide => (side === 'buyer' ? 'seller' : 'buyer');
const asParty = (reader: ChatReader): DealActor => ({ side: reader.side, userId: reader.userId });

async function viewFor(tx: Tx, deal: DealRow, reader: ChatReader, now?: Date): Promise<DealView> {
  return buildDealView(tx, deal, reader, now ?? (await dbNow(tx)));
}

// ─── notes (§9.1) ───

export interface DealNotesInput {
  version: number;
  paymentMethod?: DealPaymentMethod | null;
  advancePaise?: bigint | null;
  fulfilment?: DealFulfilment | null;
  expectedOn?: string | null;
  text?: string | null;
}

const NOTE_FIELDS = [
  ['paymentMethod', 'payment_method'],
  ['advancePaise', 'advance'],
  ['fulfilment', 'fulfilment'],
  ['expectedOn', 'expected_on'],
  ['text', 'text'],
] as const;

/**
 * `PATCH /deals/:id/notes`: either side's non-viewer while `agreed` / `handed_over`. `version` must match
 * (`409 DEAL_STALE`, the only action that checks it); advance ≤ total (400); the text is scam-checked at write time and
 * masked per reader on the way out. A save that changes something posts `deal_notes_changed` naming the fields, never
 * their values (§26 21). Nothing changed → the record as it is, no write.
 */
export async function editNotes(tx: Tx, user: UserTokenPayload, dealId: string, input: DealNotesInput): Promise<DealView> {
  const { deal, reader } = await lockDealForParty(tx, user, dealId);
  const now = await assertAction(tx, deal, reader, 'edit_notes');
  if (input.version !== deal.version) {
    throw new ConflictError('Someone changed this deal; reload it', 'DEAL_STALE', { version: deal.version });
  }
  if (input.advancePaise !== undefined && input.advancePaise !== null && (input.advancePaise < 0n || input.advancePaise > deal.totalPaise)) {
    throw new ValidationError('The advance can’t be more than the total', { totalPaise: deal.totalPaise.toString() });
  }
  const current = {
    paymentMethod: deal.paymentMethod,
    advancePaise: deal.advancePaise,
    fulfilment: deal.fulfilment,
    expectedOn: deal.expectedOn,
    text: deal.notesText,
  };
  const changed = NOTE_FIELDS.filter(([k]) => input[k] !== undefined && input[k] !== current[k]);
  if (changed.length === 0) return viewFor(tx, deal, reader, now);

  const set: PgUpdateSetSource<typeof deals> = { notesUpdatedAt: sql`now()`, notesUpdatedByUserId: reader.userId };
  for (const [k] of changed) {
    if (k === 'text') {
      set.notesText = input.text ?? null;
      set.notesScamFlag = input.text ? looksLikeScam(input.text) : false;
    } else if (k === 'paymentMethod') set.paymentMethod = input.paymentMethod ?? null;
    else if (k === 'advancePaise') set.advancePaise = input.advancePaise ?? null;
    else if (k === 'fulfilment') set.fulfilment = input.fulfilment ?? null;
    else set.expectedOn = input.expectedOn ?? null;
  }
  const updated = (await updateDeal(tx, deal.id, set))!;
  const fields = changed.map(([, name]) => name).join(',');
  await recordEvent(tx, updated, 'notes_changed', asParty(reader), { fields });
  await dealLine(tx, updated, 'deal_notes_changed', { by: reader.side, fields }, asParty(reader));
  await afterDealChange(tx, updated);
  return viewFor(tx, updated, reader, now);
}

// ─── photos (§6.8) ───

/** `POST /deals/:id/photos/presign`: a party's non-viewer, while the deal isn't final. */
export async function presignDealPhoto(
  conn: Conn,
  user: UserTokenPayload,
  dealId: string,
  contentType: string,
  contentLength: number,
): Promise<{ url: string; key: string; expiresAt: string }> {
  const { deal, reader } = await dealForParty(conn, user, dealId);
  assertCanWrite(reader);
  if (deal.status === 'completed' || deal.status === 'cancelled') throw transitionNotAllowed(deal, 'photo');
  const signed = await presignPrivatePhoto(reader.businessId, contentType, contentLength);
  return { url: signed.url, key: signed.key, expiresAt: signed.expiresAt.toISOString() };
}

/**
 * Before a photo action's transaction (hand over, problem): party and role checked, then the uploads finalized into
 * `deal/<dealId>/…` (P11: the route checks for a stored reply first, so a replay never gets here). Returns the final keys.
 */
export async function finalizeDealPhotos(conn: Conn, user: UserTokenPayload, dealId: string, keys: string[]): Promise<string[]> {
  if (keys.length === 0) return [];
  const { reader } = await dealForParty(conn, user, dealId);
  assertCanWrite(reader);
  return finalizePrivatePhotos(reader.businessId, keys, { kind: 'deal', dealId });
}

// ─── hand over (§9.2, §9.3) ───

/**
 * `POST /deals/:id/hand-over` (seller, `agreed`): `handed_over`, `problem_deadline_at = now() + deal_problem_window_days`,
 * `auto_complete_at = now() + deal_auto_complete_days` (plain days, R21), optional photo (already finalized) and note.
 * `deal_handed_over` to the buyer.
 */
export async function handOver(
  tx: Tx,
  user: UserTokenPayload,
  dealId: string,
  input: { photoKey: string | null; note: string | null },
): Promise<DealView> {
  const { deal, reader } = await lockDealForParty(tx, user, dealId);
  await assertAction(tx, deal, reader, 'hand_over');
  const settings = await getSettings(tx);
  const updated = (await updateDeal(
    tx,
    deal.id,
    {
      status: 'handed_over',
      handedOverAt: sql`now()`,
      handedOverByUserId: reader.userId,
      handoverPhotoKey: input.photoKey,
      handoverNote: input.note,
      problemDeadlineAt: sql`now() + make_interval(days => ${settings.deal_problem_window_days}::int)`,
      autoCompleteAt: sql`now() + make_interval(days => ${settings.deal_auto_complete_days}::int)`,
    },
    ['agreed'],
  ))!;
  await recordEvent(tx, updated, 'handed_over', asParty(reader), { photo: input.photoKey !== null });
  await dealLine(tx, updated, 'deal_handed_over', {}, asParty(reader));
  await notifyDealSide(tx, updated, 'buyer', 'deal_handed_over', `deal_handed_over:${updated.id}`);
  await afterDealChange(tx, updated);
  return viewFor(tx, updated, reader);
}

// ─── completion (§9.4) ───

/**
 * Completes a locked deal (buyer's confirm, the auto-complete job, support): `completed`, `completed_at`, `completed_how`;
 * a pending cancel request lapses (§9.2); the hold converts (quantity down, sell-out at 0) and the listing's offers
 * reconcile. Only from `from` (the `UPDATE` re-checks it): `null` when the deal was no longer there. Then the event, the
 * line and the notifications: `buyer_confirmed` → the seller only (P14), `auto` → both. Support's completion is worded
 * by the dispute resolution (its caller), so it writes neither.
 */
export async function completeDeal(
  tx: Tx,
  deal: DealRow,
  how: DealCompletedHow,
  actor: DealActor,
  from: DealStatus[],
): Promise<DealRow | null> {
  const updated = await updateDeal(
    tx,
    deal.id,
    {
      status: 'completed',
      completedAt: sql`now()`,
      completedHow: how,
      cancelRequestedSide: null,
      cancelRequestedAt: null,
      cancelRequestedReason: null,
      cancelRequestedByUserId: null,
    },
    from,
  );
  if (!updated) return null;
  await convertHold(tx, deal.id);
  await reconcileOffersForListing(tx, deal.listingId);
  if (how === 'buyer_confirmed') {
    await recordEvent(tx, updated, 'received', actor);
    await dealLine(tx, updated, 'deal_completed', { by: 'buyer' }, actor);
    await notifyDealSide(tx, updated, 'seller', 'deal_completed', `deal_completed:${updated.id}`);
  } else if (how === 'auto') {
    await recordEvent(tx, updated, 'auto_completed', actor);
    await dealLine(tx, updated, 'deal_auto_completed');
    await notifyDealSide(tx, updated, 'buyer', 'deal_completed', `deal_completed:${updated.id}`);
    await notifyDealSide(tx, updated, 'seller', 'deal_completed', `deal_completed:${updated.id}`);
  }
  return updated;
}

/** `POST /deals/:id/confirm-received` (buyer, `handed_over`). */
export async function confirmReceived(tx: Tx, user: UserTokenPayload, dealId: string): Promise<DealView> {
  const { deal, reader } = await lockDealForParty(tx, user, dealId);
  await assertAction(tx, deal, reader, 'confirm_received');
  const updated = await completeDeal(tx, deal, 'buyer_confirmed', asParty(reader), ['handed_over']);
  if (!updated) throw transitionNotAllowed(deal, 'confirm_received');
  await afterDealChange(tx, updated);
  return viewFor(tx, updated, reader);
}

// ─── cancelling (§9.5) ───

const reasonsOf = (side: PartySide): readonly string[] => (side === 'buyer' ? DEAL_CANCEL_REASONS_BUYER : DEAL_CANCEL_REASONS_SELLER);

function assertReason(side: PartySide, reason: string): DealCancelReason {
  if (!reasonsOf(side).includes(reason)) {
    throw new ValidationError('Pick a reason from the list', { reasons: [...reasonsOf(side)] });
  }
  return reason as DealCancelReason;
}

/**
 * Cancels a locked deal from `from` (the `UPDATE` re-checks it): `cancelled`, who and why, the request cleared; the
 * hold released (`stock: 'release'`) or converted (`'convert'`: a dispute closed with the goods not back, §9.6); the
 * listing's offers reconciled (backups revive). Writes the event and the line; the caller sends the notifications.
 * `null` when the deal had left `from`.
 */
export async function applyCancellation(
  tx: Tx,
  deal: DealRow,
  input: { by: DealCancelledBy; actor: DealActor; reason: DealCancelReason; note: string | null; stock: 'release' | 'convert' },
  from: DealStatus[],
): Promise<DealRow | null> {
  const updated = await updateDeal(
    tx,
    deal.id,
    {
      status: 'cancelled',
      cancelledAt: sql`now()`,
      cancelledBySide: input.by,
      cancelReason: input.reason,
      cancelNote: input.note,
      cancelRequestedSide: null,
      cancelRequestedAt: null,
      cancelRequestedReason: null,
      cancelRequestedByUserId: null,
    },
    from,
  );
  if (!updated) return null;
  if (input.stock === 'release') await releaseHold(tx, deal.id);
  else await convertHold(tx, deal.id);
  await reconcileOffersForListing(tx, deal.listingId);
  await recordEvent(tx, updated, 'cancelled', input.actor, { by: input.by, reason: input.reason, stockReturned: input.stock === 'release' });
  await dealLine(tx, updated, 'deal_cancelled', { by: input.by, reason: input.reason }, input.actor);
  return updated;
}

/** `POST /deals/:id/cancel` (`agreed`, either side alone): the hold is released; `deal_cancelled` to the other side. */
export async function cancelDeal(
  tx: Tx,
  user: UserTokenPayload,
  dealId: string,
  input: { reason: string; note: string | null },
): Promise<DealView> {
  const { deal, reader } = await lockDealForParty(tx, user, dealId);
  await assertAction(tx, deal, reader, 'cancel');
  const reason = assertReason(reader.side, input.reason);
  const updated = await applyCancellation(
    tx,
    deal,
    { by: reader.side, actor: asParty(reader), reason, note: input.note, stock: 'release' },
    ['agreed'],
  );
  if (!updated) throw transitionNotAllowed(deal, 'cancel');
  await notifyDealSide(tx, updated, other(reader.side), 'deal_cancelled', `deal_cancelled:${updated.id}`);
  await afterDealChange(tx, updated);
  return viewFor(tx, updated, reader);
}

/** `POST /deals/:id/cancel-request` (`handed_over`, either side; `409 CANCEL_REQUEST_EXISTS` while one is pending). */
export async function requestCancel(tx: Tx, user: UserTokenPayload, dealId: string, input: { reason: string | null }): Promise<DealView> {
  const { deal, reader } = await lockDealForParty(tx, user, dealId);
  if (deal.status === 'handed_over' && deal.cancelRequestedSide !== null) {
    throw new ConflictError('A cancel request is already waiting', 'CANCEL_REQUEST_EXISTS', { side: deal.cancelRequestedSide });
  }
  await assertAction(tx, deal, reader, 'request_cancel');
  const reason = input.reason === null ? null : assertReason(reader.side, input.reason);
  const updated = (await updateDeal(
    tx,
    deal.id,
    {
      cancelRequestedSide: reader.side,
      cancelRequestedAt: sql`now()`,
      cancelRequestedReason: reason,
      cancelRequestedByUserId: reader.userId,
    },
    ['handed_over'],
  ))!;
  await recordEvent(tx, updated, 'cancel_requested', asParty(reader), { by: reader.side, reason });
  await dealLine(tx, updated, 'deal_cancel_requested', { by: reader.side, ...(reason ? { reason } : {}) }, asParty(reader));
  await notifyDealSide(tx, updated, other(reader.side), 'deal_cancel_requested', `deal_cancel_requested:${updated.id}:${updated.version}`);
  await afterDealChange(tx, updated);
  return viewFor(tx, updated, reader);
}

function assertRequestPending(deal: DealRow): void {
  if (deal.status === 'handed_over' && deal.cancelRequestedSide === null) {
    throw new ConflictError('There is no cancel request', 'NO_CANCEL_REQUEST');
  }
}

/**
 * `POST /deals/:id/cancel-request/accept` (the side that didn't ask): `cancelled` by `both`, the hold released (the
 * goods are assumed back, §9.5); `deal_cancelled` to the requester.
 */
export async function acceptCancelRequest(tx: Tx, user: UserTokenPayload, dealId: string): Promise<DealView> {
  const { deal, reader } = await lockDealForParty(tx, user, dealId);
  assertRequestPending(deal);
  await assertAction(tx, deal, reader, 'accept_cancel_request');
  const updated = await applyCancellation(
    tx,
    deal,
    {
      by: 'both',
      actor: asParty(reader),
      reason: (deal.cancelRequestedReason as DealCancelReason | null) ?? 'other',
      note: null,
      stock: 'release',
    },
    ['handed_over'],
  );
  if (!updated) throw transitionNotAllowed(deal, 'accept_cancel_request');
  await notifyDealSide(tx, updated, other(reader.side), 'deal_cancelled', `deal_cancelled:${updated.id}`);
  await afterDealChange(tx, updated);
  return viewFor(tx, updated, reader);
}

/** `POST /deals/:id/cancel-request/clear`: the requester withdraws it or the other side declines it (one action, §27 30). */
export async function clearCancelRequest(tx: Tx, user: UserTokenPayload, dealId: string): Promise<DealView> {
  const { deal, reader } = await lockDealForParty(tx, user, dealId);
  assertRequestPending(deal);
  await assertAction(tx, deal, reader, 'clear_cancel_request');
  const requester = deal.cancelRequestedSide;
  const updated = (await updateDeal(
    tx,
    deal.id,
    { cancelRequestedSide: null, cancelRequestedAt: null, cancelRequestedReason: null, cancelRequestedByUserId: null },
    ['handed_over'],
  ))!;
  const declined = requester !== reader.side;
  await recordEvent(tx, updated, 'cancel_request_withdrawn', asParty(reader), { by: reader.side, declined });
  await dealLine(tx, updated, 'deal_cancel_request_withdrawn', { by: reader.side }, asParty(reader));
  await afterDealChange(tx, updated);
  return viewFor(tx, updated, reader);
}
