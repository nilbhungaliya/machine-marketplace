import { and, eq, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import {
  rentalEndDate,
  type RentalBlockReason,
  type RentalBookingStatus,
  type RentalOperator,
  type RentalPeriod,
  type RentalRates,
  type RentalTermsSnapshot,
  type RentalTransport,
} from '@mpm/shared-types';
import { db, type Db, type Tx } from '../../src/db/index.js';
import {
  chatMessages,
  chatThreads,
  dealDisputes,
  dealReviews,
  listings,
  notificationDeliveries,
  notifications,
  rentalBlocks,
  rentalBookingEvents,
  rentalBookingVersions,
  rentalBookings,
  reports,
} from '../../src/db/schema.js';
import { insertTestThread } from './test-deals.js';
import { insertTestListing } from './test-listings.js';

// M14 rental booking fixtures (plan C0-2). Rows are written directly (no services), so booking, capacity and job tests
// start from any state. Cleanup: `deleteM14Rows` (called by `deleteListingsOf` and `deleteTestListings` before the F8
// and F6 cleanups, so a suite's usual `deleteTestBusinesses` in `afterAll` removes M14 rows first); `countM14Rows` is
// the "left clean" check.

type Conn = Db | Tx;
type Point = { lat: number; lng: number };

/**
 * A live `machine_rental` listing (with its `listing_machines` and `listing_rentals` rows) of `quantity` machines
 * (default 1). Rates default to a ₹5 000 day rate only; every other term is unset unless given.
 */
export async function insertTestRentalListing(
  o: {
    businessId: string;
    userId: string;
    quantity?: number;
    status?: Parameters<typeof insertTestListing>[1]['status'];
    categoryId?: string | null;
    title?: string;
    rates?: Partial<RentalRates>;
    operator?: RentalOperator | null;
    operatorRateDayPaise?: number | null;
    transport?: RentalTransport | null;
    transportChargePaise?: number | null;
    minDuration?: number | null;
    minDurationPeriod?: RentalPeriod | null;
    serviceRadiusKm?: number | null;
    depositPaise?: number | null;
    point?: Point | null;
  },
  conn: Conn = db,
): Promise<{ listingId: string }> {
  const { id } = await insertTestListing(conn, {
    businessId: o.businessId,
    userId: o.userId,
    kind: 'machine_rental',
    status: o.status ?? 'live',
    categoryId: o.categoryId ?? null,
    title: o.title ?? 'Test rental excavator',
    quantity: String(o.quantity ?? 1),
    point: o.point ?? null,
    rental: {
      rateHourPaise: o.rates?.rateHourPaise ?? null,
      rateDayPaise: o.rates?.rateDayPaise !== undefined ? o.rates.rateDayPaise : 500_000,
      rateWeekPaise: o.rates?.rateWeekPaise ?? null,
      rateMonthPaise: o.rates?.rateMonthPaise ?? null,
      ...(o.rates?.shiftHours !== undefined ? { shiftHours: o.rates.shiftHours } : {}),
      ...(o.rates?.monthDays !== undefined ? { monthDays: o.rates.monthDays } : {}),
      operator: o.operator ?? null,
      operatorRateDayPaise: o.operatorRateDayPaise ?? null,
      transport: o.transport ?? null,
      transportChargePaise: o.transportChargePaise ?? null,
      minDuration: o.minDuration ?? null,
      minDurationPeriod: o.minDurationPeriod ?? null,
      serviceRadiusKm: o.serviceRadiusKm ?? null,
      depositPaise: o.depositPaise ?? null,
    },
  });
  return { listingId: id };
}

const DEFAULT_TERMS: RentalTermsSnapshot = {
  rateHourPaise: null,
  rateDayPaise: 500_000,
  rateWeekPaise: null,
  rateMonthPaise: null,
  shiftHours: 8,
  monthDays: 26,
  operator: null,
  operatorRateDayPaise: null,
  fuel: 'client',
  transport: null,
  transportChargePaise: null,
  depositPaise: null,
  minDuration: null,
  minDurationPeriod: null,
  serviceRadiusKm: null,
};

export interface TestBooking {
  bookingId: string;
  ref: number;
  threadId: string;
  versionId: string;
}

/**
 * A booking row in `status` (default `requested`) with its version 1 (renter's, total = `totalPaise`) and
 * `current_version_id` set; the renter's thread on the listing is reused or created. Timestamps follow the status:
 * `confirmed_at` from `confirmed` on (default now), `on_site_at` for `on_rent` / `returned` / `disputed` (default now),
 * `returned_at` + `auto_complete_at` (+ 2 days) for `returned`, `completed_at` for `completed`, `cancelled_at` for
 * `cancelled`; `turn` owner on `requested`, renter on `countered`; `disputed` comes from `on_rent`. Dates are
 * `YYYY-MM-DD`; `endDate` defaults to `rentalEndDate(startDate, period, count)`.
 */
export async function insertTestBooking(
  o: {
    listingId: string;
    renterBusinessId: string;
    ownerBusinessId: string;
    /** The renter user who requested. */
    userId: string;
    threadId?: string;
    status?: RentalBookingStatus;
    startDate: string;
    endDate?: string;
    period?: RentalPeriod;
    count?: number;
    machines?: number;
    totalPaise?: number;
    onSiteAt?: Date | null;
    confirmedAt?: Date | null;
    sitePincode?: string;
    siteAddress?: string | null;
    terms?: Partial<RentalTermsSnapshot>;
  },
  conn: Conn = db,
): Promise<TestBooking> {
  const status = o.status ?? 'requested';
  const period = o.period ?? 'day';
  const count = o.count ?? 1;
  const endDate = o.endDate ?? rentalEndDate(o.startDate, period, count);
  const machines = o.machines ?? 1;
  const total = o.totalPaise ?? 500_000 * count * machines;
  const agreed = !['requested', 'countered', 'declined', 'withdrawn', 'expired'].includes(status);
  const onSite = ['on_rent', 'returned', 'completed', 'disputed'].includes(status);

  let threadId = o.threadId;
  if (!threadId) {
    const [existing] = await conn
      .select({ id: chatThreads.id })
      .from(chatThreads)
      .where(and(eq(chatThreads.listingId, o.listingId), eq(chatThreads.buyerBusinessId, o.renterBusinessId)));
    threadId =
      existing?.id ??
      (await insertTestThread({ listingId: o.listingId, buyerBusinessId: o.renterBusinessId, buyerUserId: o.userId }, conn)).id;
  }

  const [l] = await conn.select({ title: listings.title }).from(listings).where(eq(listings.id, o.listingId));
  const now = new Date();
  const [b] = await conn
    .insert(rentalBookings)
    .values({
      listingId: o.listingId,
      threadId,
      renterBusinessId: o.renterBusinessId,
      ownerBusinessId: o.ownerBusinessId,
      createdByUserId: o.userId,
      status,
      turn: status === 'requested' ? 'owner' : status === 'countered' ? 'renter' : null,
      startDate: o.startDate,
      endDate,
      period,
      periodCount: count,
      machines,
      withOperator: false,
      ownerDelivers: false,
      agreedTotalPaise: agreed ? total : null,
      sitePincode: o.sitePincode ?? '990011',
      siteCity: 'Surat',
      siteState: 'Gujarat',
      siteAddress: o.siteAddress ?? null,
      listingTitle: l?.title ?? 'Test rental',
      termsSnapshot: { ...DEFAULT_TERMS, ...(o.terms ?? {}) },
      replyDueAt: status === 'requested' || status === 'countered' ? sql`now() + interval '24 hours'` : null,
      confirmedAt: o.confirmedAt !== undefined ? o.confirmedAt : agreed && status !== 'cancelled' ? now : null,
      onSiteAt: o.onSiteAt !== undefined ? o.onSiteAt : onSite ? now : null,
      onSiteBySide: onSite ? 'owner' : null,
      returnedAt: status === 'returned' || status === 'completed' ? now : null,
      autoCompleteAt: status === 'returned' ? sql`now() + interval '2 days'` : null,
      completedAt: status === 'completed' ? now : null,
      completedHow: status === 'completed' ? 'renter_confirmed' : null,
      cancelledAt: status === 'cancelled' ? now : null,
      cancelledBySide: status === 'cancelled' ? 'renter' : null,
      cancelReason: status === 'cancelled' ? 'plans_changed' : null,
      disputedFrom: status === 'disputed' ? 'on_rent' : null,
    })
    .returning({ id: rentalBookings.id, ref: rentalBookings.ref });

  const [v] = await conn
    .insert(rentalBookingVersions)
    .values({
      bookingId: b!.id,
      seq: 1,
      proposedBySide: 'renter',
      startDate: o.startDate,
      endDate,
      period,
      periodCount: count,
      machines,
      withOperator: false,
      ownerDelivers: false,
      estimatePaise: total,
      totalPaise: total,
      createdByUserId: o.userId,
    })
    .returning({ id: rentalBookingVersions.id });
  await conn.update(rentalBookings).set({ currentVersionId: v!.id }).where(eq(rentalBookings.id, b!.id));
  return { bookingId: b!.id, ref: b!.ref, threadId, versionId: v!.id };
}

/** An owner block on a listing (default 1 machine, `maintenance`). */
export async function insertTestBlock(
  o: { listingId: string; userId: string; startDate: string; endDate: string; machines?: number; reason?: RentalBlockReason },
  conn: Conn = db,
): Promise<{ blockId: string }> {
  const [row] = await conn
    .insert(rentalBlocks)
    .values({
      listingId: o.listingId,
      startDate: o.startDate,
      endDate: o.endDate,
      machines: o.machines ?? 1,
      reason: o.reason ?? 'maintenance',
      createdByUserId: o.userId,
    })
    .returning({ id: rentalBlocks.id });
  return { blockId: row!.id };
}

/**
 * Every M14 row in the database, by table (plus notifications, messages, reviews and disputes pointing at a booking):
 * the "left clean" checks expect all zeros.
 */
export async function countM14Rows(conn: Conn = db): Promise<Record<string, number>> {
  const n = async (q: Promise<Array<{ n: number }>>): Promise<number> => Number((await q)[0]?.n ?? 0);
  const c = sql<number>`count(*)::int`;
  return {
    rental_bookings: await n(conn.select({ n: c }).from(rentalBookings)),
    rental_booking_versions: await n(conn.select({ n: c }).from(rentalBookingVersions)),
    rental_booking_events: await n(conn.select({ n: c }).from(rentalBookingEvents)),
    rental_blocks: await n(conn.select({ n: c }).from(rentalBlocks)),
    notifications_with_booking: await n(conn.select({ n: c }).from(notifications).where(isNotNull(notifications.rentalBookingId))),
    messages_with_booking: await n(conn.select({ n: c }).from(chatMessages).where(isNotNull(chatMessages.rentalBookingId))),
    reviews_with_booking: await n(conn.select({ n: c }).from(dealReviews).where(isNotNull(dealReviews.rentalBookingId))),
    disputes_with_booking: await n(conn.select({ n: c }).from(dealDisputes).where(isNotNull(dealDisputes.rentalBookingId))),
  };
}

const ids = <T extends { id: string }>(rows: T[]): string[] => rows.map((r) => r.id);

/**
 * Deletes M14 rows of the given businesses (as renter or owner), listings, users (bookings they created, blocks they
 * wrote) and bookings, deepest foreign key first: deliveries + notifications of those bookings, rental reviews and
 * disputes, booking messages, events, the `current_version_id` pointer, versions, bookings, then the blocks of those
 * listings and of every listing of the businesses. No-op when every list is empty. Call before `deleteF8Rows` /
 * `deleteF6Rows` (bookings reference threads).
 */
export async function deleteM14Rows(
  conn: Conn,
  opts: { businessIds: string[]; listingIds?: string[]; bookingIds?: string[]; userIds?: string[] },
): Promise<void> {
  const businessIds = opts.businessIds;
  const userIds = opts.userIds ?? [];
  const listingIds = [...(opts.listingIds ?? [])];
  if (businessIds.length === 0 && userIds.length === 0 && listingIds.length === 0 && !opts.bookingIds?.length) return;
  if (businessIds.length) {
    listingIds.push(...ids(await conn.select({ id: listings.id }).from(listings).where(inArray(listings.businessId, businessIds))));
  }

  const bookingWhere: SQL[] = [];
  if (opts.bookingIds?.length) bookingWhere.push(inArray(rentalBookings.id, opts.bookingIds));
  if (listingIds.length) bookingWhere.push(inArray(rentalBookings.listingId, listingIds));
  if (businessIds.length) {
    bookingWhere.push(inArray(rentalBookings.renterBusinessId, businessIds), inArray(rentalBookings.ownerBusinessId, businessIds));
  }
  if (userIds.length) bookingWhere.push(inArray(rentalBookings.createdByUserId, userIds));
  const bookingIds = bookingWhere.length
    ? ids(await conn.select({ id: rentalBookings.id }).from(rentalBookings).where(or(...bookingWhere)))
    : [];

  if (bookingIds.length) {
    const reviewIds = ids(
      await conn.select({ id: dealReviews.id }).from(dealReviews).where(inArray(dealReviews.rentalBookingId, bookingIds)),
    );
    const notificationWhere: SQL[] = [inArray(notifications.rentalBookingId, bookingIds)];
    if (reviewIds.length) notificationWhere.push(inArray(notifications.reviewId, reviewIds));
    const notificationIds = ids(await conn.select({ id: notifications.id }).from(notifications).where(or(...notificationWhere)));
    if (notificationIds.length) {
      await conn.delete(notificationDeliveries).where(inArray(notificationDeliveries.notificationId, notificationIds));
      await conn.delete(notifications).where(inArray(notifications.id, notificationIds));
    }
    if (reviewIds.length) {
      await conn.delete(reports).where(and(sql`${reports.targetType} = 'review'`, inArray(reports.targetId, reviewIds)));
      await conn.delete(dealReviews).where(inArray(dealReviews.id, reviewIds));
    }
    await conn.delete(dealDisputes).where(inArray(dealDisputes.rentalBookingId, bookingIds));
    await conn.delete(chatMessages).where(inArray(chatMessages.rentalBookingId, bookingIds));
    await conn.delete(rentalBookingEvents).where(inArray(rentalBookingEvents.bookingId, bookingIds));
    await conn.update(rentalBookings).set({ currentVersionId: null }).where(inArray(rentalBookings.id, bookingIds));
    await conn.delete(rentalBookingVersions).where(inArray(rentalBookingVersions.bookingId, bookingIds));
    await conn.delete(rentalBookings).where(inArray(rentalBookings.id, bookingIds));
  }

  const blockWhere: SQL[] = [];
  if (listingIds.length) blockWhere.push(inArray(rentalBlocks.listingId, listingIds));
  if (userIds.length) blockWhere.push(inArray(rentalBlocks.createdByUserId, userIds));
  if (blockWhere.length) await conn.delete(rentalBlocks).where(or(...blockWhere));
}
