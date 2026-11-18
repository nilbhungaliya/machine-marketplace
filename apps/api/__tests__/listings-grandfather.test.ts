import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, inArray, sql } from 'drizzle-orm';
import type { ListingOwnerView } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { brands, categories, conditions, listingStatusHistory, listings, machineModels, templateFields, units } from '../src/db/schema.js';
import { createTestBrand, createTestCatalog, deleteTestBrands, deleteTestCatalog, type TestBrand, type TestCatalog } from './_helpers/test-catalog.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import {
  createTestSeller,
  deleteTestListings,
  deleteTestSellerExtras,
  deleteTestUnits,
  insertTestListing,
  type TestListingOptions,
  type TestSeller,
} from './_helpers/test-listings.js';

// Grandfathering (F2 spec §7.3, R42) and flags on edit (R16), plan Task 7 step 2: a non-draft PATCH checks only what it
// changes, so catalogue changes never block an unrelated edit; a changed field meets today's rules; edits that raise a
// flag or touch side / fit under an open report send a public listing back to review.

let app: FastifyInstance;
let catalog: TestCatalog;
let seller: TestSeller;
let reporter: TestSeller;
const sellers: TestSeller[] = [];
let partBrand: TestBrand;
let machineBrand: TestBrand;
let modelA = '';
let modelB = '';
const unitIds: string[] = [];
const conditionIds: string[] = [];
let groupSeq = 0;

const auth = (s: TestSeller) => ({ authorization: `Bearer ${s.token}` });
const patch = (id: string, body: unknown) =>
  app.inject({ method: 'PATCH', url: `/listings/${id}`, headers: auth(seller), payload: body as object });

async function rowOf(id: string) {
  const [row] = await db.select().from(listings).where(eq(listings.id, id));
  return row!;
}

/** A part group of its own under the test loom, so a test can change it without touching the others. */
async function group(opts: { hasSides?: boolean | null } = {}): Promise<string> {
  const slug = `gf-group-${groupSeq++}`;
  const [row] = await db
    .insert(categories)
    .values({
      parentId: catalog.machineTypeId, level: 'part_group', name: `GF Group ${slug}`, slug,
      path: `${catalog.categorySlug}/test-loom/${slug}`, hasSides: opts.hasSides ?? null,
    })
    .returning({ id: categories.id });
  return row!.id;
}

const live = (extra: Partial<TestListingOptions> = {}) =>
  insertTestListing(db, {
    businessId: seller.businessId,
    userId: seller.userId,
    kind: 'part',
    categoryId: catalog.partGroupId,
    unitId: catalog.unitId,
    conditionId: catalog.conditionId,
    quantity: '10',
    ...extra,
  }).then((r) => r.id);

async function openReport(listingId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO reports (target_type, target_id, reporter_user_id, reporter_business_id, reason)
    VALUES ('listing', ${listingId}, ${reporter.userId}, ${reporter.businessId}, 'wrong_side_or_fit')`);
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  catalog = await createTestCatalog();
  seller = await createTestSeller({ machineCategoryId: catalog.categoryId });
  reporter = await createTestSeller({ machineCategoryId: catalog.categoryId });
  sellers.push(seller, reporter);
  partBrand = await createTestBrand({ makesParts: true });
  machineBrand = await createTestBrand();
  const [a] = await db.insert(machineModels).values({ brandId: machineBrand.id, machineTypeId: catalog.machineTypeId, key: 'gfa', name: 'GF A' }).returning({ id: machineModels.id });
  const [b] = await db.insert(machineModels).values({ brandId: machineBrand.id, machineTypeId: catalog.machineTypeId, key: 'gfb', name: 'GF B' }).returning({ id: machineModels.id });
  modelA = a!.id;
  modelB = b!.id;
});

afterAll(async () => {
  await deleteTestBusinesses(sellers.map((s) => s.businessId));
  await deleteTestSellerExtras(sellers);
  await deleteTestBrands([partBrand, machineBrand].filter(Boolean).map((x) => x.id));
  await deleteTestCatalog(catalog.categoryId);
  await deleteTestUnits(unitIds);
  if (conditionIds.length) await db.delete(conditions).where(inArray(conditions.id, conditionIds));
});

describe('grandfathered references', () => {
  it('accepts a price edit after the category, part brand, unit and condition were deactivated', async () => {
    const groupId = await group();
    const brand = await createTestBrand({ makesParts: true });
    const [unit] = await db.insert(units).values({ key: `gf_unit_${catalog.suffix}`, label: 'GF unit', decimals: 0 }).returning({ id: units.id });
    const [cond] = await db.insert(conditions).values({ key: `gf_cond_${catalog.suffix}`, label: 'GF cond' }).returning({ id: conditions.id });
    unitIds.push(unit!.id);
    conditionIds.push(cond!.id);
    const id = await live({ categoryId: groupId, partBrandId: brand.id, unitId: unit!.id, conditionId: cond!.id });
    try {
      await db.update(categories).set({ isActive: false }).where(eq(categories.id, groupId));
      await db.update(brands).set({ isActive: false, makesParts: false }).where(eq(brands.id, brand.id));
      await db.update(units).set({ isActive: false }).where(eq(units.id, unit!.id));
      await db.update(conditions).set({ isActive: false }).where(eq(conditions.id, cond!.id));

      const res = await patch(id, { pricePaise: 120_000, quantity: '8' });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data).toMatchObject({ pricePaise: 120_000, quantity: '8', status: 'live' });
      const row = await rowOf(id);
      expect(row.version).toBe(2);
      expect(row.refreshedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
      // Re-sending the same (now inactive) references is not a change.
      expect((await patch(id, { partBrandId: brand.id, unitId: unit!.id, conditionId: cond!.id })).statusCode).toBe(200);
      // A changed reference meets today's rules.
      expect((await patch(id, { conditionId: catalog.conditionId })).statusCode).toBe(200);
      const back = await patch(id, { conditionId: cond!.id });
      expect(back.statusCode).toBe(400);
    } finally {
      await deleteTestListings(db, [id]);
      await deleteTestBrands([brand.id]);
    }
  });

  it('keeps a left side on a node whose sides were switched off; a side change must suit the node now', async () => {
    const groupId = await group({ hasSides: true });
    const id = await live({ categoryId: groupId, side: 'left' });
    await db.update(categories).set({ hasSides: false }).where(eq(categories.id, groupId));

    const qty = await patch(id, { quantity: '5' });
    expect(qty.statusCode, qty.body).toBe(200);
    expect((qty.json().data as ListingOwnerView).side).toBe('left');

    const right = await patch(id, { side: 'right' });
    expect(right.statusCode).toBe(400);
    expect(right.json().code).toBe('SIDE_NOT_ALLOWED');
    const none = await patch(id, { side: 'not_applicable' });
    expect(none.statusCode, none.body).toBe(200);
    expect((await rowOf(id)).side).toBe('not_applicable');
  });

  it('lets a newly required field pass a price edit but blocks a specs edit that leaves it empty', async () => {
    const groupId = await group();
    const id = await live({ categoryId: groupId, specs: { loom_part_note: 'Wide' } });
    await db.insert(templateFields).values({ categoryId: groupId, key: 'gf_required', label: 'GF required', type: 'text', appliesTo: 'parts', required: true });

    expect((await patch(id, { pricePaise: 90_000 })).statusCode).toBe(200);
    const empty = await patch(id, { specs: { loom_part_note: 'Narrow' } });
    expect(empty.statusCode).toBe(400);
    expect(empty.json()).toMatchObject({ code: 'SPECS_INVALID', details: { gf_required: 'required' } });
    const filled = await patch(id, { specs: { loom_part_note: 'Narrow', gf_required: 'Yes' } });
    expect(filled.statusCode, filled.body).toBe(200);
  });

  it('passes an unchanged fitment row with a deactivated model alongside a new valid row', async () => {
    const id = await live({ fitments: [{ brandId: machineBrand.id, modelId: modelA, yearFrom: 2010, yearTo: 2015 }] });
    await db.update(machineModels).set({ isActive: false }).where(eq(machineModels.id, modelA));
    try {
      const res = await patch(id, {
        fitments: [
          { brandId: machineBrand.id, modelId: modelA, yearFrom: 2010, yearTo: 2015 },
          { brandId: machineBrand.id, modelId: modelB },
        ],
      });
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json().data as ListingOwnerView).fitments).toHaveLength(2);
      // The same model with other years is a changed row: today's rules apply.
      const changed = await patch(id, { fitments: [{ brandId: machineBrand.id, modelId: modelA, yearFrom: 2011, yearTo: 2015 }] });
      expect(changed.statusCode).toBe(400);
      expect(changed.json()).toMatchObject({ code: 'FITMENT_INVALID', details: { index: 0 } });
    } finally {
      await db.update(machineModels).set({ isActive: true }).where(eq(machineModels.id, modelA));
    }
  });
});

describe('what a non-draft edit refuses', () => {
  it('locks the category after review (CATEGORY_LOCKED) but not on a rejected listing', async () => {
    const id = await live();
    const res = await patch(id, { categoryId: catalog.motorsGroupId });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('CATEGORY_LOCKED');
    // The same category is not a change.
    expect((await patch(id, { categoryId: catalog.partGroupId })).statusCode).toBe(200);

    const rejected = await live({ status: 'rejected' });
    const ok = await patch(rejected, { categoryId: catalog.motorsGroupId });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await rowOf(rejected)).categoryId).toBe(catalog.motorsGroupId);
  });

  it('refuses a zero quantity', async () => {
    expect((await patch(await live(), { quantity: '0' })).statusCode).toBe(400);
  });

  it('refuses removing the price of a fixed-price listing (LISTING_INCOMPLETE)', async () => {
    const id = await live();
    const res = await patch(id, { pricePaise: null });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'LISTING_INCOMPLETE', details: { problems: [{ field: 'pricePaise', code: 'PRICE_REQUIRED' }] } });
    expect((await patch(id, { delivery: [] })).json().code).toBe('LISTING_INCOMPLETE');
    // GST mode is required unless Price on request (§4.6).
    const noGst = await patch(id, { gstMode: null });
    expect(noGst.statusCode).toBe(400);
    expect(noGst.json()).toMatchObject({ code: 'LISTING_INCOMPLETE', details: { problems: [{ field: 'gstMode', code: 'required' }] } });
    // Switching to Price on request removes the price legitimately.
    expect((await patch(id, { priceModel: 'on_request' })).statusCode).toBe(200);
  });

  it('refuses leaving Price on request without a GST mode', async () => {
    const id = await live({ priceModel: 'on_request', pricePaise: null, gstMode: null });
    const res = await patch(id, { priceModel: 'fixed', pricePaise: 100_000 });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'LISTING_INCOMPLETE', details: { problems: [{ field: 'gstMode', code: 'required' }] } });
    expect((await patch(id, { priceModel: 'fixed', pricePaise: 100_000, gstMode: 'included' })).statusCode).toBe(200);
  });
});

describe('an edit that changes nothing', () => {
  it('writes nothing: no version bump, no refresh (an autosave never stales a moderator decision)', async () => {
    const id = await live({ refreshedAt: new Date(Date.now() - 86_400_000) });
    const before = await rowOf(id);
    const res = await patch(id, { pricePaise: 100_000, quantity: '10.000', delivery: ['pickup'], location: { source: 'business' } });
    expect(res.statusCode, res.body).toBe(200);
    const after = await rowOf(id);
    expect(after.version).toBe(before.version);
    expect(after.refreshedAt!.getTime()).toBe(before.refreshedAt!.getTime());
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());

    // A real change still bumps it once.
    expect((await patch(id, { pricePaise: 110_000 })).statusCode).toBe(200);
    expect((await rowOf(id)).version).toBe(before.version + 1);
  });

  it('does not bump a draft re-sent the same step', async () => {
    const { id } = await insertTestListing(db, {
      businessId: seller.businessId, userId: seller.userId, kind: 'part', status: 'draft', categoryId: catalog.partGroupId,
      fitments: [{ brandId: machineBrand.id, modelId: modelB }],
    });
    const step = { title: 'Temple roller', fitments: [{ brandId: machineBrand.id, modelId: modelB }] };
    expect((await patch(id, step)).statusCode).toBe(200);
    const v = (await rowOf(id)).version;
    expect((await patch(id, step)).statusCode).toBe(200);
    expect((await rowOf(id)).version).toBe(v);
  });
});

describe('flags and reports on edit (R16)', () => {
  it('sends a live listing edited to ₹4 back to review (edit_flagged, return_status live)', async () => {
    const id = await live();
    const res = await patch(id, { pricePaise: 400 });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data).toMatchObject({ status: 'pending_review', flags: ['price_check'], reviewReasons: ['edit_flagged'] });
    const row = await rowOf(id);
    expect(row.returnStatus).toBe('live');
    const history = await db.select().from(listingStatusHistory).where(eq(listingStatusHistory.listingId, id));
    expect(history).toEqual([expect.objectContaining({ fromStatus: 'live', toStatus: 'pending_review', action: 'back_to_review', actor: 'system' })]);
  });

  it('keeps a live listing live when the flag was accepted by a moderator', async () => {
    const id = await live({ pricePaise: 400, flags: ['price_check'], acceptedFlags: ['price_check'] });
    const res = await patch(id, { pricePaise: 300 });
    expect(res.json().data).toMatchObject({ status: 'live', flags: ['price_check'] });
  });

  it('stores the flag on a paused listing without moving it (the gate catches it)', async () => {
    const id = await live({ status: 'paused' });
    const res = await patch(id, { pricePaise: 400 });
    expect(res.json().data).toMatchObject({ status: 'paused', flags: ['price_check'] });
  });

  it('adds the reason to a listing already in review', async () => {
    const id = await live({ status: 'pending_review', reviewReasons: ['first_listings'] });
    const res = await patch(id, { pricePaise: 400 });
    expect(res.json().data).toMatchObject({ status: 'pending_review' });
    expect([...(await rowOf(id)).reviewReasons].sort()).toEqual(['edit_flagged', 'first_listings']);
  });

  it('sends a side edit back to review while a report is open (edited_after_report), not without one', async () => {
    const quiet = await live({ side: 'left' });
    const calm = await patch(quiet, { side: 'right' });
    expect(calm.json().data).toMatchObject({ status: 'live', side: 'right' });

    const id = await live({ side: 'left' });
    await openReport(id);
    const priceOnly = await patch(id, { pricePaise: 110_000 });
    expect(priceOnly.json().data).toMatchObject({ status: 'live', reviewOnEdit: true });

    const res = await patch(id, { side: 'right' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data).toMatchObject({ status: 'pending_review', reviewReasons: ['edited_after_report'] });
    expect((await rowOf(id)).returnStatus).toBe('live');
  });

  it('sends a fitment edit back to review while a report is open', async () => {
    const id = await live({ fitments: [{ brandId: machineBrand.id }] });
    await openReport(id);
    const res = await patch(id, { fitments: [{ brandId: machineBrand.id, modelId: modelB }] });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data).toMatchObject({ status: 'pending_review', reviewReasons: ['edited_after_report'] });
  });
});

