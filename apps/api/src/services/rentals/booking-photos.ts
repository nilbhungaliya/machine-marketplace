import type { Db, Tx } from '../../db/index.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { assertCanWrite } from '../chat/members.js';
import { finalizePrivatePhotos, presignPrivatePhoto } from '../chat/private-photo.js';
import { bookingForParty } from './booking-read.service.js';
import type { BookingReader } from './booking-view.js';
import { bookingTransitionNotAllowed } from './booking-write.js';
import type { RentalBookingRow } from './locks.js';

// Booking step photos (M14 spec §6.4, §18; plan D8): the private chat pipeline. Uploads go to `incoming-chat/<business>/`
// (`presignPrivatePhoto`), then are re-encoded into `rental/<bookingId>/<uuid>.jpg` **before** the step's transaction
// with `keepUploads: true` (F8's pattern: the route deletes the finals when the transaction fails and the uploads once
// the write settled, so an idempotent retry can finalise them again). On site and return: ≤ 3; a problem: ≤ 5.

type Conn = Db | Tx;

export type BookingPhotoStep = 'on_site' | 'return' | 'problem';

const FINAL = new Set(['completed', 'declined', 'withdrawn', 'expired', 'cancelled']);

/** `POST /rental-bookings/:id/photos/presign`: a party's non-viewer, while the booking isn't final. */
export async function presignBookingPhoto(
  conn: Conn,
  user: UserTokenPayload,
  id: string,
  contentType: string,
  contentLength: number,
): Promise<{ url: string; key: string; expiresAt: string }> {
  const { booking, reader } = await bookingForParty(conn, user, id);
  assertCanWrite(reader);
  if (FINAL.has(booking.status)) throw bookingTransitionNotAllowed(booking, 'photo');
  const signed = await presignPrivatePhoto(reader.businessId, contentType, contentLength);
  return { url: signed.url, key: signed.key, expiresAt: signed.expiresAt.toISOString() };
}

/**
 * Whether the (unlocked) booking can take this step from this side: on site from `confirmed` (either side), return from
 * `on_rent` (owner), a problem from `on_rent` / `returned`. The step's locked re-check stays the rule; this only spares
 * re-encoding photos for a step that can't happen.
 */
function stepPossible(status: RentalBookingRow['status'], side: BookingReader['side'], step: BookingPhotoStep): boolean {
  if (step === 'on_site') return status === 'confirmed';
  if (step === 'return') return status === 'on_rent' && side === 'owner';
  return status === 'on_rent' || status === 'returned';
}

/**
 * Before a step's transaction: party, role and the step's status / side checked on the unlocked row (`409
 * RENTAL_TRANSITION_NOT_ALLOWED`, as the locked check), then the uploads finalised into `rental/<bookingId>/…`. Returns
 * the final keys (the uploads are kept; the route deletes them once the write settled).
 */
export async function finalizeBookingPhotos(conn: Conn, user: UserTokenPayload, id: string, keys: string[], step: BookingPhotoStep): Promise<string[]> {
  if (keys.length === 0) return [];
  const { booking, reader } = await bookingForParty(conn, user, id);
  assertCanWrite(reader);
  if (!stepPossible(booking.status, reader.side, step)) throw bookingTransitionNotAllowed(booking, step);
  return finalizePrivatePhotos(reader.businessId, keys, { kind: 'rental', bookingId: id, step }, { keepUploads: true });
}
