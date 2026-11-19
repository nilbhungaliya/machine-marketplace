import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { appSettings, auditLog, dealReviews } from '../src/db/schema.js';
import { runTx, type TxApp } from '../src/lib/tx-effects.js';
import { submitReview } from '../src/services/reviews/review.service.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { insertTestDeal } from './_helpers/test-deals.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';

// L4-2 (spec §10.4–§10.6): scores from published, not hidden buyer reviews only, shown from 3; the public list never
// shows unpublished or seller → buyer reviews (guests read it); one reply, only once published; moderator-only hide
// with an audit row, and a hidden review leaves the score at once.

const fakeIo = { of: () => ({ to: () => ({ emit: () => undefined }) }) };
const txApp = { db, io: fakeIo, log: { warn: () => undefined, info: () => undefined } } as unknown as TxApp;

let app: FastifyInstance;
let seller: TestSeller;
let buyer: TestBusinessUser;
let moderator: { id: string; token: string };
let support: { id: string; token: string };
let savedMin: unknown;

const asUser = (u: { userId: string; businessId: string }) => ({ userId: u.userId, businessId: u.businessId });

/** A completed deal with the buyer's review, published unless `published: false`. Returns the review id and deal id. */
async function buyerReview(ratings: Record<string, number>, opts: { published?: boolean; text?: string } = {}) {
  const { id } = await insertTestListing(db, {
    businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: null, status: 'live', quantity: '10', priceModel: 'negotiable', pricePaise: 100_000,
  });
  const { dealId } = await insertTestDeal({ listing: { id }, buyer, quantity: '1', pricePerUnitPaise: 100_000, status: 'completed' });
  const state = await runTx(txApp, (tx) => submitReview(tx, asUser(buyer), dealId, { ratings, text: opts.text ?? null }));
  if (opts.published !== false) await db.update(dealReviews).set({ publishedAt: sql`now()` }).where(eq(dealReviews.id, state.mine!.id));
  return { reviewId: state.mine!.id, dealId };
}

const call = (method: 'GET' | 'POST', url: string, token?: string, payload?: object) =>
  app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload ? { payload } : {}) });

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
  seller = await createTestSeller();
  buyer = await createTestBusinessUser();
  moderator = await createTestAdmin('moderator');
  support = await createTestAdmin('support');
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, 'review_min_published'));
  savedMin = row?.value;
  await db.insert(appSettings).values({ key: 'review_min_published', value: 3 }).onConflictDoUpdate({ target: appSettings.key, set: { value: 3 } });
});

afterAll(async () => {
  if (savedMin === undefined) await db.delete(appSettings).where(eq(appSettings.key, 'review_min_published'));
  else await db.update(appSettings).set({ value: savedMin }).where(eq(appSettings.key, 'review_min_published'));
  await deleteTestBusinesses([seller.businessId, buyer.businessId]);
  await deleteTestSellerExtras([seller]);
  await deleteTestAdmins([moderator.id, support.id]);
  await app.close();
});

describe('scores and the public list (§10.4)', () => {
  let hiddenId: string;

  it('shows no score under 3, the right mean and facet % at 3, and never unpublished or seller → buyer reviews', async () => {
    await buyerReview({ matched_listing: 5, communication: 4, on_time: 3 }, { text: 'Good, call 98765 43210' });
    const second = await buyerReview({ matched_listing: 5, communication: 5, on_time: 5 });
    hiddenId = second.reviewId;
    const unpublished = await buyerReview({ matched_listing: 1, communication: 1, on_time: 1 }, { published: false });
    // A seller → buyer review on a deal of theirs: stored, never public.
    await runTx(txApp, (tx) => submitReview(tx, asUser(seller), unpublished.dealId, { ratings: { communication: 1, payment: 1, pickup: 1 } }));
    await db.update(dealReviews).set({ publishedAt: sql`now()` }).where(and(eq(dealReviews.dealId, unpublished.dealId), eq(dealReviews.reviewerSide, 'seller')));
    await db.update(dealReviews).set({ publishedAt: null }).where(eq(dealReviews.id, unpublished.reviewId));

    // Guests read it.
    let res = await call('GET', `/businesses/${seller.businessId}/reviews`);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ score: null, count: 2 });
    expect(res.json().data.items).toHaveLength(2);
    expect(JSON.stringify(res.json().data)).not.toContain('98765');

    await buyerReview({ matched_listing: 4, communication: 4, on_time: 2 });
    res = await call('GET', `/businesses/${seller.businessId}/reviews`);
    const page = res.json().data;
    // Facets: matched 14/3, communication 13/3, on time 10/3; overall 37/9 = 4.11.
    expect(page.score).toEqual({ count: 3, stars: 4.1, facetsPercent: { matched_listing: 93, communication: 87, on_time: 67 } });
    expect(page.items.map((i: { id: string }) => i.id)).not.toContain(unpublished.reviewId);
    expect(page.items.every((i: { ratings: Record<string, number> }) => 'matched_listing' in i.ratings)).toBe(true);
  });

  it('lets only a moderator hide (support 403), audits it, and drops the hidden review from the score at once', async () => {
    const path = `/admin/reviews/${hiddenId}/hide`;
    expect((await call('POST', path, support.token, { reason: 'Abusive words' })).statusCode).toBe(403);
    const hidden = await call('POST', path, moderator.token, { reason: 'Abusive words' });
    expect(hidden.statusCode).toBe(200);
    expect(hidden.json().data).toMatchObject({ id: hiddenId, hidden: true });
    const audits = await db.select().from(auditLog).where(and(eq(auditLog.adminId, moderator.id), eq(auditLog.entityId, hiddenId)));
    expect(audits.map((a) => a.action)).toEqual(['review.hide']);

    const page = (await call('GET', `/businesses/${seller.businessId}/reviews`)).json().data;
    expect(page.score).toBeNull();
    expect(page.items.map((i: { id: string }) => i.id)).not.toContain(hiddenId);

    expect((await call('POST', `/admin/reviews/${hiddenId}/unhide`, moderator.token, { reason: 'Reviewed again' })).statusCode).toBe(200);
    expect((await call('GET', `/businesses/${seller.businessId}/reviews`)).json().data.score).not.toBeNull();
  });
});

describe('reply (§10.5)', () => {
  it('replies once to a published review, never to an unpublished one', async () => {
    const published = await buyerReview({ matched_listing: 5, communication: 5, on_time: 5 });
    const first = await call('POST', `/reviews/${published.reviewId}/reply`, seller.token, { text: 'Thank you' });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.reply).toMatchObject({ text: 'Thank you' });
    const again = await call('POST', `/reviews/${published.reviewId}/reply`, seller.token, { text: 'Thanks again' });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('REPLY_EXISTS');

    const draft = await buyerReview({ matched_listing: 5, communication: 5, on_time: 5 }, { published: false });
    const early = await call('POST', `/reviews/${draft.reviewId}/reply`, seller.token, { text: 'Thank you' });
    expect(early.statusCode).toBe(409);
    expect(early.json().code).toBe('REVIEW_NOT_PUBLISHED');
    // Any signed-in business may report a published review, once while it's open.
    expect((await call('POST', `/reviews/${published.reviewId}/report`, buyer.token, { reason: 'false' })).statusCode).toBe(200);
    expect((await call('POST', `/reviews/${published.reviewId}/report`, buyer.token, { reason: 'abusive' })).json().code).toBe('REPORT_EXISTS');
    // The buyer can't reply to its own review of the seller.
    expect((await call('POST', `/reviews/${published.reviewId}/reply`, buyer.token, { text: 'Me too' })).json().code).toBe('REVIEW_NOT_FOUND');
  });
});
