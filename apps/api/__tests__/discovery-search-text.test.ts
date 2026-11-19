import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { brands, listings, machineModels, templateFieldOptions } from '../src/db/schema.js';
import { buildSearchColumns, refreshListingSearch } from '../src/services/discovery/search-text.js';
import { createTestBrand, createTestCatalog, deleteTestBrands, deleteTestCatalog, type TestBrand, type TestCatalog } from './_helpers/test-catalog.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';

// F4 + F5 spec §4.1, §5.2, R5 (plan B1-1): the stored search text and search point.

let catalog: TestCatalog;
let seller: TestSeller;
let partBrand: TestBrand;
let fitBrand: TestBrand;
let modelId = '';

beforeAll(async () => {
  catalog = await createTestCatalog();
  await db.update(templateFieldOptions).set({ label: 'Zzt Ringlabel' }).where(eq(templateFieldOptions.id, catalog.optionIds.ring));
  partBrand = await createTestBrand({ makesParts: true });
  fitBrand = await createTestBrand();
  const [m] = await db
    .insert(machineModels)
    .values({ key: `zzt_${Date.now()}`, brandId: fitBrand.id, machineTypeId: catalog.machineTypeId, name: 'Zzt Model 77' })
    .returning({ id: machineModels.id });
  modelId = m!.id;
  seller = await createTestSeller({ machineCategoryId: catalog.categoryId, pincode: '990024', pincodeOffices: [{ lat: 20.0, lng: 75.0 }, { lat: 20.02, lng: 75.0 }] });
});

afterAll(async () => {
  await deleteTestBusinesses([seller.businessId]);
  await deleteTestSellerExtras([seller]);
  await deleteTestBrands([partBrand.id, fitBrand.id]);
  await deleteTestCatalog(catalog.categoryId);
});

async function stored(id: string) {
  const [row] = await db
    .select({
      title: listings.searchTitleText,
      text: listings.searchText,
      lat: sql<number | null>`ST_Y(${listings.searchPoint}::geometry)`,
      lng: sql<number | null>`ST_X(${listings.searchPoint}::geometry)`,
      at: listings.searchRefreshedAt,
    })
    .from(listings)
    .where(eq(listings.id, id));
  return row!;
}

describe('buildSearchColumns (pure)', () => {
  it('stores both part-number forms, names, specs and condition; never side words or the description', () => {
    const out = buildSearchColumns({
      title: 'Tie Rod End',
      partNumber: 'AB-123/X',
      partBrandName: 'Bosch',
      categoryNames: ['Construction', 'Backhoe Loader', 'Steering'],
      fitments: [{ brandName: 'JCB', modelName: '3DX', modelOther: null }],
      machine: null,
      specValues: ['Forged'],
      conditionLabel: 'Used',
    });
    expect(out.searchTitleText).toBe('tie rod end ab 123 x ab123x bosch construction backhoe loader steering');
    expect(out.searchText).toBe(`${out.searchTitleText} jcb 3dx forged used`);
  });

  it('an empty listing has empty texts', () => {
    expect(
      buildSearchColumns({ title: null, partNumber: null, partBrandName: null, categoryNames: [], fitments: [], machine: null, specValues: [], conditionLabel: null }),
    ).toEqual({ searchTitleText: '', searchText: '' });
  });
});

describe('refreshListingSearch', () => {
  it('builds the columns from the listing and its references', async () => {
    const { id } = await insertTestListing(db, {
      businessId: seller.businessId,
      userId: seller.userId,
      kind: 'part',
      categoryId: catalog.partGroupId,
      title: 'Zzt Spindle Assembly LH (Left)',
      description: 'secretdescword never searchable',
      partNumber: 'AB-123/X',
      partBrandId: partBrand.id,
      side: 'left',
      specs: { temple_type: 'ring' },
      conditionId: catalog.conditionId,
      fitments: [{ brandId: fitBrand.id, modelId }, { brandId: fitBrand.id, modelOther: 'Zzt Otherfit' }],
      pincode: '990024',
    });
    await refreshListingSearch(db, [id]);
    const row = await stored(id);
    const title = row.title;
    expect(title.startsWith('zzt spindle assembly ab 123 x ab123x')).toBe(true);
    expect(title).toContain(partBrand.name.toLowerCase());
    expect(title).toContain(`test machines ${catalog.suffix} test loom test temples`);
    expect(row.text.startsWith(title)).toBe(true);
    expect(row.text).toContain('zzt model 77');
    expect(row.text).toContain('zzt otherfit');
    expect(row.text).toContain(fitBrand.name.toLowerCase());
    expect(row.text).toContain('zzt ringlabel'); // option label, not the key
    expect(row.text).toContain(`test condition ${catalog.suffix}`);
    expect(row.text).not.toContain('secretdescword');
    expect(row.text.split(' ')).not.toContain('left');
    expect(row.text.split(' ')).not.toContain('lh');
    expect(row.at).not.toBeNull();
  });

  it('search point: the pincode centroid when the listing has no pin, else the pin', async () => {
    const noPin = await insertTestListing(db, { businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: catalog.partGroupId, pincode: '990024' });
    const pin = await insertTestListing(db, {
      businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: catalog.partGroupId, pincode: '990024', point: { lat: 21.5, lng: 73.5 },
    });
    await refreshListingSearch(db, [noPin.id, pin.id]);
    const a = await stored(noPin.id);
    expect(Number(a.lat)).toBeCloseTo(20.01, 5);
    expect(Number(a.lng)).toBeCloseTo(75.0, 5);
    const b = await stored(pin.id);
    expect(Number(b.lat)).toBeCloseTo(21.5, 5);
    expect(Number(b.lng)).toBeCloseTo(73.5, 5);
  });

  it('a machine listing takes its brand, model and Other texts', async () => {
    const { id } = await insertTestListing(db, {
      businessId: seller.businessId, userId: seller.userId, kind: 'machine', categoryId: catalog.machineTypeId,
      title: 'Zzt Loom For Sale', machine: { brandId: fitBrand.id, modelOther: 'Zzt Custom 9' },
    });
    await refreshListingSearch(db, [id]);
    const row = await stored(id);
    expect(row.text).toContain(fitBrand.name.toLowerCase());
    expect(row.text).toContain('zzt custom 9');
  });

  it('a brand rename shows after the next refresh', async () => {
    const { id } = await insertTestListing(db, { businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: catalog.partGroupId, partBrandId: partBrand.id });
    await refreshListingSearch(db, [id]);
    await db.update(brands).set({ name: `${partBrand.name} Renamedzzt` }).where(eq(brands.id, partBrand.id));
    await refreshListingSearch(db, [id]);
    expect((await stored(id)).title).toContain('renamedzzt');
  });
});
