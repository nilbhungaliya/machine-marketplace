import { and, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import {
  RENTAL_LIMITS,
  type RentalBookingPhotos,
  type RentalBookingSideFilter,
  type RentalBookingStatus,
  type RentalBookingTab,
  type RentalBookingView,
  type RentalBookingsPage,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { dealDisputes, rentalBookings, users } from '../../db/schema.js';
import { AppError, ValidationError } from '../../lib/errors.js';
import { IST_TODAY } from '../../lib/ist.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { assertCanWrite } from '../chat/members.js';
import { privatePhotoUrl } from '../chat/private-photo.js';
import type { ListingRow } from '../listings/locks.js';
import { toBookingListRows, toBookingView, type BookingReader, type BookingSide } from './booking-view.js';
import { lockListingForRental, lockRentalBooking, type RentalBookingRow } from './locks.js';
import { assertOnboardedForRental, istTodayOf } from './request-input.js';

// M14 lane A1 (plan A1-4): the booking reads (list, detail, views) and the Deals tab badge count live here. A booking is
// visible to the members of its renter and owner businesses only; anyone else gets `404 RENTAL_BOOKING_NOT_FOUND`.

type Conn = Db | Tx;

export function bookingNotFound(): AppError {
  return new AppError('Booking not found', 404, 'RENTAL_BOOKING_NOT_FOUND');
}

/** The caller's side of a booking, or null for a business that isn't a party. */
export function sideOfBooking(b: Pick<RentalBookingRow, 'renterBusinessId' | 'ownerBusinessId'>, businessId: string | null): BookingSide | null {
  if (businessId === null) return null;
  if (b.renterBusinessId === businessId) return 'renter';
  if (b.ownerBusinessId === businessId) return 'owner';
  return null;
}

/** The caller as a reader of `b` (business and role from the `users` row); `404` for anyone not a party. */
export async function bookingReaderFor(
  conn: Conn,
  user: UserTokenPayload,
  b: Pick<RentalBookingRow, 'renterBusinessId' | 'ownerBusinessId'>,
): Promise<BookingReader> {
  const [u] = await conn.select({ businessId: users.businessId, memberRole: users.memberRole }).from(users).where(eq(users.id, user.userId));
  const side = sideOfBooking(b, u?.businessId ?? null);
  if (!u?.businessId || !side) throw bookingNotFound();
  return { userId: user.userId, businessId: u.businessId, memberRole: u.memberRole, side };
}

/** The booking (unlocked) and the caller as a reader; `404 RENTAL_BOOKING_NOT_FOUND` for an outsider. */
export async function bookingForParty(conn: Conn, user: UserTokenPayload, id: string): Promise<{ booking: RentalBookingRow; reader: BookingReader }> {
  const [booking] = await conn.select().from(rentalBookings).where(eq(rentalBookings.id, id));
  if (!booking) throw bookingNotFound();
  return { booking, reader: await bookingReaderFor(conn, user, booking) };
}

/** `GET /rental-bookings/:id`: the Booking record for the caller. */
export async function getRentalBooking(conn: Conn, user: UserTokenPayload, id: string): Promise<RentalBookingView> {
  const { booking, reader } = await bookingForParty(conn, user, id);
  return toBookingView(conn, booking, reader, await istTodayOf(conn));
}

/** `GET /rental-bookings/:id/photos` (party only): the private photos as 300 s signed URLs. */
export async function bookingPhotos(conn: Conn, user: UserTokenPayload, id: string): Promise<RentalBookingPhotos> {
  const { booking } = await bookingForParty(conn, user, id);
  const sign = (keys: string[]) => Promise.all(keys.map(async (k) => (await privatePhotoUrl(k)).url));
  const disputes = await conn
    .select({ photoKeys: dealDisputes.photoKeys })
    .from(dealDisputes)
    .where(eq(dealDisputes.rentalBookingId, id))
    .orderBy(desc(dealDisputes.createdAt));
  const problemKeys = disputes.flatMap((d) => d.photoKeys);
  return {
    onSite: await sign(booking.onSitePhotoKeys),
    returned: await sign(booking.returnPhotoKeys),
    ...(problemKeys.length ? { problem: await sign(problemKeys) } : {}),
  };
}

const TAB_STATUSES: Record<RentalBookingTab, RentalBookingStatus[]> = {
  active: ['requested', 'countered', 'confirmed', 'on_rent', 'returned', 'disputed'],
  completed: ['completed'],
  cancelled: ['declined', 'withdrawn', 'expired', 'cancelled'],
};

function sideWhere(businessId: string, side: RentalBookingSideFilter): SQL {
  if (side === 'renter') return eq(rentalBookings.renterBusinessId, businessId);
  if (side === 'owner') return eq(rentalBookings.ownerBusinessId, businessId);
  return or(eq(rentalBookings.renterBusinessId, businessId), eq(rentalBookings.ownerBusinessId, businessId))!;
}

/** `rentalYourTurn` (§6.6) as SQL for one business, with today's IST date from the database clock. */
function yourTurnWhere(businessId: string): SQL {
  return sql`(
    (${rentalBookings.ownerBusinessId} = ${businessId}::uuid AND (
      ${rentalBookings.status} = 'requested'
      OR (${rentalBookings.status} = 'confirmed' AND ${IST_TODAY} >= ${rentalBookings.startDate})
      OR (${rentalBookings.status} = 'on_rent' AND ${IST_TODAY} >= ${rentalBookings.endDate})))
    OR (${rentalBookings.renterBusinessId} = ${businessId}::uuid AND ${rentalBookings.status} IN ('countered', 'returned'))
  )`;
}

interface Cursor {
  at: string;
  id: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

function decodeCursor(raw: string): Cursor {
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor;
    if (typeof c.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(c.at) || !/^[0-9a-f-]{36}$/i.test(c.id)) throw new Error();
    return c;
  } catch {
    throw new ValidationError('Invalid cursor', undefined, 'INVALID_CURSOR');
  }
}

/** `updated_at` in UTC to the microsecond, so the keyset never skips a row two writes left in the same millisecond. */
const updatedAtText = sql<string>`to_char(${rentalBookings.updatedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;

/**
 * `GET /rental-bookings?tab=&side=&listingId=&cursor=` (§13.2): the business's bookings, newest change first, 20 a page
 * by keyset (`updated_at`, `id`); counts per tab and "your turn" under the side (and listing) filter. `listingId` keeps
 * one listing's bookings (My listings "Bookings (n)").
 */
export async function listRentalBookings(
  conn: Conn,
  user: UserTokenPayload,
  q: { tab: RentalBookingTab; side: RentalBookingSideFilter; listingId?: string; cursor?: string },
): Promise<RentalBookingsPage> {
  const empty: RentalBookingsPage = { items: [], nextCursor: null, counts: { active: 0, completed: 0, cancelled: 0 }, yourTurn: 0 };
  const [u] = await conn.select({ businessId: users.businessId }).from(users).where(eq(users.id, user.userId));
  if (!u?.businessId) return empty;
  const me = u.businessId;
  const mine: SQL[] = [sideWhere(me, q.side)];
  if (q.listingId) mine.push(eq(rentalBookings.listingId, q.listingId));
  const where: SQL[] = [...mine, inArray(rentalBookings.status, TAB_STATUSES[q.tab])];
  if (q.cursor) {
    const c = decodeCursor(q.cursor);
    where.push(sql`(${rentalBookings.updatedAt}, ${rentalBookings.id}) < ((${c.at}::timestamp AT TIME ZONE 'UTC'), ${c.id}::uuid)`);
  }
  const size = RENTAL_LIMITS.pageSize;
  const rows = await conn
    .select({ b: rentalBookings, at: updatedAtText })
    .from(rentalBookings)
    .where(and(...where))
    .orderBy(desc(rentalBookings.updatedAt), desc(rentalBookings.id))
    .limit(size + 1);
  const page = rows.slice(0, size);
  const last = page[page.length - 1];
  const nextCursor = rows.length > size && last ? encodeCursor({ at: last.at, id: last.b.id }) : null;

  const [c] = await conn
    .select({
      active: sql<number>`count(*) FILTER (WHERE ${inArray(rentalBookings.status, TAB_STATUSES.active)})::int`,
      completed: sql<number>`count(*) FILTER (WHERE ${rentalBookings.status} = 'completed')::int`,
      cancelled: sql<number>`count(*) FILTER (WHERE ${inArray(rentalBookings.status, TAB_STATUSES.cancelled)})::int`,
      yourTurn: sql<number>`count(*) FILTER (WHERE ${yourTurnWhere(me)})::int`,
    })
    .from(rentalBookings)
    .where(and(...mine));

  return {
    items: await toBookingListRows(conn, page.map((r) => r.b), me, await istTodayOf(conn)),
    nextCursor,
    counts: { active: c?.active ?? 0, completed: c?.completed ?? 0, cancelled: c?.cancelled ?? 0 },
    yourTurn: c?.yourTurn ?? 0,
  };
}

/**
 * `Badges.rentalsYourTurn` (§6.6): the business's bookings whose next step is its own (`rentalYourTurn` with today's
 * IST date), as renter and as owner.
 */
export async function countRentalsYourTurn(conn: Conn, businessId: string): Promise<number> {
  const [row] = await conn
    .select({ n: sql<number>`count(*)::int` })
    .from(rentalBookings)
    .where(and(sideWhere(businessId, 'all'), yourTurnWhere(businessId)));
  return row?.n ?? 0;
}

/**
 * A booking write's start (§6.7, plan Global constraints): the caller's business onboarded (`409
 * ONBOARDING_INCOMPLETE`), a party (`404`), not a viewer (`403 VIEWER_READ_ONLY`); then the listing `FOR UPDATE` (every
 * capacity writer; `listing: false` for a write that changes no capacity, such as notes) and the booking `FOR NO KEY
 * UPDATE`, re-read under the locks.
 */
export async function lockBookingForAction(
  tx: Tx,
  user: UserTokenPayload,
  id: string,
  opts: { listing?: boolean } = {},
): Promise<{ booking: RentalBookingRow; listing: ListingRow | null; reader: BookingReader }> {
  await assertOnboardedForRental(tx, user);
  const { booking: seen, reader } = await bookingForParty(tx, user, id);
  assertCanWrite(reader);
  const listing = opts.listing === false ? null : await lockListingForRental(tx, seen.listingId);
  const booking = await lockRentalBooking(tx, id);
  if (!booking) throw bookingNotFound();
  return { booking, listing, reader };
}
