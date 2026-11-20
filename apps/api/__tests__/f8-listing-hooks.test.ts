import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { ListingKind, ListingStatus } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { appSettings, listings, machineModels, partRequestReplies, partRequestWork } from '../src/db/schema.js';
import { setMyLocation } from '../src/services/business/profile.service.js';
import { syncReservation } from '../src/services/deals/holds.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { createTestBrand, createTestCatalog, deleteTestBrands, deleteTestCatalog, type TestCatalog } from './_helpers/test-catalog.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { insertTestDeal } from './_helpers/test-deals.js';
import {
  createTestMachineUnit,
  createTestSeller,
  deleteTestSellerExtras,
  deleteTestUnits,
  insertTestListing,
  type TestListingOptions,
  type TestSeller,
} from './_helpers/test-listings.js';
import { insertTestPartRequest, insertTestReply } from './_helpers/test-part-requests.js';

// F8 listing hooks (plan C0-4a, spec §8.1, §9.3): every way a part or machine listing goes live, removed or rejected
// queues exactly one unclaimed `listing_changed` row in its transaction; match-irrelevant edits and rentals queue none;
// a draft made from a request shows and drops its pending reply.

let app: FastifyInstance;
let catalog: TestCatalog;
let machineUnit: { id: string; key: string };
let brand: { id: string };
let modelA: string;
let modelB: string;
let admin: { id: string; token: string };
let s: TestSeller;
let buyer: TestBusinessUser;
const sellers: TestSeller[] = [];

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const act = (id: string, action: string) =>
  app.inject({ method: 'POST', url: `/listings/${id}/actions`, headers: auth(s.token), payload: { action } });
const adminPost = (id: string, path: string, payload: object = {}) =>
  app.inject({ method: 'POST', url: `/admin/listings/${id}/${path}`, headers: auth(admin.token), payload });
const versionOf = async (id: string) => (await db.select({ v: listings.version }).from(listings).where(eq(listings.id, id)))[0]!.v;

const listingOf = (status: ListingStatus, kind: ListingKind = 'part', extra: Partial<TestListingOptions> = {}) =>
  insertTestListing(db, {
    businessId: s.businessId,
    userId: s.userId,
    kind,
    status,
    categoryId: kind === 'part' ? catalog.partGroupId : catalog.machineTypeId,
    side: kind === 'part' ? 'left' : null,
    unitId: kind === 'part' ? catalog.unitId : machineUnit.id,
    conditionId: kind === 'machine_rental' ? null : catalog.conditionId,
    quantity: kind === 'part' ? '10' : '1',
    ...(kind === 'part' ? {} : { machine: { brandId: brand.id, modelId: modelA } }),
    returnStatus: status === 'hidden' || status === 'pending_review' ? 'live' : null,
    ...extra,
  }).then((r) => r.id);

/** Unclaimed `listing_changed` rows of the listing. */
const queued = async (id: string) =>
  (
    await db
      .select({ id: partRequestWork.id })
      .from(partRequestWork)
      .where(and(eq(partRequestWork.subjectId, id), eq(partRequestWork.kind, 'listing_changed'), isNull(partRequestWork.claimedAt)))
  ).length;
const clearWork = (ids: string[]) => db.delete(partRequestWork).where(inArray(partRequestWork.subjectId, ids));

beforeAll(async () => {
  app = await buildApp({ logger: false });
  catalog = await createTestCatalog();
  machineUnit = await createTestMachineUnit();
  brand = await createTestBrand();
  const models = await db
    .insert(machineModels)
    .values([
      { brandId: brand.id, machineTypeId: catalog.machineTypeId, key: 'f8a', name: 'F8 A' },
      { brandId: brand.id, machineTypeId: catalog.machineTypeId, key: 'f8b', name: 'F8 B' },
    ])
    .returning({ id: machineModels.id });
  [modelA, modelB] = [models[0]!.id, models[1]!.id];
  admin = await createTestAdmin('moderator');
  s = await createTestSeller({ gst: true, machineCategoryId: catalog.categoryId });
  sellers.push(s);
  buyer = await createTestBusinessUser();
  // Publish, resume, renew and relist land live (no first-listings review).
  await db.insert(appSettings).values({ key: 'listing_review_first_n', value: 0 }).onConflictDoUpdate({ target: appSettings.key, set: { value: 0 } });
});

afterAll(async () => {
  await db.delete(appSettings).where(eq(appSettings.key, 'listing_review_first_n'));
  await deleteTestBusinesses([...sellers.map((x) => x.businessId), buyer?.businessId].filter(Boolean) as string[]);
  await deleteTestSellerExtras(sellers);
  await deleteTestAdmins([admin?.id].filter(Boolean) as string[]);
  await db.delete(machineModels).where(inArray(machineModels.id, [modelA, modelB].filter(Boolean)));
  await deleteTestBrands([brand?.id].filter(Boolean) as string[]);
  await deleteTestCatalog(catalog.categoryId);
  if (machineUnit) await deleteTestUnits([machineUnit.id]);
  await app?.close();
});

describe('status moves queue one row', () => {
  let id: string;
  const start = async (status: ListingStatus, kind: ListingKind = 'part', extra: Partial<TestListingOptions> = {}) => {
    id = await listingOf(status, kind, extra);
    await clearWork([id]);
    expect(await queued(id)).toBe(0);
  };

  beforeEach(() => {
    id = '';
  });

  it('publish straight to live', async () => {
    await start('draft');
    const res = await app.inject({ method: 'POST', url: `/listings/${id}/publish`, headers: auth(s.token) });
    expect(res.json().data.outcome).toBe('live');
    expect(await queued(id)).toBe(1);
  });

  it('admin approve', async () => {
    await start('pending_review');
    expect((await adminPost(id, 'approve', { version: await versionOf(id) })).statusCode).toBe(200);
    expect(await queued(id)).toBe(1);
  });

  it.each([
    ['resume', 'paused'],
    ['renew', 'live'],
    ['relist', 'sold'],
    ['remove', 'live'],
  ] as const)('seller %s', async (action, from) => {
    await start(from);
    const res = await act(id, action);
    expect(res.statusCode).toBe(200);
    expect(await queued(id)).toBe(1);
  });

  it('admin unhide, admin remove, moderation reject', async () => {
    await start('hidden');
    expect((await adminPost(id, 'unhide')).statusCode).toBe(200);
    expect(await queued(id)).toBe(1);
    await start('live');
    expect((await adminPost(id, 'remove', { reason: 'Test removal reason' })).statusCode).toBe(200);
    expect(await queued(id)).toBe(1);
    await start('pending_review');
    expect((await adminPost(id, 'reject', { version: await versionOf(id), reason: 'Test reject reason' })).statusCode).toBe(200);
    expect(await queued(id)).toBe(1);
  });

  it('bulk admin remove of two listings → one row each', async () => {
    const ids = [await listingOf('live'), await listingOf('live')];
    await clearWork(ids);
    const res = await app.inject({
      method: 'POST', url: '/admin/listings/bulk', headers: auth(admin.token), payload: { action: 'remove', ids, reason: 'Test bulk reason' },
    });
    expect(res.json().data.done).toHaveLength(2);
    for (const x of ids) expect(await queued(x)).toBe(1);
  });

  it('unreserve after an F6 deal cancel', async () => {
    await start('live');
    const deal = await insertTestDeal({ listing: { id }, buyer, quantity: '10', pricePerUnitPaise: 100_000 });
    await db.transaction((tx) => syncReservation(tx, id));
    expect((await db.select({ st: listings.status }).from(listings).where(eq(listings.id, id)))[0]!.st).toBe('reserved');
    await clearWork([id]);
    const res = await app.inject({
      method: 'POST', url: `/deals/${deal.dealId}/cancel`, headers: auth(buyer.token), payload: { reason: 'no_longer_needed' },
    });
    expect(res.statusCode).toBe(200);
    expect(await queued(id)).toBe(1);
  });

  it('a machine rental going live and a pause queue nothing', async () => {
    await start('pending_review', 'machine_rental', { machine: { brandOther: 'Local make' }, priceModel: null, pricePaise: null });
    expect((await adminPost(id, 'approve', { version: await versionOf(id) })).statusCode).toBe(200);
    expect(await queued(id)).toBe(0);
    await start('live');
    expect((await act(id, 'pause')).statusCode).toBe(200);
    expect(await queued(id)).toBe(0);
  });

  it('publish then resume before any claim → still one row', async () => {
    await start('draft');
    await app.inject({ method: 'POST', url: `/listings/${id}/publish`, headers: auth(s.token) });
    await act(id, 'pause');
    expect((await act(id, 'resume')).statusCode).toBe(200);
    expect(await queued(id)).toBe(1);
  });
});

describe('edits of a live listing', () => {
  const patch = (id: string, body: object) => app.inject({ method: 'PATCH', url: `/listings/${id}`, headers: auth(s.token), payload: body });
  const fresh = async (kind: ListingKind = 'part') => {
    const id = await listingOf('live', kind);
    await clearWork([id]);
    return id;
  };

  it('title → one; description → none', async () => {
    const a = await fresh();
    expect((await patch(a, { title: 'F8 hooks temple roller left' })).statusCode).toBe(200);
    expect(await queued(a)).toBe(1);
    const b = await fresh();
    expect((await patch(b, { description: 'Only the description changed' })).statusCode).toBe(200);
    expect(await queued(b)).toBe(0);
  });

  it('quantity from fully held to more → one', async () => {
    const id = await fresh();
    await insertTestDeal({ listing: { id }, buyer, quantity: '10', pricePerUnitPaise: 100_000 });
    await db.transaction((tx) => syncReservation(tx, id));
    await clearWork([id]);
    expect((await patch(id, { quantity: '15' })).statusCode).toBe(200);
    expect(await queued(id)).toBe(1);
  });

  it('its own location → one', async () => {
    const id = await fresh();
    const res = await patch(id, { location: { source: 'godown', pincode: '990011', city: 'Surat', state: 'Gujarat', industrialAreaOther: 'F8 Godown', lat: 21.2, lng: 72.9 } });
    expect(res.statusCode).toBe(200);
    expect(await queued(id)).toBe(1);
  });

  it("an admin PATCH of the side → one; a machine's model change → one", async () => {
    const id = await fresh();
    const res = await app.inject({
      method: 'PATCH', url: `/admin/listings/${id}`, headers: auth(admin.token), payload: { version: await versionOf(id), side: 'right' },
    });
    expect(res.statusCode).toBe(200);
    expect(await queued(id)).toBe(1);
    const m = await fresh('machine');
    expect((await patch(m, { machine: { brandId: brand.id, modelId: modelB } })).statusCode).toBe(200);
    expect(await queued(m)).toBe(1);
  });
});

describe('setMyLocation', () => {
  it('queues each live listing of the business, none of its drafts', async () => {
    const x = await createTestSeller({ gst: true, machineCategoryId: catalog.categoryId });
    sellers.push(x);
    const mk = (status: ListingStatus) =>
      insertTestListing(db, {
        businessId: x.businessId, userId: x.userId, kind: 'part', status, categoryId: catalog.partGroupId, side: 'left',
        unitId: catalog.unitId, conditionId: catalog.conditionId, quantity: '5',
      }).then((r) => r.id);
    const live = [await mk('live'), await mk('live')];
    const draft = await mk('draft');
    await clearWork([...live, draft]);
    await setMyLocation(db, x.userId, { pincode: '990011', city: 'Surat', state: 'Gujarat', industrialAreaOther: 'F8 Estate', lat: 21.25, lng: 72.85 });
    for (const l of live) expect(await queued(l)).toBe(1);
    expect(await queued(draft)).toBe(0);
  });
});

describe('a draft made from a request', () => {
  it('shows its pending reply (name masked) and drops it with the draft', async () => {
    const request = await insertTestPartRequest({
      businessId: buyer.businessId, userId: buyer.userId, categoryId: catalog.machineTypeId, unitId: catalog.unitId,
      name: 'Temple roller call 9876543210',
    });
    const draft = await listingOf('draft');
    const reply = await insertTestReply({ partRequestId: request.id, sellerBusinessId: s.businessId, listingId: draft, userId: s.userId, status: 'pending' });

    const owner = await app.inject({ method: 'GET', url: `/listings/${draft}/owner`, headers: auth(s.token) });
    const view = owner.json().data;
    expect(view.partRequestId).toBe(request.id);
    expect(view.pendingRequestReply.partRequestId).toBe(request.id);
    expect(view.pendingRequestReply.name).not.toContain('9876543210');

    expect((await app.inject({ method: 'DELETE', url: `/listings/${draft}`, headers: auth(s.token) })).statusCode).toBe(200);
    expect(await db.select().from(partRequestReplies).where(eq(partRequestReplies.id, reply.id))).toHaveLength(0);
    expect(await db.select().from(listings).where(eq(listings.id, draft))).toHaveLength(0);
  });
});


