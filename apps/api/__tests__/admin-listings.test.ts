import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { AdminListingDetail, AdminListingList, ListingKind, ListingStatus } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { businesses, reports } from '../src/db/schema.js';
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

// All listings and the review screen's detail (F2 plan Task 16, spec §11.2, §11.4, §11.6): every filter, the business
// filter's name, search by `#ref`, part number and name, page sizes, roles, and the private fields admins see. Lists
// are scoped to this suite's business (or its own catalogue / city) because other suites share the database.

let app: FastifyInstance;
let catalog: TestCatalog;
let machineUnit: { id: string; key: string };
let moderator: { id: string; token: string };
let support: { id: string; token: string };
let officer: { id: string; token: string };
const sellers: TestSeller[] = [];

let main: TestSeller;
let other: TestSeller;
const ids: Record<string, string> = {};
const refs: Record<string, number> = {};
const CITY = `Testpur ${Date.now()}`;
const TRADE = `Zylo Bearings ${Date.now()}`;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const get = (url: string, token = moderator.token) => app.inject({ method: 'GET', url, headers: auth(token) });
const list = async (query: string, token = moderator.token): Promise<AdminListingList> => {
  const res = await get(`/admin/listings?${query}`, token);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().data;
};
const idsOf = (l: AdminListingList) => l.rows.map((r) => r.id).sort();
const sorted = (...keys: string[]) => keys.map((k) => ids[k]!).sort();

async function seller(opts: Parameters<typeof createTestSeller>[0] = {}): Promise<TestSeller> {
  const s = await createTestSeller({ machineCategoryId: catalog.categoryId, ...opts });
  sellers.push(s);
  return s;
}

async function add(key: string, s: TestSeller, status: ListingStatus, kind: ListingKind = 'part', extra: Partial<TestListingOptions> = {}) {
  const r = await insertTestListing(db, {
    businessId: s.businessId,
    userId: s.userId,
    kind,
    status,
    categoryId: kind === 'part' ? catalog.motorsGroupId : catalog.machineTypeId,
    unitId: kind === 'part' ? catalog.unitId : machineUnit.id,
    conditionId: kind === 'machine_rental' ? null : catalog.conditionId,
    quantity: kind === 'part' ? '10' : '1',
    ...(kind === 'part' ? {} : { machine: { brandOther: 'Local make' } }),
    ...extra,
  });
  ids[key] = r.id;
  refs[key] = r.ref;
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  catalog = await createTestCatalog();
  machineUnit = await createTestMachineUnit();
  moderator = await createTestAdmin('moderator');
  support = await createTestAdmin('support');
  officer = await createTestAdmin('verification_officer');
  main = await seller({ gst: true });
  other = await seller();
  await db.update(businesses).set({ tradeName: TRADE }).where(eq(businesses.id, main.businessId));

  await add('livePart', main, 'live', 'part', { title: 'Warp beam flange', partNumber: 'TP-200L', side: 'left', city: CITY, flags: ['price_check'] });
  await add('pausedPart', main, 'paused', 'part', { title: 'Heald frame', side: 'right' });
  await add('soldMachine', main, 'sold', 'machine', { title: 'Rapier loom 190' });
  await add('rental', main, 'live', 'machine_rental', { title: 'Loom for rent', rental: { rateDayPaise: null, rateWeekPaise: 2_000_000 } });
  await add('draft', main, 'draft', 'part', { title: 'Draft part' });
  await add('reported', main, 'live', 'part', { title: 'Shuttle', flags: ['quantity_check'] });
  await add('otherLive', other, 'live', 'part', { title: 'Other seller part', city: CITY });
  await db.insert(reports).values({
    targetType: 'listing', targetId: ids.reported!, reporterUserId: other.userId, reporterBusinessId: other.businessId, reason: 'stock_photos',
  });
});

afterAll(async () => {
  await deleteTestBusinesses(sellers.map((s) => s.businessId));
  await deleteTestSellerExtras(sellers);
  await deleteTestAdmins([moderator?.id, support?.id, officer?.id].filter(Boolean) as string[]);
  if (catalog) await deleteTestCatalog(catalog.categoryId);
  if (machineUnit) await deleteTestUnits([machineUnit.id]);
  await app?.close();
});

describe('GET /admin/listings', () => {
  it('filters by business (every status but draft by default) and names the business', async () => {
    const l = await list(`businessId=${main.businessId}`);
    expect(idsOf(l)).toEqual(sorted('livePart', 'pausedPart', 'soldMachine', 'rental', 'reported'));
    expect(l.business).toEqual({ id: main.businessId, name: TRADE });
    expect(l).toMatchObject({ total: 5, page: 1, pageSize: 25 });
    expect((await list('')).business).toBeNull();
    const unknown = await list(`businessId=${randomUUID()}`);
    expect(unknown).toMatchObject({ rows: [], total: 0, business: null });
  });

  it('builds rows with category path, seller, price or rate, flags and open reports', async () => {
    const l = await list(`businessId=${main.businessId}`);
    const byId = new Map(l.rows.map((r) => [r.id, r]));
    expect(byId.get(ids.livePart!)).toMatchObject({
      ref: refs.livePart, title: 'Warp beam flange', kind: 'part', status: 'live', side: 'left', city: CITY,
      categoryPath: [catalog.categoryName, 'Test Loom', 'Test Motors'], business: { id: main.businessId, name: TRADE },
      priceModel: 'fixed', pricePaise: 100_000, rate: null, flags: ['price_check'], openReports: 0,
    });
    expect(byId.get(ids.rental!)).toMatchObject({ rate: { period: 'week', paise: 2_000_000 }, categoryPath: [catalog.categoryName, 'Test Loom'] });
    expect(byId.get(ids.reported!)).toMatchObject({ openReports: 1 });
  });

  it('filters by status (comma list, drafts on request), kind, side, flags and open reports', async () => {
    const b = `businessId=${main.businessId}`;
    expect(idsOf(await list(`${b}&status=live,draft`))).toEqual(sorted('livePart', 'rental', 'draft', 'reported'));
    expect(idsOf(await list(`${b}&kind=machine`))).toEqual(sorted('soldMachine'));
    expect(idsOf(await list(`${b}&side=right`))).toEqual(sorted('pausedPart'));
    expect(idsOf(await list(`${b}&flags=price_check,quantity_check`))).toEqual(sorted('livePart', 'reported'));
    expect(idsOf(await list(`${b}&reported=1`))).toEqual(sorted('reported'));
    expect((await get(`/admin/listings?status=live,bogus`)).statusCode).toBe(400);
  });

  it('filters by machine category and by city (any case)', async () => {
    const byRoot = await list(`machineCategoryId=${catalog.categoryId}&pageSize=100`);
    expect(idsOf(byRoot)).toEqual(sorted('livePart', 'pausedPart', 'soldMachine', 'rental', 'reported', 'otherLive'));
    expect(idsOf(await list(`city=${encodeURIComponent(CITY.toUpperCase())}`))).toEqual(sorted('livePart', 'otherLive'));
  });

  it('searches by #ref, by part number with spaces, by title and by business name', async () => {
    const b = `businessId=${main.businessId}`;
    expect(idsOf(await list(`${b}&q=${encodeURIComponent(`#${refs.soldMachine}`)}`))).toEqual(sorted('soldMachine'));
    expect(idsOf(await list(`q=${encodeURIComponent(`#${refs.otherLive}`)}`))).toEqual(sorted('otherLive'));
    expect(idsOf(await list(`${b}&q=${encodeURIComponent('tp 200')}`))).toEqual(sorted('livePart'));
    expect(idsOf(await list(`${b}&q=heald`))).toEqual(sorted('pausedPart'));
    expect(idsOf(await list(`q=${encodeURIComponent(TRADE.toLowerCase())}&pageSize=50`))).toEqual(
      sorted('livePart', 'pausedPart', 'soldMachine', 'rental', 'reported'),
    );
  });

  it('pages with 25, 50 or 100 a page and refuses other sizes', async () => {
    const l = await list(`businessId=${main.businessId}&pageSize=50&page=2`);
    expect(l).toMatchObject({ rows: [], total: 5, page: 2, pageSize: 50 });
    expect((await get('/admin/listings?pageSize=30')).statusCode).toBe(400);
    expect((await get('/admin/listings?nope=1')).statusCode).toBe(400);
  });

  it('lets support read, and refuses a verification officer', async () => {
    expect(idsOf(await list(`businessId=${other.businessId}`, support.token))).toEqual(sorted('otherLive'));
    expect((await get('/admin/listings', officer.token)).statusCode).toBe(403);
  });
});

describe('GET /admin/listings/:id', () => {
  it('shows private fields, the seller panel, reports and history, to moderators and support', async () => {
    const s = await seller({ gst: true });
    const { id } = await insertTestListing(db, {
      businessId: s.businessId, userId: s.userId, kind: 'machine', status: 'live', categoryId: catalog.machineTypeId,
      unitId: machineUnit.id, conditionId: catalog.conditionId, machine: { brandOther: 'Local make', serialNumber: 'SN-ADMIN-42' },
      locationSource: 'godown', pincode: '990016', addressLine: 'Shed 4, Ring Road', point: { lat: 21.2, lng: 72.8 },
    });
    await insertTestListing(db, { businessId: s.businessId, userId: s.userId, kind: 'part', status: 'sold', categoryId: catalog.motorsGroupId, unitId: catalog.unitId });
    await insertTestListing(db, { businessId: s.businessId, userId: s.userId, kind: 'part', status: 'draft', categoryId: catalog.motorsGroupId, unitId: catalog.unitId });
    await insertTestHistory(db, { listingId: id, from: 'pending_review', to: 'live', action: 'approve', actor: 'admin', adminId: moderator.id });
    await db.insert(reports).values({
      targetType: 'listing', targetId: id, reporterUserId: other.userId, reporterBusinessId: other.businessId, reason: 'advance_payment', details: 'Asked for 50% upfront',
    });

    for (const token of [moderator.token, support.token]) {
      const res = await get(`/admin/listings/${id}`, token);
      expect(res.statusCode, res.body).toBe(200);
      const d: AdminListingDetail = res.json().data;
      expect(d.listing.machine?.serialNumber).toBe('SN-ADMIN-42');
      expect(d.listing.location).toMatchObject({ addressLine: 'Shed 4, Ring Road', pincode: '990016', lat: 21.2, lng: 72.8 });
      expect(d.listing).toMatchObject({ id, status: 'live', returnStatus: null });
      expect(d.listing.firstLiveAt).not.toBeNull();
      expect(d.sideConvention).toBe('Seen by the weaver');
      expect(d.seller).toMatchObject({
        businessId: s.businessId, gstVerified: true, ownerStatus: 'active',
        listingsByStatus: { live: 1, sold: 1, draft: 1 }, everLive: 2,
      });
      expect(d.reports).toEqual([
        expect.objectContaining({ reason: 'advance_payment', details: 'Asked for 50% upfront', status: 'open', reporter: { businessId: other.businessId, businessName: expect.any(String) } }),
      ]);
      expect(d.history).toEqual([expect.objectContaining({ action: 'approve', actor: 'admin', adminName: 'Test Admin', toStatus: 'live' })]);
    }
  });

  it('is 404 for an unknown listing and 403 for a verification officer', async () => {
    expect((await get(`/admin/listings/${randomUUID()}`)).statusCode).toBe(404);
    expect((await get(`/admin/listings/${ids.livePart}`, officer.token)).statusCode).toBe(403);
  });
});
