import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, inArray, sql } from 'drizzle-orm';
import type { ListingOwnerView } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/index.js';
import {
  categories,
  industrialAreas,
  listingFitments,
  listingMachines,
  listingMedia,
  listingStatusHistory,
  listings,
  machineModels,
  pincodeOffices,
  units,
} from '../src/db/schema.js';
import { createListing } from '../src/services/listings/listing-write.service.js';
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

// Listing writes (F2 plan Task 7, spec §4, §5.1, §5.3, §7.3, §14): create, draft PATCH validation and its error codes,
// draft delete, the business location sync, and the catalogue-guard lock (Batch 1 review item 1).

let app: FastifyInstance;
let catalog: TestCatalog;
let loom2Id = '';
let inactiveGroupId = '';
let partBrand: TestBrand;
let machineBrand: TestBrand;
let otherBrand: TestBrand;
let modelLoom = '';
let modelLoom2 = '';
let otherBrandModel = '';
let machineUnit: { id: string; key: string };
let areaSurat = '';
let areaAhmedabad = '';
const officeIds: string[] = [];

let seller: TestSeller;
let rival: TestSeller;
let gstSeller: TestSeller;
let fresh: TestSeller;
let drafter: TestSeller;
let pinless: TestSeller;
let mover: TestSeller;
const sellers: TestSeller[] = [];

const auth = (s: TestSeller) => ({ authorization: `Bearer ${s.token}` });
const create = (s: TestSeller, body: unknown) => app.inject({ method: 'POST', url: '/listings', headers: auth(s), payload: body as object });
const patch = (s: TestSeller, id: string, body: unknown) =>
  app.inject({ method: 'PATCH', url: `/listings/${id}`, headers: auth(s), payload: body as object });
const remove = (s: TestSeller, id: string) => app.inject({ method: 'DELETE', url: `/listings/${id}`, headers: auth(s) });

async function rowOf(id: string) {
  const [row] = await db.select().from(listings).where(eq(listings.id, id));
  return row!;
}

/** A draft written directly (no create rate limit): no category, no photos unless given. */
async function draftOf(s: TestSeller, kind: TestListingOptions['kind'] = 'part', extra: Partial<TestListingOptions> = {}) {
  const { id } = await insertTestListing(db, {
    businessId: s.businessId,
    userId: s.userId,
    kind,
    status: 'draft',
    categoryId: null,
    photos: 0,
    unitId: kind === 'part' ? null : machineUnit.id,
    ...extra,
  });
  return id;
}

async function distanceMetres(id: string, lat: number, lng: number): Promise<number> {
  const { rows } = await db.execute<{ d: number }>(
    sql`SELECT ST_Distance(point, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography) AS d FROM listings WHERE id = ${id}`,
  );
  return Number(rows[0]!.d);
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  catalog = await createTestCatalog();
  const [loom2] = await db
    .insert(categories)
    .values({ parentId: catalog.categoryId, level: 'machine_type', name: 'Test Loom 2', slug: 'test-loom-2', path: `${catalog.categorySlug}/test-loom-2` })
    .returning({ id: categories.id });
  loom2Id = loom2!.id;
  const [inactive] = await db
    .insert(categories)
    .values({
      parentId: catalog.machineTypeId, level: 'part_group', name: 'Test Retired Group', slug: 'test-retired-group',
      path: `${catalog.categorySlug}/test-loom/test-retired-group`, isActive: false,
    })
    .returning({ id: categories.id });
  inactiveGroupId = inactive!.id;

  partBrand = await createTestBrand({ makesParts: true, makesMachines: false });
  machineBrand = await createTestBrand();
  otherBrand = await createTestBrand();
  const model = async (brandId: string, machineTypeId: string, key: string) => {
    const [row] = await db.insert(machineModels).values({ brandId, machineTypeId, key, name: key }).returning({ id: machineModels.id });
    return row!.id;
  };
  modelLoom = await model(machineBrand.id, catalog.machineTypeId, 'zw408');
  modelLoom2 = await model(machineBrand.id, loom2Id, 'zw500');
  otherBrandModel = await model(otherBrand.id, catalog.machineTypeId, 'other1');
  machineUnit = await createTestMachineUnit();

  const [surat] = await db
    .insert(industrialAreas)
    .values({ name: `Write Estate ${catalog.suffix}`, city: 'Surat', state: 'Gujarat' })
    .returning({ id: industrialAreas.id });
  areaSurat = surat!.id;
  const [ahd] = await db
    .insert(industrialAreas)
    .values({ name: `Write Estate ${catalog.suffix}`, city: 'Ahmedabad', state: 'Gujarat' })
    .returning({ id: industrialAreas.id });
  areaAhmedabad = ahd!.id;

  const opts = { machineCategoryId: catalog.categoryId };
  seller = await createTestSeller(opts);
  rival = await createTestSeller(opts);
  gstSeller = await createTestSeller({ ...opts, gst: true });
  fresh = await createTestSeller({ ...opts, onboarded: false });
  drafter = await createTestSeller(opts);
  pinless = await createTestSeller({ ...opts, pincode: '990012', pincodeOffices: [{ lat: 21.0, lng: 72.0 }, { lat: 21.02, lng: 72.02 }] });
  mover = await createTestSeller({ ...opts, pincode: '990013', point: { lat: 21.2, lng: 72.8 } });
  sellers.push(seller, rival, gstSeller, fresh, drafter, pinless, mover);
});

afterAll(async () => {
  await deleteTestBusinesses(sellers.map((s) => s.businessId));
  await deleteTestSellerExtras(sellers);
  if (officeIds.length) await db.delete(pincodeOffices).where(inArray(pincodeOffices.id, officeIds));
  await db.delete(industrialAreas).where(inArray(industrialAreas.id, [areaSurat, areaAhmedabad].filter(Boolean)));
  await deleteTestBrands([partBrand, machineBrand, otherBrand].filter(Boolean).map((b) => b.id));
  await deleteTestCatalog(catalog.categoryId);
  if (machineUnit) await deleteTestUnits([machineUnit.id]);
  await app?.close();
});

describe('POST /listings', () => {
  it('creates a part draft with no side, the business location and a first history row', async () => {
    const res = await create(seller, { kind: 'part' });
    expect(res.statusCode, res.body).toBe(201);
    const view = res.json().data as ListingOwnerView;
    expect(view).toMatchObject({ kind: 'part', status: 'draft', side: 'not_applicable', unitId: null, isOwner: true, version: 1 });
    expect(view.location).toMatchObject({ source: 'business', pincode: '990011', city: 'Surat', state: 'Gujarat', industrialAreaOther: 'Test Estate' });
    expect(view.ref).toBeGreaterThanOrEqual(100001);
    const history = await db.select().from(listingStatusHistory).where(eq(listingStatusHistory.listingId, view.id));
    expect(history).toEqual([expect.objectContaining({ fromStatus: null, toStatus: 'draft', action: 'create', actor: 'seller', userId: seller.userId })]);
    expect((await rowOf(view.id)).refreshedAt).toBeNull();
  });

  it('creates a machine draft with the flagged machine unit and a quantity of 1', async () => {
    const res = await create(seller, { kind: 'machine' });
    expect(res.statusCode, res.body).toBe(201);
    const view = res.json().data as ListingOwnerView;
    expect(view).toMatchObject({ kind: 'machine', unitId: machineUnit.id, quantity: '1', side: null });
    expect(view.machine).toMatchObject({ brandId: null, underPower: false });
  });

  it('refuses a rental from a business without GST and creates one for a verified business', async () => {
    const refused = await create(seller, { kind: 'machine_rental' });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().code).toBe('RENTAL_NEEDS_GST');

    const res = await create(gstSeller, { kind: 'machine_rental' });
    expect(res.statusCode, res.body).toBe(201);
    const view = res.json().data as ListingOwnerView;
    expect(view.rental).toMatchObject({ shiftHours: 8, monthDays: 26, fuel: 'client', rateDayPaise: null });
    expect(view.unitId).toBe(machineUnit.id);
  });

  it('refuses a business that has not finished onboarding', async () => {
    const res = await create(fresh, { kind: 'part' });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('ONBOARDING_INCOMPLETE');
  });

  it('refuses the 21st draft', async () => {
    for (let i = 0; i < 20; i++) await draftOf(drafter);
    const res = await create(drafter, { kind: 'part' });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('DRAFT_LIMIT');
  });

  it('refuses an unknown kind', async () => {
    expect((await create(seller, { kind: 'boat' })).statusCode).toBe(400);
  });

  it('answers NO_MACHINE_UNIT when no active unit is flagged (service level, rolled back)', async () => {
    const rollback = new Error('rollback');
    await expect(
      db.transaction(async (tx) => {
        await tx.update(units).set({ isActive: false }).where(eq(units.isMachineUnit, true));
        await expect(createListing(tx, { userId: seller.userId, businessId: seller.businessId }, { kind: 'machine' })).rejects.toMatchObject({
          statusCode: 409,
          code: 'NO_MACHINE_UNIT',
        });
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    const [still] = await db.select({ isActive: units.isActive }).from(units).where(eq(units.id, machineUnit.id));
    expect(still!.isActive).toBe(true);
  });

  it("gives a business without a pin its pincode's centroid", async () => {
    const res = await create(pinless, { kind: 'part' });
    expect(res.statusCode, res.body).toBe(201);
    const id = (res.json().data as ListingOwnerView).id;
    expect(await distanceMetres(id, 21.01, 72.01)).toBeLessThan(50);
  });
});

describe('PATCH /listings/:id on a draft', () => {
  const expectError = async (res: Awaited<ReturnType<typeof patch>>, status: number, code: string) => {
    expect(res.statusCode, res.body).toBe(status);
    expect(res.json().code).toBe(code);
    return res.json();
  };

  it('saves a step and recomputes the norms, bumping the version but not refreshed_at', async () => {
    const id = await draftOf(seller);
    const res = await patch(seller, id, {
      categoryId: catalog.partGroupId,
      title: '  Temple Roller Left  ',
      partNumber: 'tp-200 L',
      side: 'left',
      partBrandId: partBrand.id,
      unitId: catalog.unitId,
      quantity: '12',
      minOrderQty: '2',
      conditionId: catalog.conditionId,
      specs: { temple_type: 'ring', loom_part_note: 'Fits wide looms' },
      priceModel: 'negotiable',
      pricePaise: 150_000,
      gstMode: 'extra',
      delivery: ['pickup', 'ship', 'pickup'],
      fitments: [{ brandId: machineBrand.id, modelId: modelLoom, yearFrom: 2012, yearTo: 2020, note: 'with tensioner' }],
    });
    expect(res.statusCode, res.body).toBe(200);
    const view = res.json().data as ListingOwnerView;
    expect(view).toMatchObject({
      title: 'Temple Roller Left',
      side: 'left',
      quantity: '12',
      minOrderQty: '2',
      version: 2,
      delivery: ['pickup', 'ship'],
      categoryPath: [catalog.categoryName, 'Test Loom', 'Test Temples'],
    });
    expect(view.fitments).toEqual([expect.objectContaining({ brandId: machineBrand.id, modelId: modelLoom, yearFrom: 2012, yearTo: 2020, source: 'seller' })]);
    const row = await rowOf(id);
    expect(row).toMatchObject({ titleNorm: 'temple roller', partNumberNorm: 'TP200L', partNumberBase: 'TP200', refreshedAt: null });
  });

  it('refuses an inactive category and a node of the wrong level (CATEGORY_INVALID)', async () => {
    const id = await draftOf(seller);
    await expectError(await patch(seller, id, { categoryId: inactiveGroupId }), 400, 'CATEGORY_INVALID');
    await expectError(await patch(seller, id, { categoryId: catalog.machineTypeId }), 400, 'CATEGORY_INVALID');
    const machineId = await draftOf(seller, 'machine');
    await expectError(await patch(seller, machineId, { categoryId: catalog.partGroupId }), 400, 'CATEGORY_INVALID');
  });

  it('refuses a wrong option on a draft (SPECS_INVALID with the errors) but not a missing required field', async () => {
    const id = await draftOf(seller, 'part', { categoryId: catalog.partGroupId });
    const body = await expectError(await patch(seller, id, { specs: { temple_type: 'nope' } }), 400, 'SPECS_INVALID');
    expect(body.details).toEqual({ temple_type: 'invalid_option' });
    await expectError(await patch(seller, await draftOf(seller), { specs: { temple_type: 'ring' } }), 400, 'SPECS_INVALID');
  });

  it('refuses a kind change and a field of another kind', async () => {
    const id = await draftOf(seller);
    await expectError(await patch(seller, id, { kind: 'machine' }), 400, 'KIND_IMMUTABLE');
    await expectError(await patch(seller, id, { rental: { rateDayPaise: 100_000 } }), 400, 'FIELD_NOT_FOR_KIND');
    await expectError(await patch(seller, id, { machine: { year: 2015 } }), 400, 'FIELD_NOT_FOR_KIND');
    const machineId = await draftOf(seller, 'machine');
    await expectError(await patch(seller, machineId, { side: 'left' }), 400, 'FIELD_NOT_FOR_KIND');
    await expectError(await patch(seller, machineId, { unitId: catalog.unitId }), 400, 'FIELD_NOT_FOR_KIND');
    const rentalId = await draftOf(gstSeller, 'machine_rental');
    await expectError(await patch(gstSeller, rentalId, { pricePaise: 100_000 }), 400, 'FIELD_NOT_FOR_KIND');
    await expectError(await patch(gstSeller, rentalId, { machine: { reasonForSale: 'Upgrading' } }), 400, 'FIELD_NOT_FOR_KIND');
  });

  it('refuses a part brand that does not make parts (BRAND_INVALID)', async () => {
    const id = await draftOf(seller);
    await expectError(await patch(seller, id, { partBrandId: machineBrand.id }), 400, 'BRAND_INVALID');
    expect((await patch(seller, id, { partBrandId: partBrand.id })).statusCode).toBe(200);
  });

  it('refuses a machine model of another machine type (MODEL_INVALID)', async () => {
    const id = await draftOf(seller, 'machine', { categoryId: catalog.machineTypeId });
    await expectError(await patch(seller, id, { machine: { brandId: machineBrand.id, modelId: modelLoom2 } }), 400, 'MODEL_INVALID');
    await expectError(await patch(seller, id, { machine: { brandId: machineBrand.id, modelId: otherBrandModel } }), 400, 'MODEL_INVALID');
    await expectError(await patch(seller, id, { machine: { brandId: partBrand.id } }), 400, 'BRAND_INVALID');
    const res = await patch(seller, id, { machine: { brandId: machineBrand.id, modelId: modelLoom, year: 2015, serialNumber: 'SN-9' } });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json().data as ListingOwnerView).machine).toMatchObject({ brandId: machineBrand.id, modelId: modelLoom, year: 2015, serialNumber: 'SN-9' });
    // "Other" make text replaces the catalogue brand.
    const other = await patch(seller, id, { machine: { brandOther: 'Local make', modelOther: 'Mk 2' } });
    expect(other.statusCode, other.body).toBe(200);
    expect((other.json().data as ListingOwnerView).machine).toMatchObject({ brandId: null, brandOther: 'Local make', modelId: null, modelOther: 'Mk 2' });
  });

  it('refuses a fitment model of another brand with the row index, and accepts a model of another machine type', async () => {
    const id = await draftOf(seller, 'part', { categoryId: catalog.partGroupId });
    const body = await expectError(
      await patch(seller, id, {
        fitments: [
          { brandId: machineBrand.id, modelId: modelLoom2 },
          { brandId: machineBrand.id, modelId: otherBrandModel },
        ],
      }),
      400,
      'FITMENT_INVALID',
    );
    expect(body.details).toMatchObject({ index: 1 });
    await expectError(await patch(seller, id, { fitments: [{ brandId: partBrand.id }] }), 400, 'FITMENT_INVALID');
    await expectError(await patch(seller, id, { fitments: [{ brandId: machineBrand.id, yearFrom: 2020, yearTo: 2010 }] }), 400, 'FITMENT_INVALID');
    const ok = await patch(seller, id, { fitments: [{ brandId: machineBrand.id, modelId: modelLoom2 }, { brandId: otherBrand.id }] });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((ok.json().data as ListingOwnerView).fitments).toHaveLength(2);
  });

  it('refuses more decimals than the unit allows (UNIT_DECIMALS) and a min order above the quantity', async () => {
    const id = await draftOf(seller);
    await expectError(await patch(seller, id, { unitId: catalog.unitId, quantity: '1.5' }), 400, 'UNIT_DECIMALS');
    await expectError(await patch(seller, id, { unitId: catalog.unitId, quantity: '10', minOrderQty: '20' }), 400, 'MIN_ORDER_ABOVE_QUANTITY');
    expect((await patch(seller, id, { unitId: catalog.unitId, quantity: '10', minOrderQty: '10' })).statusCode).toBe(200);
    await expectError(await patch(seller, id, { quantity: '5' }), 400, 'MIN_ORDER_ABOVE_QUANTITY');
  });

  it('refuses a side on a node without sides (SIDE_NOT_ALLOWED)', async () => {
    const id = await draftOf(seller);
    await expectError(await patch(seller, id, { categoryId: catalog.motorsGroupId, side: 'left' }), 400, 'SIDE_NOT_ALLOWED');
    expect((await patch(seller, id, { categoryId: catalog.motorsGroupId, side: 'not_applicable' })).statusCode).toBe(200);
  });

  it("refuses a godown area outside the pincode's district (AREA_MISMATCH) and keeps the address private to the owner", async () => {
    const id = await draftOf(seller);
    const godown = { source: 'godown', pincode: '990012', city: 'Surat', state: 'Gujarat' };
    await expectError(await patch(seller, id, { location: { ...godown, industrialAreaId: areaAhmedabad } }), 400, 'AREA_MISMATCH');
    const res = await patch(seller, id, { location: { ...godown, industrialAreaId: areaSurat, addressLine: 'Shed 4' } });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json().data as ListingOwnerView).location).toMatchObject({
      source: 'godown', pincode: '990012', industrialAreaId: areaSurat, addressLine: 'Shed 4',
    });
    // No pin: the godown pincode's centroid.
    expect(await distanceMetres(id, 21.01, 72.01)).toBeLessThan(50);
    // With a pin: the pin.
    expect((await patch(seller, id, { location: { ...godown, industrialAreaOther: 'Back lane', lat: 21.5, lng: 72.5 } })).statusCode).toBe(200);
    expect(await distanceMetres(id, 21.5, 72.5)).toBeLessThan(1);
    // Back to the business address.
    const back = await patch(seller, id, { location: { source: 'business' } });
    expect((back.json().data as ListingOwnerView).location).toMatchObject({ source: 'business', pincode: '990011', addressLine: null, industrialAreaOther: 'Test Estate' });
  });

  it('refuses a 2-character title and an empty patch', async () => {
    const id = await draftOf(seller);
    expect((await patch(seller, id, { title: 'ab' })).statusCode).toBe(400);
    expect((await patch(seller, id, {})).statusCode).toBe(400);
    expect((await patch(seller, id, { quantity: '0' })).statusCode).toBe(400);
  });

  it('refuses a listing that is not editable (hidden)', async () => {
    const { id } = await insertTestListing(db, { businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: catalog.partGroupId, status: 'hidden' });
    await expectError(await patch(seller, id, { title: 'Temple roller' }), 409, 'LISTING_NOT_EDITABLE');
  });

  it("answers 404 for another business's listing", async () => {
    const id = await draftOf(seller);
    await expectError(await patch(rival, id, { title: 'Temple roller' }), 404, 'LISTING_NOT_FOUND');
  });

  it('drops spec keys foreign to the new category and resets the side', async () => {
    const id = await draftOf(seller);
    const first = await patch(seller, id, { categoryId: catalog.partGroupId, side: 'left', specs: { temple_type: 'ring', loom_part_note: 'Wide' } });
    expect(first.statusCode, first.body).toBe(200);
    const res = await patch(seller, id, { categoryId: catalog.motorsGroupId });
    expect(res.statusCode, res.body).toBe(200);
    const view = res.json().data as ListingOwnerView;
    expect(view.specs).toEqual({ loom_part_note: 'Wide' });
    expect(view.side).toBe('not_applicable');
  });

  it('clears the price when the model becomes Price on request', async () => {
    const id = await draftOf(seller);
    const res = await patch(seller, id, { priceModel: 'on_request', pricePaise: 50_000 });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json().data as ListingOwnerView).pricePaise).toBeNull();
  });

  it('saves rental terms and refuses a past available-from date', async () => {
    const id = await draftOf(gstSeller, 'machine_rental');
    const res = await patch(gstSeller, id, {
      rental: { rateDayPaise: 400_000, rateHourPaise: 60_000, operator: 'mandatory', operatorRateDayPaise: 80_000, fuel: 'per_litre', serviceRadiusKm: 50 },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json().data as ListingOwnerView).rental).toMatchObject({ rateDayPaise: 400_000, operator: 'mandatory', operatorRateDayPaise: 80_000 });
    const past = await patch(gstSeller, id, { rental: { availableFrom: '2020-01-01' } });
    expect(past.statusCode).toBe(400);
    const included = await patch(gstSeller, id, { rental: { operator: 'included' } });
    expect((included.json().data as ListingOwnerView).rental).toMatchObject({ operator: 'included', operatorRateDayPaise: null });
  });

  it('waits behind a catalogue guard holding the model and validates the moved model (Batch 1 review item 1)', async () => {
    const id = await draftOf(seller, 'machine', { categoryId: catalog.machineTypeId });
    const [m] = await db
      .insert(machineModels)
      .values({ brandId: machineBrand.id, machineTypeId: catalog.machineTypeId, key: `moving${catalog.suffix}`, name: `Moving ${catalog.suffix}` })
      .returning({ id: machineModels.id });
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM machine_models WHERE id = $1 FOR UPDATE', [m!.id]);
      let settled = false;
      const pending = patch(seller, id, { machine: { brandId: machineBrand.id, modelId: m!.id } }).finally(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(settled).toBe(false);
      // The guard moves the model to another machine type, then commits.
      await holder.query('UPDATE machine_models SET machine_type_id = $1 WHERE id = $2', [loom2Id, m!.id]);
      await holder.query('COMMIT');
      const res = await pending;
      expect(res.statusCode, res.body).toBe(400);
      expect(res.json().code).toBe('MODEL_INVALID');
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
    }
  });
});

describe('DELETE /listings/:id', () => {
  it('deletes a draft with its children', async () => {
    const id = await draftOf(seller, 'part', { photos: 2, fitments: [{ brandId: machineBrand.id }] });
    const res = await remove(seller, id);
    expect(res.statusCode, res.body).toBe(200);
    expect(await db.select().from(listings).where(eq(listings.id, id))).toHaveLength(0);
    expect(await db.select().from(listingMedia).where(eq(listingMedia.listingId, id))).toHaveLength(0);
    expect(await db.select().from(listingFitments).where(eq(listingFitments.listingId, id))).toHaveLength(0);
  });

  it('deletes a machine draft with its machine row', async () => {
    const id = await draftOf(seller, 'machine');
    expect((await remove(seller, id)).statusCode).toBe(200);
    expect(await db.select().from(listingMachines).where(eq(listingMachines.listingId, id))).toHaveLength(0);
  });

  it('refuses a live listing and a stranger', async () => {
    const { id } = await insertTestListing(db, { businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: catalog.partGroupId });
    const live = await remove(seller, id);
    expect(live.statusCode).toBe(409);
    expect(live.json()).toMatchObject({ code: 'LISTING_TRANSITION_NOT_ALLOWED', details: { from: 'live', action: 'delete' } });
    const draft = await draftOf(seller);
    expect((await remove(rival, draft)).statusCode).toBe(404);
  });
});

describe('business location sync (R19)', () => {
  it("moves business-sourced listings to the new location, bumping version but not refreshed_at; godown and removed ones stay", async () => {
    const base = { businessId: mover.businessId, userId: mover.userId, kind: 'part' as const, categoryId: catalog.partGroupId, pincode: '990013' };
    const biz = await insertTestListing(db, { ...base, point: { lat: 21.2, lng: 72.8 } });
    const godown = await insertTestListing(db, { ...base, locationSource: 'godown', pincode: '990012', point: { lat: 21.01, lng: 72.01 } });
    const removed = await insertTestListing(db, { ...base, status: 'removed' });
    const before = await rowOf(biz.id);

    const res = await app.inject({
      method: 'PUT',
      url: '/businesses/me/location',
      headers: auth(mover),
      payload: { pincode: '990014', city: 'Surat', state: 'Gujarat', industrialAreaOther: 'New Estate', lat: 21.3, lng: 72.9 },
    });
    expect(res.statusCode, res.body).toBe(200);

    const after = await rowOf(biz.id);
    expect(after).toMatchObject({ pincode: '990014', industrialAreaOther: 'New Estate', version: before.version + 1 });
    expect(after.refreshedAt!.getTime()).toBe(before.refreshedAt!.getTime());
    expect(await distanceMetres(biz.id, 21.3, 72.9)).toBeLessThan(1);
    expect(await rowOf(godown.id)).toMatchObject({ pincode: '990012', version: 1 });
    expect(await rowOf(removed.id)).toMatchObject({ pincode: '990013', version: 1 });
  });

  it("gives a business without a pin the new pincode's centroid", async () => {
    const rows = await db
      .insert(pincodeOffices)
      .values([
        { pincode: '990015', officeName: 'Test PO A', district: 'Surat', state: 'Gujarat', point: sql`ST_SetSRID(ST_MakePoint(72.4, 21.4), 4326)::geography` },
        { pincode: '990015', officeName: 'Test PO B', district: 'Surat', state: 'Gujarat', point: sql`ST_SetSRID(ST_MakePoint(72.42, 21.42), 4326)::geography` },
      ])
      .returning({ id: pincodeOffices.id });
    officeIds.push(...rows.map((r) => r.id));
    const { id } = await insertTestListing(db, { businessId: pinless.businessId, userId: pinless.userId, kind: 'part', categoryId: catalog.partGroupId, pincode: '990012' });

    const res = await app.inject({
      method: 'PUT',
      url: '/businesses/me/location',
      headers: auth(pinless),
      payload: { pincode: '990015', city: 'Surat', state: 'Gujarat', industrialAreaOther: 'Pinless Estate' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await rowOf(id)).toMatchObject({ pincode: '990015', version: 2 });
    expect(await distanceMetres(id, 21.41, 72.41)).toBeLessThan(50);
  });
});
