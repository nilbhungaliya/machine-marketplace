import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { auditLog, dealDisputes, reports } from '../src/db/schema.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { insertTestDeal } from './_helpers/test-deals.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';

// L1-5: admin conversation reads and Reports & flags (F6 + F7 spec §16.1–§16.3, R23).

let app: FastifyInstance;
let seller: TestSeller;
let buyer: TestBusinessUser;
let moderator: { id: string; token: string };
let support: { id: string; token: string };
let operations: { id: string; token: string };
const businessIds: string[] = [];
const PHONE_TEXT = 'my number is 98765 43210';

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function newThread(): Promise<{ threadId: string; listingId: string }> {
  const { id: listingId } = await insertTestListing(db, {
    businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: null, status: 'live', quantity: '10', priceModel: 'negotiable', pricePaise: 10_000,
  });
  const res = await app.inject({ method: 'POST', url: `/listings/${listingId}/enquiry`, headers: auth(buyer.token), payload: { quick: ['is_available'] } });
  const threadId = res.json().data.threadId as string;
  await app.inject({ method: 'POST', url: `/threads/${threadId}/messages`, headers: auth(buyer.token), payload: { clientMessageId: randomUUID(), text: PHONE_TEXT } });
  return { threadId, listingId };
}

const readThread = (token: string, threadId: string, reason = 'Checking the reported conversation') =>
  app.inject({ method: 'POST', url: `/admin/threads/${threadId}/read`, headers: auth(token), payload: { reason } });

const reportThread = (threadId: string) =>
  app.inject({ method: 'POST', url: `/threads/${threadId}/report`, headers: auth(seller.token), payload: { reason: 'abusive' } });

const readAudits = (threadId: string) =>
  db.select().from(auditLog).where(and(eq(auditLog.action, 'thread.read'), eq(auditLog.entityId, threadId)));

beforeAll(async () => {
  app = await buildApp({ logger: false });
  seller = await createTestSeller();
  buyer = await createTestBusinessUser();
  businessIds.push(seller.businessId, buyer.businessId);
  moderator = await createTestAdmin('moderator');
  support = await createTestAdmin('support');
  operations = await createTestAdmin('operations');
});

afterAll(async () => {
  await deleteTestBusinesses(businessIds);
  await deleteTestSellerExtras([seller]);
  await deleteTestAdmins([moderator.id, support.id, operations.id]);
  await app.close();
});

describe('POST /admin/threads/:id/read', () => {
  it('needs a report: refused without, allowed while open and 29 days after resolution, refused at 31', async () => {
    const { threadId } = await newThread();
    const none = await readThread(moderator.token, threadId);
    expect(none.statusCode).toBe(403);
    expect(none.json().code).toBe('ADMIN_READ_NOT_ALLOWED');

    expect((await reportThread(threadId)).statusCode).toBe(200);
    const ok = await readThread(moderator.token, threadId);
    expect(ok.statusCode).toBe(200);
    const body = ok.json().data;
    expect(body.messages.some((m: { text: string | null }) => m.text === PHONE_TEXT)).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/contactPhone|"number"/);
    expect(JSON.stringify(body)).not.toContain(buyer.phone);

    const [r] = await db.select().from(reports).where(eq(reports.targetId, threadId));
    const resolve = await app.inject({
      method: 'POST', url: `/admin/reports/${r!.id}/resolve`, headers: auth(moderator.token), payload: { outcome: 'dismissed', note: 'Nothing wrong here' },
    });
    expect(resolve.statusCode).toBe(200);
    expect(resolve.json().data).toMatchObject({ id: r!.id, status: 'dismissed' });

    await db.update(reports).set({ resolvedAt: sql`now() - interval '29 days'` }).where(eq(reports.id, r!.id));
    expect((await readThread(moderator.token, threadId)).statusCode).toBe(200);
    await db.update(reports).set({ resolvedAt: sql`now() - interval '31 days'` }).where(eq(reports.id, r!.id));
    expect((await readThread(moderator.token, threadId)).json().code).toBe('ADMIN_READ_NOT_ALLOWED');

    const audits = await readAudits(threadId);
    expect(audits).toHaveLength(2);
    expect(audits[0]!.after).toMatchObject({ reason: 'Checking the reported conversation' });
  });

  it('a dispute lets support read, within 30 days of resolution', async () => {
    const { threadId, listingId } = await newThread();
    const deal = await insertTestDeal({ listing: { id: listingId }, buyer, quantity: '1', pricePerUnitPaise: 10_000, status: 'handed_over' });
    const [dispute] = await db
      .insert(dealDisputes)
      .values({ dealId: deal.dealId, openedBySide: 'buyer', openedByUserId: buyer.userId, category: 'damaged', description: 'Arrived with a cracked housing' })
      .returning();
    expect((await readThread(support.token, threadId)).statusCode).toBe(200);
    await db.update(dealDisputes).set({ status: 'resolved', outcome: 'completed', resolvedAt: sql`now() - interval '29 days'` }).where(eq(dealDisputes.id, dispute!.id));
    expect((await readThread(support.token, threadId)).statusCode).toBe(200);
    await db.update(dealDisputes).set({ resolvedAt: sql`now() - interval '31 days'` }).where(eq(dealDisputes.id, dispute!.id));
    expect((await readThread(support.token, threadId)).json().code).toBe('ADMIN_READ_NOT_ALLOWED');
    expect(await readAudits(threadId)).toHaveLength(2);
  });

  it('RBAC: operations 403; a reason is required', async () => {
    const { threadId } = await newThread();
    await reportThread(threadId);
    expect((await readThread(operations.token, threadId)).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/admin/reports', headers: auth(operations.token) })).statusCode).toBe(403);
    expect((await readThread(support.token, threadId, 'x')).statusCode).toBe(400);
    expect((await readThread(support.token, threadId)).statusCode).toBe(200);
  });
});

describe('GET /admin/reports', () => {
  it('lists conversation reports with both parties, filtered by target', async () => {
    const { threadId } = await newThread();
    await reportThread(threadId);
    const res = await app.inject({ method: 'GET', url: '/admin/reports?target=conversation&status=open', headers: auth(support.token) });
    expect(res.statusCode).toBe(200);
    const row = res.json().data.items.find((i: { targetId: string }) => i.targetId === threadId);
    expect(row).toMatchObject({ target: 'conversation', status: 'open', reason: 'abusive' });
    const reviews = await app.inject({ method: 'GET', url: '/admin/reports?target=review', headers: auth(support.token) });
    expect(reviews.json().data.items.some((i: { targetId: string }) => i.targetId === threadId)).toBe(false);
  });
});
