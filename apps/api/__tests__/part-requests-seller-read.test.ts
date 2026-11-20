import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, inArray, or } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { businessBlocks, businesses } from '../src/db/schema.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';
import {
  countF8Rows,
  createTestPartTree,
  insertTestPartRequest,
  insertTestReply,
  insertTestTarget,
  type TestPartRequestOptions,
  type TestPartTree,
} from './_helpers/test-part-requests.js';

// F8 A1-4: the seller's reads, Not relevant, report and the "Requests for you" badge (spec §6, §12.3, §12.4, §14;
// plan A1-4, D3, D16).

vi.mock('../src/lib/storage.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/storage.js')>();
  return { ...real, presignPrivateGet: vi.fn(async (key: string) => `https://private.test/${key}?sig=1`) };
});

const SURAT = { lat: 21.17, lng: 72.83 };
const DELHI = { lat: 28.61, lng: 77.21 };
const FORBIDDEN_KEYS = ['phone', 'pincode', 'point', 'address', 'industrialAreaId'];

let app: FastifyInstance;
let tree: TestPartTree;
let tree2: TestPartTree;
let buyer: TestSeller;
let seller: TestSeller;
const sellers: TestSeller[] = [];

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const get = (url: string, token: string) => app.inject({ method: 'GET', url, headers: auth(token) });
const send = (method: 'POST' | 'DELETE', url: string, token: string, payload?: object) =>
  app.inject({ method, url, headers: auth(token), ...(payload ? { payload } : {}) });

async function business(opts: Parameters<typeof createTestSeller>[0] = {}): Promise<TestSeller> {
  const s = await createTestSeller({ machineCategoryId: tree.machineCategory.id, point: SURAT, ...opts });
  sellers.push(s);
  return s;
}

const request = (o: Partial<TestPartRequestOptions> = {}, who: TestSeller = buyer) =>
  insertTestPartRequest({ businessId: who.businessId, userId: who.userId, categoryId: tree.partGroup.id, side: 'left', unitId: tree.unitId, ...o });

const live = (who: TestSeller, categoryId = tree.partGroup.id) =>
  insertTestListing(db, { businessId: who.businessId, userId: who.userId, kind: 'part', categoryId, side: 'left', unitId: tree.unitId });

/** Every key anywhere in a JSON value. */
function keysOf(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      keysOf(x, out);
    }
  }
  return out;
}

const ids = (items: Array<{ id: string }>) => items.map((i) => i.id);

beforeAll(async () => {
  app = await buildApp({ logger: false });
  tree = await createTestPartTree();
  tree2 = await createTestPartTree();
  buyer = await business();
  seller = await business();
  await db.update(businesses).set({ tradeName: 'Shree Ram 98765 43210' }).where(eq(businesses.id, buyer.businessId));
});

afterAll(async () => {
  const all = sellers.map((s) => s.businessId);
  await db.delete(businessBlocks).where(or(inArray(businessBlocks.blockerBusinessId, all), inArray(businessBlocks.blockedBusinessId, all)));
  await deleteTestBusinesses(all);
  await deleteTestSellerExtras(sellers);
  await tree.cleanup();
  await tree2.cleanup();
  expect(Object.values(await countF8Rows()).every((n) => n === 0)).toBe(true);
  await app.close();
});

describe('what a seller sees (§12.3)', () => {
  it('no contact or location keys; budget only when visible; buyer trade name masked', async () => {
    const hidden = await request({ budgetPerUnitPaise: 40_000, budgetVisible: false });
    const shown = await request({ budgetPerUnitPaise: 60_000, budgetVisible: true });
    for (const r of [hidden, shown]) {
      const res = await get(`/part-requests/${r.id}`, seller.token);
      expect(res.statusCode).toBe(200);
      const v = res.json().data;
      expect(v.role).toBe('seller');
      for (const k of FORBIDDEN_KEYS) expect(keysOf(v).has(k)).toBe(false);
      expect(v.budgetPerUnitPaise).toBe(r.id === hidden.id ? null : 60_000);
      expect(v.buyer.tradeName).not.toContain('98765');
    }
    const list = (await get('/part-requests/for-sellers?tab=all', seller.token)).json().data;
    const rows = list.items.filter((i: { id: string }) => i.id === hidden.id || i.id === shown.id);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      for (const k of FORBIDDEN_KEYS) expect(keysOf(row).has(k)).toBe(false);
      expect(row.budgetPerUnitPaise).toBe(row.id === hidden.id ? null : 60_000);
      expect(row.buyer.tradeName).not.toContain('98765');
    }
  });

  it('404 on the detail, photos, not relevant and report for a business that is not eligible', async () => {
    const verifiedOnly = await request({ audience: 'verified_only' });
    const unverified = await business();
    const blockedSeller = await business();
    await db.insert(businessBlocks).values({ blockerBusinessId: buyer.businessId, blockedBusinessId: blockedSeller.businessId, createdByUserId: buyer.userId });
    const open = await request();
    const third = await business({ activities: ['buy'] });
    const cases: Array<[string, TestSeller]> = [
      [verifiedOnly.id, unverified],
      [open.id, blockedSeller],
      [open.id, third],
    ];
    for (const [id, who] of cases) {
      expect((await get(`/part-requests/${id}`, who.token)).statusCode).toBe(404);
      expect((await get(`/part-requests/${id}/photos`, who.token)).statusCode).toBe(404);
      expect((await send('POST', `/part-requests/${id}/not-relevant`, who.token, {})).statusCode).toBe(404);
      expect((await send('POST', `/part-requests/${id}/report`, who.token, { reason: 'spam' })).statusCode).toBe(404);
    }
  });
});

describe('for-sellers tabs and order', () => {
  it('For you: targeted and with stock; All adds the profile-only; order targeted → reach + stock → reach → outside', async () => {
    const s = await business();
    await db.update(businesses).set({ categories: [tree.machineCategory.id, tree2.machineCategory.id] }).where(eq(businesses.id, s.businessId));
    await live(s);
    const far = { point: DELHI, reach: 'radius_50' as const, state: 'Delhi' };
    const targeted = await request({ categoryId: tree2.partGroup.id, unitId: tree2.unitId, ...far });
    await insertTestTarget({ partRequestId: targeted.id, businessId: s.businessId });
    const reachStock = await request();
    const reach = await request({ categoryId: tree2.partGroup.id, unitId: tree2.unitId });
    const outStock = await request(far);
    const out = await request({ categoryId: tree2.partGroup.id, unitId: tree2.unitId, ...far });
    const mine = new Set([targeted.id, reachStock.id, reach.id, outStock.id, out.id]);
    const pick = (items: Array<{ id: string }>) => ids(items).filter((id) => mine.has(id));

    const all = (await get('/part-requests/for-sellers?tab=all', s.token)).json().data;
    expect(pick(all.items)).toEqual([targeted.id, reachStock.id, reach.id, outStock.id, out.id]);
    const forYou = (await get('/part-requests/for-sellers?tab=matched', s.token)).json().data;
    expect(pick(forYou.items)).toEqual([targeted.id, reachStock.id, outStock.id]);
    const row = forYou.items.find((i: { id: string }) => i.id === targeted.id);
    expect(row).toMatchObject({ targeted: true, inReach: false, hasMatchingStock: false });
    expect(row.distanceKm).toBeGreaterThan(900);
  });

  it('Not relevant hides from For you and All, the detail still answers notRelevant: true, DELETE undoes', async () => {
    const r = await request();
    const inTab = async (tab: string) => ids((await get(`/part-requests/for-sellers?tab=${tab}`, seller.token)).json().data.items).includes(r.id);
    expect(await inTab('matched')).toBe(false); // the seller has no stock and no target yet
    expect(await inTab('all')).toBe(true);
    const set = await send('POST', `/part-requests/${r.id}/not-relevant`, seller.token, { reason: 'dont_sell_this' });
    expect(set.statusCode).toBe(200);
    expect(set.json().data).toEqual({ notRelevant: true });
    expect(await inTab('all')).toBe(false);
    expect((await get(`/part-requests/${r.id}`, seller.token)).json().data.notRelevant).toBe(true);
    const undo = await send('DELETE', `/part-requests/${r.id}/not-relevant`, seller.token);
    expect(undo.json().data).toEqual({ notRelevant: false });
    expect(await inTab('all')).toBe(true);
  });

  it('Not relevant on a closed request the seller replied to is PART_REQUEST_NOT_ACTIVE', async () => {
    const r = await request({ status: 'closed' });
    await insertTestReply({ partRequestId: r.id, sellerBusinessId: seller.businessId, listingId: (await live(seller)).id, userId: seller.userId });
    const res = await send('POST', `/part-requests/${r.id}/not-relevant`, seller.token, {});
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('PART_REQUEST_NOT_ACTIVE');
  });
});

describe('report (§14)', () => {
  it('a second report is REPORT_EXISTS; `other` needs details', async () => {
    const r = await request();
    expect((await send('POST', `/part-requests/${r.id}/report`, seller.token, { reason: 'other' })).statusCode).toBe(400);
    const first = await send('POST', `/part-requests/${r.id}/report`, seller.token, { reason: 'spam' });
    expect(first.statusCode).toBe(200);
    expect(first.json().data).toEqual({ reported: true });
    const again = await send('POST', `/part-requests/${r.id}/report`, seller.token, { reason: 'spam' });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('REPORT_EXISTS');
  });
});

describe('Requests for you badge (§12.4)', () => {
  it('drops after the seller opens a request, after a reply and after Not relevant', async () => {
    const s = await business();
    const reqs = [await request(), await request(), await request()];
    for (const r of reqs) await insertTestTarget({ partRequestId: r.id, businessId: s.businessId });
    const badge = async () => (await get('/users/me/badges', s.token)).json().data.requestsForYou;
    expect(await badge()).toBe(3);
    expect((await get(`/part-requests/${reqs[0]!.id}`, s.token)).statusCode).toBe(200);
    expect(await badge()).toBe(2);
    await insertTestReply({ partRequestId: reqs[1]!.id, sellerBusinessId: s.businessId, listingId: (await live(s)).id, userId: s.userId, status: 'pending' });
    expect(await badge()).toBe(1);
    expect((await send('POST', `/part-requests/${reqs[2]!.id}/not-relevant`, s.token, {})).statusCode).toBe(200);
    expect(await badge()).toBe(0);
  });
});
