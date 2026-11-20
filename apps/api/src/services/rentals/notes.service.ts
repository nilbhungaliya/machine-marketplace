import { eq, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { RentalBookingView } from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { rentalBookings } from '../../db/schema.js';
import { ConflictError, ValidationError } from '../../lib/errors.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { looksLikeScam } from '../chat/scam-patterns.js';
import { lockBookingForAction } from './booking-read.service.js';
import { toBookingView } from './booking-view.js';
import { bookingTransitionNotAllowed, emitBookingUpdated, recordBookingEvent } from './booking-write.js';
import { istTodayOf, type RentalNotesBody } from './request-input.js';

// Notes (M14 spec R10, §8; plan A1-3; F6 `deal.service.ts` `editNotes`): payment method, advance, deposit, deposit
// returned, expected on-site time and a short text, "recorded; paid outside the app". Either side's non-viewer while
// `confirmed` / `on_rent` / `returned`; the only booking write that checks `version` (`409 RENTAL_BOOKING_STALE`).
// Changes no capacity, so the listing isn't locked. The event names the fields, never their values.

const FIELDS = [
  ['paymentMethod', 'payment_method'],
  ['advancePaise', 'advance'],
  ['depositPaise', 'deposit'],
  ['depositReturned', 'deposit_returned'],
  ['expectedOnSiteTime', 'expected_on_site'],
  ['text', 'text'],
] as const;

/** `PATCH /rental-bookings/:id/notes`. An advance above the agreed total → `400`. No change → the view as it is. */
export async function editNotes(tx: Tx, user: UserTokenPayload, id: string, input: RentalNotesBody): Promise<RentalBookingView> {
  const { booking: b, reader } = await lockBookingForAction(tx, user, id, { listing: false });
  if (!['confirmed', 'on_rent', 'returned'].includes(b.status)) throw bookingTransitionNotAllowed(b, 'edit_notes');
  if (input.version !== b.version) throw new ConflictError('Someone changed this booking; reload it', 'RENTAL_BOOKING_STALE', { version: b.version });
  if (input.advancePaise != null && b.agreedTotalPaise !== null && input.advancePaise > Number(b.agreedTotalPaise)) {
    throw new ValidationError('The advance can’t be more than the agreed total', { agreedTotalPaise: Number(b.agreedTotalPaise) });
  }
  const current = {
    paymentMethod: b.paymentMethod,
    advancePaise: b.advancePaise === null ? null : Number(b.advancePaise),
    depositPaise: b.depositPaise === null ? null : Number(b.depositPaise),
    depositReturned: b.depositReturned,
    expectedOnSiteTime: b.expectedOnSiteTime,
    text: b.notesText,
  };
  const changed = FIELDS.filter(([k]) => input[k] !== undefined && input[k] !== current[k]);
  if (changed.length === 0) return toBookingView(tx, b, reader, await istTodayOf(tx));

  const set: PgUpdateSetSource<typeof rentalBookings> = {
    notesUpdatedAt: sql`now()`,
    notesUpdatedByUserId: reader.userId,
    version: sql`${rentalBookings.version} + 1`,
    updatedAt: sql`now()`,
  };
  for (const [k] of changed) {
    if (k === 'text') {
      set.notesText = input.text ?? null;
      set.notesScamFlag = input.text ? looksLikeScam(input.text) : false;
    } else if (k === 'paymentMethod') set.paymentMethod = input.paymentMethod ?? null;
    else if (k === 'advancePaise') set.advancePaise = input.advancePaise ?? null;
    else if (k === 'depositPaise') set.depositPaise = input.depositPaise ?? null;
    else if (k === 'depositReturned') set.depositReturned = input.depositReturned ?? null;
    else set.expectedOnSiteTime = input.expectedOnSiteTime ?? null;
  }
  const [updated] = await tx.update(rentalBookings).set(set).where(eq(rentalBookings.id, b.id)).returning();
  await recordBookingEvent(tx, b.id, 'notes_changed', { side: reader.side, userId: reader.userId }, { fields: changed.map(([, n]) => n).join(',') });
  emitBookingUpdated(tx, updated!);
  return toBookingView(tx, updated!, reader, await istTodayOf(tx));
}
