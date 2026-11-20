import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, inArray, or, sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { businessBlocks, partRequestMatches, partRequests } from '../src/db/schema.js';
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

// F8 A1-3: the buyer's reads (spec §12.2; plan A1-3, D3, D15, D17).

vi.mock('../src/lib/storage.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/storage.js')>();
  return { ...real, presignPrivateGet: vi.fn(async (key: string) => `https://private.test/${key}?sig=1`) };
});

const SURAT = { lat: 21.17, lng: 72.83 };
const HOUR_MS = 3_600_000;

let app: FastifyInstance;
let tree: TestPartTree;
let buyer: TestSeller;
let seller: TestSeller;
let blocked: TestSeller;
const sellers: TestSeller[] = [];

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const get = (url: string, token: string) => app.inject({ method: 'GET', url, headers: auth(token) });

async function business(opts: Parameters<typeof createTestSeller>[0] = {}): Promise<TestSeller> {
  const s = await createTestSeller({ machineCategoryId: tree.machineCategory.id, point: SURAT, ...opts });
  sellers.push(s);
  return s;
}

const request = (o: Partial<TestPartRequestOptions> = {}, who: TestSeller = buyer) =>
  insertTestPartRequest({ businessId: who.businessId, userId: who.userId, categoryId: tree.partGroup.id, side: 'left', unitId: tree.unitId, ...o });

const live = (who: TestSeller = seller, pricePaise = 100_000) =>
  insertTestListing(db, {
    businessId: who.businessId,
    userId: who.userId,
    kind: 'part',
    categoryId: tree.partGroup.id,
    side: 'left',
    unitId: tree.unitId,
    quantity: '5',
    pricePaise,
  });

const reply = (requestId: string, listingId: string, o: Parameters<typeof insertTestReply>[0] extends infer T ? Partial<T> : never = {}, who = seller) =>
  insertTestReply({ partRequestId: requestId, sellerBusinessId: who.businessId, listingId, userId: who.userId, ...o });

beforeAll(async () => {
  app = await buildApp({ logger: false });
  tree = await createTestPartTree();
  buyer = await business();
  seller = await business();
  blocked = await business();
  await db.insert(businessBlocks).values({ blockerBusinessId: buyer.businessId, blockedBusinessId: blocked.businessId, createdByUserId: buyer.userId });
});

afterAll(async () => {
  const ids = sellers.map((s) => s.businessId);
  await db.delete(businessBlocks).where(or(inArray(businessBlocks.blockerBusinessId, ids), inArray(businessBlocks.blockedBusinessId, ids)));
  await deleteTestBusinesses(ids);
  await deleteTestSellerExtras(sellers);
  await tree.cleanup();
  expect(Object.values(await countF8Rows()).every((n) => n === 0)).toBe(true);
  await app.close();
});

describe('GET /:id as the buyer', () => {
  it('role buyer, private budget present, name and note masked in Devanagari and Gujarati digits', async () => {
    const r = await request({ name: 'Roller ९८७६५४३२१०', note: 'Call ૯૮૭૬૫૪૩૨૧૦', budgetPerUnitPaise: 50_000, budgetVisible: false });
    const res = await get(`/part-requests/${r.id}`, buyer.token);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    const v = res.json().data;
    expect(v).toMatchObject({ role: 'buyer', budgetPerUnitPaise: 50_000, budgetVisible: false });
    expect(v.name).not.toContain('९८७६५४३२१०');
    expect(v.note).not.toContain('૯૮૭૬૫૪૩૨૧૦');
  });

  it('fulfilPrompt: set for an agreed or disputed deal on a delivered-reply listing, null once cancelled', async () => {
    const prompt = async (status: 'agreed' | 'disputed' | 'cancelled') => {
      const r = await request();
      const l = await live();
      await reply(r.id, l.id);
      const deal = await insertTestDeal({ listing: l, buyer, quantity: '1', pricePerUnitPaise: 100_000, status });
      return { deal, view: (await get(`/part-requests/${r.id}`, buyer.token)).json().data };
    };
    const agreed = await prompt('agreed');
    expect(agreed.view.fulfilPrompt).toMatchObject({ dealId: agreed.deal.dealId });
    const disputed = await prompt('disputed');
    expect(disputed.view.fulfilPrompt).toMatchObject({ dealId: disputed.deal.dealId });
    const cancelled = await prompt('cancelled');
    expect(cancelled.view.fulfilPrompt).toBeNull();
  });
});

describe('replies, compare', () => {
  it('replies: delivered only, blocked seller hidden, message masked', async () => {
    const r = await request();
    const shown = await reply(r.id, (await live()).id, { message: 'Ring me on 98765 43210' });
    for (const status of ['pending', 'withdrawn', 'dropped'] as const) await reply(r.id, (await live()).id, { status });
    await reply(r.id, (await live(blocked)).id, {}, blocked);
    const res = await get(`/part-requests/${r.id}/replies`, buyer.token);
    expect(res.statusCode).toBe(200);
    const items = res.json().data.items;
    expect(items.map((i: { replyId: string }) => i.replyId)).toEqual([shown.id]);
    expect(items[0].message).not.toContain('98765');
    expect(items[0]).toMatchObject({ live: true, viewed: false, seller: { businessId: seller.businessId } });
  });

  it('compare: a listing both reply and match once, capped at 10 of 12, lowest price marked', async () => {
    const r = await request();
    const listings: Array<{ id: string }> = [];
    for (let i = 0; i < 12; i++) listings.push(await live(seller, i === 3 ? 20_000 : 100_000 + i * 1000));
    for (let i = 0; i < 6; i++) await reply(r.id, listings[i]!.id);
    for (let i = 5; i < 12; i++) await insertTestMatch({ partRequestId: r.id, listingId: listings[i]!.id, sellerBusinessId: seller.businessId });
    const res = await get(`/part-requests/${r.id}/compare`, buyer.token);
    expect(res.statusCode).toBe(200);
    const cols = res.json().data.columns as Array<{ listingId: string; source: string; lowestPrice: boolean; contactAction: string }>;
    expect(cols).toHaveLength(10);
    expect(new Set(cols.map((c) => c.listingId)).size).toBe(10);
    expect(cols.filter((c) => c.listingId === listings[5]!.id)).toEqual([expect.objectContaining({ source: 'reply' })]);
    expect(cols.filter((c) => c.lowestPrice).map((c) => c.listingId)).toEqual([listings[3]!.id]);
    expect(cols.every((c) => c.contactAction === 'buy')).toBe(true);
  });
});

describe('mine', () => {
  it('tabs and counts (closed holds expired and removed); 21 active rows page 20 + 1', async () => {
    const b = await business();
    for (let i = 0; i < 21; i++) await request({}, b);
    for (const status of ['expired', 'removed', 'closed', 'fulfilled'] as const) await request({ status }, b);
    const first = await get('/part-requests/mine?status=active', b.token);
    expect(first.statusCode).toBe(200);
    const p1 = first.json().data;
    expect(p1.counts).toEqual({ active: 21, fulfilled: 1, closed: 3 });
    expect(p1.items).toHaveLength(20);
    expect(p1.nextCursor).toEqual(expect.any(String));
    const p2 = (await get(`/part-requests/mine?status=active&cursor=${encodeURIComponent(p1.nextCursor)}`, b.token)).json().data;
    expect(p2.items).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
    const ids = new Set([...p1.items, ...p2.items].map((i: { id: string }) => i.id));
    expect(ids.size).toBe(21);
    const closed = (await get('/part-requests/mine?status=closed', b.token)).json().data;
    expect(closed.items.map((i: { status: string }) => i.status).sort()).toEqual(['closed', 'expired', 'removed']);
    const bad = await get('/part-requests/mine?status=active&cursor=nonsense', b.token);
    expect(bad.json().code).toBe('INVALID_CURSOR');
  });
});

describe('photos', () => {
  it('signed URLs for the buyer; 404 for a business that is not eligible', async () => {
    const r = await request({ audience: 'verified_only' });
    await db.update(partRequests).set({ photoKeys: [`part-request/${r.id}/a.jpg`] }).where(eq(partRequests.id, r.id));
    const own = await get(`/part-requests/${r.id}/photos`, buyer.token);
    expect(own.statusCode).toBe(200);
    expect(own.json().data.photos).toHaveLength(1);
    const outsider = await business();
    expect((await get(`/part-requests/${r.id}/photos`, outsider.token)).statusCode).toBe(404);
  });
});

describe('home (D17)', () => {
  it('the request with the newer unseen match; newCount only after buyer_seen_at; nearestKm the stored km', async () => {
    const h = await business();
    const older = await request({}, h);
    const newer = await request({}, h);
    const m1 = await insertTestMatch({ partRequestId: older.id, listingId: (await live()).id, sellerBusinessId: seller.businessId, distanceKm: 2 });
    const before = await insertTestMatch({ partRequestId: newer.id, listingId: (await live()).id, sellerBusinessId: seller.businessId, distanceKm: 3 });
    await insertTestMatch({ partRequestId: newer.id, listingId: (await live()).id, sellerBusinessId: seller.businessId, distanceKm: 7 });
    const ago = (h: number) => new Date(Date.now() - h * HOUR_MS);
    await db.update(partRequestMatches).set({ createdAt: ago(3) }).where(eq(partRequestMatches.listingId, before.listingId));
    await db.update(partRequestMatches).set({ createdAt: ago(1) }).where(eq(partRequestMatches.listingId, m1.listingId));
    await db.update(partRequests).set({ buyerSeenAt: ago(2) }).where(eq(partRequests.id, newer.id));
    const res = await get('/part-requests/home', h.token);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.buyer).toEqual({ partRequestId: newer.id, name: newer.name, side: 'left', newCount: 1, nearestKm: 7 });
    expect(res.json().data.seller).not.toBeNull();
    // Sanity: the older request still has its unseen match.
    expect((await db.select({ n: sql<number>`count(*)::int` }).from(partRequestMatches).where(eq(partRequestMatches.partRequestId, older.id)))[0]!.n).toBe(1);
  });
});
