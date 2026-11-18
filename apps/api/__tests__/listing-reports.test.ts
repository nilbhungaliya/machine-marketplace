import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { ListingStatus } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { reports, users } from '../src/db/schema.js';
import { signUserToken } from '../src/plugins/auth.js';
import { signInWithPhone } from '../src/services/user.service.js';
import { createTestCatalog, deleteTestCatalog, type TestCatalog } from './_helpers/test-catalog.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestListingOptions, type TestSeller } from './_helpers/test-listings.js';
import { deleteTestUsers, uniqueTestPhone } from './_helpers/test-users.js';

// Report listing (F2 plan Task 10 step 2, spec §8.4, R15).

let app: FastifyInstance;
let catalog: TestCatalog;
const sellers: TestSeller[] = [];
const loneUserIds: string[] = [];

const report = (token: string, id: string, body: object) =>
  app.inject({ method: 'POST', url: `/listings/${id}/reports`, headers: { authorization: `Bearer ${token}` }, payload: body });

async function seller(): Promise<TestSeller> {
  const s = await createTestSeller({ machineCategoryId: catalog.categoryId });
  sellers.push(s);
  return s;
}

const partOf = (s: TestSeller, status: ListingStatus = 'live', extra: Partial<TestListingOptions> = {}) =>
  insertTestListing(db, { businessId: s.businessId, userId: s.userId, kind: 'part', status, categoryId: catalog.motorsGroupId, ...extra }).then(
    (r) => r.id,
  );

beforeAll(async () => {
  app = await buildApp({ logger: false });
  catalog = await createTestCatalog();
});

afterAll(async () => {
  await deleteTestBusinesses(sellers.map((s) => s.businessId));
  await deleteTestSellerExtras(sellers);
  await deleteTestUsers(loneUserIds);
  await deleteTestCatalog(catalog.categoryId);
  await app?.close();
});

describe('POST /listings/:id/reports', () => {
  it('records the report with both reporter columns, and the owner view shows reviewOnEdit', async () => {
    const owner = await seller();
    const reporter = await seller();
    const id = await partOf(owner);
    const res = await report(reporter.token, id, { reason: 'wrong_side_or_fit', details: 'It is the right side' });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().data).toMatchObject({ status: 'open' });
    const [row] = await db.select().from(reports).where(eq(reports.id, res.json().data.id));
    expect(row).toMatchObject({
      targetType: 'listing', targetId: id, reporterUserId: reporter.userId, reporterBusinessId: reporter.businessId,
      reason: 'wrong_side_or_fit', details: 'It is the right side', status: 'open',
    });

    const view = await app.inject({ method: 'GET', url: `/listings/${id}/owner`, headers: { authorization: `Bearer ${owner.token}` } });
    expect(view.json().data.reviewOnEdit).toBe(true);
  });

  it('refuses a second open report by the same business (409 REPORT_EXISTS), allows one after resolution', async () => {
    const owner = await seller();
    const reporter = await seller();
    const id = await partOf(owner);
    expect((await report(reporter.token, id, { reason: 'stock_photos' })).statusCode).toBe(201);
    const again = await report(reporter.token, id, { reason: 'already_sold' });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('REPORT_EXISTS');

    await db.update(reports).set({ status: 'dismissed' }).where(and(eq(reports.targetId, id), eq(reports.reporterBusinessId, reporter.businessId)));
    expect((await report(reporter.token, id, { reason: 'already_sold' })).statusCode).toBe(201);
  });

  it('refuses one\'s own listing (403 REPORT_OWN_LISTING)', async () => {
    const owner = await seller();
    const res = await report(owner.token, await partOf(owner), { reason: 'stock_photos' });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('REPORT_OWN_LISTING');
  });

  it('is 404 for a listing that is not public (draft, paused, restricted seller)', async () => {
    const owner = await seller();
    const reporter = await seller();
    for (const status of ['draft', 'paused', 'pending_review'] as const) {
      const res = await report(reporter.token, await partOf(owner, status), { reason: 'stock_photos' });
      expect(res.statusCode, status).toBe(404);
      expect(res.json().code).toBe('LISTING_NOT_FOUND');
    }
    const live = await partOf(owner);
    await db.update(users).set({ status: 'suspended' }).where(eq(users.id, owner.userId));
    try {
      expect((await report(reporter.token, live, { reason: 'stock_photos' })).statusCode).toBe(404);
    } finally {
      await db.update(users).set({ status: 'active' }).where(eq(users.id, owner.userId));
    }
  });

  it('refuses the 11th report in 24 hours (429 REPORT_LIMIT)', async () => {
    const owner = await seller();
    const reporter = await seller();
    // Ten reports in the last day (targets need not exist: reports.target_id has no foreign key).
    await db.insert(reports).values(
      Array.from({ length: 10 }, () => ({
        targetType: 'listing' as const, targetId: randomUUID(), reporterUserId: reporter.userId,
        reporterBusinessId: reporter.businessId, reason: 'stock_photos', status: 'dismissed' as const,
      })),
    );
    const res = await report(reporter.token, await partOf(owner), { reason: 'stock_photos' });
    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe('REPORT_LIMIT');
    expect(res.json().details.retryAt).toEqual(expect.any(String));
  });

  it('counts only the last 24 hours', async () => {
    const owner = await seller();
    const reporter = await seller();
    await db.insert(reports).values(
      Array.from({ length: 10 }, () => ({
        targetType: 'listing' as const, targetId: randomUUID(), reporterUserId: reporter.userId,
        reporterBusinessId: reporter.businessId, reason: 'stock_photos', status: 'dismissed' as const,
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      })),
    );
    expect((await report(reporter.token, await partOf(owner), { reason: 'stock_photos' })).statusCode).toBe(201);
  });

  it('needs details for something_else, a known reason and a signed-in user', async () => {
    const owner = await seller();
    const reporter = await seller();
    const id = await partOf(owner);
    expect((await report(reporter.token, id, { reason: 'something_else' })).statusCode).toBe(400);
    expect((await report(reporter.token, id, { reason: 'something_else', details: '   ' })).statusCode).toBe(400);
    expect((await report(reporter.token, id, { reason: 'spam' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/listings/${id}/reports`, payload: { reason: 'stock_photos' } })).statusCode).toBe(401);
    expect((await report(reporter.token, id, { reason: 'something_else', details: 'Phone number is fake' })).statusCode).toBe(201);
  });

  it('refuses a user without a business (409 ONBOARDING_INCOMPLETE), so no report has a NULL business', async () => {
    const owner = await seller();
    const signIn = await signInWithPhone(db, uniqueTestPhone());
    loneUserIds.push(signIn.user.id);
    const token = signUserToken({ userId: signIn.user.id, businessId: null });
    const res = await report(token, await partOf(owner), { reason: 'stock_photos' });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('ONBOARDING_INCOMPLETE');
  });
});
