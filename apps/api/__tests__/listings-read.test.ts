import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import type { ListingCard, ListingKind, ListingStatus, MyListingsView } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/index.js';
import { listings, users } from '../src/db/schema.js';
import { listMine } from '../src/services/listings/listing-read.service.js';
import { toOwnerView } from '../src/services/listings/listing-view.service.js';
import { getSettings } from '../src/services/settings.service.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { createTestCatalog, deleteTestCatalog, type TestCatalog } from './_helpers/test-catalog.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import {
  createTestMachineUnit,
  createTestSeller,
  deleteTestSellerExtras,
  deleteTestUnits,
  insertTestHistory,
  insertTestListing,
  type TestListingOptions,
  type TestSeller,
} from './_helpers/test-listings.js';

// Reads and public visibility (F2 plan Task 10, spec §7.1, §8.1, §10, R20, R49, R50): non-public listings are 404 to
// anyone but the owner, public payloads carry no private field, restricted businesses' listings aren't public, and My
// listings groups and counts.

const DAY = 24 * 60 * 60 * 1000;
const PRIVATE_KEYS = ['serialNumber', 'addressLine', 'pincode', 'point', 'lat', 'lng', 'location'];

let app: FastifyInstance;
let catalog: TestCatalog;
let machineUnit: { id: string; key: string };
let admin: { id: string; token: string };
const sellers: TestSeller[] = [];

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: token ? auth(token) : {} });

async function seller(opts: Parameters<typeof createTestSeller>[0] = {}): Promise<TestSeller> {
  const s = await createTestSeller({ machineCategoryId: catalog.categoryId, ...opts });
  sellers.push(s);
  return s;
}

const partOf = (s: TestSeller, status: ListingStatus, extra: Partial<TestListingOptions> = {}) =>
  insertTestListing(db, {
    businessId: s.businessId,
    userId: s.userId,
    kind: 'part',
    status,
    categoryId: catalog.motorsGroupId,
    unitId: catalog.unitId,
    conditionId: catalog.conditionId,
    quantity: '10',
    ...extra,
  }).then((r) => r.id);

/** Every key anywhere in a JSON value. */
function allKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) allKeys(v, out);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      allKeys(v, out);
    }
  }
  return out;
}

const expiredToken = (s: TestSeller) =>
  jwt.sign({ userId: s.userId, businessId: s.businessId, typ: 'user' }, process.env.JWT_SECRET!, { expiresIn: -60 });

beforeAll(async () => {
  app = await buildApp({ logger: false });
  catalog = await createTestCatalog();
  machineUnit = await createTestMachineUnit();
  admin = await createTestAdmin('moderator');
});

afterAll(async () => {
  await deleteTestBusinesses(sellers.map((s) => s.businessId));
  await deleteTestSellerExtras(sellers);
  await deleteTestAdmins([admin?.id].filter(Boolean) as string[]);
  await deleteTestCatalog(catalog.categoryId);
  if (machineUnit) await deleteTestUnits([machineUnit.id]);
  await app?.close();
});

describe('GET /listings/:id visibility', () => {
  const nonPublic: ListingStatus[] = ['draft', 'pending_review', 'rejected', 'paused', 'sold', 'unavailable', 'expired', 'hidden'];

  it('is 404 for a guest, another business and an expired token, and the owner view for the owner, in every non-public status', async () => {
    const owner = await seller();
    const other = await seller();
    for (const status of nonPublic) {
      const id = await partOf(owner, status);
      for (const [who, token] of [['guest', undefined], ['other', other.token], ['expired', expiredToken(owner)]] as const) {
        const res = await get(`/listings/${id}`, token);
        expect(res.statusCode, `${status} for ${who}`).toBe(404);
        expect(res.json().code).toBe('LISTING_NOT_FOUND');
      }
      const mine = await get(`/listings/${id}`, owner.token);
      expect(mine.statusCode, `${status} for the owner`).toBe(200);
      expect(mine.json().data).toMatchObject({ id, status, isOwner: true });
      expect((await get(`/listings/${id}/owner`, owner.token)).statusCode).toBe(200);
      expect((await get(`/listings/${id}/owner`, other.token)).statusCode).toBe(404);
    }
  });

  it('serves live, reserved and rented listings to anyone', async () => {
    const owner = await seller();
    for (const status of ['live', 'reserved', 'rented'] as const) {
      const id = await partOf(owner, status);
      const res = await get(`/listings/${id}`);
      expect(res.statusCode, status).toBe(200);
      expect(res.json().data).toMatchObject({ id, status, isOwner: false });
    }
  });

  it('keeps every private field out of the public payload of a machine listing', async () => {
    const owner = await seller();
    const { id } = await insertTestListing(db, {
      businessId: owner.businessId, userId: owner.userId, kind: 'machine', status: 'live', categoryId: catalog.machineTypeId,
      unitId: machineUnit.id, conditionId: catalog.conditionId, machine: { brandOther: 'Local make', serialNumber: 'SN-SECRET-77' },
      locationSource: 'godown', pincode: '990015', addressLine: 'Plot 12, Secret Lane', point: { lat: 21.2, lng: 72.8 },
    });
    const viewer = await seller();
    for (const token of [undefined, viewer.token]) {
      const res = await get(`/listings/${id}`, token);
      expect(res.statusCode).toBe(200);
      const keys = allKeys(res.json().data);
      for (const k of PRIVATE_KEYS) expect(keys.has(k), k).toBe(false);
      expect(res.body).not.toContain('SN-SECRET-77');
      expect(res.body).not.toContain('Secret Lane');
      expect(res.body).not.toContain('990015');
      expect(res.json().data.machine).toMatchObject({ brandOther: 'Local make' });
    }
    // The owner still sees them.
    const own = await get(`/listings/${id}`, owner.token);
    expect(own.json().data).toMatchObject({ machine: { serialNumber: 'SN-SECRET-77' }, location: { addressLine: 'Plot 12, Secret Lane', pincode: '990015' } });
  });

  it('gives null media URLs without MEDIA_PUBLIC_BASE_URL, and built ones with it', async () => {
    const owner = await seller();
    const id = await partOf(owner, 'live', { photos: 2 });
    const res = await get(`/listings/${id}`);
    expect(res.json().data.media).toHaveLength(2);
    expect(res.json().data.media[0]).toMatchObject({ url: null, thumbUrl: null });
    expect(res.json().data.thumbUrl).toBeNull();

    process.env.MEDIA_PUBLIC_BASE_URL = 'https://media.example.test/';
    try {
      const withBase = await get(`/listings/${id}`);
      expect(withBase.json().data.media[0].url).toMatch(/^https:\/\/media\.example\.test\/listings\//);
    } finally {
      process.env.MEDIA_PUBLIC_BASE_URL = '';
    }
  });

  it('gives the distance in whole km from the viewer business, and none to a guest', async () => {
    const owner = await seller();
    const viewer = await seller({ point: { lat: 21.17, lng: 72.83 } });
    const id = await partOf(owner, 'live', { point: { lat: 21.188, lng: 72.83 } });
    expect((await get(`/listings/${id}`, viewer.token)).json().data.distanceKm).toBe(2);
    expect((await get(`/listings/${id}`)).json().data.distanceKm).toBeNull();
  });

  it("falls back to the viewer's pincode centroid when the business has no pin", async () => {
    const owner = await seller();
    const viewer = await seller({ pincode: '990016', pincodeOffices: [{ lat: 21.1, lng: 72.8 }, { lat: 21.12, lng: 72.8 }] });
    const id = await partOf(owner, 'live', { point: { lat: 21.2, lng: 72.8 } });
    // Centroid 21.11 → 0.09° of latitude ≈ 10 km.
    expect((await get(`/listings/${id}`, viewer.token)).json().data.distanceKm).toBe(10);
  });

  it("hides a restricted business's listings (owner suspended) and brings them back on reinstatement", async () => {
    const owner = await seller();
    const viewer = await seller();
    const id = await partOf(owner, 'live');
    const seen = await get(`/listings/${id}`, viewer.token);
    expect(seen.json().data.seller.liveListings).toBe(1);

    await db.update(users).set({ status: 'suspended' }).where(eq(users.id, owner.userId));
    try {
      expect((await get(`/listings/${id}`)).statusCode).toBe(404);
      expect((await get(`/listings/${id}`, viewer.token)).statusCode).toBe(404);
      expect((await get(`/businesses/${owner.businessId}/listings`)).json().data).toEqual([]);
      await db.update(users).set({ status: 'blocked' }).where(eq(users.id, owner.userId));
      expect((await get(`/listings/${id}`)).statusCode).toBe(404);
    } finally {
      await db.update(users).set({ status: 'active' }).where(eq(users.id, owner.userId));
    }
    expect((await get(`/listings/${id}`)).statusCode).toBe(200);
    expect((await get(`/businesses/${owner.businessId}/listings`)).json().data).toHaveLength(1);
  });

  it('counts the seller card\'s live listings over public statuses only', async () => {
    const owner = await seller();
    const id = await partOf(owner, 'live');
    await partOf(owner, 'rented');
    await partOf(owner, 'paused');
    await partOf(owner, 'draft');
    expect((await get(`/listings/${id}`)).json().data.seller.liveListings).toBe(2);
  });

  it('is 404 for an unknown id and 400 for a malformed one', async () => {
    expect((await get('/listings/00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect((await get('/listings/nope')).statusCode).toBe(400);
  });
});

describe('removed listings', () => {
  it('shows an admin-removed listing to its owner for 30 days with the reason, then not', async () => {
    const owner = await seller();
    const recent = await partOf(owner, 'removed', { statusReason: 'Fake listing' });
    await insertTestHistory(db, { listingId: recent, from: 'live', to: 'removed', action: 'remove', actor: 'admin', adminId: admin.id, reason: 'Fake listing' });
    const old = await partOf(owner, 'removed', { statusReason: 'Old reason' });
    await insertTestHistory(db, { listingId: old, from: 'live', to: 'removed', action: 'remove', actor: 'admin', adminId: admin.id, createdAt: new Date(Date.now() - 31 * DAY) });
    const bySeller = await partOf(owner, 'removed');
    await insertTestHistory(db, { listingId: bySeller, from: 'live', to: 'removed', action: 'remove', actor: 'seller', userId: owner.userId });

    const view = await get(`/listings/${recent}/owner`, owner.token);
    expect(view.statusCode).toBe(200);
    expect(view.json().data).toMatchObject({ status: 'removed', statusReason: 'Fake listing' });
    expect((await get(`/listings/${recent}`, owner.token)).statusCode).toBe(200);
    expect((await get(`/listings/${old}/owner`, owner.token)).statusCode).toBe(404);
    expect((await get(`/listings/${bySeller}/owner`, owner.token)).statusCode).toBe(404);
    expect((await get(`/listings/${recent}`)).statusCode).toBe(404);

    const mine = (await get('/listings/mine?group=removed_by_team', owner.token)).json().data as MyListingsView;
    expect(mine.counts.removed_by_team).toBe(1);
    expect(mine.items.map((i) => i.id)).toEqual([recent]);
    expect(mine.items[0]!.statusReason).toBe('Fake listing');
  });
});

describe('GET /listings/mine', () => {
  it('counts every group in one go and pages the asked group', async () => {
    const owner = await seller();
    for (const status of ['live', 'reserved', 'rented', 'pending_review', 'rejected', 'paused', 'expired', 'unavailable', 'hidden', 'sold', 'draft', 'draft'] as const) {
      await partOf(owner, status);
    }
    await partOf(owner, 'removed');
    const other = await seller();
    await partOf(other, 'live');

    const res = await get('/listings/mine', owner.token);
    expect(res.statusCode, res.body).toBe(200);
    const view = res.json().data as MyListingsView;
    expect(view.counts).toEqual({ live: 3, review: 2, paused: 4, sold: 1, drafts: 2, removed_by_team: 0 });
    expect(view).toMatchObject({ group: 'live', total: 3, page: 1, pageSize: 20 });
    expect(new Set(view.items.map((i) => i.status))).toEqual(new Set(['live', 'reserved', 'rented']));
    expect(view.items[0]).toHaveProperty('needsAttention');
    expect(view.items[0]).toHaveProperty('scoreMissing');

    const paused = (await get('/listings/mine?group=paused', owner.token)).json().data as MyListingsView;
    expect(paused.items).toHaveLength(4);
    const page2 = (await get('/listings/mine?group=paused&page=2', owner.token)).json().data as MyListingsView;
    expect(page2.items).toHaveLength(0);
    expect((await get('/listings/mine?group=nope', owner.token)).statusCode).toBe(400);
    expect((await get('/listings/mine')).statusCode).toBe(401);
  });

  it('marks a listing expiring soon', async () => {
    const owner = await seller();
    await partOf(owner, 'live', { refreshedAt: new Date(Date.now() - 55 * DAY) });
    const view = (await get('/listings/mine?group=live', owner.token)).json().data as MyListingsView;
    expect(view.items[0]).toMatchObject({ expiringSoon: true });
    expect(view.items[0]!.expiresAt).not.toBeNull();
  });
});

describe('My listings cost and agreement with the owner view', () => {
  /** One of each kind, varied enough to give nudges, a score, a rate, a moderation note and a video. */
  async function mix(s: TestSeller, each: number): Promise<void> {
    for (let i = 0; i < each; i++) {
      await partOf(s, 'live', { categoryId: catalog.partGroupId, side: 'not_applicable', photos: i % 2, partNumber: 'TP-200' });
      await insertTestListing(db, {
        businessId: s.businessId, userId: s.userId, kind: 'machine' as ListingKind, status: 'live', categoryId: catalog.machineTypeId,
        unitId: machineUnit.id, conditionId: catalog.conditionId, machine: { brandOther: 'Local make', year: 2015 }, videos: 1,
        moderationOutcome: 'approved', moderationNote: 'Looks fine', refreshedAt: new Date(Date.now() - 55 * DAY),
      });
      await insertTestListing(db, {
        businessId: s.businessId, userId: s.userId, kind: 'machine_rental', status: 'live',
        categoryId: catalog.machineTypeId, unitId: machineUnit.id, machine: { brandOther: 'Local make' },
        rental: i % 2 === 0 ? { rateDayPaise: null, rateWeekPaise: 600_000 } : { rateDayPaise: null },
      });
    }
  }

  async function countQueries(fn: () => Promise<unknown>): Promise<number> {
    const spy = vi.spyOn(pool, 'query');
    try {
      await fn();
      return spy.mock.calls.length;
    } finally {
      spy.mockRestore();
    }
  }

  it('costs the same number of queries for 3 cards as for 18', async () => {
    const small = await seller();
    const big = await seller();
    await mix(small, 1);
    await mix(big, 6);
    const asUser = (s: TestSeller) => ({ userId: s.userId, businessId: s.businessId });

    let smallView: MyListingsView | undefined;
    let bigView: MyListingsView | undefined;
    const smallCount = await countQueries(async () => (smallView = await listMine(db, asUser(small), 'live', 1)));
    const bigCount = await countQueries(async () => (bigView = await listMine(db, asUser(big), 'live', 1)));
    expect(smallView!.items).toHaveLength(3);
    expect(bigView!.items).toHaveLength(18);
    expect(bigCount).toBe(smallCount);
    expect(smallCount).toBeGreaterThan(5);
    expect(smallCount).toBeLessThan(25);
  });

  it('gives every card the same values as the owner view', async () => {
    const s = await seller();
    await mix(s, 2);
    const view = await listMine(db, { userId: s.userId, businessId: s.businessId }, 'live', 1);
    expect(view.items).toHaveLength(6);
    const settings = await getSettings(db);
    for (const card of view.items) {
      const [row] = await db.select().from(listings).where(eq(listings.id, card.id));
      const owner = await toOwnerView(db, row!, settings);
      const { scoreMissing, rentalLine, ...rest } = card;
      expect(scoreMissing).toEqual(owner.score.missing);
      // M14 plan D14: My listings' own rental line (the owner view has `bookingSummary` instead).
      expect(rentalLine).toEqual(card.kind === 'machine_rental' ? { quantity: 1, outToday: 0, activeBookings: 0 } : null);
      for (const [key, value] of Object.entries(rest)) {
        expect(value, `${card.kind} ${key}`).toEqual((owner as unknown as Record<string, unknown>)[key]);
      }
    }
    // The mix really exercises the nudges.
    const all = view.items.flatMap((i) => i.needsAttention.map((p) => p.field));
    expect(all).toEqual(expect.arrayContaining(['side', 'photos', 'rental.rates']));
    expect(view.items.some((i) => i.expiringSoon && i.moderation?.note === 'Looks fine')).toBe(true);
  });
});

describe('GET /businesses/:id/listings', () => {
  it("lists a seller's public listings newest first, with exclude and limit", async () => {
    const owner = await seller();
    const older = await partOf(owner, 'live', { publishedAt: new Date(Date.now() - 3 * DAY) });
    const newer = await partOf(owner, 'rented', { publishedAt: new Date(Date.now() - DAY) });
    await partOf(owner, 'paused');
    await partOf(owner, 'draft');

    const res = await get(`/businesses/${owner.businessId}/listings`);
    expect(res.statusCode, res.body).toBe(200);
    const cards = res.json().data as ListingCard[];
    expect(cards.map((c) => c.id)).toEqual([newer, older]);
    expect(cards[0]).toMatchObject({ unit: { key: catalog.unitKey }, condition: { key: catalog.conditionKey }, thumbUrl: null });
    for (const k of PRIVATE_KEYS) expect(allKeys(cards).has(k), k).toBe(false);

    expect((await get(`/businesses/${owner.businessId}/listings?exclude=${newer}`)).json().data.map((c: ListingCard) => c.id)).toEqual([older]);
    expect((await get(`/businesses/${owner.businessId}/listings?limit=1`)).json().data).toHaveLength(1);
    expect((await get(`/businesses/${owner.businessId}/listings?limit=51`)).statusCode).toBe(400);
  });

  it('gives distances to a signed-in viewer with a pin', async () => {
    const owner = await seller();
    const viewer = await seller({ point: { lat: 21.17, lng: 72.83 } });
    await partOf(owner, 'live', { point: { lat: 21.188, lng: 72.83 } });
    const cards = (await get(`/businesses/${owner.businessId}/listings`, viewer.token)).json().data as ListingCard[];
    expect(cards[0]!.distanceKm).toBe(2);
  });
});
