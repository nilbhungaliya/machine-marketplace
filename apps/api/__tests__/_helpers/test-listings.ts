import { eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  normalizePartName,
  normalizePartNumber,
  partNumberBase,
  type DeliveryOption,
  type GstPriceMode,
  type ListingActor,
  type ListingFlag,
  type ListingKind,
  type ListingLocationSource,
  type ListingStatus,
  type ModerationOutcome,
  type PartSide,
  type PriceModel,
  type ReviewReason,
  type Specs,
} from '@mpm/shared-types';
import { db, type Db, type Tx } from '../../src/db/index.js';
import {
  businesses,
  categories,
  listingFitments,
  listingMachines,
  listingMedia,
  listingRentals,
  listingStatusHistory,
  listings,
  pincodeOffices,
  units,
} from '../../src/db/schema.js';
import { createTestBusinessUser, grantTestGst, type TestBusinessUser } from './test-businesses.js';

export { deleteTestListings } from './test-users.js';

// F2 listing fixtures (plan Task 2). Listings, their children and fake-key media rows are written directly, so publish
// and lifecycle tests never need R2. Cleanup order in afterAll: deleteTestBusinesses (deletes listings and every child
// first) → deleteTestSellerExtras → deleteTestAdmins → deleteTestCatalog / deleteTestBrands / deleteTestUnits.

type Conn = Db | Tx;
type Point = { lat: number; lng: number };

/**
 * Pincodes reserved for test `pincode_offices` rows (no real pincode starts with 99; 990001–990009 belong to the F1
 * suites, 990011–990019 to F2, 990021–990029 to F4 + F5 discovery).
 */
const TEST_PINCODE = /^9900[12][1-9]$/;
const DEFAULT_PINCODE = '990011';

let seq = 0;
const suffix = (): string => `${Date.now()}${seq++}`;

export interface TestSeller extends TestBusinessUser {
  /** What `createTestSeller` inserted besides the business: delete with `deleteTestSellerExtras` after the businesses. */
  cleanup: { pincodeOfficeIds: string[]; categoryIds: string[] };
}

/**
 * A business that can sell (F2 spec §5.1): a signed-in owner with activities buy + sell, an active machine category
 * (`machineCategoryId`, else one of its own) and, when `onboarded` (default), a finished location in Surat with an
 * industrial area (`industrialAreaId`, else the "Other" text "Test Estate") and the pincode (default `990011`).
 * - `point`: the business's pin (none by default).
 * - `pincodeOffices`: inserts its own `pincode_offices` rows for the pincode with these points, so the pincode has a
 *   centroid; only for the test ranges `990011`–`990019` and `990021`–`990029`.
 * - `gst`: GST-verified through `grantTestGst`.
 * Remove with `deleteTestBusinesses([businessId])`, then `deleteTestSellerExtras([seller])`.
 */
export async function createTestSeller(
  opts: {
    gst?: boolean;
    point?: Point | null;
    pincode?: string;
    pincodeOffices?: Point[];
    onboarded?: boolean;
    machineCategoryId?: string;
    industrialAreaId?: string;
  } = {},
): Promise<TestSeller> {
  const pincode = opts.pincode ?? DEFAULT_PINCODE;
  const cleanup: TestSeller['cleanup'] = { pincodeOfficeIds: [], categoryIds: [] };
  const user = await createTestBusinessUser({ activities: ['buy', 'sell'] });

  let categoryId = opts.machineCategoryId;
  if (!categoryId) {
    const slug = `test-seller-machines-${suffix()}`;
    const [cat] = await db
      .insert(categories)
      .values({ level: 'machine_category', name: `Test Seller Machines ${slug}`, slug, path: slug, sortOrder: 9999 })
      .returning({ id: categories.id });
    categoryId = cat!.id;
    cleanup.categoryIds.push(categoryId);
  }

  const onboarded = opts.onboarded ?? true;
  await db
    .update(businesses)
    .set({
      categories: [categoryId],
      ...(onboarded
        ? {
            pincode,
            city: 'Surat',
            state: 'Gujarat',
            industrialAreaId: opts.industrialAreaId ?? null,
            industrialAreaOther: opts.industrialAreaId ? null : 'Test Estate',
            location: opts.point ? sql`ST_SetSRID(ST_MakePoint(${opts.point.lng}, ${opts.point.lat}), 4326)::geography` : null,
          }
        : {}),
    })
    .where(eq(businesses.id, user.businessId));

  if (opts.pincodeOffices?.length) {
    if (!TEST_PINCODE.test(pincode)) throw new Error(`createTestSeller: pincode offices only for 990011-990029 (got ${pincode})`);
    const rows = await db
      .insert(pincodeOffices)
      .values(
        opts.pincodeOffices.map((p, i) => ({
          pincode,
          officeName: `Test PO ${i + 1}`,
          district: 'Surat',
          state: 'Gujarat',
          point: sql`ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography`,
        })),
      )
      .returning({ id: pincodeOffices.id });
    cleanup.pincodeOfficeIds.push(...rows.map((r) => r.id));
  }

  if (opts.gst) await grantTestGst(user.businessId);
  return { ...user, cleanup };
}

/** Deletes what `createTestSeller` inserted besides the businesses. Run after `deleteTestBusinesses`. */
export async function deleteTestSellerExtras(sellers: TestSeller[]): Promise<void> {
  const officeIds = sellers.flatMap((s) => s.cleanup.pincodeOfficeIds);
  const categoryIds = sellers.flatMap((s) => s.cleanup.categoryIds);
  if (officeIds.length) await db.delete(pincodeOffices).where(inArray(pincodeOffices.id, officeIds));
  if (categoryIds.length) await db.delete(categories).where(inArray(categories.id, categoryIds));
}

/**
 * A unit of its own flagged `is_machine_unit` (sort order −1000, so it sorts first). Machine fixtures never rely on the
 * seed's `machines` unit. Delete with `deleteTestUnits` after the listings that use it.
 */
export async function createTestMachineUnit(): Promise<{ id: string; key: string }> {
  const key = `test_machines_${suffix()}`;
  const [row] = await db
    .insert(units)
    .values({ key, label: `Test machines ${key}`, decimals: 0, sortOrder: -1000, isMachineUnit: true })
    .returning({ id: units.id });
  return { id: row!.id, key };
}

export async function deleteTestUnits(ids: string[]): Promise<void> {
  if (ids.length) await db.delete(units).where(inArray(units.id, ids));
}

/** Statuses a listing only reaches after going live: the fixture stamps `first_live_at` for them unless told. */
const BEEN_LIVE: readonly ListingStatus[] = ['live', 'paused', 'reserved', 'sold', 'rented', 'unavailable', 'expired', 'hidden'];

export interface TestFitment {
  brandId: string;
  modelId?: string | null;
  modelOther?: string | null;
  yearFrom?: number | null;
  yearTo?: number | null;
  note?: string | null;
  source?: 'seller' | 'admin';
}

export interface TestListingOptions {
  businessId: string;
  userId: string;
  kind: ListingKind;
  /** Default `live`. */
  status?: ListingStatus;
  categoryId: string | null;
  /** Parts default to `not_applicable`; machines have none. */
  side?: PartSide | null;
  partNumber?: string | null;
  title?: string;
  description?: string | null;
  specs?: Specs;
  partBrandId?: string | null;
  quantity?: string;
  unitId?: string | null;
  minOrderQty?: string | null;
  conditionId?: string | null;
  /** Default `fixed` for parts and machines, none for rentals. */
  priceModel?: PriceModel | null;
  /** Default ₹1 000 (parts) or ₹5 lakh (machines); none for rentals. */
  pricePaise?: number | null;
  gstMode?: GstPriceMode | null;
  delivery?: DeliveryOption[];
  fitments?: TestFitment[];
  /** Fake-key photo rows (default 1) and video rows (default 0). */
  photos?: number;
  videos?: number;
  locationSource?: ListingLocationSource;
  pincode?: string | null;
  city?: string | null;
  state?: string | null;
  industrialAreaId?: string | null;
  industrialAreaOther?: string | null;
  addressLine?: string | null;
  point?: Point | null;
  /** F4 + F5 search point (R5), written directly (B1's refresh normally fills it). Default none. */
  searchPoint?: Point | null;
  flags?: ListingFlag[];
  acceptedFlags?: ListingFlag[];
  reviewReasons?: ReviewReason[];
  returnStatus?: ListingStatus | null;
  moderationOutcome?: ModerationOutcome | null;
  moderationNote?: string | null;
  statusReason?: string | null;
  version?: number;
  /** Default now for every status but `draft`. */
  publishedAt?: Date | null;
  /** Default now for statuses reached only after going live (`BEEN_LIVE`), else null. */
  firstLiveAt?: Date | null;
  /** Default now for every status but `draft`. */
  refreshedAt?: Date | null;
  statusChangedAt?: Date | null;
  /** Machine kinds: fields of the `listing_machines` row, or `false` for no row. */
  machine?: Partial<Omit<typeof listingMachines.$inferInsert, 'listingId'>> | false;
  /** `machine_rental`: fields of the `listing_rentals` row (default a ₹5 000 day rate), or `false` for no row. */
  rental?: Partial<Omit<typeof listingRentals.$inferInsert, 'listingId'>> | false;
}

/**
 * Writes a listing directly (row, norms through the shared helpers, machine / rental row, fitments and fake-key
 * `listing_media` rows `listings/<listingId>/<mediaId>/<role>.<ext>`), bypassing the services. Returns its id, ref and
 * media ids (photos first, then videos).
 */
export async function insertTestListing(
  conn: Conn,
  o: TestListingOptions,
): Promise<{ id: string; ref: number; mediaIds: string[] }> {
  const status = o.status ?? 'live';
  const isPart = o.kind === 'part';
  const isRental = o.kind === 'machine_rental';
  const title = o.title ?? (isPart ? 'Test temple roller' : 'Test loom');
  const side = o.side !== undefined ? o.side : isPart ? 'not_applicable' : null;
  const partNumber = o.partNumber ?? null;
  const norm = partNumber ? normalizePartNumber(partNumber) : null;
  const now = new Date();
  const notDraft = status !== 'draft';
  const point = o.point ?? null;

  const [row] = await conn
    .insert(listings)
    .values({
      businessId: o.businessId,
      createdByUserId: o.userId,
      kind: o.kind,
      status,
      categoryId: o.categoryId,
      title,
      titleNorm: normalizePartName(title),
      description: o.description ?? null,
      partNumber,
      partNumberNorm: norm,
      partNumberBase: norm ? partNumberBase(norm, side) : null,
      partBrandId: o.partBrandId ?? null,
      side,
      specs: o.specs ?? {},
      quantity: o.quantity ?? '1',
      unitId: o.unitId ?? null,
      minOrderQty: o.minOrderQty ?? null,
      conditionId: o.conditionId ?? null,
      priceModel: o.priceModel !== undefined ? o.priceModel : isRental ? null : 'fixed',
      pricePaise: o.pricePaise !== undefined ? o.pricePaise : isRental ? null : isPart ? 100_000 : 50_000_000,
      gstMode: o.gstMode !== undefined ? o.gstMode : isRental ? null : 'extra',
      delivery: o.delivery ?? ['pickup'],
      locationSource: o.locationSource ?? 'business',
      pincode: o.pincode !== undefined ? o.pincode : DEFAULT_PINCODE,
      city: o.city !== undefined ? o.city : 'Surat',
      state: o.state !== undefined ? o.state : 'Gujarat',
      industrialAreaId: o.industrialAreaId ?? null,
      industrialAreaOther: o.industrialAreaOther !== undefined ? o.industrialAreaOther : o.industrialAreaId ? null : 'Test Estate',
      addressLine: o.addressLine ?? null,
      point: point ? sql`ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography` : null,
      searchPoint: o.searchPoint ? sql`ST_SetSRID(ST_MakePoint(${o.searchPoint.lng}, ${o.searchPoint.lat}), 4326)::geography` : null,
      flags: o.flags ?? [],
      acceptedFlags: o.acceptedFlags ?? [],
      reviewReasons: o.reviewReasons ?? [],
      returnStatus: o.returnStatus ?? null,
      moderationOutcome: o.moderationOutcome ?? null,
      moderationNote: o.moderationNote ?? null,
      statusReason: o.statusReason ?? null,
      version: o.version ?? 1,
      publishedAt: o.publishedAt !== undefined ? o.publishedAt : notDraft ? now : null,
      firstLiveAt: o.firstLiveAt !== undefined ? o.firstLiveAt : BEEN_LIVE.includes(status) ? now : null,
      refreshedAt: o.refreshedAt !== undefined ? o.refreshedAt : notDraft ? now : null,
      statusChangedAt: o.statusChangedAt !== undefined ? o.statusChangedAt : now,
    })
    .returning({ id: listings.id, ref: listings.ref });
  const id = row!.id;

  if (o.kind !== 'part' && o.machine !== false) {
    await conn.insert(listingMachines).values({ listingId: id, ...(o.machine ?? {}) });
  }
  if (isRental && o.rental !== false) {
    await conn.insert(listingRentals).values({ listingId: id, rateDayPaise: 500_000, ...(o.rental ?? {}) });
  }
  if (o.fitments?.length) {
    await conn.insert(listingFitments).values(
      o.fitments.map((f, i) => ({
        listingId: id,
        brandId: f.brandId,
        modelId: f.modelId ?? null,
        modelOther: f.modelOther ?? null,
        yearFrom: f.yearFrom ?? null,
        yearTo: f.yearTo ?? null,
        note: f.note ?? null,
        source: f.source ?? 'seller',
        sortOrder: i,
      })),
    );
  }

  const photos = o.photos ?? 1;
  const videos = o.videos ?? 0;
  const media: Array<typeof listingMedia.$inferInsert> = [];
  for (let i = 0; i < photos; i++) {
    const mediaId = randomUUID();
    media.push({
      id: mediaId, listingId: id, type: 'photo', key: `listings/${id}/${mediaId}/full.jpg`,
      thumbKey: `listings/${id}/${mediaId}/thumb.jpg`, contentType: 'image/jpeg', sizeBytes: 200_000, sortOrder: i,
    });
  }
  for (let i = 0; i < videos; i++) {
    const mediaId = randomUUID();
    media.push({
      id: mediaId, listingId: id, type: 'video', key: `listings/${id}/${mediaId}/video.mp4`,
      thumbKey: `listings/${id}/${mediaId}/poster.jpg`, contentType: 'video/mp4', sizeBytes: 5_000_000,
      durationMs: 30_000, sortOrder: photos + i,
    });
  }
  if (media.length) await conn.insert(listingMedia).values(media);

  return { id, ref: row!.ref, mediaIds: media.map((m) => m.id!) };
}

/** A dated `listing_status_history` row (`createdAt` default now). */
export async function insertTestHistory(
  conn: Conn,
  h: {
    listingId: string;
    from: ListingStatus | null;
    to: ListingStatus;
    action: string;
    actor: ListingActor;
    userId?: string | null;
    adminId?: string | null;
    reason?: string | null;
    createdAt?: Date;
  },
): Promise<string> {
  const [row] = await conn
    .insert(listingStatusHistory)
    .values({
      listingId: h.listingId,
      fromStatus: h.from,
      toStatus: h.to,
      action: h.action,
      actor: h.actor,
      userId: h.userId ?? null,
      adminId: h.adminId ?? null,
      reason: h.reason ?? null,
      ...(h.createdAt ? { createdAt: h.createdAt } : {}),
    })
    .returning({ id: listingStatusHistory.id });
  return row!.id;
}
