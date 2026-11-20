import { sql } from 'drizzle-orm';
import {
  RENTAL_CANCEL_REASONS_OWNER,
  RENTAL_CANCEL_REASONS_RENTER,
  type RentalBookingView,
  type RentalCancelReason,
  type RentalFinalReason,
} from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { ConflictError, ValidationError } from '../../lib/errors.js';
import { addDays } from '../../lib/ist.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { lockBookingForAction } from './booking-read.service.js';
import { toBookingView, type BookingReader } from './booking-view.js';
import { bookingTransitionNotAllowed, writeBookingStatus } from './booking-write.js';
import type { RentalBookingRow } from './locks.js';
import { getSettings } from '../settings.service.js';
import { istTodayOf } from './request-input.js';
import { syncRentalStatus } from './status-sync.js';

// Booking steps (M14 spec §6.1, §6.4, §6.5, R6; plan A1-3; follows F6 `deals/deal-actions.ts`, `deal-cancel.ts`): on site,
// returned, confirm return, cancel. Every step locks the listing first (it moves capacity: on site from the on-site
// date, returned frees it, cancel frees it), then the booking, and runs `syncRentalStatus` after. On site never checks
// capacity (the machine is physically there). Steps work in every listing state (§7.2).

const view = async (tx: Tx, b: RentalBookingRow, reader: BookingReader) => toBookingView(tx, b, reader, await istTodayOf(tx));
const other = (side: BookingReader['side']) => (side === 'renter' ? 'owner' : 'renter');

/**
 * `POST /rental-bookings/:id/on-site` (either side, `confirmed`, not before `start_date − 1` IST, `409
 * RENTAL_TOO_EARLY`, nor after `end_date`, `409 RENTAL_TRANSITION_NOT_ALLOWED` with `reason: 'ended'`): optional opening hour meter and ≤ 3 photos (final keys, finalised by the route). The other side
 * told.
 */
export async function markOnSite(
  tx: Tx,
  user: UserTokenPayload,
  id: string,
  input: { hourMeter?: number; photoKeys?: string[] },
): Promise<RentalBookingView> {
  const { booking: b, listing, reader } = await lockBookingForAction(tx, user, id);
  if (b.status !== 'confirmed') throw bookingTransitionNotAllowed(b, 'on_site');
  const today = await istTodayOf(tx);
  if (today < addDays(b.startDate, -1)) {
    throw new ConflictError('It’s too early to mark the machine on site', 'RENTAL_TOO_EARLY', { from: addDays(b.startDate, -1) });
  }
  if (today > b.endDate) {
    throw new ConflictError('This booking’s dates are over', 'RENTAL_TRANSITION_NOT_ALLOWED', { status: b.status, action: 'on_site', reason: 'ended' });
  }
  const written = await writeBookingStatus(
    tx,
    b,
    'on_site',
    { side: reader.side, userId: reader.userId },
    {
      onSiteAt: sql`now()`,
      onSiteBySide: reader.side,
      hourMeterStart: input.hourMeter ?? null,
      onSitePhotoKeys: input.photoKeys ?? [],
    },
    {
      event: { code: 'on_site', values: { by: reader.side, photos: input.photoKeys?.length ?? 0 } },
      line: { code: 'booking_on_site', values: { by: reader.side } },
      notify: [{ to: other(reader.side), type: 'rental_booking_on_site' }],
    },
  );
  await syncRentalStatus(tx, listing!);
  return view(tx, written, reader);
}

export interface ReturnedInput {
  hourMeter?: number;
  finalAmountPaise: number;
  finalReason?: RentalFinalReason;
  finalNote?: string | null;
  damageNote?: string | null;
  photoKeys?: string[];
}

/**
 * `POST /rental-bookings/:id/returned` (owner, `on_rent`, early or late): the final amount (a different amount than the
 * agreed total needs a reason, `400 FINAL_REASON_REQUIRED`), closing hour meter ≥ opening (`400 HOUR_METER_INVALID`),
 * damage note, ≤ 3 photos; `auto_complete_at = now + rental_complete_days`. The renter told ("check the final amount").
 */
export async function markReturned(tx: Tx, user: UserTokenPayload, id: string, input: ReturnedInput): Promise<RentalBookingView> {
  const { booking: b, listing, reader } = await lockBookingForAction(tx, user, id);
  if (b.status !== 'on_rent' || reader.side !== 'owner') throw bookingTransitionNotAllowed(b, 'return');
  if (input.hourMeter !== undefined && b.hourMeterStart !== null && input.hourMeter < b.hourMeterStart) {
    throw new ValidationError('The closing hour meter can’t be below the opening one', { min: b.hourMeterStart }, 'HOUR_METER_INVALID');
  }
  const changed = b.agreedTotalPaise === null || Number(b.agreedTotalPaise) !== input.finalAmountPaise;
  if (changed && !input.finalReason) {
    throw new ValidationError('Say why the final amount differs from the agreed total', { agreedTotalPaise: b.agreedTotalPaise }, 'FINAL_REASON_REQUIRED');
  }
  const completeDays = (await getSettings(tx)).rental_complete_days;
  const written = await writeBookingStatus(
    tx,
    b,
    'return',
    { side: reader.side, userId: reader.userId },
    {
      returnedAt: sql`now()`,
      autoCompleteAt: sql`now() + make_interval(days => ${completeDays}::int)`,
      hourMeterEnd: input.hourMeter ?? null,
      finalAmountPaise: input.finalAmountPaise,
      finalAmountReason: changed ? (input.finalReason ?? null) : null,
      finalAmountNote: changed ? (input.finalNote ?? null) : null,
      damageNote: input.damageNote ?? null,
      returnPhotoKeys: input.photoKeys ?? [],
    },
    {
      event: { code: 'returned', values: { finalChanged: changed, ...(changed && input.finalReason ? { reason: input.finalReason } : {}) } },
      notify: [{ to: 'renter', type: 'rental_booking_returned' }],
    },
  );
  await syncRentalStatus(tx, listing!);
  return view(tx, written, reader);
}

/** `POST /rental-bookings/:id/confirm-return` (renter, `returned`) → `completed` (`renter_confirmed`); the owner told. */
export async function confirmReturn(tx: Tx, user: UserTokenPayload, id: string): Promise<RentalBookingView> {
  const { booking: b, reader } = await lockBookingForAction(tx, user, id);
  const written = await writeBookingStatus(
    tx,
    b,
    'confirm_return',
    { side: reader.side, userId: reader.userId },
    { completedHow: 'renter_confirmed' },
    { notify: [{ to: 'owner', type: 'rental_booking_completed' }] },
  );
  return view(tx, written, reader);
}

const CANCEL_REASONS: Record<BookingReader['side'], readonly string[]> = {
  renter: RENTAL_CANCEL_REASONS_RENTER,
  owner: RENTAL_CANCEL_REASONS_OWNER,
};

/**
 * `POST /rental-bookings/:id/cancel` (either side alone, `confirmed` only: once on site there is no cancel, §6.5), with
 * a reason of the side's list and an optional note; frees the dates; the other side told.
 */
export async function cancelBooking(
  tx: Tx,
  user: UserTokenPayload,
  id: string,
  input: { reason: string; note?: string | null },
): Promise<RentalBookingView> {
  const { booking: b, listing, reader } = await lockBookingForAction(tx, user, id);
  if (!CANCEL_REASONS[reader.side].includes(input.reason)) {
    throw new ValidationError('Pick a reason', { reasons: CANCEL_REASONS[reader.side] }, 'VALIDATION_ERROR');
  }
  const written = await writeBookingStatus(
    tx,
    b,
    'cancel',
    { side: reader.side, userId: reader.userId },
    { cancelReason: input.reason as RentalCancelReason, cancelNote: input.note ?? null },
    { notify: [{ to: other(reader.side), type: 'rental_booking_cancelled' }] },
  );
  await syncRentalStatus(tx, listing!);
  return view(tx, written, reader);
}
