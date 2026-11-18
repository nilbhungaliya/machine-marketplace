import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db, pool } from '../src/db/index.js';
import { businesses, categories, listingStatusHistory, listings } from '../src/db/schema.js';
import { lockBusinessThenListing } from '../src/services/listings/locks.js';
import { applySystemTransition } from '../src/services/listings/listing-lifecycle.service.js';
import { toOwnerView } from '../src/services/listings/listing-view.service.js';
import { getSettings } from '../src/services/settings.service.js';
import { createTestCatalog, deleteTestCatalog, type TestCatalog } from './_helpers/test-catalog.js';
import { deleteTestBusinesses } from './_helpers/test-businesses.js';
import { createTestSeller, deleteTestSellerExtras, insertTestListing, type TestSeller } from './_helpers/test-listings.js';

// The lifecycle core (F2 plan Task 6): the business-then-listing lock, the one status writer (through
// applySystemTransition: conditional UPDATE + one history row), and the owner view's computed fields.

const DAY = 24 * 60 * 60 * 1000;

let catalog: TestCatalog;
let seller: TestSeller;
let other: TestSeller;
const sellers: TestSeller[] = [];

async function rowOf(id: string) {
  const [row] = await db.select().from(listings).where(eq(listings.id, id));
  return row!;
}

async function historyOf(id: string) {
  return db.select().from(listingStatusHistory).where(eq(listingStatusHistory.listingId, id));
}

beforeAll(async () => {
  catalog = await createTestCatalog();
  seller = await createTestSeller({ machineCategoryId: catalog.categoryId });
  other = await createTestSeller({ machineCategoryId: catalog.categoryId });
  sellers.push(seller, other);
});

afterAll(async () => {
  await deleteTestBusinesses(sellers.map((s) => s.businessId));
  await deleteTestSellerExtras(sellers);
  await deleteTestCatalog(catalog.categoryId);
});

const part = (extra: Partial<Parameters<typeof insertTestListing>[1]> = {}) =>
  insertTestListing(db, { businessId: seller.businessId, userId: seller.userId, kind: 'part', categoryId: catalog.partGroupId, ...extra });

describe('lockBusinessThenListing', () => {
  it('locks the business and its listing and returns both rows', async () => {
    const { id } = await part();
    const result = await db.transaction((tx) => lockBusinessThenListing(tx, seller.businessId, id));
    expect(result.business.id).toBe(seller.businessId);
    expect(result.listing.id).toBe(id);
  });

  it("answers 404 LISTING_NOT_FOUND for another business's listing", async () => {
    const { id } = await part();
    await expect(db.transaction((tx) => lockBusinessThenListing(tx, other.businessId, id))).rejects.toMatchObject({
      statusCode: 404,
      code: 'LISTING_NOT_FOUND',
    });
  });
});

describe('applySystemTransition (writeStatus)', () => {
  it('refuses a stale listing object with 409 and writes nothing', async () => {
    const { id } = await part({ status: 'live' });
    const stale = await rowOf(id);
    // Someone else paused it after we read it.
    await db.update(listings).set({ status: 'paused' }).where(eq(listings.id, id));

    await expect(
      db.transaction((tx) => applySystemTransition(tx, stale, 'back_to_review', { reviewReasons: ['edit_flagged'] })),
    ).rejects.toMatchObject({ statusCode: 409, code: 'LISTING_TRANSITION_NOT_ALLOWED', details: { from: 'live', action: 'back_to_review' } });

    expect((await rowOf(id)).status).toBe('paused');
    expect(await historyOf(id)).toHaveLength(0);
  });

  it('refuses an action the table has no row for', async () => {
    const { id } = await part({ status: 'paused' });
    await expect(db.transaction(async (tx) => applySystemTransition(tx, await rowOf(id), 'expire'))).rejects.toMatchObject({
      statusCode: 409,
      code: 'LISTING_TRANSITION_NOT_ALLOWED',
      details: { from: 'paused', action: 'expire' },
    });
    expect(await historyOf(id)).toHaveLength(0);
  });

  it('back_to_review from rented stores return_status = rented and merges the review reasons', async () => {
    const { id } = await insertTestListing(db, {
      businessId: seller.businessId,
      userId: seller.userId,
      kind: 'machine_rental',
      categoryId: catalog.machineTypeId,
      status: 'rented',
      reviewReasons: ['edited_after_report'],
      statusChangedAt: new Date(Date.now() - DAY),
    });
    const before = await rowOf(id);
    const after = await db.transaction(async (tx) =>
      applySystemTransition(tx, await rowOf(id), 'back_to_review', { reviewReasons: ['edit_flagged', 'edited_after_report'] }),
    );

    expect(after.status).toBe('pending_review');
    const row = await rowOf(id);
    expect(row.status).toBe('pending_review');
    expect(row.returnStatus).toBe('rented');
    expect([...row.reviewReasons].sort()).toEqual(['edit_flagged', 'edited_after_report']);
    expect(row.statusChangedAt!.getTime()).toBeGreaterThan(before.statusChangedAt!.getTime() + DAY / 2);

    const history = await historyOf(id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ fromStatus: 'rented', toStatus: 'pending_review', action: 'back_to_review', actor: 'system' });
  });

  it('photos_removed moves a live listing to rejected with outcome changes_requested and the note', async () => {
    const { id } = await part({ status: 'live', returnStatus: 'live' });
    await db.transaction(async (tx) => applySystemTransition(tx, await rowOf(id), 'photos_removed', { reason: 'Photos show another part' }));

    const row = await rowOf(id);
    expect(row.status).toBe('rejected');
    expect(row.moderationOutcome).toBe('changes_requested');
    expect(row.moderationNote).toBe('Photos show another part');
    expect(row.moderatedAt).not.toBeNull();
    expect(row.returnStatus).toBeNull();
    const history = await historyOf(id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ fromStatus: 'live', toStatus: 'rejected', action: 'photos_removed', actor: 'system', reason: 'Photos show another part' });
  });

  it('expire never waits for the business lock, by default (amendment 1)', async () => {
    const { id } = await part({ status: 'live' });
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM businesses WHERE id = $1 FOR NO KEY UPDATE', [seller.businessId]);
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
        await applySystemTransition(tx, await rowOf(id), 'expire');
      });
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
    expect((await rowOf(id)).status).toBe('expired');
  });

  it('refuses expire with lockBusiness: true', async () => {
    const { id } = await part({ status: 'live' });
    await expect(
      db.transaction(async (tx) => applySystemTransition(tx, await rowOf(id), 'expire', { lockBusiness: true })),
    ).rejects.toThrow(/expire/);
    expect((await rowOf(id)).status).toBe('live');
  });

  it("back_to_review keeps a reason already on the row when the caller's object is stale", async () => {
    const { id } = await part({ status: 'live' });
    const stale = await rowOf(id);
    await db.update(listings).set({ reviewReasons: ['edited_after_report'] }).where(eq(listings.id, id));
    await db.transaction((tx) => applySystemTransition(tx, stale, 'back_to_review', { reviewReasons: ['edit_flagged'] }));
    const row = await rowOf(id);
    expect(row.status).toBe('pending_review');
    expect([...row.reviewReasons].sort()).toEqual(['edit_flagged', 'edited_after_report']);
  });
});

describe('toOwnerView', () => {
  it('asks for a side once the node switches sides on', async () => {
    const { id } = await part({ categoryId: catalog.motorsGroupId, side: 'not_applicable' });
    const settings = await getSettings(db);
    expect((await toOwnerView(db, await rowOf(id), settings)).needsAttention).not.toContainEqual({ field: 'side', code: 'SIDE_REQUIRED' });

    await db.update(categories).set({ hasSides: true }).where(eq(categories.id, catalog.motorsGroupId));
    try {
      const view = await toOwnerView(db, await rowOf(id), settings);
      expect(view.needsAttention).toContainEqual({ field: 'side', code: 'SIDE_REQUIRED' });
    } finally {
      await db.update(categories).set({ hasSides: false }).where(eq(categories.id, catalog.motorsGroupId));
    }
  });

  it('lists a missing photo, price and GST mode', async () => {
    const { id } = await part({ photos: 0, priceModel: 'fixed', pricePaise: null, gstMode: null });
    const view = await toOwnerView(db, await rowOf(id), await getSettings(db));
    expect(view.needsAttention).toEqual(
      expect.arrayContaining([
        { field: 'photos', code: 'required' },
        { field: 'pricePaise', code: 'PRICE_REQUIRED' },
        { field: 'gstMode', code: 'required' },
      ]),
    );
  });

  it('is expiring soon 6 days before expiry with the default settings, not 8 days before', async () => {
    const settings = await getSettings(db);
    const soon = await part({ status: 'live', refreshedAt: new Date(Date.now() - 54 * DAY) });
    const view = await toOwnerView(db, await rowOf(soon.id), settings);
    expect(view.expiringSoon).toBe(true);
    const expected = (await rowOf(soon.id)).refreshedAt!.getTime() + 60 * DAY;
    expect(new Date(view.expiresAt!).getTime()).toBe(expected);

    const later = await part({ status: 'live', refreshedAt: new Date(Date.now() - 52 * DAY) });
    expect((await toOwnerView(db, await rowOf(later.id), settings)).expiringSoon).toBe(false);

    const paused = await part({ status: 'paused', refreshedAt: new Date(Date.now() - 54 * DAY) });
    const pausedView = await toOwnerView(db, await rowOf(paused.id), settings);
    expect(pausedView.expiresAt).toBeNull();
    expect(pausedView.expiringSoon).toBe(false);
  });

  it('carries the owner fields: version, flags, serial number, location with the pincode, score and isOwner', async () => {
    const { id } = await insertTestListing(db, {
      businessId: seller.businessId,
      userId: seller.userId,
      kind: 'machine',
      categoryId: catalog.machineTypeId,
      status: 'live',
      machine: { serialNumber: 'SN-1', year: 2015 },
      flags: ['price_check'],
      acceptedFlags: ['price_check'],
      photos: 3,
      point: { lat: 21.17, lng: 72.83 },
    });
    const view = await toOwnerView(db, await rowOf(id), await getSettings(db));
    expect(view).toMatchObject({
      id,
      kind: 'machine',
      status: 'live',
      isOwner: true,
      version: 1,
      flags: ['price_check'],
      acceptedFlags: ['price_check'],
      reviewOnEdit: false,
      categoryPath: [catalog.categoryName, 'Test Loom'],
      machine: { serialNumber: 'SN-1', year: 2015 },
      location: { source: 'business', pincode: '990011', city: 'Surat' },
      seller: { businessId: seller.businessId, gstVerified: false },
    });
    expect(view.location.lat).toBeCloseTo(21.17, 5);
    expect(view.media).toHaveLength(3);
    expect(view.media[0]!.url).toBeNull();
    expect(view.score.missing).not.toContain('photos');
    expect(view.score.missing).not.toContain('year');
  });

  it('marks reviewOnEdit while a report is open', async () => {
    const { id } = await part({ status: 'live' });
    await db.execute(sql`
      INSERT INTO reports (target_type, target_id, reporter_user_id, reporter_business_id, reason)
      VALUES ('listing', ${id}, ${other.userId}, ${other.businessId}, 'wrong_side_or_fit')`);
    expect((await toOwnerView(db, await rowOf(id), await getSettings(db))).reviewOnEdit).toBe(true);
    await db.execute(sql`UPDATE reports SET status = 'dismissed' WHERE target_id = ${id}`);
    expect((await toOwnerView(db, await rowOf(id), await getSettings(db))).reviewOnEdit).toBe(false);
  });

  it("names an unverified business by its trade name", async () => {
    const { id } = await part();
    const [b] = await db.select({ tradeName: businesses.tradeName }).from(businesses).where(and(eq(businesses.id, seller.businessId)));
    const view = await toOwnerView(db, await rowOf(id), await getSettings(db));
    expect(view.seller.displayName).toBe(b!.tradeName);
  });
});
