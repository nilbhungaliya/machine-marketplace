import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DISCOVERY_LIMITS, type SavedListingItem, type SavedListingsPage } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { listings, savedListings } from '../src/db/schema.js';
import { createTestCatalog, deleteTestCatalog, type TestCatalog } from './_helpers/test-catalog.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { deleteTestDiscovery, deleteTestRedisKeys, testRunId } from './_helpers/test-discovery.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';

// F4 + F5 spec §4.4, §7 saved listings (plan B2-2).

const runId = testRunId();
let app: FastifyInstance;
let catalog: TestCatalog;
let seller: TestSeller;
let buyer: TestSeller;
let other: TestSeller;
let hoarder: TestSeller;
let racer: TestSeller;
let pinned: TestSeller;
const sellers: TestSeller[] = [];
const ids: Record<string, string> = {};

beforeAll(async () => {
  app = await buildApp({ logger: false });
  catalog = await createTestCatalog();
  seller = await createTestSeller({ machineCategoryId: catalog.categoryId });
  buyer = await createTestSeller({ machineCategoryId: catalog.categoryId });
  other = await createTestSeller({ machineCategoryId: catalog.categoryId });
  hoarder = await createTestSeller({ machineCategoryId: catalog.categoryId });
  racer = await createTestSeller({ machineCategoryId: catalog.categoryId });
  // A business pinned in a spot no other suite uses (Odisha); the "near" listing ~5 km away.
  pinned = await createTestSeller({ machineCategoryId: catalog.categoryId, point: { lat: 21.3, lng: 83.6 } });
  sellers.push(seller, buyer, other, hoarder, racer, pinned);
  ids.near = (await insertTestListing(db, {
    businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: catalog.partGroupId,
    title: 'Saved near', searchPoint: { lat: 21.35, lng: 83.6 },
  })).id;
  for (const [name, status] of [['a', 'live'], ['b', 'live'], ['c', 'reserved'], ['paused', 'paused'], ['gone', 'live']] as const) {
    const r = await insertTestListing(db, {
      businessId: seller.businessId, userId: seller.userId, kind: 'part', status, categoryId: catalog.partGroupId,
      title: `Saved ${name}`, pincode: '990011', addressLine: 'Plot 7, Private Road', photos: name === 'gone' ? 0 : 1,
    });
    ids[name] = r.id;
  }
});

afterAll(async () => {
  await deleteTestDiscovery(runId, { userIds: sellers.map((s) => s.userId) });
  await deleteTestBusinesses(sellers.map((s) => s.businessId));
  await deleteTestSellerExtras(sellers);
  await deleteTestCatalog(catalog.categoryId);
  if (app?.redis) await deleteTestRedisKeys(app.redis);
  await app?.close();
});

const auth = (s: TestSeller) => ({ authorization: `Bearer ${s.token}` });
const save = (s: TestSeller, id: string) => app.inject({ method: 'PUT', url: `/users/me/saved-listings/${id}`, headers: auth(s) });
const unsave = (s: TestSeller, id: string) => app.inject({ method: 'DELETE', url: `/users/me/saved-listings/${id}`, headers: auth(s) });
const list = (s: TestSeller, cursor?: string) =>
  app.inject({ method: 'GET', url: `/users/me/saved-listings${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, headers: auth(s) });
const rowsOf = (userId: string) => db.select().from(savedListings).where(eq(savedListings.userId, userId));

describe('PUT /users/me/saved-listings/:listingId', () => {
  it('saves a public listing, idempotently', async () => {
    const first = await save(buyer, ids.a!);
    expect(first.statusCode).toBe(200);
    expect(first.json().data).toEqual({ saved: true });
    expect((await save(buyer, ids.a!)).json().data).toEqual({ saved: true });
    expect((await rowsOf(buyer.userId)).filter((r) => r.listingId === ids.a)).toHaveLength(1);
  });

  it('refuses the viewer’s own listing, and a listing that is not public', async () => {
    const own = await save(seller, ids.a!);
    expect(own.statusCode).toBe(409);
    expect(own.json().code).toBe('CANNOT_SAVE_OWN_LISTING');
    const paused = await save(buyer, ids.paused!);
    expect(paused.statusCode).toBe(404);
    expect(paused.json().code).toBe('LISTING_NOT_FOUND');
    expect((await save(buyer, randomUUID())).json().code).toBe('LISTING_NOT_FOUND');
    expect((await save(buyer, 'not-a-uuid')).statusCode).toBe(400);
  });

  it(`refuses the ${DISCOVERY_LIMITS.savedCap + 1}st save, but a repeat at the cap still answers saved`, async () => {
    const drafts = await db
      .insert(listings)
      .values(
        Array.from({ length: DISCOVERY_LIMITS.savedCap }, () => ({
          businessId: seller.businessId, createdByUserId: seller.userId, kind: 'part' as const, status: 'draft' as const,
        })),
      )
      .returning({ id: listings.id });
    const base = Date.now() - 10_000_000;
    await db.insert(savedListings).values(drafts.map((d, i) => ({ userId: hoarder.userId, listingId: d.id, createdAt: new Date(base + i * 1000) })));

    const over = await save(hoarder, ids.a!);
    expect(over.statusCode).toBe(409);
    expect(over.json().code).toBe('SAVED_LIMIT');
    // Already saved: no new row, so the cap doesn't apply.
    await db.delete(savedListings).where(and(eq(savedListings.userId, hoarder.userId), eq(savedListings.listingId, drafts[0]!.id)));
    expect((await save(hoarder, ids.a!)).statusCode).toBe(200);
    expect((await save(hoarder, ids.a!)).statusCode).toBe(200);
    expect(await rowsOf(hoarder.userId)).toHaveLength(DISCOVERY_LIMITS.savedCap);
  });
});

describe('the saved cap under concurrency', () => {
  it(`two saves at the same moment with ${DISCOVERY_LIMITS.savedCap - 1} saved: exactly one succeeds`, async () => {
    const drafts = await db
      .insert(listings)
      .values(
        Array.from({ length: DISCOVERY_LIMITS.savedCap - 1 }, () => ({
          businessId: seller.businessId, createdByUserId: seller.userId, kind: 'part' as const, status: 'draft' as const,
        })),
      )
      .returning({ id: listings.id });
    await db.insert(savedListings).values(drafts.map((d) => ({ userId: racer.userId, listingId: d.id })));
    const replies = await Promise.all([save(racer, ids.a!), save(racer, ids.b!)]);
    const outcome = replies.map((r) => (r.statusCode === 200 ? 'ok' : `${r.statusCode} ${r.json().code}`)).sort();
    expect(outcome).toEqual(['409 SAVED_LIMIT', 'ok']);
    expect(await rowsOf(racer.userId)).toHaveLength(DISCOVERY_LIMITS.savedCap);
  });
});

describe('DELETE /users/me/saved-listings/:listingId', () => {
  it('always answers saved: false', async () => {
    await save(buyer, ids.b!);
    for (const id of [ids.b!, ids.b!, randomUUID(), ids.paused!]) {
      const res = await unsave(buyer, id);
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual({ saved: false });
    }
    expect((await rowsOf(buyer.userId)).some((r) => r.listingId === ids.b)).toBe(false);
  });
});

describe('GET /users/me/saved-listings', () => {
  it('lists newest first; a listing that left the public statuses shows as unavailable, with no card', async () => {
    await db.delete(savedListings).where(eq(savedListings.userId, other.userId));
    const t = Date.now();
    await db.insert(savedListings).values([
      { userId: other.userId, listingId: ids.a!, createdAt: new Date(t - 3000) },
      { userId: other.userId, listingId: ids.b!, createdAt: new Date(t - 2000) },
      { userId: other.userId, listingId: ids.c!, createdAt: new Date(t - 1000) },
    ]);
    await db.update(listings).set({ status: 'hidden' }).where(eq(listings.id, ids.b!));
    try {
      const res = await list(other);
      expect(res.statusCode).toBe(200);
      const page = res.json().data as SavedListingsPage;
      expect(page.nextCursor).toBeNull();
      expect(page.items.map((i) => i.listingId)).toEqual([ids.c, ids.b, ids.a]);
      const [c, b, a] = page.items as [SavedListingItem, SavedListingItem, SavedListingItem];
      expect(b).toEqual({ listingId: ids.b, savedAt: expect.any(String), unavailable: true });
      expect('card' in c && c.card.tags).toEqual(['reserved']);
      expect('card' in a && a.card.saved).toBe(true);
      expect(res.body).not.toMatch(/"(lat|lng|point|pincode|addressLine)"/);
      expect(res.body).not.toContain('Private Road');
      expect(res.body).not.toContain('990011');
    } finally {
      await db.update(listings).set({ status: 'live' }).where(eq(listings.id, ids.b!));
    }
  });

  it('pages with a sealed keyset cursor bound to the user', async () => {
    const first = (await list(hoarder)).json().data as SavedListingsPage;
    expect(first.items).toHaveLength(DISCOVERY_LIMITS.pageSize);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = (await list(hoarder, first.nextCursor!)).json().data as SavedListingsPage;
    expect(second.items).toHaveLength(DISCOVERY_LIMITS.pageSize);
    const seen = new Set(first.items.map((i) => i.listingId));
    for (const i of second.items) expect(seen.has(i.listingId)).toBe(false);
    const times = [...first.items, ...second.items].map((i) => Date.parse(i.savedAt));
    expect(times).toEqual([...times].sort((x, y) => y - x));

    const tampered = await list(hoarder, `${first.nextCursor!.slice(0, -2)}AA`);
    expect(tampered.statusCode).toBe(400);
    expect(tampered.json().code).toBe('CURSOR_INVALID');
    const foreign = await list(other, first.nextCursor!);
    expect(foreign.json().code).toBe('CURSOR_INVALID');
  });

  it('shows distances from the business location, as Home and search do; none without a business location', async () => {
    for (const s of [pinned, buyer]) {
      await db.delete(savedListings).where(eq(savedListings.userId, s.userId));
      expect((await save(s, ids.near!)).statusCode).toBe(200);
    }
    const page = (await list(pinned)).json().data as SavedListingsPage;
    const item = page.items[0]!;
    const fromCards = await app.inject({
      method: 'POST', url: '/discover/cards', headers: auth(pinned), payload: { ids: [ids.near], origin: { business: true } },
    });
    const expected = fromCards.json().data[0].distanceKm;
    expect(expected).toEqual(expect.any(Number));
    expect('card' in item && item.card.distanceKm).toBe(expected);
    // `buyer`'s business has a pincode with no offices and no pin: no origin.
    const none = ((await list(buyer)).json().data as SavedListingsPage).items.find((i) => i.listingId === ids.near)!;
    expect('card' in none && none.card.distanceKm).toBeNull();
  });

  it('drops the row when the listing is deleted', async () => {
    await save(buyer, ids.gone!);
    expect((await rowsOf(buyer.userId)).some((r) => r.listingId === ids.gone)).toBe(true);
    await db.delete(listings).where(eq(listings.id, ids.gone!));
    expect((await rowsOf(buyer.userId)).some((r) => r.listingId === ids.gone)).toBe(false);
  });

  it('answers 401 to a guest', async () => {
    const id = ids.a!;
    expect((await app.inject({ method: 'GET', url: '/users/me/saved-listings' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'PUT', url: `/users/me/saved-listings/${id}` })).statusCode).toBe(401);
    expect((await app.inject({ method: 'DELETE', url: `/users/me/saved-listings/${id}` })).statusCode).toBe(401);
  });
});
