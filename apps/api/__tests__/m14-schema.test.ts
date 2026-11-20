import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';
import { insertTestDeal } from './_helpers/test-deals.js';
import {
  countM14Rows,
  deleteM14Rows,
  insertTestBlock,
  insertTestBooking,
  insertTestRentalListing,
} from './_helpers/test-rentals.js';

// M14 data model (spec 2026-11-20-m14-rental-bookings §5; plan C0-2): what the database itself refuses. Raw SQL on
// purpose.

let owner: TestSeller;
let renter: TestBusinessUser;
const businessIds: string[] = [];

async function rowsOf<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(query)).rows as T[];
}

async function booking(status: Parameters<typeof insertTestBooking>[0]['status'] = 'requested') {
  const { listingId } = await insertTestRentalListing({ businessId: owner.businessId, userId: owner.userId, quantity: 2 });
  return insertTestBooking({
    listingId,
    renterBusinessId: renter.businessId,
    ownerBusinessId: owner.businessId,
    userId: renter.userId,
    startDate: '2026-12-01',
    count: 3,
    status,
  });
}

const reviewInsert = (o: { dealId?: string | null; bookingId?: string | null; side: 'buyer' | 'seller'; cols: string }) =>
  db.execute(sql`
    INSERT INTO deal_reviews (deal_id, rental_booking_id, reviewer_side, reviewer_business_id, reviewed_business_id,
      reviewer_user_id, publish_due_at, ${sql.raw(o.cols.split('=')[0]!)})
    VALUES (${o.dealId ?? null}, ${o.bookingId ?? null}, ${o.side},
      ${o.side === 'buyer' ? renter.businessId : owner.businessId}, ${o.side === 'buyer' ? owner.businessId : renter.businessId},
      ${o.side === 'buyer' ? renter.userId : owner.userId}, now(), ${sql.raw(o.cols.split('=')[1]!)})`);

beforeAll(async () => {
  owner = await createTestSeller({ gst: true });
  renter = await createTestBusinessUser();
  businessIds.push(owner.businessId, renter.businessId);
});

afterAll(async () => {
  await deleteTestBusinesses(businessIds);
  await deleteTestSellerExtras([owner]);
});

describe('M14 schema', () => {
  it('numbers bookings from #700001', async () => {
    const b = await booking();
    expect(b.ref).toBeGreaterThanOrEqual(700001);
  });

  it('refuses an end date before the start date', async () => {
    const b = await booking();
    await expect(db.execute(sql`UPDATE rental_bookings SET end_date = start_date - 1 WHERE id = ${b.bookingId}`)).rejects.toMatchObject({
      code: '23514', constraint: 'rental_bookings_dates',
    });
  });

  it('refuses an advance above the agreed total and a fourth on-site photo', async () => {
    const b = await booking('confirmed');
    await expect(
      db.execute(sql`UPDATE rental_bookings SET advance_paise = agreed_total_paise + 1 WHERE id = ${b.bookingId}`),
    ).rejects.toMatchObject({ code: '23514', constraint: 'rental_bookings_advance_le_agreed' });
    await expect(
      db.execute(sql`UPDATE rental_bookings SET on_site_photo_keys = ARRAY['a','b','c','d'] WHERE id = ${b.bookingId}`),
    ).rejects.toMatchObject({ code: '23514', constraint: 'rental_bookings_photos_max' });
  });

  it('refuses a block longer than 366 days', async () => {
    const { listingId } = await insertTestRentalListing({ businessId: owner.businessId, userId: owner.userId });
    await expect(
      insertTestBlock({ listingId, userId: owner.userId, startDate: '2027-01-01', endDate: '2028-01-02' }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'rental_blocks_shape' });
    await expect(insertTestBlock({ listingId, userId: owner.userId, startDate: '2027-01-01', endDate: '2028-01-01' })).resolves.toBeTruthy();
  });

  it('takes a booking card with its booking, and refuses one without', async () => {
    const b = await booking();
    await expect(
      db.execute(sql`
        INSERT INTO chat_messages (thread_id, kind, sender_side, sender_user_id)
        VALUES (${b.threadId}, 'booking', 'buyer', ${renter.userId})`),
    ).rejects.toMatchObject({ code: '23514', constraint: 'chat_messages_shape' });
    await expect(
      db.execute(sql`
        INSERT INTO chat_messages (thread_id, kind, sender_side, sender_user_id, rental_booking_id)
        VALUES (${b.threadId}, 'booking', 'buyer', ${renter.userId}, ${b.bookingId})`),
    ).resolves.toBeTruthy();
    await expect(
      db.execute(sql`
        INSERT INTO chat_messages (thread_id, kind, sender_side, sender_user_id, text, rental_booking_id)
        VALUES (${b.threadId}, 'text', 'buyer', ${renter.userId}, 'hi', ${b.bookingId})`),
    ).rejects.toMatchObject({ code: '23514', constraint: 'chat_messages_shape' });
  });

  it('allows one open dispute per booking', async () => {
    const b = await booking('disputed');
    const insert = () =>
      db.execute(sql`
        INSERT INTO deal_disputes (rental_booking_id, opened_by_side, opened_by_user_id, category, description)
        VALUES (${b.bookingId}, 'buyer', ${renter.userId}, 'breakdown', 'The machine stopped on day two')`);
    await insert();
    await expect(insert()).rejects.toMatchObject({ code: '23505', constraint: 'deal_disputes_one_open_rental' });
  });

  it('refuses a review or a dispute with both subjects or neither', async () => {
    const b = await booking('completed');
    const listing = await insertTestListing(db, { businessId: owner.businessId, userId: owner.userId, kind: 'part', categoryId: null, quantity: '5' });
    const deal = await insertTestDeal({ listing: { id: listing.id }, buyer: renter, quantity: '1', pricePerUnitPaise: 100_000, status: 'completed' });
    const buyerCols = 'r_matched_listing, r_communication, r_on_time=5, 5, 5';
    await expect(reviewInsert({ dealId: deal.dealId, bookingId: b.bookingId, side: 'buyer', cols: buyerCols })).rejects.toMatchObject({
      code: '23514', constraint: 'deal_reviews_subject_one',
    });
    await expect(reviewInsert({ side: 'buyer', cols: buyerCols })).rejects.toMatchObject({
      code: '23514', constraint: 'deal_reviews_subject_one',
    });
    await expect(
      db.execute(sql`
        INSERT INTO deal_disputes (opened_by_side, opened_by_user_id, category, description)
        VALUES ('buyer', ${renter.userId}, 'other', 'Neither a deal nor a booking')`),
    ).rejects.toMatchObject({ code: '23514', constraint: 'deal_disputes_subject_one' });
  });

  it('checks rental review facets per side, and still takes an F6 deal review', async () => {
    const b = await booking('completed');
    await expect(
      reviewInsert({ bookingId: b.bookingId, side: 'seller', cols: 'r_communication, r_payment, r_pickup=5, 5, 5' }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'deal_reviews_shape' });
    await expect(
      reviewInsert({ bookingId: b.bookingId, side: 'seller', cols: 'r_communication, r_payment, r_care=5, 4, 3' }),
    ).resolves.toBeTruthy();
    await expect(
      reviewInsert({ bookingId: b.bookingId, side: 'buyer', cols: 'r_matched_listing, r_communication, r_on_time=5, 5, 5' }),
    ).resolves.toBeTruthy();
    await expect(
      reviewInsert({ bookingId: b.bookingId, side: 'buyer', cols: 'r_matched_listing, r_communication, r_on_time=4, 4, 4' }),
    ).rejects.toMatchObject({ code: '23505', constraint: 'deal_reviews_rental_side_uq' });

    const listing = await insertTestListing(db, { businessId: owner.businessId, userId: owner.userId, kind: 'part', categoryId: null, quantity: '5' });
    const deal = await insertTestDeal({ listing: { id: listing.id }, buyer: renter, quantity: '1', pricePerUnitPaise: 100_000, status: 'completed' });
    await expect(
      reviewInsert({ dealId: deal.dealId, side: 'seller', cols: 'r_communication, r_payment, r_pickup=5, 5, 5' }),
    ).resolves.toBeTruthy();
    await expect(
      reviewInsert({ dealId: deal.dealId, side: 'buyer', cols: 'r_matched_listing, r_communication, r_on_time, r_care=5, 5, 5, 5' }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'deal_reviews_shape' });
  });

  it('deleteM14Rows leaves no M14 row, then the businesses delete', async () => {
    const extraOwner = await createTestSeller();
    const extraRenter = await createTestBusinessUser();
    const { listingId } = await insertTestRentalListing({ businessId: extraOwner.businessId, userId: extraOwner.userId });
    const b = await insertTestBooking({
      listingId, renterBusinessId: extraRenter.businessId, ownerBusinessId: extraOwner.businessId, userId: extraRenter.userId,
      startDate: '2026-12-10', status: 'completed',
    });
    await insertTestBlock({ listingId, userId: extraOwner.userId, startDate: '2026-12-20', endDate: '2026-12-21' });
    await db.execute(sql`
      INSERT INTO rental_booking_events (booking_id, code, actor_side) VALUES (${b.bookingId}, 'requested', 'renter')`);
    await db.execute(sql`
      INSERT INTO chat_messages (thread_id, kind, sender_side, sender_user_id, rental_booking_id)
      VALUES (${b.threadId}, 'booking', 'buyer', ${extraRenter.userId}, ${b.bookingId})`);
    const [review] = await rowsOf<{ id: string }>(sql`
      INSERT INTO deal_reviews (rental_booking_id, reviewer_side, reviewer_business_id, reviewed_business_id, reviewer_user_id,
        r_matched_listing, r_communication, r_on_time, publish_due_at)
      VALUES (${b.bookingId}, 'buyer', ${extraRenter.businessId}, ${extraOwner.businessId}, ${extraRenter.userId}, 5, 5, 5, now())
      RETURNING id`);
    await db.execute(sql`
      INSERT INTO notifications (user_id, business_id, type, category, rental_booking_id, review_id, dedupe_key)
      VALUES (${extraOwner.userId}, ${extraOwner.businessId}, 'rental_booking_completed', 'rentals', ${b.bookingId},
        ${review!.id}, ${`rental_booking_completed:${b.bookingId}`})`);

    const ours = [extraOwner.businessId, extraRenter.businessId];
    await deleteM14Rows(db, { businessIds: ours });
    const [left] = await rowsOf<{ n: number }>(sql`
      SELECT (SELECT count(*) FROM rental_bookings WHERE renter_business_id = ${extraRenter.businessId})
           + (SELECT count(*) FROM rental_blocks WHERE listing_id = ${listingId})::int AS n`);
    expect(Number(left!.n)).toBe(0);
    await expect(deleteTestBusinesses(ours)).resolves.toBeUndefined();
    await deleteTestSellerExtras([extraOwner]);
  });
});

describe('M14 cleanup', () => {
  it('leaves every M14 table empty after the businesses go', async () => {
    await deleteTestBusinesses(businessIds.splice(0));
    expect(Object.values(await countM14Rows()).every((n) => n === 0)).toBe(true);
  });
});
