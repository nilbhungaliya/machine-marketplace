import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { ListingStatus } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { deals, listings } from '../src/db/schema.js';
import type { TxApp } from '../src/lib/tx-effects.js';
import { cancelAgreedDealsForRemovedListing } from '../src/services/deals/deal-cancel.js';
import { releaseHold } from '../src/services/deals/holds.js';
import { runListingExpiry } from '../src/services/listings/listing-jobs.service.js';
import { reconcileOffersForListing } from '../src/services/offers/reconcile.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { createTestCatalog, deleteTestCatalog, type TestCatalog } from './_helpers/test-catalog.js';
import { assertHeldInvariant, insertTestDeal, insertTestOffer, insertTestThread } from './_helpers/test-deals.js';
import {
  createTestMachineUnit,
  createTestSeller,
  deleteTestSellerExtras,
  deleteTestUnits,
  insertTestListing,
  type TestListingOptions,
  type TestSeller,
} from './_helpers/test-listings.js';

// Every listing writer reconciles and syncs; the holds guards on edits and seller actions (plan C1-2, spec §8.3, §22,
// §27 4, 21, 24). Reconcile (L2) and the admin-removal cancel (L3) are recorded, not run.

vi.mock('../src/services/offers/reconcile.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/services/offers/reconcile.js')>();
  return { ...real, reconcileOffersForListing: vi.fn(async () => undefined) };
});
vi.mock('../src/services/deals/deal-cancel.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/services/deals/deal-cancel.js')>();
  return { ...real, cancelAgreedDealsForRemovedListing: vi.fn(async () => undefined) };
});
vi.mock('../src/lib/storage.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/storage.js')>();
  return { ...real, deletePublicObject: vi.fn(async () => undefined), deleteObject: vi.fn(async () => undefined) };
});

const reconcile = vi.mocked(reconcileOffersForListing);
const cancelAgreed = vi.mocked(cancelAgreedDealsForRemovedListing);

const MEDIA_ENV: Record<string, string> = {
  AWS_S3_ENDPOINT: 'http://127.0.0.1:9',
  AWS_REGION: 'auto',
  AWS_ACCESS_KEY_ID: 'test-key',
  AWS_SECRET_ACCESS_KEY: 'test-secret',
  AWS_S3_PRIVATE_BUCKET: 'test-private',
  AWS_S3_PUBLIC_BUCKET: 'test-public',
  MEDIA_PUBLIC_BASE_URL: 'https://media.example.test',
};

let app: FastifyInstance;
let catalog: TestCatalog;
let otherUnit: { id: string; key: string };
let seller: TestSeller;
let buyer: TestBusinessUser;
let moderator: { id: string; token: string };
const jobApp = { db, log: { warn: () => undefined } } as unknown as TxApp;
const DAY = 24 * 60 * 60 * 1000;

const sellerAuth = () => ({ authorization: `Bearer ${seller.token}` });
const adminAuth = () => ({ authorization: `Bearer ${moderator.token}` });
const act = (id: string, action: string) =>
  app.inject({ method: 'POST', url: `/listings/${id}/actions`, headers: sellerAuth(), payload: { action } });
const patch = (id: string, body: object) => app.inject({ method: 'PATCH', url: `/listings/${id}`, headers: sellerAuth(), payload: body });
const admin = (id: string, path: string, body: object = {}) =>
  app.inject({ method: 'POST', url: `/admin/listings/${id}/${path}`, headers: adminAuth(), payload: body });

async function listingOf(extra: Partial<TestListingOptions> = {}): Promise<{ id: string; mediaIds: string[] }> {
  return insertTestListing(db, {
    businessId: seller.businessId,
    userId: seller.userId,
    kind: 'part',
    categoryId: catalog.motorsGroupId,
    unitId: catalog.unitId,
    conditionId: catalog.conditionId,
    quantity: '5',
    ...extra,
  });
}
const idOf = (extra: Partial<TestListingOptions> = {}) => listingOf(extra).then((l) => l.id);

async function rowOf(id: string) {
  const [row] = await db.select().from(listings).where(eq(listings.id, id));
  return row!;
}

const dealOf = (listingId: string, quantity: string) =>
  insertTestDeal({ listing: { id: listingId }, buyer, quantity, pricePerUnitPaise: 100_000 });

/** How many times reconcile ran for this listing since the last reset. */
const reconciled = (listingId: string) => reconcile.mock.calls.filter((c) => c[1] === listingId).length;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  catalog = await createTestCatalog();
  otherUnit = await createTestMachineUnit();
  seller = await createTestSeller({ machineCategoryId: catalog.categoryId });
  buyer = await createTestBusinessUser();
  moderator = await createTestAdmin('moderator');
});

afterAll(async () => {
  await deleteTestBusinesses([seller?.businessId, buyer?.businessId].filter(Boolean) as string[]);
  if (seller) await deleteTestSellerExtras([seller]);
  await deleteTestAdmins([moderator?.id].filter(Boolean) as string[]);
  if (catalog) await deleteTestCatalog(catalog.categoryId);
  if (otherUnit) await deleteTestUnits([otherUnit.id]);
  await app?.close();
});

beforeEach(() => {
  reconcile.mockClear();
  cancelAgreed.mockClear();
});

describe('every listing writer reconciles once (§22)', () => {
  const writers: Array<[string, (id: string) => Promise<void>, Partial<TestListingOptions>]> = [
    ['seller pause', async (id) => void expect((await act(id, 'pause')).statusCode).toBe(200), {}],
    ['seller resume', async (id) => void expect((await act(id, 'resume')).statusCode).toBe(200), { status: 'paused' }],
    [
      'publish from rejected',
      async (id) => void expect((await app.inject({ method: 'POST', url: `/listings/${id}/publish`, headers: sellerAuth() })).statusCode).toBe(200),
      { status: 'rejected' },
    ],
    [
      'patch back to review (quantity flag)',
      async (id) => void expect((await patch(id, { quantity: '200000' })).statusCode).toBe(200),
      {},
    ],
    [
      'admin approve',
      async (id) => void expect((await admin(id, 'approve', { version: (await rowOf(id)).version })).statusCode).toBe(200),
      { status: 'pending_review' },
    ],
    ['admin hide', async (id) => void expect((await admin(id, 'hide', { reason: 'Checking it' })).statusCode).toBe(200), {}],
    ['admin unhide', async (id) => void expect((await admin(id, 'unhide')).statusCode).toBe(200), { status: 'hidden', returnStatus: 'live' }],
    ['admin remove', async (id) => void expect((await admin(id, 'remove', { reason: 'Not a real part' })).statusCode).toBe(200), {}],
    [
      'admin bulk hide',
      async (id) => {
        const res = await app.inject({
          method: 'POST',
          url: '/admin/listings/bulk',
          headers: adminAuth(),
          payload: { action: 'hide', ids: [id], reason: 'Checking them' },
        });
        expect(res.json().data).toMatchObject({ done: [id], skipped: [] });
      },
      {},
    ],
    [
      'listing expiry job',
      async () => void expect((await runListingExpiry(jobApp, { businessIds: [seller.businessId] })).expired).toBe(1),
      { refreshedAt: new Date(Date.now() - 90 * DAY) },
    ],
  ];

  it.each(writers)('%s', async (_name, write, extra) => {
    const id = await idOf(extra);
    await write(id);
    expect(reconciled(id)).toBe(1);
    await assertHeldInvariant(id);
  });

  it('admin media delete of the last photo (photos_removed)', async () => {
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(MEDIA_ENV)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    try {
      const { id, mediaIds } = await listingOf();
      const res = await app.inject({
        method: 'DELETE',
        url: `/admin/listings/${id}/media/${mediaIds[0]}`,
        headers: adminAuth(),
        payload: { reason: 'Shows a phone number' },
      });
      expect(res.statusCode).toBe(200);
      expect((await rowOf(id)).status).toBe('rejected');
      expect(reconciled(id)).toBe(1);
    } finally {
      for (const k of Object.keys(MEDIA_ENV)) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });
});

describe('edits with stock on hold (§8.3)', () => {
  it('refuses a quantity below the held stock; equal is fine and reserves the listing', async () => {
    const id = await idOf();
    await dealOf(id, '3');
    const below = await patch(id, { quantity: '2' });
    expect(below.statusCode).toBe(409);
    expect(below.json().code).toBe('QUANTITY_BELOW_HELD');

    const equal = await patch(id, { quantity: '3' });
    expect(equal.statusCode).toBe(200);
    expect(equal.json().data.status).toBe('reserved');
    expect((await rowOf(id)).status).toBe('reserved');
    expect(reconciled(id)).toBe(1);
    await assertHeldInvariant(id);
  });

  it("keeps a reserved listing's price and description editable", async () => {
    const id = await idOf({ status: 'reserved', quantity: '2' });
    await dealOf(id, '2');
    const res = await patch(id, { pricePaise: 120_000, description: 'Fresh stock, boxed' });
    expect(res.statusCode).toBe(200);
    const row = await rowOf(id);
    expect([row.status, row.pricePaise, row.description]).toEqual(['reserved', 120_000, 'Fresh stock, boxed']);
    await assertHeldInvariant(id);
  });

  it('locks the unit while a hold or a backup offer is open', async () => {
    const held = await idOf();
    await dealOf(held, '1');
    const a = await patch(held, { unitId: otherUnit.id });
    expect([a.statusCode, a.json().code]).toEqual([409, 'UNIT_LOCKED']);

    const backed = await idOf();
    const thread = await insertTestThread({ listingId: backed, buyerBusinessId: buyer.businessId, buyerUserId: buyer.userId });
    await insertTestOffer({ threadId: thread.id, status: 'backup', pricePerUnitPaise: 90_000, quantity: '1' });
    const b = await patch(backed, { unitId: otherUnit.id });
    expect([b.statusCode, b.json().code]).toEqual([409, 'UNIT_LOCKED']);
    expect((await rowOf(backed)).unitId).toBe(catalog.unitId);
  });

  it('reconciles after a price-model change', async () => {
    const id = await idOf();
    const res = await patch(id, { priceModel: 'negotiable' });
    expect(res.statusCode).toBe(200);
    expect(reconciled(id)).toBe(1);
  });

  it('still refuses a quantity of 0 from the seller', async () => {
    const id = await idOf();
    expect((await patch(id, { quantity: '0' })).statusCode).toBe(400);
  });
});

describe('seller actions and admin removal with open deals (§8.3)', () => {
  it.each(['mark_sold', 'remove'] as const)('%s with stock on hold → LISTING_HAS_OPEN_DEALS with the deal ids', async (action) => {
    const id = await idOf();
    const { dealId } = await dealOf(id, '2');
    const res = await act(id, action);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'LISTING_HAS_OPEN_DEALS', details: { dealIds: [dealId] } });
    expect((await rowOf(id)).status).toBe('live');
    await assertHeldInvariant(id);
  });

  it('mark_sold on a reserved listing says why: LISTING_HAS_OPEN_DEALS, not a refused transition', async () => {
    const id = await idOf({ status: 'reserved', quantity: '2' });
    const { dealId } = await dealOf(id, '2');
    const res = await act(id, 'mark_sold');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'LISTING_HAS_OPEN_DEALS', details: { dealIds: [dealId] } });
  });

  it('admin remove of a fully held reserved listing works when the cancel releases the hold (it unreserves first)', async () => {
    const id = await idOf({ status: 'reserved', quantity: '2' });
    const { dealId } = await dealOf(id, '2');
    cancelAgreed.mockImplementationOnce(async (tx) => releaseHold(tx, dealId));
    const res = await admin(id, 'remove', { reason: 'Not a real part' });
    expect(res.statusCode, res.body).toBe(200);
    const row = await rowOf(id);
    expect([row.status, Number(row.heldQuantity)]).toEqual(['removed', 0]);
    await assertHeldInvariant(id);
  });

  it('admin remove cancels the agreed deals first', async () => {
    const id = await idOf();
    await dealOf(id, '2');
    const res = await admin(id, 'remove', { reason: 'Not a real part' });
    expect(res.statusCode).toBe(200);
    expect(cancelAgreed).toHaveBeenCalledTimes(1);
    expect(cancelAgreed.mock.calls[0]![1]).toBe(id);
    expect(cancelAgreed.mock.calls[0]![2]).toBe(moderator.id);
  });

  it('relist of a sold-out listing needs a quantity first', async () => {
    const id = await idOf({ status: 'sold', quantity: '0' });
    const res = await act(id, 'relist');
    expect([res.statusCode, res.json().code]).toEqual([400, 'QUANTITY_REQUIRED']);
    expect((await rowOf(id)).status).toBe('sold');
  });
});

describe('expiry with holds (§8.3)', () => {
  it('never expires a reserved listing, and expires a live one with a hold (its deal untouched)', async () => {
    const old = new Date(Date.now() - 90 * DAY);
    const reservedId = await idOf({ status: 'reserved', quantity: '2', refreshedAt: old });
    await dealOf(reservedId, '2');
    const liveId = await idOf({ refreshedAt: old });
    const { dealId } = await dealOf(liveId, '2');

    await runListingExpiry(jobApp, { businessIds: [seller.businessId] });
    const statuses: ListingStatus[] = [(await rowOf(reservedId)).status, (await rowOf(liveId)).status];
    expect(statuses).toEqual(['reserved', 'expired']);
    const [deal] = await db.select({ status: deals.status }).from(deals).where(eq(deals.id, dealId));
    expect(deal!.status).toBe('agreed');
    expect(Number((await rowOf(liveId)).heldQuantity)).toBe(2);
    await assertHeldInvariant(reservedId);
    await assertHeldInvariant(liveId);
  });
});
