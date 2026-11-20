import { and, eq, inArray, sql } from 'drizzle-orm';
import type { RentalEstimateResult, RentalBookingView } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { businesses, chatThreads, listings, rentalBookingVersions, rentalBookings, users } from '../../db/schema.js';
import { ConflictError, ForbiddenError } from '../../lib/errors.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { openOrGetThread } from '../chat/open-thread.js';
import { looksLikeScam } from '../chat/scam-patterns.js';
import { insertCardMessage, recomputeTurns } from '../chat/thread-lines.js';
import { assertNotBlocked } from '../chat/thread.service.js';
import { centroidSql } from '../listings/listing-validate.service.js';
import { listingNotFound, type ListingRow } from '../listings/locks.js';
import { publicListingWhere } from '../listings/public-where.service.js';
import { getSettings } from '../settings.service.js';
import { bookingLine, emitBookingUpdated, notifyBooking, recordBookingEvent } from './booking-write.js';
import { toBookingView } from './booking-view.js';
import { assertCapacity, machinesOf } from './capacity.js';
import { estimateFor, termsSnapshotOf } from './estimate.js';
import { lockListingForRental, lockRenterBusiness, type RentalBookingRow } from './locks.js';
import {
  assertOnboardedForRental,
  assertRenterLimits,
  istTodayOf,
  parseRentalRequest,
  resolveSite,
  type RentalRequestBody,
  type RentalTermsInput,
} from './request-input.js';

// The request (M14 spec §6.1 "request", §6.2, R1, R8, R9; plan A1-1; follows F6 `offers/offer.service.ts` `makeOffer`).

type Conn = Db | Tx;

/**
 * The checks every request, change, confirm and accept repeats **under the listing lock** (§6.2; C0 made suspension and
 * GST revoke lock the owner's rental listings, so this re-check closes their race): the owner business still holds GST
 * (`403 RENTAL_NEEDS_GST`), no owner user of it is suspended or blocked (`409 LISTING_NOT_BOOKABLE`), and no block
 * between the two businesses (`403 BUSINESS_BLOCKED`).
 */
export async function assertPairCanRent(tx: Tx, ownerBusinessId: string, renterBusinessId: string): Promise<void> {
  const [owner] = await tx.select({ levels: businesses.verificationLevels }).from(businesses).where(eq(businesses.id, ownerBusinessId));
  if (!owner?.levels.includes('gst')) throw new ForbiddenError('This business is no longer GST verified, so it can’t take bookings', 'RENTAL_NEEDS_GST');
  const [inactive] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.businessId, ownerBusinessId), eq(users.memberRole, 'owner'), inArray(users.status, ['suspended', 'blocked'])))
    .limit(1);
  if (inactive) throw new ConflictError('This machine can’t be booked now', 'LISTING_NOT_BOOKABLE', { reason: 'owner_inactive' });
  await assertNotBlocked(tx, { buyerBusinessId: renterBusinessId, sellerBusinessId: ownerBusinessId });
}

/** `POST /rentals/estimate` (public): the §6.2 checks that need no business, then `estimateFor` (never a distance). */
export async function estimateRental(conn: Conn, input: RentalTermsInput & { listingId: string; sitePincode?: string }): Promise<RentalEstimateResult> {
  const [listing] = await conn
    .select({ quantity: listings.quantity })
    .from(listings)
    .where(and(eq(listings.id, input.listingId), eq(listings.kind, 'machine_rental'), publicListingWhere()));
  if (!listing) throw listingNotFound();
  const settings = await getSettings(conn);
  const terms = await termsSnapshotOf(conn, input.listingId);
  parseRentalRequest({ quantity: machinesOf(listing) }, terms, input, await istTodayOf(conn), settings.rental_advance_days);
  return estimateFor(conn, input.listingId, input);
}

/**
 * `POST /listings/:id/bookings` (§6.1 request, §6.2), in the route's transaction, in the §6.7 lock order: onboarding
 * (`409 ONBOARDING_INCOMPLETE`); the renter business `FOR NO KEY UPDATE` and its limits (`409 RENTAL_OPEN_LIMIT`,
 * `429 RENTAL_DAILY_LIMIT`); the listing `FOR UPDATE` — public and `live` / `rented` (`404 LISTING_NOT_FOUND`), not
 * the renter's own (`409 OWN_LISTING`), owner GST, owner status and the block re-checked under it; one open request per
 * thread (`409 RENTAL_REQUEST_OPEN`); the terms (§6.2 400s, `PINCODE_UNKNOWN`); the dates not already full (`409
 * RENTAL_DATES_TAKEN`). Then the thread (opened without the enquiry cap, D9), the booking (`requested`, the owner's
 * turn, `reply_due_at`), version 1, the booking card (no enquiry card), the `requested` event and line, the owner's
 * notification, the turns and `rental:updated`.
 */
export async function requestBooking(tx: Tx, user: UserTokenPayload, listingId: string, input: RentalRequestBody): Promise<RentalBookingView> {
  const renterBusinessId = await assertOnboardedForRental(tx, user);
  const sessionUser: UserTokenPayload = { userId: user.userId, businessId: renterBusinessId };
  const [me] = await tx.select({ memberRole: users.memberRole }).from(users).where(eq(users.id, user.userId));
  if (!me || me.memberRole === 'viewer') throw new ForbiddenError('Viewers can read but not write', 'VIEWER_READ_ONLY');

  const renter = await lockRenterBusiness(tx, renterBusinessId);
  const settings = await getSettings(tx);
  await assertRenterLimits(tx, renterBusinessId, renter.verificationLevels.includes('gst'), settings);

  const locked = await lockListingForRental(tx, listingId);
  const [visible] = await tx
    .select({ id: listings.id })
    .from(listings)
    .where(and(eq(listings.id, listingId), publicListingWhere(), inArray(listings.status, ['live', 'rented'])));
  if (!visible) throw listingNotFound();
  if (locked.businessId === renterBusinessId) throw new ConflictError('This is your own listing', 'OWN_LISTING');
  await assertPairCanRent(tx, locked.businessId, renterBusinessId);

  const [existing] = await tx
    .select({ id: chatThreads.id })
    .from(chatThreads)
    .where(and(eq(chatThreads.listingId, listingId), eq(chatThreads.buyerBusinessId, renterBusinessId)));
  if (existing) {
    const [open] = await tx
      .select({ id: rentalBookings.id })
      .from(rentalBookings)
      .where(and(eq(rentalBookings.threadId, existing.id), inArray(rentalBookings.status, ['requested', 'countered'])))
      .limit(1);
    if (open) throw new ConflictError('You already have a request waiting here: change that one instead', 'RENTAL_REQUEST_OPEN', { bookingId: open.id });
  }

  const terms = await termsSnapshotOf(tx, listingId);
  const quantity = machinesOf(locked);
  const resolved = parseRentalRequest({ quantity }, terms, input, await istTodayOf(tx), settings.rental_advance_days);
  const site = await resolveSite(tx, input.sitePincode);
  await assertCapacity(tx, { id: listingId, quantity }, { from: resolved.startDate, to: resolved.endDate }, resolved.machines);

  const { thread } = await openOrGetThread(tx, sessionUser, listingId, { skipDailyCap: true });

  const [inserted] = await tx
    .insert(rentalBookings)
    .values({
      listingId,
      threadId: thread.id,
      renterBusinessId,
      ownerBusinessId: locked.businessId,
      createdByUserId: user.userId,
      status: 'requested',
      turn: 'owner',
      startDate: resolved.startDate,
      endDate: resolved.endDate,
      period: resolved.period,
      periodCount: resolved.count,
      machines: resolved.machines,
      withOperator: resolved.withOperator,
      ownerDelivers: resolved.ownerDelivers,
      sitePincode: input.sitePincode,
      siteCity: site.city,
      siteState: site.state,
      siteAddress: input.siteAddress ?? null,
      sitePoint: centroidSql(input.sitePincode),
      listingTitle: locked.title ?? '',
      termsSnapshot: terms,
      replyDueAt: sql`now() + make_interval(hours => ${settings.rental_reply_hours}::int)`,
    })
    .returning();
  const note = input.note ?? null;
  const [version] = await tx
    .insert(rentalBookingVersions)
    .values({
      bookingId: inserted!.id,
      seq: 1,
      proposedBySide: 'renter',
      startDate: resolved.startDate,
      endDate: resolved.endDate,
      period: resolved.period,
      periodCount: resolved.count,
      machines: resolved.machines,
      withOperator: resolved.withOperator,
      ownerDelivers: resolved.ownerDelivers,
      estimatePaise: resolved.estimatePaise,
      totalPaise: resolved.estimatePaise,
      message: note,
      messageScamFlag: note !== null && looksLikeScam(note),
      createdByUserId: user.userId,
    })
    .returning({ id: rentalBookingVersions.id });
  const [booking] = await tx
    .update(rentalBookings)
    .set({ currentVersionId: version!.id })
    .where(eq(rentalBookings.id, inserted!.id))
    .returning();
  const b = booking as RentalBookingRow;

  await insertCardMessage(tx, thread.id, { kind: 'booking', rentalBookingId: b.id, senderSide: 'buyer', senderUserId: user.userId });
  const actor = { side: 'renter' as const, userId: user.userId };
  await recordBookingEvent(tx, b.id, 'requested', actor, { versionSeq: 1 });
  await bookingLine(tx, thread.id, 'booking_requested', { bookingId: b.id, ref: b.ref }, 'renter');
  await recomputeTurns(tx, thread.id);
  await notifyBooking(tx, b, { to: 'owner', type: 'rental_booking_requested' });
  emitBookingUpdated(tx, b);
  return toBookingView(tx, b, { userId: user.userId, businessId: renterBusinessId, memberRole: me.memberRole, side: 'renter' }, await istTodayOf(tx));
}

/** A rental listing's state for confirm / accept / change (§7.2): `live`, `rented` and `paused` take them. */
export function assertListingBookable(listing: Pick<ListingRow, 'status'>): void {
  if (!['live', 'rented', 'paused'].includes(listing.status)) {
    throw new ConflictError('This machine can’t be booked now', 'LISTING_NOT_BOOKABLE', { status: listing.status });
  }
}
