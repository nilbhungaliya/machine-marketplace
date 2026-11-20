import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import type { ReviewState, SellerReviewsPage } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { auditLog, dealReviews, notifications } from '../src/db/schema.js';
import { addDays, istToday } from '../src/lib/ist.js';
import { runTx } from '../src/lib/tx-effects.js';
import { moderateReview } from '../src/services/reviews/review-moderation.service.js';
import { publishDueReviews } from '../src/services/reviews/review-jobs.js';
import { postReply } from '../src/services/reviews/review.service.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { createTestSeller, deleteTestSellerExtras, type TestSeller } from './_helpers/test-listings.js';
import { countM14Rows, insertTestBooking, insertTestRentalListing } from './_helpers/test-rentals.js';

// M14 A3-1 (spec R11, §5.5a): rental reviews with the rental facets, refused before completion, blind publishing of
// the pair, and a rental review counted in the seller score and shown in the public list (LEFT JOIN, booking title);
// reply, hide and the publish job go through the subject.

let app: FastifyInstance;
let owner: TestSeller;
let renter: TestSeller;
let third: TestSeller;
let moderator: { id: string; token: string };
let listingId: string;

const RENTER_RATINGS = { matched_listing: 5, communication: 4, on_time: 5 };
const OWNER_RATINGS = { communication: 5, payment: 4, care: 3 };
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const review = (token: string, id: string, payload: object) =>
  app.inject({ method: 'POST', url: `/rental-bookings/${id}/review`, headers: auth(token), payload });
const asUser = (u: TestSeller) => ({ userId: u.userId, businessId: u.businessId });

async function booking(status: 'completed' | 'on_rent' = 'completed'): Promise<string> {
  const b = await insertTestBooking({
    listingId,
    renterBusinessId: renter.businessId,
    ownerBusinessId: owner.businessId,
    userId: renter.userId,
    status,
    startDate: addDays(istToday(), -3),
  });
  return b.bookingId;
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  owner = await createTestSeller({ gst: true });
  renter = await createTestSeller();
  third = await createTestSeller();
  moderator = await createTestAdmin('moderator');
  ({ listingId } = await insertTestRentalListing({ businessId: owner.businessId, userId: owner.userId, title: 'Rental crane 25 t' }));
});

afterAll(async () => {
  if (moderator) await db.delete(auditLog).where(eq(auditLog.adminId, moderator.id));
  const all = [owner, renter, third].filter(Boolean);
  await deleteTestBusinesses(all.map((s) => s.businessId));
  await deleteTestSellerExtras(all);
  await deleteTestAdmins([moderator?.id].filter(Boolean) as string[]);
  expect(Object.values(await countM14Rows()).every((n) => n === 0)).toBe(true);
  await app?.close();
});

describe('rental reviews (R11)', () => {
  it('takes the renter and owner facets, refuses a wrong facet, and publishes the pair blind', async () => {
    const id = await booking();
    const wrong = await review(owner.token, id, { ratings: { communication: 5, payment: 4, pickup: 3 } });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().code).toBe('REVIEW_ANSWERS_INVALID');

    const first = await review(renter.token, id, { ratings: RENTER_RATINGS, text: 'Good machine' });
    expect(first.statusCode).toBe(200);
    const s1 = first.json().data as ReviewState;
    expect(s1.subject).toEqual({ kind: 'rental', id });
    expect(s1.dealId).toBeNull();
    expect(s1.mine?.publishedAt).toBeNull();

    // Blind: the owner sees only "submitted", then its own review publishes both.
    const ownerState = (await app.inject({ method: 'GET', url: `/rental-bookings/${id}/review`, headers: auth(owner.token) })).json().data as ReviewState;
    expect(ownerState).toMatchObject({ mySide: 'seller', eligible: true, theirsSubmitted: true, mine: null });

    const second = await review(owner.token, id, { ratings: OWNER_RATINGS });
    expect(second.statusCode).toBe(200);
    expect((second.json().data as ReviewState).mine).toMatchObject({ ratings: OWNER_RATINGS });
    const rows = await db.select().from(dealReviews).where(eq(dealReviews.rentalBookingId, id));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.publishedAt !== null)).toBe(true);
    expect(rows.find((r) => r.reviewerSide === 'seller')!.rCare).toBe(3);

    const notified = await db.select().from(notifications).where(and(eq(notifications.type, 'review_received'), eq(notifications.rentalBookingId, id)));
    expect(notified).toHaveLength(1);

    const outsider = await app.inject({ method: 'GET', url: `/rental-bookings/${id}/review`, headers: auth(third.token) });
    expect(outsider.statusCode).toBe(404);
    expect(outsider.json().code).toBe('RENTAL_BOOKING_NOT_FOUND');
  });

  it('refuses a review before completion', async () => {
    const id = await booking('on_rent');
    const res = await review(renter.token, id, { ratings: RENTER_RATINGS });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('REVIEW_NOT_ELIGIBLE');
  });

  it('counts rental reviews in the seller score and lists them with the booking title; reply, hide and the job use the subject', async () => {
    const ids = [await booking(), await booking(), await booking()];
    for (const id of ids) expect((await review(renter.token, id, { ratings: RENTER_RATINGS })).statusCode).toBe(200);
    // The publish job: single reviews past their due time publish alone and tell the owner, destination the booking.
    await db.execute(sql`UPDATE deal_reviews SET publish_due_at = now() - interval '1 minute' WHERE published_at IS NULL AND rental_booking_id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`);
    expect(await publishDueReviews(app)).toBeGreaterThanOrEqual(3);
    const told = await db.select().from(notifications).where(and(eq(notifications.type, 'review_received'), eq(notifications.rentalBookingId, ids[0]!)));
    expect(told).toHaveLength(1);
    expect(told[0]!.params).toMatchObject({ bookingRef: expect.any(Number) });

    const page = (await app.inject({ method: 'GET', url: `/businesses/${owner.businessId}/reviews` })).json().data as SellerReviewsPage;
    expect(page.count).toBe(4);
    expect(page.score).not.toBeNull();
    expect(page.score!.count).toBe(4);
    expect(page.items.map((i) => i.listingTitle)).toContain('Rental crane 25 t');

    const [target] = await db.select().from(dealReviews).where(and(eq(dealReviews.rentalBookingId, ids[0]!), eq(dealReviews.reviewerSide, 'buyer')));
    const replied = await runTx(app, (tx) => postReply(tx, asUser(owner), target!.id, 'Thank you'));
    expect(replied.reply?.text).toBe('Thank you');
    await expect(runTx(app, (tx) => postReply(tx, asUser(owner), target!.id, 'Again'))).rejects.toMatchObject({ code: 'REPLY_EXISTS' });

    const hidden = await runTx(app, (tx) => moderateReview(tx, moderator.id, target!.id, 'hide', 'Personal details'));
    expect(hidden.hidden).toBe(true);
    expect(hidden.ratings).toEqual(RENTER_RATINGS);
    const after = (await app.inject({ method: 'GET', url: `/businesses/${owner.businessId}/reviews` })).json().data as SellerReviewsPage;
    expect(after.count).toBe(3);
  });
});
