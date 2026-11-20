import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { notifications, partRequestPushCounts, partRequestReplies, partRequestWork, partRequests } from '../src/db/schema.js';
import type { TxApp } from '../src/lib/tx-effects.js';
import {
  deletePartRequestHistory,
  expirePartRequests,
  notifyExpiringPartRequests,
} from '../src/services/part-requests/request-jobs.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';
import {
  countF8Rows,
  createTestPartTree,
  insertTestPartRequest,
  insertTestReply,
  type TestPartRequestRow,
  type TestPartTree,
} from './_helpers/test-part-requests.js';

// A3-1: request expiry, the expiring-soon reminder and retention (F8 spec §8.2, §9.1). Per-request transactions with
// `FOR NO KEY UPDATE SKIP LOCKED`; a renew racing the expiry never leaves `expired` with the renewed `expires_at`.

let tree: TestPartTree;
let buyer: TestBusinessUser;
let seller: TestSeller;
const businessIds: string[] = [];

const fakeIo = { of: () => ({ to: () => ({ emit: () => undefined }) }) };
const jobApp = { db, io: fakeIo, log: { warn: () => undefined, error: () => undefined, info: () => undefined } } as unknown as TxApp;

const newRequest = (o: { expiresAt?: Date } = {}): Promise<TestPartRequestRow> =>
  insertTestPartRequest({
    businessId: buyer.businessId, userId: buyer.userId, categoryId: tree.partGroup.id, unitId: tree.unitId, side: 'left', ...o,
  });

const past = () => new Date(Date.now() - 60_000);
const statusOf = async (id: string) => (await db.select().from(partRequests).where(eq(partRequests.id, id)))[0]!;
const notesOf = (id: string, type: string) =>
  db.select().from(notifications).where(and(eq(notifications.partRequestId, id), sql`${notifications.type} = ${type}`));

beforeAll(async () => {
  tree = await createTestPartTree();
  buyer = await createTestBusinessUser();
  seller = await createTestSeller({ machineCategoryId: tree.machineCategory.id });
  businessIds.push(buyer.businessId, seller.businessId);
});

afterAll(async () => {
  await deleteTestBusinesses(businessIds);
  await deleteTestSellerExtras([seller]);
  await tree.cleanup();
  expect(Object.values(await countF8Rows()).every((n) => n === 0)).toBe(true);
});

describe('expirePartRequests', () => {
  it('expires an active request past expires_at, drops its pending reply (seller told), tells the buyer once', async () => {
    const req = await newRequest({ expiresAt: past() });
    const { id: listingId } = await insertTestListing(db, {
      businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: tree.partGroup.id, status: 'draft',
    });
    const reply = await insertTestReply({
      partRequestId: req.id, sellerBusinessId: seller.businessId, listingId, userId: seller.userId, status: 'pending',
    });

    expect((await expirePartRequests(jobApp)).expired).toBeGreaterThanOrEqual(1);
    expect((await statusOf(req.id)).status).toBe('expired');
    const [r] = await db.select().from(partRequestReplies).where(eq(partRequestReplies.id, reply.id));
    expect(r).toMatchObject({ status: 'dropped', dropReason: 'request_expired' });
    const dropped = await notesOf(req.id, 'part_request_reply_dropped');
    expect(dropped.map((n) => n.businessId)).toEqual([seller.businessId]);
    expect(await notesOf(req.id, 'part_request_expired')).toHaveLength(1);

    await expirePartRequests(jobApp);
    expect(await notesOf(req.id, 'part_request_expired')).toHaveLength(1);
    const [note] = await notesOf(req.id, 'part_request_expired');
    expect(note!.dedupeKey).toBe(`part_request_expired:${req.id}:${Math.floor(req.expiresAt.getTime() / 1000)}`);
  });

  it('skips a request another transaction holds, without waiting on it', async () => {
    const req = await newRequest({ expiresAt: past() });
    let locked!: () => void;
    let release!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const held = new Promise<void>((r) => (release = r));
    const holder = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM part_requests WHERE id = ${req.id} FOR NO KEY UPDATE`);
      locked();
      await held;
    });
    await isLocked;
    try {
      const t0 = Date.now();
      await expirePartRequests(jobApp);
      expect(Date.now() - t0).toBeLessThan(5_000);
      expect((await statusOf(req.id)).status).toBe('active');
    } finally {
      release();
      await holder;
    }
    await expirePartRequests(jobApp);
    expect((await statusOf(req.id)).status).toBe('expired');
  });

  it('racing a renew: renewed and active, or expired with the old expires_at, never expired with the new one', async () => {
    for (let i = 0; i < 5; i++) {
      const req = await newRequest({ expiresAt: past() });
      // The renew's shape (A1): lock the request FOR NO KEY UPDATE (waiting), then move expires_at while still active.
      const renew = db.transaction(async (tx) => {
        const { rows } = await tx.execute<{ status: string }>(
          sql`SELECT status FROM part_requests WHERE id = ${req.id} FOR NO KEY UPDATE`,
        );
        if (rows[0]?.status !== 'active') return;
        await tx
          .update(partRequests)
          .set({ expiresAt: sql`now() + interval '7 days'` as unknown as Date, expiringNotifiedAt: null })
          .where(eq(partRequests.id, req.id));
      });
      await Promise.all([renew, expirePartRequests(jobApp)]);
      await expirePartRequests(jobApp);
      const { rows } = await db.execute<{ status: string; future: boolean }>(
        sql`SELECT status, expires_at > now() AS future FROM part_requests WHERE id = ${req.id}`,
      );
      const after = rows[0]!;
      expect([after.status, after.future]).toEqual(after.status === 'active' ? ['active', true] : ['expired', false]);
    }
  });
});

describe('notifyExpiringPartRequests', () => {
  it('reminds once inside the notice window, again after a renew; not outside it', async () => {
    const soon = await newRequest({ expiresAt: new Date(Date.now() + 12 * 3_600_000) });
    const later = await newRequest({ expiresAt: new Date(Date.now() + 3 * 24 * 3_600_000) });

    await notifyExpiringPartRequests(jobApp);
    await notifyExpiringPartRequests(jobApp);
    expect(await notesOf(soon.id, 'part_request_expiring')).toHaveLength(1);
    expect(await notesOf(later.id, 'part_request_expiring')).toHaveLength(0);
    expect((await statusOf(soon.id)).expiringNotifiedAt).not.toBeNull();

    // A renew moves expires_at and resets the column: the new period gets its own reminder.
    await db
      .update(partRequests)
      .set({ expiresAt: new Date(Date.now() + 20 * 3_600_000), expiringNotifiedAt: null })
      .where(eq(partRequests.id, soon.id));
    await notifyExpiringPartRequests(jobApp);
    expect(await notesOf(soon.id, 'part_request_expiring')).toHaveLength(2);
  });
});

describe('deletePartRequestHistory', () => {
  it('deletes done rows older than 7 days; keeps a 2-day-old done row and a 10-day-old failed row', async () => {
    const [oldDone, youngDone, failed] = [randomUUID(), randomUUID(), randomUUID()];
    const ago = (days: number) => new Date(Date.now() - days * 24 * 3_600_000);
    await db.insert(partRequestWork).values([
      { kind: 'listing_changed', subjectId: oldDone, claimedAt: ago(8), doneAt: ago(8), attempts: 1 },
      { kind: 'listing_changed', subjectId: youngDone, claimedAt: ago(2), doneAt: ago(2), attempts: 1 },
      { kind: 'listing_changed', subjectId: failed, claimedAt: ago(10), failedAt: ago(10), attempts: 5 },
    ]);
    await db.insert(partRequestPushCounts).values([
      { businessId: seller.businessId, day: sql`(now() AT TIME ZONE 'Asia/Kolkata')::date - 9` as unknown as string, pushes: 2 },
      { businessId: seller.businessId, day: sql`(now() AT TIME ZONE 'Asia/Kolkata')::date` as unknown as string, pushes: 1 },
    ]);
    try {
      expect(await deletePartRequestHistory(db)).toBeGreaterThanOrEqual(2);
      const left = await db
        .select({ subjectId: partRequestWork.subjectId })
        .from(partRequestWork)
        .where(inArray(partRequestWork.subjectId, [oldDone, youngDone, failed]));
      expect(left.map((r) => r.subjectId).sort()).toEqual([youngDone, failed].sort());
      const counts = await db.select().from(partRequestPushCounts).where(eq(partRequestPushCounts.businessId, seller.businessId));
      expect(counts).toHaveLength(1);
    } finally {
      await db.delete(partRequestWork).where(inArray(partRequestWork.subjectId, [oldDone, youngDone, failed]));
    }
  });
});
