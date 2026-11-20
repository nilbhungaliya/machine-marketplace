import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { RentalBookingStatus } from '@mpm/shared-types';
import { db } from '../src/db/index.js';
import { rentalBookings } from '../src/db/schema.js';
import { addDays, istToday } from '../src/lib/ist.js';
import { assertCapacity, maxOutInRange, maxOutInRangeSlow, outToday } from '../src/services/rentals/capacity.js';
import { lockListingForRental } from '../src/services/rentals/locks.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { createTestSeller, deleteTestSellerExtras, type TestSeller } from './_helpers/test-listings.js';
import { countM14Rows, deleteM14Rows, insertTestBlock, insertTestBooking, insertTestRentalListing } from './_helpers/test-rentals.js';

// M14 C0-3b (plan, review focus #1): capacity has one definition. The fast form (from + each effective start) equals
// the every-day form on random layouts; overruns, early on-site and disputes count as §5.7 says; and two writers
// racing for the last machine, each holding the listing lock, never both pass.

let owner: TestSeller;
let renter: TestSeller;
const today = istToday();
const d = (n: number) => addDays(today, n);
/** An instant at noon IST, `n` days from today. */
const istNoon = (n: number) => new Date(`${d(n)}T06:30:00Z`);

/** A small deterministic PRNG (mulberry32): the layouts are random but the same every run. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

beforeAll(async () => {
  owner = await createTestSeller({ gst: true });
  renter = await createTestSeller();
});

afterAll(async () => {
  await deleteTestBusinesses([owner?.businessId, renter?.businessId].filter(Boolean) as string[]);
  await deleteTestSellerExtras([owner, renter].filter(Boolean));
  expect(Object.values(await countM14Rows()).every((n) => n === 0)).toBe(true);
});

const book = (listingId: string, o: Omit<Parameters<typeof insertTestBooking>[0], 'listingId' | 'renterBusinessId' | 'ownerBusinessId' | 'userId'>) =>
  insertTestBooking({ listingId, renterBusinessId: renter.businessId, ownerBusinessId: owner.businessId, userId: renter.userId, ...o });

describe('maxOutInRange', () => {
  it('equals the every-day form over 20 random layouts of bookings and blocks', async () => {
    const { listingId } = await insertTestRentalListing({ businessId: owner.businessId, userId: owner.userId, quantity: 50 });
    const statuses: RentalBookingStatus[] = ['confirmed', 'on_rent', 'disputed', 'returned', 'requested', 'cancelled', 'completed'];
    const rand = rng(1414);
    const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
    for (let layout = 0; layout < 20; layout++) {
      const n = int(2, 6);
      for (let i = 0; i < n; i++) {
        const start = int(-12, 20);
        const end = start + int(0, 8);
        if (rand() < 0.3) {
          await insertTestBlock({ listingId, userId: owner.userId, startDate: d(start), endDate: d(end), machines: int(1, 3) });
          continue;
        }
        const status = statuses[int(0, statuses.length - 1)]!;
        const onSite = ['on_rent', 'disputed', 'returned', 'completed'].includes(status) ? istNoon(start - int(0, 1)) : null;
        const b = await book(listingId, { status, startDate: d(start), endDate: d(end), machines: int(1, 3), onSiteAt: onSite });
        if (status === 'disputed' && rand() < 0.5) {
          await db.update(rentalBookings).set({ disputedFrom: 'returned' }).where(eq(rentalBookings.id, b.bookingId));
        }
      }
      for (let r = 0; r < 4; r++) {
        const from = int(-14, 22);
        const to = from + int(0, 12);
        expect(await maxOutInRange(db, listingId, d(from), d(to))).toBe(await maxOutInRangeSlow(db, listingId, d(from), d(to)));
      }
      await deleteM14Rows(db, { businessIds: [], listingIds: [listingId] });
    }
  });

  it('keeps an overrunning booking counted today, counts an early on-site day, and skips a dispute from returned', async () => {
    const { listingId } = await insertTestRentalListing({ businessId: owner.businessId, userId: owner.userId, quantity: 5 });
    // Out since 5 days ago, due back 2 days ago, never marked returned.
    await book(listingId, { status: 'on_rent', startDate: d(-5), endDate: d(-2), onSiteAt: istNoon(-5) });
    expect(await outToday(db, listingId)).toBe(1);
    expect(await maxOutInRange(db, listingId, d(0), d(0))).toBe(1);
    expect(await maxOutInRange(db, listingId, d(1), d(3))).toBe(0);

    // Starts tomorrow, already on site today.
    await book(listingId, { status: 'on_rent', startDate: d(1), endDate: d(3), machines: 2, onSiteAt: istNoon(0) });
    expect(await outToday(db, listingId)).toBe(3);

    const disputed = await book(listingId, { status: 'disputed', startDate: d(-1), endDate: d(1), onSiteAt: istNoon(-1) });
    expect(await outToday(db, listingId)).toBe(4);
    await db.update(rentalBookings).set({ disputedFrom: 'returned' }).where(eq(rentalBookings.id, disputed.bookingId));
    expect(await outToday(db, listingId)).toBe(3);
  });
});

describe('assertCapacity', () => {
  it('lets one of two racing writers take the last machine', async () => {
    const { listingId } = await insertTestRentalListing({ businessId: owner.businessId, userId: owner.userId, quantity: 2 });
    // Its thread is reused by both writers (each would otherwise insert the same thread).
    const first = await book(listingId, { status: 'confirmed', startDate: d(3), endDate: d(5) });

    const writer = (delayMs: number) =>
      db.transaction(async (tx) => {
        const listing = await lockListingForRental(tx, listingId);
        // The first writer holds the lock a while: the second waits on it, then sees the first's booking.
        if (delayMs) await tx.execute(sql`SELECT pg_sleep(${delayMs / 1000})`);
        await assertCapacity(tx, { id: listing.id, quantity: 2 }, { from: d(4), to: d(6) }, 1);
        await insertTestBooking(
          {
            listingId,
            renterBusinessId: renter.businessId,
            ownerBusinessId: owner.businessId,
            userId: renter.userId,
            threadId: first.threadId,
            status: 'confirmed',
            startDate: d(4),
            endDate: d(6),
          },
          tx,
        );
      });
    const results = await Promise.allSettled([writer(300), writer(0)]);
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ code: 'RENTAL_DATES_TAKEN' });
    expect(await maxOutInRange(db, listingId, d(4), d(6))).toBe(2);
  });
});
