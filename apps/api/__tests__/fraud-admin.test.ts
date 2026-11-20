import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import type { FraudEvidence } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { auditLog, fraudSignals } from '../src/db/schema.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { insertTestThread } from './_helpers/test-deals.js';
import { insertTestMessage } from './_helpers/test-fraud.js';
import { insertTestListing } from './_helpers/test-listings.js';

// Admin close-out A3-4 (§8.3, R8, R11): the signal review with its audit row and roles, and the conversation reader's
// new source (an open signal citing the thread).

let app: FastifyInstance;
let seller: TestBusinessUser;
let buyer: TestBusinessUser;
let moderator: { id: string; token: string };
let support: { id: string; token: string };
let operations: { id: string; token: string };
const businessIds: string[] = [];

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function signalCitingNewThread(): Promise<{ signalId: string; threadId: string }> {
  const { id: listingId } = await insertTestListing(db, {
    businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: null, status: 'live', quantity: '10', priceModel: 'negotiable', pricePaise: 10_000,
  });
  const thread = await insertTestThread({ listingId, buyerBusinessId: buyer.businessId, buyerUserId: buyer.userId });
  const m = await insertTestMessage({ threadId: thread.id, senderUserId: buyer.userId, senderSide: 'buyer', text: 'pay to shop@okaxis' });
  const evidence: FraudEvidence[] = [
    { key: `pay:${m.id}`, at: new Date().toISOString(), summary: 'Payment details in a message: upi_handle', refs: { threadId: thread.id, messageId: m.id, businessIds: [seller.businessId] } },
  ];
  // One open signal per business and kind: close any earlier one of this test first.
  await db
    .update(fraudSignals)
    .set({ status: 'dismissed', reviewedAt: new Date(), note: 'earlier' })
    .where(and(eq(fraudSignals.businessId, buyer.businessId), eq(fraudSignals.status, 'open')));
  const [s] = await db
    .insert(fraudSignals)
    .values({ businessId: buyer.businessId, kind: 'payment_details', evidence, evidenceCount: 1, firstSeenAt: new Date(), lastSeenAt: new Date() })
    .returning({ id: fraudSignals.id });
  return { signalId: s!.id, threadId: thread.id };
}

const review = (token: string, id: string, outcome = 'dismissed') =>
  app.inject({ method: 'POST', url: `/admin/fraud-signals/${id}/review`, headers: auth(token), payload: { outcome, note: 'Checked: a known supplier' } });

const readThread = (token: string, threadId: string) =>
  app.inject({ method: 'POST', url: `/admin/threads/${threadId}/read`, headers: auth(token), payload: { reason: 'Checking the fraud signal evidence' } });

beforeAll(async () => {
  app = await buildApp({ logger: false });
  seller = await createTestBusinessUser({ activities: ['buy', 'sell'] });
  buyer = await createTestBusinessUser();
  businessIds.push(seller.businessId, buyer.businessId);
  moderator = await createTestAdmin('moderator');
  support = await createTestAdmin('support');
  operations = await createTestAdmin('operations');
});

afterAll(async () => {
  await deleteTestBusinesses(businessIds);
  await deleteTestAdmins([moderator.id, support.id, operations.id]);
  await app.close();
});

describe('POST /admin/fraud-signals/:id/review', () => {
  it('dismisses with reviewed_at and an audit row; a second review → 409; operations → 403', async () => {
    const { signalId } = await signalCitingNewThread();
    expect((await review(operations.token, signalId)).statusCode).toBe(403);

    const list = await app.inject({ method: 'GET', url: `/admin/fraud-signals?businessId=${buyer.businessId}`, headers: auth(support.token) });
    expect(list.json().data.rows.map((r: { id: string }) => r.id)).toEqual([signalId]);
    const detail = await app.inject({ method: 'GET', url: `/admin/fraud-signals/${signalId}`, headers: auth(support.token) });
    expect(detail.json().data.evidence[0].businesses).toEqual([{ id: seller.businessId, name: expect.any(String) }]);

    const res = await review(moderator.token, signalId);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ status: 'dismissed', reviewedBy: { id: moderator.id }, note: 'Checked: a known supplier' });
    const [row] = await db.select().from(fraudSignals).where(eq(fraudSignals.id, signalId));
    expect(row!.reviewedAt).toBeInstanceOf(Date);
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'fraud_signal.review'), eq(auditLog.entityId, signalId)));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.adminId).toBe(moderator.id);
    expect(audits[0]!.before).toMatchObject({ status: 'open' });
    expect(audits[0]!.after).toMatchObject({ status: 'dismissed' });

    const again = await review(support.token, signalId, 'actioned');
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('FRAUD_SIGNAL_NOT_OPEN');
  });
});

describe('conversation reader from a fraud signal (R11)', () => {
  it('allowed while an open signal cites the thread (thread.read names it), refused once it is dismissed', async () => {
    const { signalId, threadId } = await signalCitingNewThread();
    const ok = await readThread(moderator.token, threadId);
    expect(ok.statusCode).toBe(200);
    const [audit] = await db.select().from(auditLog).where(and(eq(auditLog.action, 'thread.read'), eq(auditLog.entityId, threadId)));
    expect(audit!.after).toMatchObject({ signalId, reportId: null, disputeId: null });

    expect((await review(support.token, signalId)).statusCode).toBe(200);
    const refused = await readThread(moderator.token, threadId);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().code).toBe('ADMIN_READ_NOT_ALLOWED');
  });
});
