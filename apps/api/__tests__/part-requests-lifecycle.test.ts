import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import sharp from 'sharp';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { appSettings, notifications, partRequestMatches, partRequestReplies, partRequestWork, partRequests } from '../src/db/schema.js';
import * as storage from '../src/lib/storage.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { insertTestDeal } from './_helpers/test-deals.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';
import {
  countF8Rows,
  createTestPartTree,
  insertTestMatch,
  insertTestPartRequest,
  insertTestReply,
  type TestPartRequestOptions,
  type TestPartTree,
} from './_helpers/test-part-requests.js';

// F8 A1-2: edit, renew, close, fulfil, read (spec §9.1 buyer rows, §5.4, §5.5; plan A1-2, D7).

vi.mock('../src/lib/storage.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/storage.js')>();
  return {
    ...real,
    getObjectBytes: vi.fn(),
    putPrivateObject: vi.fn(),
    deleteObject: vi.fn(),
    presignSignedPut: vi.fn(),
    presignPrivateGet: vi.fn(async (key: string) => `https://private.test/${key}?sig=1`),
  };
});

const SURAT = { lat: 21.17, lng: 72.83 };
const DAY_MS = 86_400_000;
const SETTING_KEYS = ['part_request_open_limit_unverified'];

let app: FastifyInstance;
let tree: TestPartTree;
let otherTree: TestPartTree;
let buyer: TestSeller;
let seller: TestSeller;
let jpeg: Buffer;
const sellers: TestSeller[] = [];

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function business(): Promise<TestSeller> {
  const s = await createTestSeller({ machineCategoryId: tree.machineCategory.id, point: SURAT });
  sellers.push(s);
  return s;
}

const request = (o: Partial<TestPartRequestOptions> = {}, who: TestSeller = buyer) =>
  insertTestPartRequest({ businessId: who.businessId, userId: who.userId, categoryId: tree.partGroup.id, side: 'left', unitId: tree.unitId, ...o });

const call = (method: 'POST' | 'PATCH', url: string, token: string, payload: object = {}) =>
  app.inject({ method, url, headers: auth(token), payload });

const work = (id: string) =>
  db.select().from(partRequestWork).where(and(eq(partRequestWork.subjectId, id), eq(partRequestWork.kind, 'target_request')));

const rowOf = async (id: string) => (await db.select().from(partRequests).where(eq(partRequests.id, id)))[0]!;

const live = (who: TestSeller = seller) =>
  insertTestListing(db, { businessId: who.businessId, userId: who.userId, kind: 'part', categoryId: tree.partGroup.id, side: 'left', unitId: tree.unitId });

beforeAll(async () => {
  app = await buildApp({ logger: false });
  tree = await createTestPartTree();
  otherTree = await createTestPartTree();
  buyer = await business();
  seller = await business();
  jpeg = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#808080' } }).jpeg().toBuffer();
});

beforeEach(() => {
  vi.mocked(storage.getObjectBytes).mockReset().mockResolvedValue(jpeg);
  vi.mocked(storage.putPrivateObject).mockReset().mockResolvedValue(undefined);
  vi.mocked(storage.deleteObject).mockReset().mockResolvedValue(undefined);
});

afterAll(async () => {
  await db.delete(appSettings).where(inArray(appSettings.key, SETTING_KEYS));
  await deleteTestBusinesses(sellers.map((s) => s.businessId));
  await deleteTestSellerExtras(sellers);
  await tree.cleanup();
  await otherTree.cleanup();
  expect(Object.values(await countF8Rows()).every((n) => n === 0)).toBe(true);
  await app.close();
});

describe('buyer moves (§9.1)', () => {
  it('edit: version + 1; a name change enqueues target_request, a note change does not', async () => {
    const r = await request();
    const note = await call('PATCH', `/part-requests/${r.id}`, buyer.token, { version: 1, note: 'Urgent please' });
    expect(note.statusCode).toBe(200);
    expect(note.json().data).toMatchObject({ version: 2, note: 'Urgent please' });
    expect(await work(r.id)).toHaveLength(0);
    const name = await call('PATCH', `/part-requests/${r.id}`, buyer.token, { version: 2, name: 'Temple ring' });
    expect(name.json().data).toMatchObject({ version: 3, name: 'Temple ring' });
    expect(await work(r.id)).toHaveLength(1);
  });

  it('an old version is PART_REQUEST_STALE; validityDays is 400; another machine category is CATEGORY_LOCKED', async () => {
    const r = await request();
    const stale = await call('PATCH', `/part-requests/${r.id}`, buyer.token, { version: 7, note: 'x' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('PART_REQUEST_STALE');
    expect((await call('PATCH', `/part-requests/${r.id}`, buyer.token, { version: 1, validityDays: 30 })).statusCode).toBe(400);
    const locked = await call('PATCH', `/part-requests/${r.id}`, buyer.token, { version: 1, categoryId: otherTree.partGroup.id });
    expect(locked.statusCode).toBe(409);
    expect(locked.json().code).toBe('CATEGORY_LOCKED');
  });

  it('PATCH photoKeys: one kept, one new upload → exactly those two; the dropped object deleted after commit', async () => {
    const r = await request();
    const kept = `part-request/${r.id}/${randomUUID()}.jpg`;
    const dropped = `part-request/${r.id}/${randomUUID()}.jpg`;
    await db.update(partRequests).set({ photoKeys: [kept, dropped] }).where(eq(partRequests.id, r.id));
    const res = await call('PATCH', `/part-requests/${r.id}`, buyer.token, {
      version: 1,
      photoKeys: [kept, `incoming-chat/${buyer.businessId}/${randomUUID()}`],
    });
    expect(res.statusCode).toBe(200);
    const row = await rowOf(r.id);
    expect(row.photoKeys).toHaveLength(2);
    expect(row.photoKeys[0]).toBe(kept);
    expect(row.photoKeys[1]).toMatch(new RegExp(`^part-request/${r.id}/`));
    expect(row.photoKeys).not.toContain(dropped);
    expect(vi.mocked(storage.deleteObject).mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining([dropped]));
  });

  it('renew from active extends the expiry and resets the expiring notice', async () => {
    const r = await request();
    await db.update(partRequests).set({ expiringNotifiedAt: new Date() }).where(eq(partRequests.id, r.id));
    const res = await call('POST', `/part-requests/${r.id}/renew`, buyer.token, { days: 15 });
    expect(res.statusCode).toBe(200);
    const row = await rowOf(r.id);
    expect(row.status).toBe('active');
    expect(row.expiringNotifiedAt).toBeNull();
    expect(row.expiresAt.getTime() - r.expiresAt.getTime()).toBeGreaterThan(14 * DAY_MS);
  });

  it('renew past first_posted_at + 90 days is PART_REQUEST_MAX_DAYS', async () => {
    const r = await request({ firstPostedAt: new Date(Date.now() - 80 * DAY_MS) });
    const res = await call('POST', `/part-requests/${r.id}/renew`, buyer.token, { days: 15 });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('PART_REQUEST_MAX_DAYS');
  });

  it('renew from expired: the open limit when full; with room → active and a target_request row', async () => {
    const b = await business();
    await db.insert(appSettings).values({ key: 'part_request_open_limit_unverified', value: 1 }).onConflictDoUpdate({ target: appSettings.key, set: { value: 1 } });
    try {
      const open = await request({}, b);
      const expired = await request({ status: 'expired', expiresAt: new Date(Date.now() - DAY_MS) }, b);
      const full = await call('POST', `/part-requests/${expired.id}/renew`, b.token, { days: 15 });
      expect(full.statusCode).toBe(409);
      expect(full.json()).toMatchObject({ code: 'PART_REQUEST_OPEN_LIMIT', details: { limit: 1 } });
      expect((await call('POST', `/part-requests/${open.id}/close`, b.token, { reason: 'found_elsewhere' })).statusCode).toBe(200);
      const ok = await call('POST', `/part-requests/${expired.id}/renew`, b.token, { days: 15 });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().data.status).toBe('active');
      expect(await work(expired.id)).toHaveLength(1);
    } finally {
      await db.delete(appSettings).where(inArray(appSettings.key, SETTING_KEYS));
    }
  });

  it('fulfil (with own deal) and close; refused moves are PART_REQUEST_TRANSITION_NOT_ALLOWED', async () => {
    const listing = await live();
    const deal = await insertTestDeal({ listing, buyer, quantity: '1', pricePerUnitPaise: 100_000 });
    const f = await request();
    const fulfilled = await call('POST', `/part-requests/${f.id}/fulfil`, buyer.token, { dealId: deal.dealId });
    expect(fulfilled.statusCode).toBe(200);
    expect(fulfilled.json().data.status).toBe('fulfilled');
    expect((await rowOf(f.id)).fulfilledDealId).toBe(deal.dealId);
    const renew = await call('POST', `/part-requests/${f.id}/renew`, buyer.token, { days: 15 });
    expect(renew.json()).toMatchObject({ code: 'PART_REQUEST_TRANSITION_NOT_ALLOWED', details: { from: 'fulfilled', action: 'renew' } });

    const c = await request();
    const closed = await call('POST', `/part-requests/${c.id}/close`, buyer.token, { reason: 'no_longer_needed' });
    expect(closed.statusCode).toBe(200);
    expect(closed.json().data.status).toBe('closed');
    for (const [method, path, body] of [
      ['PATCH', '', { version: 1, note: 'x' }],
      ['POST', '/close', { reason: 'other' }],
      ['POST', '/fulfil', {}],
    ] as const) {
      const res = await call(method, `/part-requests/${c.id}${path}`, buyer.token, body);
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('PART_REQUEST_TRANSITION_NOT_ALLOWED');
    }
  });

  it("fulfil with another business's deal is DEAL_INVALID", async () => {
    const other = await business();
    const listing = await live();
    const deal = await insertTestDeal({ listing, buyer: other, quantity: '1', pricePerUnitPaise: 100_000 });
    const r = await request();
    const res = await call('POST', `/part-requests/${r.id}/fulfil`, buyer.token, { dealId: deal.dealId });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('DEAL_INVALID');
  });

  it('close drops the pending reply (request_closed, seller told once); the delivered one stays', async () => {
    const r = await request();
    const l1 = await live();
    const l2 = await live();
    const pending = await insertTestReply({ partRequestId: r.id, sellerBusinessId: seller.businessId, listingId: l1.id, userId: seller.userId, status: 'pending' });
    const delivered = await insertTestReply({ partRequestId: r.id, sellerBusinessId: seller.businessId, listingId: l2.id, userId: seller.userId });
    expect((await call('POST', `/part-requests/${r.id}/close`, buyer.token, { reason: 'other' })).statusCode).toBe(200);
    const replies = await db.select().from(partRequestReplies).where(eq(partRequestReplies.partRequestId, r.id));
    expect(replies.find((x) => x.id === pending.id)).toMatchObject({ status: 'dropped', dropReason: 'request_closed' });
    expect(replies.find((x) => x.id === delivered.id)).toMatchObject({ status: 'delivered' });
    const told = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, seller.userId), eq(notifications.type, 'part_request_reply_dropped'), eq(notifications.partRequestId, r.id)));
    expect(told).toHaveLength(1);
  });
});

describe('read (D7)', () => {
  it("marks the member's grouped rows, delivered replies and matches seen; a seller gets 404", async () => {
    const r = await request();
    const l1 = await live();
    const l2 = await live();
    const reply = await insertTestReply({ partRequestId: r.id, sellerBusinessId: seller.businessId, listingId: l1.id, userId: seller.userId });
    await insertTestMatch({ partRequestId: r.id, listingId: l2.id, sellerBusinessId: seller.businessId });
    const [n] = await db
      .insert(notifications)
      .values({
        userId: buyer.userId,
        businessId: buyer.businessId,
        type: 'part_match',
        category: 'requests',
        partRequestId: r.id,
        dedupeKey: `part_match:${r.id}`,
      })
      .returning();

    const res = await call('POST', `/part-requests/${r.id}/read`, buyer.token);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ ok: true });
    expect((await db.select().from(notifications).where(eq(notifications.id, n!.id)))[0]!.readAt).not.toBeNull();
    expect((await rowOf(r.id)).buyerSeenAt).not.toBeNull();
    expect((await db.select().from(partRequestReplies).where(eq(partRequestReplies.id, reply.id)))[0]!.buyerViewedAt).not.toBeNull();
    const matches = await db.select().from(partRequestMatches).where(eq(partRequestMatches.partRequestId, r.id));
    expect(matches.every((m) => m.seenAt !== null)).toBe(true);

    const bySeller = await call('POST', `/part-requests/${r.id}/read`, seller.token);
    expect(bySeller.statusCode).toBe(404);
  });
});
