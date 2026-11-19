import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { businessBlocks, chatMessages, offers, reports } from '../src/db/schema.js';
import { lockListingsInOrder, lockOffers, lockThread } from '../src/services/deals/locks.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { insertTestOffer } from './_helpers/test-deals.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';

// L1-5: block and report a conversation (F6 + F7 spec §6.11, §6.12, §8.5).

let app: FastifyInstance;
let seller: TestSeller;
const businessIds: string[] = [];

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function newListing(): Promise<string> {
  const { id } = await insertTestListing(db, {
    businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: null, status: 'live', quantity: '10', priceModel: 'negotiable', pricePaise: 10_000,
  });
  return id;
}

async function newBuyer(): Promise<TestBusinessUser> {
  const b = await createTestBusinessUser();
  businessIds.push(b.businessId);
  return b;
}

const enquire = (token: string, listingId: string) =>
  app.inject({ method: 'POST', url: `/listings/${listingId}/enquiry`, headers: auth(token), payload: { quick: ['is_available'] } });

const send = (token: string, threadId: string) =>
  app.inject({ method: 'POST', url: `/threads/${threadId}/messages`, headers: auth(token), payload: { clientMessageId: randomUUID(), text: 'hello' } });

const report = (token: string, threadId: string, body: Record<string, unknown> = { reason: 'spam' }) =>
  app.inject({ method: 'POST', url: `/threads/${threadId}/report`, headers: auth(token), payload: body });

beforeAll(async () => {
  app = await buildApp({ logger: false });
  seller = await createTestSeller();
  businessIds.push(seller.businessId);
});

afterAll(async () => {
  await db.delete(businessBlocks).where(eq(businessBlocks.blockerBusinessId, seller.businessId));
  for (const id of businessIds) await db.delete(businessBlocks).where(eq(businessBlocks.blockerBusinessId, id));
  await deleteTestBusinesses(businessIds);
  await deleteTestSellerExtras([seller]);
  await app.close();
});

describe('block', () => {
  it('refuses messages and enquiries either way, writes the blocked line last, and unblock restores', async () => {
    const buyer = await newBuyer();
    const listingId = await newListing();
    const { threadId } = (await enquire(buyer.token, listingId)).json().data;

    const blocked = await app.inject({ method: 'POST', url: `/threads/${threadId}/block`, headers: auth(seller.token) });
    expect(blocked.statusCode).toBe(200);
    const [last] = await db.select().from(chatMessages).where(eq(chatMessages.threadId, threadId)).orderBy(desc(chatMessages.seq)).limit(1);
    expect(last).toMatchObject({ kind: 'system', systemCode: 'blocked' });

    for (const res of [await send(buyer.token, threadId), await send(seller.token, threadId), await enquire(buyer.token, listingId), await enquire(buyer.token, await newListing())]) {
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('BUSINESS_BLOCKED');
    }
    const detail = (await app.inject({ method: 'GET', url: `/threads/${threadId}`, headers: auth(buyer.token) })).json().data;
    expect(detail).toMatchObject({ canWrite: false, blockState: 'blocked_me' });

    const list = (await app.inject({ method: 'GET', url: '/users/me/blocks', headers: auth(seller.token) })).json().data;
    expect(list.items.map((i: { businessId: string }) => i.businessId)).toContain(buyer.businessId);
    const unblock = await app.inject({ method: 'DELETE', url: `/users/me/blocks/${buyer.businessId}`, headers: auth(seller.token) });
    expect(unblock.statusCode).toBe(200);
    expect((await send(buyer.token, threadId)).statusCode).toBe(200);
  });

  it('a block racing an accept on the same listing settles both without a deadlock', async () => {
    const buyer = await newBuyer();
    const listingId = await newListing();
    const { threadId } = (await enquire(buyer.token, listingId)).json().data;
    const offer = await insertTestOffer({ threadId, pricePerUnitPaise: 9_000, quantity: '1' });

    // An accept takes listing → offer → thread (§8.5); the block takes listings → offers (closeChainsBetween) → thread.
    const accept = db.transaction(async (tx) => {
      await lockListingsInOrder(tx, [listingId]);
      await lockOffers(tx, [offer.id]);
      await new Promise((r) => setTimeout(r, 50));
      await lockThread(tx, threadId);
      await tx.update(offers).set({ status: 'accepted' }).where(and(eq(offers.id, offer.id), eq(offers.status, 'pending')));
      return 'accepted';
    });
    const block = app.inject({ method: 'POST', url: `/threads/${threadId}/block`, headers: auth(seller.token) });
    const [accepted, blockRes] = await Promise.all([accept, block]);
    expect(accepted).toBe('accepted');
    expect(blockRes.statusCode).toBe(200);
  });
});

describe('report a conversation', () => {
  it('refuses a second open report, and blocks too with block: true', async () => {
    const buyer = await newBuyer();
    const { threadId } = (await enquire(buyer.token, await newListing())).json().data;
    expect((await report(seller.token, threadId, { reason: 'other' })).json().code).toBe('VALIDATION_ERROR');
    const first = await report(seller.token, threadId, { reason: 'spam', block: true });
    expect(first.statusCode).toBe(200);
    const again = await report(seller.token, threadId);
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('REPORT_EXISTS');
    const [block] = await db.select().from(businessBlocks).where(eq(businessBlocks.blockerBusinessId, seller.businessId));
    expect(block).toBeDefined();
    expect((await send(buyer.token, threadId)).statusCode).toBe(403);
  });

  it('answers REPORT_LIMIT to the 11th report of the day (any target counts, as F2)', async () => {
    const reporter = await newBuyer();
    const { threadId } = (await enquire(reporter.token, await newListing())).json().data;
    // Ten earlier reports today, on other targets (closed, so the one-open index never fires).
    await db.insert(reports).values(
      Array.from({ length: 10 }, () => ({
        targetType: 'conversation' as const, targetId: randomUUID(), reporterUserId: reporter.userId, reporterBusinessId: reporter.businessId, reason: 'spam', status: 'dismissed' as const,
      })),
    );
    const over = await report(reporter.token, threadId);
    expect(over.statusCode).toBe(429);
    expect(over.json().code).toBe('REPORT_LIMIT');
    expect(await db.select().from(reports).where(eq(reports.targetId, threadId))).toHaveLength(0);
  });

});
