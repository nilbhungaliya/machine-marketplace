import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { dealReviews, deals, notifications } from '../src/db/schema.js';
import { runTx, type TxApp } from '../src/lib/tx-effects.js';
import { publishDueReviews } from '../src/services/reviews/review-jobs.js';
import { getReviewState } from '../src/services/reviews/review-state.js';
import { submitReview } from '../src/services/reviews/review.service.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { addTestMember, insertTestDeal } from './_helpers/test-deals.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';

// L4-1 (spec §10.1–§10.3): eligibility, the 14-day window, one review per side, facets per side, blind publishing,
// the publish job (twice and concurrently once), the min(t + 7 d, completed + 14 d) due time and `review_waiting`.

const fakeIo = { of: () => ({ to: () => ({ emit: () => undefined }) }) };
const txApp = { db, io: fakeIo, log: { warn: () => undefined, info: () => undefined } } as unknown as TxApp;

let seller: TestSeller;
let buyer: TestBusinessUser;
let third: TestBusinessUser;
let buyerViewer: { userId: string; token: string };
let sellerViewer: { userId: string; token: string };

const BUYER_RATINGS = { matched_listing: 5, communication: 4, on_time: 3 };
const SELLER_RATINGS = { communication: 5, payment: 5, pickup: 4 };

const asUser = (u: { userId: string; businessId: string }) => ({ userId: u.userId, businessId: u.businessId });
const submit = (u: { userId: string; businessId: string }, dealId: string, input: { ratings: Record<string, unknown>; text?: string | null }) =>
  runTx(txApp, (tx) => submitReview(tx, asUser(u), dealId, input));

async function completedDeal(status: 'completed' | 'cancelled' = 'completed'): Promise<string> {
  const { id } = await insertTestListing(db, {
    businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: null, status: 'live', quantity: '10', priceModel: 'negotiable', pricePaise: 100_000,
  });
  const d = await insertTestDeal({ listing: { id }, buyer, quantity: '1', pricePerUnitPaise: 100_000, status });
  return d.dealId;
}

async function reviewsOf(dealId: string) {
  return db.select().from(dealReviews).where(eq(dealReviews.dealId, dealId));
}

beforeAll(async () => {
  seller = await createTestSeller();
  buyer = await createTestBusinessUser();
  third = await createTestBusinessUser();
  buyerViewer = await addTestMember(buyer.businessId, 'viewer');
  sellerViewer = await addTestMember(seller.businessId, 'viewer');
});

afterAll(async () => {
  await deleteTestBusinesses([seller.businessId, buyer.businessId, third.businessId]);
  await deleteTestSellerExtras([seller]);
});

describe('who and when (§10.1)', () => {
  it('refuses a cancelled deal, a closed window and a second review by the same side', async () => {
    const cancelled = await completedDeal('cancelled');
    await expect(submit(buyer, cancelled, { ratings: BUYER_RATINGS })).rejects.toMatchObject({ statusCode: 409, code: 'REVIEW_NOT_ELIGIBLE' });

    const old = await completedDeal();
    await db.update(deals).set({ completedAt: sql`now() - interval '14 days 1 minute'` }).where(eq(deals.id, old));
    await expect(submit(buyer, old, { ratings: BUYER_RATINGS })).rejects.toMatchObject({ statusCode: 409, code: 'REVIEW_WINDOW_CLOSED' });

    const twice = await completedDeal();
    await submit(buyer, twice, { ratings: BUYER_RATINGS });
    await expect(submit(buyer, twice, { ratings: BUYER_RATINGS })).rejects.toMatchObject({ statusCode: 409, code: 'REVIEW_EXISTS' });
  });

  it('refuses a viewer (403) and a third business (404)', async () => {
    const dealId = await completedDeal();
    await expect(submit({ userId: buyerViewer.userId, businessId: buyer.businessId }, dealId, { ratings: BUYER_RATINGS })).rejects.toMatchObject({
      statusCode: 403,
      code: 'VIEWER_READ_ONLY',
    });
    await expect(submit(third, dealId, { ratings: BUYER_RATINGS })).rejects.toMatchObject({ statusCode: 404, code: 'DEAL_NOT_FOUND' });
    await expect(getReviewState(db, asUser(third), dealId)).rejects.toMatchObject({ statusCode: 404, code: 'DEAL_NOT_FOUND' });
  });

  it.each([
    ['seller text', 'seller', { ratings: SELLER_RATINGS, text: 'Paid on time' }],
    ['a missing facet', 'buyer', { ratings: { matched_listing: 5, communication: 4 } }],
    ['another side’s facet', 'buyer', { ratings: { ...BUYER_RATINGS, payment: 5 } }],
    ['4.5 stars', 'buyer', { ratings: { ...BUYER_RATINGS, on_time: 4.5 } }],
    ['0 stars', 'seller', { ratings: { ...SELLER_RATINGS, pickup: 0 } }],
  ] as const)('refuses %s with 400 REVIEW_ANSWERS_INVALID', async (_label, side, input) => {
    const dealId = await completedDeal();
    const who = side === 'buyer' ? buyer : seller;
    await expect(submit(who, dealId, input)).rejects.toMatchObject({ statusCode: 400, code: 'REVIEW_ANSWERS_INVALID' });
    expect(await reviewsOf(dealId)).toHaveLength(0);
  });
});

describe('blind publishing (§10.3)', () => {
  it('keeps the first review to its author, tells the other business, and publishes both on the second', async () => {
    const dealId = await completedDeal();
    const mine = await submit(buyer, dealId, { ratings: BUYER_RATINGS, text: 'Good part, call 9876543210' });
    expect(mine.mine).toMatchObject({ ratings: BUYER_RATINGS, publishedAt: null });
    expect(mine.mine!.text).not.toContain('9876543210');
    expect(mine.eligible).toBe(false);

    const theirs = await getReviewState(db, asUser(seller), dealId);
    expect(theirs).toMatchObject({ theirsSubmitted: true, mine: null, eligible: true });
    expect(JSON.stringify(theirs)).not.toContain('matched_listing');

    // `review_waiting`: one row per member of the seller business (its viewer too), none for the buyer's.
    const waiting = await db.select({ userId: notifications.userId }).from(notifications).where(eq(notifications.dedupeKey, `review_waiting:${dealId}`));
    expect(waiting.map((w) => w.userId).sort()).toEqual([seller.userId, sellerViewer.userId].sort());

    const both = await submit(seller, dealId, { ratings: SELLER_RATINGS });
    expect(both.mine!.publishedAt).not.toBeNull();
    const rows = await reviewsOf(dealId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.publishedAt !== null)).toBe(true);
    // The buyer's review of the seller tells the seller; the seller's of the buyer publishes silently.
    const received = await db.select({ userId: notifications.userId }).from(notifications).where(eq(notifications.type, 'review_received'));
    const forThisDeal = received.filter((r) => [seller.userId, sellerViewer.userId, buyer.userId, buyerViewer.userId].includes(r.userId));
    expect(forThisDeal.map((r) => r.userId).sort()).toEqual([seller.userId, sellerViewer.userId].sort());
  });

  it('publishes a single due review by the job once, even run twice and concurrently; then the other side cannot review', async () => {
    const dealId = await completedDeal();
    await submit(buyer, dealId, { ratings: BUYER_RATINGS });
    await db.update(dealReviews).set({ publishDueAt: sql`now() - interval '1 minute'` }).where(eq(dealReviews.dealId, dealId));

    const [a, b] = await Promise.all([publishDueReviews(txApp), publishDueReviews(txApp)]);
    expect(await publishDueReviews(txApp)).toBe(0);
    expect(a + b).toBeGreaterThanOrEqual(1);
    const [row] = await reviewsOf(dealId);
    expect(row!.publishedAt).not.toBeNull();
    const notes = await db.select().from(notifications).where(eq(notifications.reviewId, row!.id));
    expect(notes.map((n) => n.userId).sort()).toEqual([seller.userId, sellerViewer.userId].sort());

    expect((await getReviewState(db, asUser(seller), dealId)).reason).toBe('other_published');
    await expect(submit(seller, dealId, { ratings: SELLER_RATINGS })).rejects.toMatchObject({ statusCode: 409, code: 'REVIEW_WINDOW_CLOSED' });
  });

  it('closes the other side once the single review is due, even before the job publishes it', async () => {
    const dealId = await completedDeal();
    await submit(buyer, dealId, { ratings: BUYER_RATINGS });
    await db.update(dealReviews).set({ publishDueAt: sql`now() - interval '1 minute'` }).where(eq(dealReviews.dealId, dealId));
    expect((await getReviewState(db, asUser(seller), dealId)).reason).toBe('other_published');
    await expect(submit(seller, dealId, { ratings: SELLER_RATINGS })).rejects.toMatchObject({ statusCode: 409, code: 'REVIEW_WINDOW_CLOSED' });
    expect((await reviewsOf(dealId)).every((r) => r.publishedAt === null)).toBe(true);
    await publishDueReviews(txApp);
  });

  it('dues a first review on day 10 at completion + 14 days, not submission + 7', async () => {
    const dealId = await completedDeal();
    await db.update(deals).set({ completedAt: sql`now() - interval '10 days'` }).where(eq(deals.id, dealId));
    await submit(seller, dealId, { ratings: SELLER_RATINGS });
    const { rows } = await db.execute(sql`
      SELECT abs(extract(epoch FROM r.publish_due_at - (d.completed_at + interval '14 days'))) < 0.001 AS at_window_end
        FROM deal_reviews r JOIN deals d ON d.id = r.deal_id WHERE r.deal_id = ${dealId}`);
    expect((rows[0] as { at_window_end: boolean }).at_window_end).toBe(true);
  });
});
