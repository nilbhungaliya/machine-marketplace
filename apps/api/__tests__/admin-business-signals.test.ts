import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { dealReviews, reports } from '../src/db/schema.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { insertTestDeal, insertTestThread } from './_helpers/test-deals.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';

// Business detail "Reports (n)" (admin close-out §7.3, plan A4-2): open and reviewing reports against the business and
// what it owns; a conversation report counts against the other party, never the reporter.

let app: FastifyInstance;
const sellers: TestSeller[] = [];
const adminIds: string[] = [];

beforeAll(async () => {
  app = await buildApp({ logger: false });
});

afterAll(async () => {
  await deleteTestBusinesses(sellers.map((s) => s.businessId));
  await deleteTestSellerExtras(sellers);
  await deleteTestAdmins(adminIds);
  await app?.close();
});

describe('GET /admin/businesses/:id reports', () => {
  it('counts open reports against the business per target, never its own reports of others or closed ones', async () => {
    const x = await createTestSeller();
    const y = await createTestSeller();
    sellers.push(x, y);
    const support = await createTestAdmin('support');
    adminIds.push(support.id);

    const listing = await insertTestListing(db, { businessId: x.businessId, userId: x.userId, kind: 'part', categoryId: x.cleanup.categoryIds[0]! });
    // Y buys from X; X (seller side) reviews Y.
    const thread = await insertTestThread({ listingId: listing.id, buyerBusinessId: y.businessId, buyerUserId: y.userId });
    const deal = await insertTestDeal({ listing, buyer: y, quantity: '1', pricePerUnitPaise: 10_000, status: 'completed' });
    const [review] = await db
      .insert(dealReviews)
      .values({
        dealId: deal.dealId,
        reviewerSide: 'seller',
        reviewerBusinessId: x.businessId,
        reviewedBusinessId: y.businessId,
        reviewerUserId: x.userId,
        rCommunication: 4,
        rPayment: 4,
        rPickup: 4,
        publishDueAt: sql`now()`,
      })
      .returning({ id: dealReviews.id });

    const byY = { reporterUserId: y.userId, reporterBusinessId: y.businessId, reason: 'other' };
    await db.insert(reports).values([
      { ...byY, targetType: 'business', targetId: x.businessId },
      { ...byY, targetType: 'listing', targetId: listing.id },
      { ...byY, targetType: 'review', targetId: review!.id, status: 'reviewing' },
      { ...byY, targetType: 'conversation', targetId: thread.id },
      // Filed by X on the same thread: against Y, never X.
      { reporterUserId: x.userId, reporterBusinessId: x.businessId, reason: 'other', targetType: 'conversation', targetId: thread.id },
      // Closed: not counted.
      { ...byY, targetType: 'business', targetId: x.businessId, status: 'dismissed' },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: `/admin/businesses/${x.businessId}`,
      headers: { authorization: `Bearer ${support.token}` },
    });
    expect(res.statusCode, res.body).toBe(200);
    const data = res.json().data;
    expect(data.reports).toEqual({ open: 4, byTarget: { business: 1, listing: 1, review: 1, conversation: 1 } });
    expect(Array.isArray(data.fraudSignals)).toBe(true);

    const other = await app.inject({
      method: 'GET',
      url: `/admin/businesses/${y.businessId}`,
      headers: { authorization: `Bearer ${support.token}` },
    });
    expect(other.json().data.reports).toEqual({ open: 1, byTarget: { conversation: 1 } });
  });
});
