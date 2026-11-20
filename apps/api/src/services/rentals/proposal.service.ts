import { eq, sql } from 'drizzle-orm';
import type { RentalBookingView, RentalDeclineReason } from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { chatThreads, listings, rentalBookingVersions } from '../../db/schema.js';
import { ConflictError, ValidationError } from '../../lib/errors.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { looksLikeScam } from '../chat/scam-patterns.js';
import { maybeReveal } from '../consent/contact-consent.service.js';
import type { ListingRow } from '../listings/locks.js';
import { getSettings } from '../settings.service.js';
import { lockBookingForAction } from './booking-read.service.js';
import { toBookingView, type BookingReader } from './booking-view.js';
import { bookingTransitionNotAllowed, writeBookingStatus } from './booking-write.js';
import { assertCapacity, machinesOf } from './capacity.js';
import type { RentalBookingRow } from './locks.js';
import { istTodayOf, parseRentalRequest, type RentalChangeBody } from './request-input.js';
import { assertListingBookable, assertPairCanRent } from './request.service.js';
import { syncRentalStatus } from './status-sync.js';

// Proposals (M14 spec §6.1, §6.3, R3; plan A1-2): the owner confirms, declines or proposes a change; the renter accepts,
// declines, sends a changed request or withdraws. Each runs in the route's transaction in the §6.7 order (listing
// `FOR UPDATE` → booking `FOR NO KEY UPDATE` → thread, taken last by the line), names the version it answers
// (`versionSeq`, `409 RENTAL_BOOKING_STALE`) and changes status only through `writeBookingStatus`.

const MONEY_MAX = 10_000_000_000;

type Locked = { booking: RentalBookingRow; listing: ListingRow; reader: BookingReader };

async function lockForProposal(tx: Tx, user: UserTokenPayload, id: string): Promise<Locked> {
  const { booking, listing, reader } = await lockBookingForAction(tx, user, id);
  return { booking, listing: listing!, reader };
}

async function currentSeq(tx: Tx, b: RentalBookingRow): Promise<number> {
  const [v] = await tx
    .select({ seq: rentalBookingVersions.seq, total: rentalBookingVersions.totalPaise })
    .from(rentalBookingVersions)
    .where(eq(rentalBookingVersions.id, b.currentVersionId!));
  return v?.seq ?? 0;
}

/** `versionSeq` must name the open version (two owner members racing, §6.1): else `409 RENTAL_BOOKING_STALE`. */
async function assertVersion(tx: Tx, b: RentalBookingRow, versionSeq: number): Promise<void> {
  const seq = await currentSeq(tx, b);
  if (seq !== versionSeq) throw new ConflictError('This booking changed; reload it', 'RENTAL_BOOKING_STALE', { versionSeq: seq, version: b.version });
}

/** An open proposal past its reply window or start date can't be answered (the expiry job ends it). */
async function assertNotLapsed(tx: Tx, b: RentalBookingRow, action: string): Promise<void> {
  const { rows } = await tx.execute<{ lapsed: boolean }>(sql`
    SELECT (${b.replyDueAt?.toISOString() ?? null}::timestamptz <= now()
      OR ${b.startDate}::date < (now() AT TIME ZONE 'Asia/Kolkata')::date) IS TRUE AS lapsed
  `);
  if (rows[0]?.lapsed) throw bookingTransitionNotAllowed(b, action);
}

const view = async (tx: Tx, b: RentalBookingRow, reader: BookingReader) => toBookingView(tx, b, reader, await istTodayOf(tx));

/**
 * What a confirmation does besides the status (§6.1, §8, §7.1): `deal_count + 1` on the thread (enquiry `converted`),
 * the listing's `refreshed_at` bumped (a booked machine is an active listing), `syncRentalStatus`, and the reveal check
 * (a confirmed booking counts as a deal in the thread).
 */
async function afterConfirmation(tx: Tx, b: RentalBookingRow, listing: ListingRow): Promise<void> {
  await tx.update(chatThreads).set({ dealCount: sql`${chatThreads.dealCount} + 1`, updatedAt: sql`now()` }).where(eq(chatThreads.id, b.threadId));
  await tx.update(listings).set({ refreshedAt: sql`now()` }).where(eq(listings.id, listing.id));
  await syncRentalStatus(tx, listing);
  await maybeReveal(tx, b.threadId);
}

/**
 * Confirm (owner, `requested`) or accept (renter, `countered`): the side's turn (`409 RENTAL_TRANSITION_NOT_ALLOWED`),
 * the open version, the listing bookable (§7.2), owner GST / status and the block under the lock, the dates still free
 * (`409 RENTAL_DATES_TAKEN`); then `confirmed` at the version's total.
 */
async function agree(tx: Tx, user: UserTokenPayload, id: string, versionSeq: number, action: 'confirm' | 'accept'): Promise<RentalBookingView> {
  const { booking: b, listing, reader } = await lockForProposal(tx, user, id);
  // A party is known here (`lockBookingForAction`): a stale version is answered first (409 RENTAL_BOOKING_STALE), so a
  // second member answering an old version learns the booking changed rather than that the step isn't allowed.
  await assertVersion(tx, b, versionSeq);
  const expected = action === 'confirm' ? { status: 'requested', side: 'owner' } : { status: 'countered', side: 'renter' };
  if (b.status !== expected.status || reader.side !== expected.side) throw bookingTransitionNotAllowed(b, action);
  await assertNotLapsed(tx, b, action);
  assertListingBookable(listing);
  await assertPairCanRent(tx, b.ownerBusinessId, b.renterBusinessId);
  await assertCapacity(tx, { id: listing.id, quantity: machinesOf(listing) }, { from: b.startDate, to: b.endDate }, b.machines, {
    excludeBookingId: b.id,
  });
  const [v] = await tx.select({ total: rentalBookingVersions.totalPaise }).from(rentalBookingVersions).where(eq(rentalBookingVersions.id, b.currentVersionId!));
  const written = await writeBookingStatus(
    tx,
    b,
    action,
    { side: reader.side, userId: reader.userId },
    { agreedTotalPaise: Number(v!.total), replyDueAt: null },
    {
      event: { code: action === 'confirm' ? 'confirmed' : 'change_accepted', values: { versionSeq, totalPaise: Number(v!.total) } },
      notify: [{ to: action === 'confirm' ? 'renter' : 'owner', type: 'rental_booking_confirmed' }],
    },
  );
  await afterConfirmation(tx, written, listing);
  return view(tx, written, reader);
}

/** `POST /rental-bookings/:id/confirm` (owner). */
export function confirmBooking(tx: Tx, user: UserTokenPayload, id: string, input: { versionSeq: number }): Promise<RentalBookingView> {
  return agree(tx, user, id, input.versionSeq, 'confirm');
}

/** `POST /rental-bookings/:id/accept` (renter, the owner's change). */
export function acceptChange(tx: Tx, user: UserTokenPayload, id: string, input: { versionSeq: number }): Promise<RentalBookingView> {
  return agree(tx, user, id, input.versionSeq, 'accept');
}

/**
 * `POST /rental-bookings/:id/change` (§6.1, §6.3): the side whose turn it is (owner on `requested`, renter on
 * `countered`) proposes new terms for the open version. `rental_max_changes` (`409 RENTAL_CHANGE_LIMIT`); the terms
 * checked against the booking's terms snapshot (rates never move under a booking) and the listing's current quantity;
 * owner GST, status and block; the new dates not full. The owner's version may carry its own total (0 … 10¹⁰, default
 * the estimate); a renter's total is the estimate. New version, `change_count + 1`, a fresh reply window; the other side
 * told (`rental_booking_changed` to the renter, `rental_booking_requested` to the owner).
 */
export async function proposeChange(tx: Tx, user: UserTokenPayload, id: string, input: RentalChangeBody): Promise<RentalBookingView> {
  const { booking: b, listing, reader } = await lockForProposal(tx, user, id);
  await assertVersion(tx, b, input.versionSeq);
  const turnOk = (b.status === 'requested' && reader.side === 'owner') || (b.status === 'countered' && reader.side === 'renter');
  if (!turnOk) throw bookingTransitionNotAllowed(b, 'change');
  await assertNotLapsed(tx, b, 'change');
  const settings = await getSettings(tx);
  if (b.changeCount >= settings.rental_max_changes) {
    throw new ConflictError('No more changes: confirm or decline', 'RENTAL_CHANGE_LIMIT', { max: settings.rental_max_changes });
  }
  assertListingBookable(listing);
  await assertPairCanRent(tx, b.ownerBusinessId, b.renterBusinessId);
  const quantity = machinesOf(listing);
  const resolved = parseRentalRequest({ quantity }, b.termsSnapshot, input, await istTodayOf(tx), settings.rental_advance_days);
  await assertCapacity(tx, { id: listing.id, quantity }, { from: resolved.startDate, to: resolved.endDate }, resolved.machines, {
    excludeBookingId: b.id,
  });
  const total = reader.side === 'owner' && input.totalPaise !== undefined ? input.totalPaise : resolved.estimatePaise;
  if (!Number.isSafeInteger(total) || total < 0 || total > MONEY_MAX) throw new ValidationError('That total can’t be used', { max: MONEY_MAX });

  const message = input.message ?? null;
  const seq = (await currentSeq(tx, b)) + 1;
  const [version] = await tx
    .insert(rentalBookingVersions)
    .values({
      bookingId: b.id,
      seq,
      proposedBySide: reader.side,
      startDate: resolved.startDate,
      endDate: resolved.endDate,
      period: resolved.period,
      periodCount: resolved.count,
      machines: resolved.machines,
      withOperator: resolved.withOperator,
      ownerDelivers: resolved.ownerDelivers,
      estimatePaise: resolved.estimatePaise,
      totalPaise: total,
      message,
      messageScamFlag: message !== null && looksLikeScam(message),
      createdByUserId: reader.userId,
    })
    .returning({ id: rentalBookingVersions.id });
  const written = await writeBookingStatus(
    tx,
    b,
    'change',
    { side: reader.side, userId: reader.userId },
    {
      currentVersionId: version!.id,
      changeCount: b.changeCount + 1,
      startDate: resolved.startDate,
      endDate: resolved.endDate,
      period: resolved.period,
      periodCount: resolved.count,
      machines: resolved.machines,
      withOperator: resolved.withOperator,
      ownerDelivers: resolved.ownerDelivers,
      replyDueAt: sql`now() + make_interval(hours => ${settings.rental_reply_hours}::int)`,
    },
    {
      event: { code: reader.side === 'owner' ? 'changed_by_owner' : 'changed_by_renter', values: { versionSeq: seq, totalPaise: total } },
      notify: [
        reader.side === 'owner'
          ? { to: 'renter', type: 'rental_booking_changed' }
          : { to: 'owner', type: 'rental_booking_requested' },
      ],
    },
  );
  return view(tx, written, reader);
}

/**
 * `POST /rental-bookings/:id/decline` (§6.1): the answer of whoever's turn it is (owner on `requested`, renter on
 * `countered`), with a reason; the other side told. Any listing state.
 */
export async function declineBooking(
  tx: Tx,
  user: UserTokenPayload,
  id: string,
  input: { versionSeq: number; reason: RentalDeclineReason },
): Promise<RentalBookingView> {
  const { booking: b, reader } = await lockForProposal(tx, user, id);
  await assertVersion(tx, b, input.versionSeq);
  const turnOk = (b.status === 'requested' && reader.side === 'owner') || (b.status === 'countered' && reader.side === 'renter');
  if (!turnOk) throw bookingTransitionNotAllowed(b, 'decline');
  const written = await writeBookingStatus(
    tx,
    b,
    'decline',
    { side: reader.side, userId: reader.userId },
    { declineReason: input.reason, replyDueAt: null },
    { notify: [{ to: reader.side === 'owner' ? 'renter' : 'owner', type: 'rental_booking_declined' }] },
  );
  return view(tx, written, reader);
}

/** `POST /rental-bookings/:id/withdraw` (renter, `requested` / `countered`); the owner told. */
export async function withdrawBooking(tx: Tx, user: UserTokenPayload, id: string): Promise<RentalBookingView> {
  const { booking: b, reader } = await lockForProposal(tx, user, id);
  const written = await writeBookingStatus(
    tx,
    b,
    'withdraw',
    { side: reader.side, userId: reader.userId },
    { replyDueAt: null },
    { notify: [{ to: 'owner', type: 'rental_booking_withdrawn' }] },
  );
  return view(tx, written, reader);
}

