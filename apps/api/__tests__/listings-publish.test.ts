import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, inArray, sql } from 'drizzle-orm';
import type { ListingOwnerView } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { appSettings, businesses, categories, listingStatusHistory, listings, machineModels, templateFields } from '../src/db/schema.js';
import { applyAdminTransition, publishListing } from '../src/services/listings/listing-lifecycle.service.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { createTestBrand, createTestCatalog, deleteTestBrands, deleteTestCatalog, type TestBrand, type TestCatalog } from './_helpers/test-catalog.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import {
  createTestMachineUnit,
  createTestSeller,
  deleteTestSellerExtras,
  deleteTestUnits,
  insertTestListing,
  type TestListingOptions,
  type TestSeller,
} from './_helpers/test-listings.js';

// Completeness, the go-live gate and publish (F2 plan Task 8, spec §5.5 and amendment 5): one test per gate row and
// action. Sellers are per test group so the per-user publish limit (30 / 10 min) is never reached.

let app: FastifyInstance;
let catalog: TestCatalog;
let machineBrand: TestBrand;
let modelA = '';
let machineUnit: { id: string; key: string };
let admin: { id: string; token: string };
const sellers: TestSeller[] = [];
let requiredGroupId = '';

const auth = (s: TestSeller) => ({ authorization: `Bearer ${s.token}` });
const publish = (s: TestSeller, id: string) => app.inject({ method: 'POST', url: `/listings/${id}/publish`, headers: auth(s) });
const action = (s: TestSeller, id: string, body: object) =>
  app.inject({ method: 'POST', url: `/listings/${id}/actions`, headers: auth(s), payload: body });
const patch = (s: TestSeller, id: string, body: object) =>
  app.inject({ method: 'PATCH', url: `/listings/${id}`, headers: auth(s), payload: body });

async function rowOf(id: string) {
  const [row] = await db.select().from(listings).where(eq(listings.id, id));
  return row!;
}

async function seller(opts: Parameters<typeof createTestSeller>[0] = {}): Promise<TestSeller> {
  const s = await createTestSeller({ machineCategoryId: catalog.categoryId, ...opts });
  sellers.push(s);
  return s;
}

/** A complete part listing (default a draft) on the Motors group (no sides, no required specs). */
const partOf = (s: TestSeller, extra: Partial<TestListingOptions> = {}) =>
  insertTestListing(db, {
    businessId: s.businessId,
    userId: s.userId,
    kind: 'part',
    status: 'draft',
    categoryId: catalog.motorsGroupId,
    unitId: catalog.unitId,
    conditionId: catalog.conditionId,
    quantity: '10',
    ...extra,
  }).then((r) => r.id);

async function openReport(listingId: string, by: TestSeller): Promise<void> {
  await db.execute(sql`
    INSERT INTO reports (target_type, target_id, reporter_user_id, reporter_business_id, reason)
    VALUES ('listing', ${listingId}, ${by.userId}, ${by.businessId}, 'wrong_side_or_fit')`);
}

async function setSetting(key: string, value: number): Promise<void> {
  await db.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } });
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  catalog = await createTestCatalog();
  machineBrand = await createTestBrand();
  const [a] = await db
    .insert(machineModels)
    .values({ brandId: machineBrand.id, machineTypeId: catalog.machineTypeId, key: 'puba', name: 'Pub A' })
    .returning({ id: machineModels.id });
  modelA = a!.id;
  machineUnit = await createTestMachineUnit();
  admin = await createTestAdmin('moderator');
  // A part group with sides (inherited from the loom) and a required spec field.
  const [g] = await db
    .insert(categories)
    .values({
      parentId: catalog.machineTypeId, level: 'part_group', name: 'Pub Required', slug: 'pub-required',
      path: `${catalog.categorySlug}/test-loom/pub-required`,
    })
    .returning({ id: categories.id });
  requiredGroupId = g!.id;
  await db.insert(templateFields).values({ categoryId: requiredGroupId, key: 'pub_bore', label: 'Bore', type: 'text', appliesTo: 'parts', required: true });
});

afterEach(async () => {
  await db.delete(appSettings).where(inArray(appSettings.key, ['listing_review_first_n', 'unverified_listing_cap']));
});

afterAll(async () => {
  await deleteTestBusinesses(sellers.map((s) => s.businessId));
  await deleteTestSellerExtras(sellers);
  await deleteTestAdmins([admin?.id].filter(Boolean) as string[]);
  await deleteTestBrands([machineBrand?.id].filter(Boolean) as string[]);
  await deleteTestCatalog(catalog.categoryId);
  if (machineUnit) await deleteTestUnits([machineUnit.id]);
  await app?.close();
});

describe('completeness', () => {
  it('lists every problem at once: photo, side, price, required spec', async () => {
    const s = await seller({ gst: true });
    const id = await partOf(s, { categoryId: requiredGroupId, side: 'not_applicable', photos: 0, pricePaise: null });
    const res = await publish(s, id);
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().code).toBe('LISTING_INCOMPLETE');
    expect(res.json().details.problems).toEqual(
      expect.arrayContaining([
        { field: 'photos', code: 'required' },
        { field: 'side', code: 'SIDE_REQUIRED' },
        { field: 'pricePaise', code: 'PRICE_REQUIRED' },
        { field: 'specs.pub_bore', code: 'required' },
      ]),
    );
    expect((await rowOf(id)).status).toBe('draft');
  });

  it('names the missing basics of an empty draft', async () => {
    const s = await seller({ gst: true });
    const { id } = await insertTestListing(db, {
      businessId: s.businessId, userId: s.userId, kind: 'part', status: 'draft', categoryId: null, photos: 0,
      priceModel: null, pricePaise: null, gstMode: null, delivery: [],
    });
    const res = await publish(s, id);
    expect(res.statusCode).toBe(400);
    expect(res.json().details.problems).toEqual(
      expect.arrayContaining([
        { field: 'categoryId', code: 'required' },
        { field: 'unitId', code: 'required' },
        { field: 'conditionId', code: 'required' },
        { field: 'delivery', code: 'required' },
        { field: 'priceModel', code: 'required' },
      ]),
    );
  });

  it('refuses a draft whose category was deactivated since (CATEGORY_INVALID)', async () => {
    const s = await seller({ gst: true });
    const [g] = await db
      .insert(categories)
      .values({
        parentId: catalog.machineTypeId, level: 'part_group', name: 'Pub Retired', slug: 'pub-retired', hasSides: false,
        path: `${catalog.categorySlug}/test-loom/pub-retired`, isActive: false,
      })
      .returning({ id: categories.id });
    const id = await partOf(s, { categoryId: g!.id });
    const res = await publish(s, id);
    expect(res.statusCode).toBe(400);
    expect(res.json().details.problems).toContainEqual({ field: 'categoryId', code: 'CATEGORY_INVALID' });
  });

  it('asks a rental with no rate for one (RATE_REQUIRED) and a machine for its make', async () => {
    const s = await seller({ gst: true });
    const { id } = await insertTestListing(db, {
      businessId: s.businessId, userId: s.userId, kind: 'machine_rental', status: 'draft', categoryId: catalog.machineTypeId,
      unitId: machineUnit.id, rental: { rateDayPaise: null },
    });
    const res = await publish(s, id);
    expect(res.statusCode).toBe(400);
    expect(res.json().details.problems).toEqual(
      expect.arrayContaining([
        { field: 'rental.rates', code: 'RATE_REQUIRED' },
        { field: 'machine.brandId', code: 'required' },
      ]),
    );
    expect(res.json().details.problems).not.toContainEqual({ field: 'conditionId', code: 'required' });
  });

  it('skips the photo rule with the dev switch (R31)', async () => {
    const s = await seller({ gst: true });
    await setSetting('listing_review_first_n', 0);
    const id = await partOf(s, { photos: 0 });
    process.env.LISTING_MEDIA_OPTIONAL = 'true';
    try {
      const res = await publish(s, id);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data.outcome).toBe('live');
    } finally {
      process.env.LISTING_MEDIA_OPTIONAL = 'false';
    }
  });

  it('refuses a business whose onboarding is no longer done (409 ONBOARDING_INCOMPLETE)', async () => {
    const s = await seller({ gst: true });
    const id = await partOf(s);
    await db.update(businesses).set({ pincode: null }).where(eq(businesses.id, s.businessId));
    const res = await publish(s, id);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('ONBOARDING_INCOMPLETE');
  });

  it("answers 404 for another business's draft and 409 for a live listing", async () => {
    const s = await seller();
    const other = await seller();
    const id = await partOf(s);
    expect((await publish(other, id)).statusCode).toBe(404);
    const live = await partOf(s, { status: 'live' });
    const res = await publish(s, live);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'LISTING_TRANSITION_NOT_ALLOWED', details: { from: 'live', action: 'publish' } });
  });
});

describe('the gate: verified business', () => {
  it('reviews the first three listings (first_listings), then publishes the fourth live', async () => {
    const s = await seller({ gst: true });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await partOf(s);
      ids.push(id);
      const res = await publish(s, id);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data).toMatchObject({ outcome: 'pending_review', listing: { status: 'pending_review', reviewReasons: ['first_listings'] } });
    }
    // Still in review, none went live: the next one is reviewed too.
    expect((await publish(s, await partOf(s))).json().data.outcome).toBe('pending_review');
    await db.update(listings).set({ firstLiveAt: sql`now()` }).where(inArray(listings.id, ids));
    const fourth = await publish(s, await partOf(s));
    expect(fourth.json().data).toMatchObject({ outcome: 'live', listing: { status: 'live', reviewReasons: [] } });
  });

  it('publishes live at once with listing_review_first_n = 0', async () => {
    const s = await seller({ gst: true });
    await setSetting('listing_review_first_n', 0);
    const res = await publish(s, await partOf(s));
    expect(res.json().data.outcome).toBe('live');
  });

  it('reviews a ₹4 part (price_check) even past the first listings', async () => {
    const s = await seller({ gst: true });
    await setSetting('listing_review_first_n', 0);
    const res = await publish(s, await partOf(s, { pricePaise: 400 }));
    expect(res.json().data).toMatchObject({ outcome: 'pending_review', listing: { reviewReasons: ['price_check'], flags: ['price_check'] } });
  });

  it('writes the status with one history row, published_at, refreshed_at, and first_live_at only when live', async () => {
    const s = await seller({ gst: true });
    const reviewed = await partOf(s);
    expect((await publish(s, reviewed)).statusCode).toBe(200);
    const r = await rowOf(reviewed);
    expect(r.publishedAt).not.toBeNull();
    expect(r.refreshedAt).not.toBeNull();
    expect(r.firstLiveAt).toBeNull();
    expect(r.returnStatus).toBeNull();
    const history = await db.select().from(listingStatusHistory).where(eq(listingStatusHistory.listingId, reviewed));
    expect(history).toEqual([
      expect.objectContaining({ fromStatus: 'draft', toStatus: 'pending_review', action: 'publish', actor: 'seller', userId: s.userId }),
    ]);

    await setSetting('listing_review_first_n', 0);
    const live = await partOf(s);
    expect((await publish(s, live)).json().data.outcome).toBe('live');
    const l = await rowOf(live);
    expect(l.firstLiveAt).not.toBeNull();
    expect(l.publishedAt).not.toBeNull();
    expect(l.refreshedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('reviews a resubmission from rejected (resubmitted) and keeps its first published_at', async () => {
    const s = await seller({ gst: true });
    await setSetting('listing_review_first_n', 0);
    const publishedAt = new Date(Date.now() - 5 * 86_400_000);
    const id = await partOf(s, { status: 'rejected', publishedAt, moderationOutcome: 'changes_requested' });
    const res = await publish(s, id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data).toMatchObject({ outcome: 'pending_review', listing: { reviewReasons: ['resubmitted'] } });
    expect((await rowOf(id)).publishedAt!.getTime()).toBe(publishedAt.getTime());
  });
});

describe('the gate: unverified business', () => {
  it('reviews every publish (unverified_seller) and refuses the fourth open listing; a sold one does not count', async () => {
    const s = await seller();
    for (let i = 0; i < 3; i++) {
      const res = await publish(s, await partOf(s));
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data).toMatchObject({ outcome: 'pending_review', listing: { reviewReasons: ['unverified_seller'] } });
    }
    await partOf(s, { status: 'sold' });
    const fourth = await partOf(s);
    const res = await publish(s, fourth);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'UNVERIFIED_LISTING_CAP', details: { cap: 3 } });
    expect((await rowOf(fourth)).status).toBe('draft');
  });

  it('lets exactly one of two concurrent publishes at cap − 1 through', async () => {
    const s = await seller();
    await partOf(s, { status: 'live' });
    await partOf(s, { status: 'paused' });
    const [a, b] = [await partOf(s), await partOf(s)];
    const results = await Promise.all([publish(s, a), publish(s, b)]);
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([200, 409]);
    expect(results.find((r) => r.statusCode === 409)!.json().code).toBe('UNVERIFIED_LISTING_CAP');
  });

  it('makes a second publish wait for the business lock, then refuses it at the cap (service level)', async () => {
    const s = await seller();
    await partOf(s, { status: 'live' });
    await partOf(s, { status: 'paused' });
    const [a, b] = [await partOf(s), await partOf(s)];
    const user = { userId: s.userId, businessId: s.businessId };

    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    let published!: () => void;
    const aPublished = new Promise<void>((resolve) => (published = resolve));
    // A publishes (the third open listing) and keeps its transaction, and so the business lock, open.
    const txA = db.transaction(async (tx) => {
      const result = await publishListing(tx, user, a);
      published();
      await hold;
      return result;
    });
    await aPublished;

    let settled = false;
    const txB = db
      .transaction((tx) => publishListing(tx, user, b))
      .then(
        (r) => r,
        (e: unknown) => e,
      )
      .finally(() => {
        settled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(settled).toBe(false);

    release();
    expect((await txA).outcome).toBe('pending_review');
    expect(await txB).toMatchObject({ statusCode: 409, code: 'UNVERIFIED_LISTING_CAP', details: { cap: 3 } });
    expect((await rowOf(a)).status).toBe('pending_review');
    expect((await rowOf(b)).status).toBe('draft');
  });

  it('refuses a rental from a business without GST (403 RENTAL_NEEDS_GST)', async () => {
    const s = await seller();
    const { id } = await insertTestListing(db, {
      businessId: s.businessId, userId: s.userId, kind: 'machine_rental', status: 'draft', categoryId: catalog.machineTypeId,
      unitId: machineUnit.id, machine: { brandOther: 'Local make' },
    });
    const res = await publish(s, id);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('RENTAL_NEEDS_GST');
  });
});

describe('amendment 5: an edit after a report, off view', () => {
  it('remembers a side edit on a paused listing with an open report; resume goes to review; approval clears it', async () => {
    const s = await seller({ gst: true });
    const reporter = await seller();
    const id = await partOf(s, { status: 'paused', categoryId: catalog.partGroupId, side: 'left' });
    await openReport(id, reporter);

    const edited = await patch(s, id, { side: 'right' });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json().data).toMatchObject({ status: 'paused', reviewReasons: ['edited_after_report'] });

    const resumed = await action(s, id, { action: 'resume' });
    expect(resumed.statusCode, resumed.body).toBe(200);
    expect(resumed.json().data).toMatchObject({ outcome: 'pending_review', listing: { reviewReasons: ['edited_after_report'] } });
    expect((await rowOf(id)).returnStatus).toBe('live');

    const approved = await db.transaction(async (tx) => applyAdminTransition(tx, admin.id, await rowOf(id), 'approve'));
    expect(approved).toMatchObject({ status: 'live', reviewReasons: [], returnStatus: null });
  });

  it('sends renew of an expired listing to review after a fitment edit under an open report', async () => {
    const s = await seller({ gst: true });
    const reporter = await seller();
    const id = await partOf(s, { status: 'expired', fitments: [{ brandId: machineBrand.id }] });
    await openReport(id, reporter);
    expect((await patch(s, id, { fitments: [{ brandId: machineBrand.id, modelId: modelA }] })).statusCode).toBe(200);
    expect((await rowOf(id)).reviewReasons).toEqual(['edited_after_report']);

    const renewed = await action(s, id, { action: 'renew' });
    expect(renewed.statusCode, renewed.body).toBe(200);
    expect(renewed.json().data).toMatchObject({ outcome: 'pending_review', listing: { reviewReasons: ['edited_after_report'] } });
  });

  it("sends relist and a rented listing's renew to review while it is set", async () => {
    const s = await seller({ gst: true });
    const sold = await partOf(s, { status: 'sold', reviewReasons: ['edited_after_report'] });
    expect((await action(s, sold, { action: 'relist' })).json().data).toMatchObject({ outcome: 'pending_review' });
    const { id: rented } = await insertTestListing(db, {
      businessId: s.businessId, userId: s.userId, kind: 'machine_rental', status: 'rented', categoryId: catalog.machineTypeId,
      unitId: machineUnit.id, machine: { brandOther: 'Local make' }, reviewReasons: ['edited_after_report'],
    });
    const ended = await action(s, rented, { action: 'renew' });
    expect(ended.json().data).toMatchObject({ outcome: 'pending_review', listing: { reviewReasons: ['edited_after_report'] } });
  });

  it('resumes live after the same edit without an open report', async () => {
    const s = await seller({ gst: true });
    const id = await partOf(s, { status: 'paused', categoryId: catalog.partGroupId, side: 'left' });
    const edited = await patch(s, id, { side: 'right' });
    expect(edited.json().data).toMatchObject({ status: 'paused', reviewReasons: [] });
    const resumed = await action(s, id, { action: 'resume' });
    expect(resumed.json().data).toMatchObject({ outcome: 'live', listing: { status: 'live', side: 'right' } });
  });
});

describe('POST /listings/:id/publish', () => {
  it('needs a signed-in user', async () => {
    const s = await seller();
    const id = await partOf(s);
    expect((await app.inject({ method: 'POST', url: `/listings/${id}/publish` })).statusCode).toBe(401);
    expect((await publish(s, 'not-a-uuid')).statusCode).toBe(400);
  });

  it('returns the owner view', async () => {
    const s = await seller({ gst: true });
    const res = await publish(s, await partOf(s));
    const view = res.json().data.listing as ListingOwnerView;
    expect(view).toMatchObject({ isOwner: true, status: 'pending_review' });
  });
});
