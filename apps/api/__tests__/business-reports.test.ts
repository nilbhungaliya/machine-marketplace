import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { businessBlocks, notifications, reports, users } from '../src/db/schema.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { addTestMember } from './_helpers/test-deals.js';
import { createTestSeller, deleteTestSellerExtras, type TestSeller } from './_helpers/test-listings.js';

// Report a business (admin close-out §7.1, R6, plan A4-1, D8).

let app: FastifyInstance;
const sellers: TestSeller[] = [];

async function seller(opts: Parameters<typeof createTestSeller>[0] = {}): Promise<TestSeller> {
  const s = await createTestSeller(opts);
  sellers.push(s);
  return s;
}

const report = (token: string, businessId: string, body: object) =>
  app.inject({ method: 'POST', url: `/businesses/${businessId}/reports`, headers: { authorization: `Bearer ${token}` }, payload: body });

beforeAll(async () => {
  app = await buildApp({ logger: false });
});

afterAll(async () => {
  await deleteTestBusinesses(sellers.map((s) => s.businessId));
  await deleteTestSellerExtras(sellers);
  await app?.close();
});

describe('POST /businesses/:id/reports', () => {
  it('records an open business report, never tells the reported side, and refuses a second open one', async () => {
    const target = await seller();
    const reporter = await seller();
    const res = await report(reporter.token, target.businessId, { reason: 'fake_business', details: 'No such factory' });
    expect(res.statusCode, res.body).toBe(200);
    const { reportId } = res.json().data;
    const [row] = await db.select().from(reports).where(eq(reports.id, reportId));
    expect(row).toMatchObject({
      targetType: 'business', targetId: target.businessId, reporterUserId: reporter.userId,
      reporterBusinessId: reporter.businessId, reason: 'fake_business', details: 'No such factory', status: 'open',
    });

    const targetUsers = (await db.select({ id: users.id }).from(users).where(eq(users.businessId, target.businessId))).map((u) => u.id);
    const told = await db.select({ id: notifications.id }).from(notifications).where(inArray(notifications.userId, targetUsers));
    expect(told).toHaveLength(0);

    const again = await report(reporter.token, target.businessId, { reason: 'abusive' });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('REPORT_EXISTS');
  });

  it('refuses reporting your own business', async () => {
    const me = await seller();
    const res = await report(me.token, me.businessId, { reason: 'abusive' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('CANNOT_REPORT_SELF');
  });

  it('needs details for reason other', async () => {
    const target = await seller();
    const reporter = await seller();
    const res = await report(reporter.token, target.businessId, { reason: 'other', details: '   ' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
    expect(res.json().details).toMatchObject({ field: 'details' });
  });

  it('answers 404 for an unknown or not onboarded business', async () => {
    const reporter = await seller();
    const unknown = await report(reporter.token, randomUUID(), { reason: 'abusive' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().code).toBe('BUSINESS_NOT_FOUND');
    const halfway = await seller({ onboarded: false });
    const res = await report(reporter.token, halfway.businessId, { reason: 'abusive' });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('BUSINESS_NOT_FOUND');
  });

  it('lets a viewer member report, even across a block', async () => {
    const target = await seller();
    const reporter = await seller();
    const viewer = await addTestMember(reporter.businessId, 'viewer');
    await db.insert(businessBlocks).values({
      blockerBusinessId: target.businessId, blockedBusinessId: reporter.businessId, createdByUserId: target.userId,
    });
    const res = await report(viewer.token, target.businessId, { reason: 'impersonation' });
    expect(res.statusCode, res.body).toBe(200);
  });

  it('counts the 10-a-day limit across listing and business reports', async () => {
    const target = await seller();
    const reporter = await seller();
    // Ten reports in the last 24 h on other targets (listing and business), by the same user.
    await db.insert(reports).values(
      Array.from({ length: 10 }, (_, i) => ({
        targetType: i % 2 === 0 ? ('listing' as const) : ('business' as const),
        targetId: randomUUID(),
        reporterUserId: reporter.userId,
        reporterBusinessId: reporter.businessId,
        reason: 'abusive',
        createdAt: sql`now() - interval '1 hour'`,
      })),
    );
    const res = await report(reporter.token, target.businessId, { reason: 'abusive' });
    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe('REPORT_LIMIT');
  });
});
