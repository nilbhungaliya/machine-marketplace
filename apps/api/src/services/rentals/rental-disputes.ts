import { eq, sql } from 'drizzle-orm';
import {
  DEAL_LIMITS,
  RENTAL_DISPUTE_CATEGORIES,
  type DisputeOutcome,
  type PartySide,
  type RentalDisputeCategory,
} from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { dealDisputes, rentalBookings, users } from '../../db/schema.js';
import { AppError, ConflictError, ForbiddenError, ValidationError } from '../../lib/errors.js';
import { queueAdminEmit, runTx, type TxApp } from '../../lib/tx-effects.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { writeAudit } from '../audit.service.js';
import { onboardingForUser } from '../business/profile.service.js';
import { getSettings } from '../settings.service.js';
import { bookingTransitionNotAllowed, writeBookingStatus, type BookingActor } from './booking-write.js';
import { lockListingForRental, lockRentalBooking, type RentalBookingRow } from './locks.js';
import { syncRentalStatus } from './status-sync.js';

// M14 lane A3 (plan A3-2, spec R12, §6.1): a party reports a problem on an `on_rent` / `returned` booking → `disputed`
// plus a dispute row (subject `rental`); support resolves it from F6's Disputes queue (`resolveDispute` hands booking
// disputes to `resolveBookingDispute`). A1's `POST /rental-bookings/:id/problem` route finalises the photos
// (destination `{ kind: 'rental', step: 'problem' }`) before calling `reportBookingProblem`, then rereads the booking
// with its own view. Lock order (§6.7): listing `FOR UPDATE` → booking `FOR NO KEY UPDATE` → dispute → thread (the line).

export interface ReportBookingProblemInput {
  category: RentalDisputeCategory;
  description: string;
  /** Final private keys (`rental/<bookingId>/…`), finalised by the route. */
  photoKeys: string[];
}

/** A rental problem report's photos (plan D8: problem 5, as a deal problem). */
const PROBLEM_PHOTOS_MAX = 5;

const bookingNotFound = (): AppError => new AppError('Booking not found', 404, 'RENTAL_BOOKING_NOT_FOUND');

function checkInput(bookingId: string, input: ReportBookingProblemInput): { description: string } {
  if (!(RENTAL_DISPUTE_CATEGORIES as readonly string[]).includes(input.category)) {
    throw new ValidationError('Pick what went wrong', { field: 'category' });
  }
  const description = input.description.trim();
  if (description.length < DEAL_LIMITS.disputeDescriptionMin || description.length > DEAL_LIMITS.disputeDescriptionMax) {
    throw new ValidationError(
      `Describe the problem in ${DEAL_LIMITS.disputeDescriptionMin} to ${DEAL_LIMITS.disputeDescriptionMax} characters`,
      { field: 'description' },
    );
  }
  if (input.photoKeys.length > PROBLEM_PHOTOS_MAX || input.photoKeys.some((k) => !k.startsWith(`rental/${bookingId}/`))) {
    throw new ValidationError('These photos can’t be attached', { field: 'photoKeys' });
  }
  return { description };
}

/**
 * The caller's side on the booking, read from the database: a member of the renter (`renter`) or owner (`owner`)
 * business, onboarded (`409 ONBOARDING_INCOMPLETE`), not a viewer (`403 VIEWER_READ_ONLY`); anyone else `404
 * RENTAL_BOOKING_NOT_FOUND`.
 */
async function writerSide(tx: Tx, user: UserTokenPayload, b: RentalBookingRow): Promise<'renter' | 'owner'> {
  const [u] = await tx
    .select({ name: users.name, businessId: users.businessId, memberRole: users.memberRole })
    .from(users)
    .where(eq(users.id, user.userId));
  if (!u?.businessId || u.businessId !== user.businessId) throw bookingNotFound();
  const side = b.renterBusinessId === u.businessId ? 'renter' : b.ownerBusinessId === u.businessId ? 'owner' : null;
  if (!side) throw bookingNotFound();
  if (u.memberRole === 'viewer') throw new ForbiddenError('Viewers can read but not write', 'VIEWER_READ_ONLY');
  if ((await onboardingForUser(tx, u)) !== 'done') {
    throw new ConflictError('Finish setting up your business first', 'ONBOARDING_INCOMPLETE');
  }
  return side;
}

const partySideOf = (side: 'renter' | 'owner'): PartySide => (side === 'renter' ? 'buyer' : 'seller');

/**
 * `POST /rental-bookings/:id/problem` (§6.1, R12): either side from `on_rent`; on `returned` the renter until
 * `auto_complete_at` (`409 PROBLEM_WINDOW_CLOSED`, database clock) and the owner any time before completion; any other
 * status `409 RENTAL_TRANSITION_NOT_ALLOWED`. The dispute row (`opened_by_side` buyer = renter, seller = owner), then
 * `writeBookingStatus('problem')` (→ `disputed`, `disputed_from` = the old status, the auto-complete timer stopped),
 * the event and the `booking_problem` line (category code only), `rental_booking_problem` to the other side, and
 * `dispute:new { disputeId, rentalBookingId }` to support. No capacity changes (a `disputed` booking from `on_rent`
 * still holds its machines, §5.7). Returns the booking id; the route rereads its view.
 */
export function reportBookingProblem(
  app: TxApp,
  user: UserTokenPayload,
  bookingId: string,
  input: ReportBookingProblemInput,
): Promise<{ bookingId: string }> {
  return runTx(app, (tx) => reportBookingProblemTx(tx, user, bookingId, input));
}

/**
 * `reportBookingProblem` inside the caller's transaction (A1's idempotent `/problem` route). The emits are queued on
 * `tx` (after-commit helpers), so `tx` must come from `runTx` / `runIdempotent`.
 */
export async function reportBookingProblemTx(
  tx: Tx,
  user: UserTokenPayload,
  bookingId: string,
  input: ReportBookingProblemInput,
): Promise<{ bookingId: string }> {
  const { description } = checkInput(bookingId, input);
  const [seen] = await tx.select({ listingId: rentalBookings.listingId }).from(rentalBookings).where(eq(rentalBookings.id, bookingId));
  if (!seen) throw bookingNotFound();
  await lockListingForRental(tx, seen.listingId);
  const b = await lockRentalBooking(tx, bookingId);
  if (!b) throw bookingNotFound();
  const side = await writerSide(tx, user, b);

  if (b.status !== 'on_rent' && b.status !== 'returned') throw bookingTransitionNotAllowed(b, 'problem');
  if (b.status === 'returned' && side === 'renter') {
    const { rows } = await tx.execute<{ now: Date | string }>(sql`SELECT now() AS now`);
    const now = new Date(rows[0]!.now).getTime();
    if (b.autoCompleteAt && now >= b.autoCompleteAt.getTime()) {
      throw new ConflictError('The time to report a problem has passed', 'PROBLEM_WINDOW_CLOSED', {
        deadline: b.autoCompleteAt?.toISOString() ?? null,
      });
    }
  }

  const [dispute] = await tx
    .insert(dealDisputes)
    .values({
      rentalBookingId: b.id,
      openedBySide: partySideOf(side),
      openedByUserId: user.userId,
      category: input.category,
      description,
      photoKeys: input.photoKeys,
    })
    .returning({ id: dealDisputes.id });
  const disputeId = dispute!.id;
  await writeBookingStatus(
    tx,
    b,
    'problem',
    { side, userId: user.userId },
    { autoCompleteAt: null },
    {
      event: { code: 'problem_reported', values: { disputeId, category: input.category, by: side } },
      line: { code: 'booking_problem', values: { by: side, category: input.category } },
      notify: [{ to: side === 'renter' ? 'owner' : 'renter', type: 'rental_booking_problem', dedupeKey: `rental_booking_problem:${disputeId}` }],
    },
  );
  queueAdminEmit(tx, 'support', 'dispute:new', { disputeId, rentalBookingId: b.id });
  return { bookingId: b.id };
}

export interface BookingResolveInput {
  outcome: DisputeOutcome;
  internalNote: string;
  messageToParties: string | null;
}

function auditState(b: Pick<RentalBookingRow, 'status' | 'finalAmountPaise'>, dispute: typeof dealDisputes.$inferSelect) {
  return {
    bookingStatus: b.status,
    finalAmountPaise: b.finalAmountPaise,
    disputeStatus: dispute.status,
    outcome: dispute.outcome,
    internalNote: dispute.internalNote,
    messageToParties: dispute.messageToParties,
  };
}

/**
 * `POST /admin/disputes/:id/resolve` for a booking dispute (support, R12; called by `resolveDispute`, which refuses a
 * `stockReturned` for a booking). Locks the listing first, then the booking, then the dispute (`409 DISPUTE_NOT_OPEN`
 * unless open; a booking no longer `disputed` → `409 RENTAL_TRANSITION_NOT_ALLOWED`). Outcomes:
 * - `completed` (`support`): the final amount stands, or the agreed total when the machine was never returned;
 * - `cancelled` (`support_closed`, by `admin`): the machines are free again — never a listing quantity change;
 * - `resumed`: back to `disputed_from`; `returned` gets a fresh `auto_complete_at` (now + `rental_complete_days`).
 * Then `syncRentalStatus`, the dispute row, `rental_booking_dispute_resolved` to both, the `booking_dispute_resolved`
 * line (outcome; staff's message to the parties as written, as F6), and audit `rental_booking.dispute_resolve`.
 */
export async function resolveBookingDispute(
  tx: Tx,
  adminId: string,
  disputeId: string,
  bookingId: string,
  input: BookingResolveInput,
): Promise<void> {
  const [seen] = await tx.select({ listingId: rentalBookings.listingId }).from(rentalBookings).where(eq(rentalBookings.id, bookingId));
  if (!seen) throw bookingNotFound();
  const listing = await lockListingForRental(tx, seen.listingId);
  const b = await lockRentalBooking(tx, bookingId);
  if (!b) throw bookingNotFound();
  const [dispute] = await tx.select().from(dealDisputes).where(eq(dealDisputes.id, disputeId)).for('update');
  if (!dispute || dispute.status !== 'open') throw new ConflictError('This dispute is already resolved', 'DISPUTE_NOT_OPEN');
  if (b.status !== 'disputed') throw bookingTransitionNotAllowed(b, 'resolve');

  const actor: BookingActor = { side: 'admin', adminId };
  const opts = {
    event: { code: 'dispute_resolved' as const, values: { disputeId, outcome: input.outcome } },
    line: { code: 'booking_dispute_resolved' as const, values: { outcome: input.outcome, ...(input.messageToParties ? { message: input.messageToParties } : {}) } },
    notify: [{ to: 'both' as const, type: 'rental_booking_dispute_resolved' as const, dedupeKey: `rental_booking_dispute_resolved:${disputeId}` }],
  };
  let after: RentalBookingRow;
  if (input.outcome === 'completed') {
    after = await writeBookingStatus(
      tx,
      b,
      'resolve_completed',
      actor,
      { completedHow: 'support', autoCompleteAt: null, finalAmountPaise: b.finalAmountPaise ?? b.agreedTotalPaise },
      opts,
    );
  } else if (input.outcome === 'cancelled') {
    after = await writeBookingStatus(tx, b, 'resolve_cancelled', actor, { cancelReason: 'support_closed', autoCompleteAt: null }, opts);
  } else {
    const { rental_complete_days: days } = await getSettings(tx);
    after = await writeBookingStatus(
      tx,
      b,
      'resume',
      actor,
      b.disputedFrom === 'returned' ? { autoCompleteAt: sql`now() + make_interval(days => ${days}::int)` } : {},
      opts,
    );
  }
  await syncRentalStatus(tx, listing);

  const [resolved] = await tx
    .update(dealDisputes)
    .set({
      status: 'resolved',
      outcome: input.outcome,
      stockReturned: null,
      internalNote: input.internalNote,
      messageToParties: input.messageToParties,
      resolvedByAdminId: adminId,
      resolvedAt: sql`now()`,
    })
    .where(eq(dealDisputes.id, disputeId))
    .returning();
  await writeAudit(tx, {
    adminId,
    action: 'rental_booking.dispute_resolve',
    entityType: 'deal_dispute',
    entityId: disputeId,
    before: auditState(b, dispute),
    after: auditState(after, resolved!),
  });
}
