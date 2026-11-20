import { and, eq, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import {
  rentalBookingTransition,
  type NotificationType,
  type PartySide,
  type RentalActorSide,
  type RentalBookingAction,
  type RentalBookingStatus,
  type RentalEventCode,
  type RentalTransitionSide,
  type SystemLineCode,
} from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { businesses, chatThreads, rentalBookingEvents, rentalBookings } from '../../db/schema.js';
import { ConflictError } from '../../lib/errors.js';
import { queueAdminEmit } from '../../lib/tx-effects.js';
import { emitToBusinesses } from '../chat/chat-emit.js';
import { publicText } from '../chat/chat-view.js';
import { insertMessage, recomputeTurns } from '../chat/thread-lines.js';
import { lockThread } from '../deals/locks.js';
import { notify } from '../notifications/notify.js';
import type { RentalBookingRow } from './locks.js';

/**
 * The booking write helpers (M14 spec §6.1, plan C0-3a; the F6 `deal.service.ts` recipe: `updateDeal`, `recordEvent`,
 * `dealLine`, `notifyDealSide`, `afterDealChange`). **`writeBookingStatus` is the only writer of
 * `rental_bookings.status` after the request's insert**, in every lane. The caller holds the locks of §6.7 (listing
 * first when capacity changes, then the booking `FOR NO KEY UPDATE`); the line takes the thread last.
 */

export type RentalBookingColumns = PgUpdateSetSource<typeof rentalBookings>;

/** Who did it. Support resolving a dispute acts as `admin` (`rental_actor_side` has no `support`). */
export interface BookingActor {
  side: RentalActorSide;
  userId?: string | null;
  adminId?: string | null;
}

export type BookingValues = Record<string, string | number | boolean | null>;

/**
 * One notification for one or both sides (§11). `notifyBooking` resolves the members and builds the stored params from
 * the booking row, so senders pass none. `dedupeKey` defaults to `<type>:<bookingId>:v<version>` (one per event).
 */
export interface BookingNotify {
  to: 'renter' | 'owner' | 'both';
  type: NotificationType;
  dedupeKey?: string;
  /** F8's switch: false writes the rows without push deliveries. Default true. */
  push?: boolean;
}

export interface WriteBookingStatusOptions {
  /** The timeline event; default: the action's code (`ACTION_EVENT`) with the reason values. `false`: none. */
  event?: { code: RentalEventCode; values?: BookingValues } | false;
  /** The thread's system line; default: the action's `booking_*` code with ref and reason values. `false`: none. */
  line?: { code: SystemLineCode; values?: Record<string, string | number> } | false;
  notify?: BookingNotify[];
}

export function bookingTransitionNotAllowed(b: Pick<RentalBookingRow, 'status'>, action: string): ConflictError {
  return new ConflictError('This booking can’t do that now', 'RENTAL_TRANSITION_NOT_ALLOWED', { status: b.status, action });
}

const ACTION_EVENT: Record<Exclude<RentalBookingAction, 'request' | 'change'>, RentalEventCode> = {
  confirm: 'confirmed',
  accept: 'change_accepted',
  decline: 'declined',
  withdraw: 'withdrawn',
  expire: 'expired',
  on_site: 'on_site',
  return: 'returned',
  confirm_return: 'return_confirmed',
  auto_complete: 'auto_completed',
  cancel: 'cancelled',
  problem: 'problem_reported',
  resolve_completed: 'dispute_resolved',
  resolve_cancelled: 'dispute_resolved',
  resume: 'dispute_resolved',
  admin_cancel: 'cancelled',
  system_decline: 'declined',
  system_withdraw: 'withdrawn',
  system_cancel: 'cancelled',
};

const ACTION_LINE: Record<RentalBookingAction, SystemLineCode> = {
  request: 'booking_requested',
  change: 'booking_changed',
  confirm: 'booking_confirmed',
  accept: 'booking_confirmed',
  decline: 'booking_declined',
  withdraw: 'booking_withdrawn',
  expire: 'booking_expired',
  on_site: 'booking_on_site',
  return: 'booking_returned',
  confirm_return: 'booking_completed',
  auto_complete: 'booking_completed',
  cancel: 'booking_cancelled',
  problem: 'booking_problem',
  resolve_completed: 'booking_dispute_resolved',
  resolve_cancelled: 'booking_dispute_resolved',
  resume: 'booking_dispute_resolved',
  admin_cancel: 'booking_cancelled',
  system_decline: 'booking_declined',
  system_withdraw: 'booking_withdrawn',
  system_cancel: 'booking_cancelled',
};

const SUPPORT_ACTIONS: readonly RentalBookingAction[] = ['resolve_completed', 'resolve_cancelled', 'resume'];

/** The side `rentalBookingTransition` checks: an admin resolving a dispute is `support`. */
function transitionSide(action: RentalBookingAction, actor: BookingActor): RentalTransitionSide {
  return actor.side === 'admin' && SUPPORT_ACTIONS.includes(action) ? 'support' : actor.side;
}

const partySide = (side: RentalActorSide): PartySide | undefined =>
  side === 'renter' ? 'buyer' : side === 'owner' ? 'seller' : undefined;

/** A timeline event (§5.3). Values are codes, ids, dates and numbers only, never text a user typed. */
export async function recordBookingEvent(
  tx: Tx,
  bookingId: string,
  code: RentalEventCode,
  actor: BookingActor,
  values: BookingValues = {},
): Promise<void> {
  await tx.insert(rentalBookingEvents).values({
    bookingId,
    code,
    actorSide: actor.side,
    actorUserId: actor.userId ?? null,
    actorAdminId: actor.adminId ?? null,
    values,
  });
}

/**
 * The thread's system line for a booking step (§8): a `booking_*` code with ids, the ref, dates, reason codes and
 * totals (never text a user typed), and the booking id on the row. `values` should carry `bookingId` and `ref` (the
 * line's readers link them); `writeBookingStatus` adds both. `actorSide` (a party) brings the thread back from the
 * other side's archive; jobs, admins and system exits pass none. Locks the thread (last in §6.7).
 */
export async function bookingLine(
  tx: Tx,
  threadId: string,
  code: SystemLineCode,
  values: Record<string, string | number>,
  actorSide?: RentalActorSide,
): Promise<void> {
  const thread = await lockThread(tx, threadId);
  const side = actorSide ? partySide(actorSide) : undefined;
  const bookingId = typeof values.bookingId === 'string' ? values.bookingId : null;
  await insertMessage(
    tx,
    thread,
    { kind: 'system', systemCode: code, systemValues: values, rentalBookingId: bookingId },
    side ? { actorSide: side } : {},
  );
}

/**
 * Notifications for one or both sides of a booking (§11). Stored params (ids and safe values only, R14): `bookingRef`,
 * `listingId`, `listingTitle` (the snapshot, masked), `startDate`, `endDate`, and the recipient's counterpart
 * `businessId` + `businessName` (masked); `render.ts` masks names and titles again and words `dates`. Never amounts,
 * the site, a note or a message. Destination `{ rentalBookingId, threadId }`.
 */
export async function notifyBooking(tx: Tx, b: RentalBookingRow, n: BookingNotify): Promise<void> {
  const sides: Array<'renter' | 'owner'> = n.to === 'both' ? ['renter', 'owner'] : [n.to];
  for (const side of sides) {
    const recipientId = side === 'renter' ? b.renterBusinessId : b.ownerBusinessId;
    const otherId = side === 'renter' ? b.ownerBusinessId : b.renterBusinessId;
    const [other] = await tx.select({ name: businesses.tradeName }).from(businesses).where(eq(businesses.id, otherId));
    await notify(tx, {
      type: n.type,
      recipientBusinessId: recipientId,
      params: {
        bookingRef: b.ref,
        listingId: b.listingId,
        listingTitle: publicText(b.listingTitle),
        startDate: b.startDate,
        endDate: b.endDate,
        businessId: otherId,
        businessName: publicText(other?.name ?? null),
      },
      destination: { rentalBookingId: b.id, threadId: b.threadId },
      dedupeKey: n.dedupeKey ?? `${n.type}:${b.id}:v${b.version}`,
      ...(n.push === false ? { push: false } : {}),
    });
  }
}

/** `rental:updated` (ids, status, version: no text) to both businesses and the admin rooms `operations` / `support` (D12). */
export function emitBookingUpdated(tx: Tx, b: RentalBookingRow): void {
  emitToBusinesses(tx, [b.renterBusinessId, b.ownerBusinessId], 'rental:updated', {
    bookingId: b.id,
    threadId: b.threadId,
    status: b.status,
    version: b.version,
  });
  queueAdminEmit(tx, 'operations', 'rental:updated', { bookingId: b.id });
  queueAdminEmit(tx, 'support', 'rental:updated', { bookingId: b.id });
}

/** The reason codes a step's event and line carry by default (from the patch), never notes. */
function reasonValues(patch: RentalBookingColumns): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof patch.declineReason === 'string') out.reason = patch.declineReason;
  if (typeof patch.cancelReason === 'string') out.reason = patch.cancelReason;
  return out;
}

/**
 * The status write (§6.1, plan C0-3a). Checks `rentalBookingTransition(b.status, action, side)` (`409
 * RENTAL_TRANSITION_NOT_ALLOWED`), then one `UPDATE … WHERE id AND status = b.status` (a stale row → the same 409) with
 * `patch`, `version + 1`, `updated_at` and what the status itself implies unless the patch says otherwise:
 * - `turn`: owner on `requested`, renter on `countered`, else null (CHECK);
 * - `confirmed_at` when it becomes `confirmed` the first time; `completed_at` on `completed`; `cancelled_at` +
 *   `cancelled_by_side` (the actor) on `cancelled`;
 * - `disputed_from` = the old status on `disputed`, cleared when it leaves `disputed`.
 * Then the event (default per action), the system line (default per action, with `bookingId`, `ref` and the reason
 * code), `recomputeTurns`, the notifications, and `rental:updated` (D12). Returns the written row. The caller decides
 * timestamps such as `reply_due_at`, `on_site_at`, `auto_complete_at` and the reasons, in `patch`.
 */
export async function writeBookingStatus(
  tx: Tx,
  b: RentalBookingRow,
  action: RentalBookingAction,
  actor: BookingActor,
  patch: RentalBookingColumns = {},
  opts: WriteBookingStatusOptions = {},
): Promise<RentalBookingRow> {
  const to = rentalBookingTransition(b.status, action, transitionSide(action, actor), { disputedFrom: b.disputedFrom });
  if (!to) throw bookingTransitionNotAllowed(b, action);

  const implied: RentalBookingColumns = {
    turn: to === 'requested' ? 'owner' : to === 'countered' ? 'renter' : null,
    ...(to === 'confirmed' && !b.confirmedAt ? { confirmedAt: sql`now()` } : {}),
    ...(to === 'completed' ? { completedAt: sql`now()` } : {}),
    ...(to === 'cancelled' ? { cancelledAt: sql`now()`, cancelledBySide: actor.side } : {}),
    ...(to === 'disputed' ? { disputedFrom: b.status as RentalBookingStatus } : b.status === 'disputed' ? { disputedFrom: null } : {}),
  };
  const [row] = await tx
    .update(rentalBookings)
    .set({ ...implied, ...patch, status: to, version: sql`${rentalBookings.version} + 1`, updatedAt: sql`now()` })
    .where(and(eq(rentalBookings.id, b.id), eq(rentalBookings.status, b.status)))
    .returning();
  if (!row) throw bookingTransitionNotAllowed(b, action);

  const reasons = reasonValues(patch);
  if (opts.event !== false) {
    const code = opts.event?.code ?? (action === 'change' ? (actor.side === 'owner' ? 'changed_by_owner' : 'changed_by_renter') : action === 'request' ? 'requested' : ACTION_EVENT[action]);
    await recordBookingEvent(tx, row.id, code, actor, { ...reasons, ...(opts.event?.values ?? {}) });
  }
  if (opts.line !== false) {
    await bookingLine(
      tx,
      row.threadId,
      opts.line?.code ?? ACTION_LINE[action],
      { bookingId: row.id, ref: row.ref, ...reasons, ...(opts.line?.values ?? {}) },
      actor.side,
    );
  }
  // The owner's answer is the seller's reply to the thread (as F6's `markSellerReplied`): turns follow only open
  // bookings (D10, C0 review M6), so without it a booking-opened thread would fall back to the enquiry's owner turn.
  if (actor.side === 'owner') {
    await tx
      .update(chatThreads)
      .set({ firstSellerReplyAt: sql`coalesce(${chatThreads.firstSellerReplyAt}, now())` })
      .where(eq(chatThreads.id, row.threadId));
  }
  await recomputeTurns(tx, row.threadId);
  for (const n of opts.notify ?? []) await notifyBooking(tx, row, n);
  emitBookingUpdated(tx, row);
  return row;
}
