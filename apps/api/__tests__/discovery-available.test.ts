import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { gt, sql } from 'drizzle-orm';
import type { ListingDetail, ListingOwnerView, SearchFilters, SearchPage } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { searchQueries } from '../src/db/schema.js';
import { refreshListingSearch } from '../src/services/discovery/search-text.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { createTestCatalog, deleteTestCatalog, type TestCatalog } from './_helpers/test-catalog.js';
import { insertTestDeal, insertTestOffer } from './_helpers/test-deals.js';
import { deleteTestRedisKeys } from './_helpers/test-discovery.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestListingOptions, type TestSeller } from './_helpers/test-listings.js';

// Available quantity in discovery and on the listing page (plan C1-3, spec §8.4, §12.2): cards and search results show
// `quantity − held_quantity`, `minQty` and its facet counts use it, the buyer's thread and open negotiation on the
// detail, and the owner's held quantity. Searches are scoped to this suite's catalogue.

let app: FastifyInstance;
let catalog: TestCatalog;
let seller: TestSeller;
let buyer: TestBusinessUser;
let otherBuyer: TestBusinessUser;
let logIdBefore = 0;
const L: Record<string, string> = {};
let threadId = '';
let offerId = '';

async function mk(name: string, o: Partial<TestListingOptions> & { title: string }): Promise<string> {
  const { id } = await insertTestListing(db, {
    businessId: seller.businessId,
    userId: seller.userId,
    kind: 'part',
    categoryId: catalog.motorsGroupId,
    unitId: catalog.unitId,
    conditionId: catalog.conditionId,
    ...o,
  });
  await refreshListingSearch(db, [id]);
  L[name] = id;
  return id;
}

async function S(q: string, filters: SearchFilters = {}): Promise<SearchPage> {
  const res = await app.inject({ method: 'POST', url: '/discover/search', payload: { q, filters: { categoryId: catalog.categoryId, ...filters } } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().data as SearchPage;
}

const detail = async (id: string, token?: string) => {
  const res = await app.inject({ method: 'GET', url: `/listings/${id}`, headers: token ? { authorization: `Bearer ${token}` } : {} });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().data as ListingDetail & Partial<ListingOwnerView>;
};

beforeAll(async () => {
  app = await buildApp({ logger: false });
  catalog = await createTestCatalog();
  seller = await createTestSeller({ machineCategoryId: catalog.categoryId });
  buyer = await createTestBusinessUser();
  otherBuyer = await createTestBusinessUser();
  const [last] = await db.select({ id: sql<number>`coalesce(max(${searchQueries.id}), 0)::int` }).from(searchQueries);
  logIdBefore = Number(last?.id ?? 0);

  await mk('held', { title: 'Warp beam flange held', quantity: '5' });
  const deal = await insertTestDeal({ listing: { id: L.held! }, buyer, quantity: '3', pricePerUnitPaise: 100_000 });
  threadId = deal.threadId;
  offerId = (await insertTestOffer({ threadId, status: 'pending', pricePerUnitPaise: 90_000, quantity: '1' })).id;

  await mk('bigHeld', { title: 'Dobby lever twelve held', quantity: '12' });
  await insertTestDeal({ listing: { id: L.bigHeld! }, buyer: otherBuyer, quantity: '3', pricePerUnitPaise: 100_000 });
  await mk('bigFree', { title: 'Dobby lever twelve free', quantity: '12' });
});

afterAll(async () => {
  await db.delete(searchQueries).where(gt(searchQueries.id, logIdBefore));
  await deleteTestBusinesses([seller?.businessId, buyer?.businessId, otherBuyer?.businessId].filter(Boolean) as string[]);
  if (seller) await deleteTestSellerExtras([seller]);
  if (catalog) await deleteTestCatalog(catalog.categoryId);
  if (app?.redis) await deleteTestRedisKeys(app.redis);
  await app?.close();
});

describe('available quantity (§8.4)', () => {
  it('cards and search results show what is still available, beside the listed quantity', async () => {
    const p = await S('warp beam flange');
    const card = p.items.find((i) => i.id === L.held);
    expect(card).toMatchObject({ quantity: '5', availableQuantity: '2' });
    expect((await detail(L.held!)).availableQuantity).toBe('2');
  });

  it('minQty counts only what is available, and so does the condition facet', async () => {
    const p = await S('dobby lever', { minQty: 10 });
    expect(p.items.map((i) => i.id)).toEqual([L.bigFree]);
    expect(p.facets!.conditions).toEqual([{ id: catalog.conditionId, label: expect.any(String), count: 1 }]);
    const all = await S('dobby lever');
    expect(all.items.map((i) => i.id).sort()).toEqual([L.bigHeld, L.bigFree].sort());
  });
});

describe('the listing page for buyers and the owner (§12.2)', () => {
  it("gives the thread's buyer its thread and open negotiation, and nobody else", async () => {
    const mine = await detail(L.held!, buyer.token);
    expect(mine.myThreadId).toBe(threadId);
    expect(mine.openNegotiation).toEqual({ offerId, status: 'pending', turn: 'seller', pricePerUnitPaise: 90_000 });

    for (const view of [await detail(L.held!, otherBuyer.token), await detail(L.held!)]) {
      expect(view.myThreadId).toBeNull();
      expect(view.openNegotiation).toBeNull();
    }
  });

  it("shows the owner the quantity on hold, and no buyer thread", async () => {
    const owner = await detail(L.held!, seller.token);
    expect(owner.isOwner).toBe(true);
    expect(owner.heldQuantity).toBe('3');
    expect(owner.availableQuantity).toBe('2');
    expect(owner.myThreadId).toBeNull();
  });
});
