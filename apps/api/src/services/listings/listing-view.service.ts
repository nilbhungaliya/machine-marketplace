import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  PUBLIC_LISTING_STATUSES,
  listingScore,
  type AppSettingsValues,
  type EffectiveTemplate,
  type Fitment,
  type ListingCard,
  type ListingDetail,
  type ListingMediaItem,
  type ListingOwnerView,
  type ListingProblem,
  type MachineDetails,
  type RentalPeriod,
  type RentalTerms,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import {
  brands,
  businesses,
  conditions,
  industrialAreas,
  listingFitments,
  listingMachines,
  listingMedia,
  listingRentals,
  listings,
  machineModels,
  reports,
  units,
} from '../../db/schema.js';
import { NotFoundError } from '../../lib/errors.js';
import { publicUrl } from '../../lib/media-url.js';
import { checkSpecs, isRequiredField } from '../../lib/spec-check.js';
import { businessDisplayName } from '../business/profile.service.js';
import { loadTemplate } from '../catalog/read.service.js';
import { loadNode, type ListingNode } from './listing-validate.service.js';
import type { ListingRow } from './locks.js';

// Listing payloads (F2 spec §7.3–§7.5, §8.1, §13.4). The owner view is built here (plan Task 6); Task 10 builds the
// public detail from the same loader and strips the private fields (serial number, address line, pincode, point).

type Conn = Db | Tx;
const DAY_MS = 24 * 60 * 60 * 1000;

/** `numeric(14,3)` comes back as `'2.500'`: drop trailing zeros (`'2.5'`, `'1'`). */
export function trimQuantity(value: string | null): string | null {
  if (value === null) return null;
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

type RentalRow = typeof listingRentals.$inferSelect;

/** A rental's headline rate: the first set of day, hour, week, month (§13.4 `ListingCard.rate`). */
export function headlineRate(rental: Pick<RentalRow, 'rateDayPaise' | 'rateHourPaise' | 'rateWeekPaise' | 'rateMonthPaise'> | null): {
  period: RentalPeriod;
  paise: number;
} | null {
  if (!rental) return null;
  const order: Array<[RentalPeriod, number | null]> = [
    ['day', rental.rateDayPaise],
    ['hour', rental.rateHourPaise],
    ['week', rental.rateWeekPaise],
    ['month', rental.rateMonthPaise],
  ];
  const hit = order.find(([, paise]) => paise != null);
  return hit ? { period: hit[0], paise: hit[1]! } : null;
}

/** The node's effective template for the listing's kind (retired fields included, inactive nodes allowed), or null. */
async function templateOf(conn: Conn, row: ListingRow): Promise<EffectiveTemplate | null> {
  if (!row.categoryId) return null;
  try {
    return await loadTemplate(conn, row.categoryId, row.kind === 'part' ? 'part' : 'machine', { includeRetired: true, allowInactive: true });
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

/** Everything a listing payload is built from, private fields included. */
export interface LoadedListing {
  row: ListingRow;
  node: ListingNode | null;
  template: EffectiveTemplate | null;
  detail: ListingDetail;
  /** Private: owner and admins only. */
  location: ListingOwnerView['location'];
  photoCount: number;
  videoCount: number;
}

/** Loads a listing's references and children into a `ListingDetail` (with `serialNumber`; `isOwner` false). */
export async function loadListing(conn: Conn, row: ListingRow): Promise<LoadedListing> {
  const node = row.categoryId ? await loadNode(conn, row.categoryId) : null;
  const template = await templateOf(conn, row);

  const [refs] = await conn
    .select({
      areaName: industrialAreas.name,
      lat: sql<number | null>`ST_Y(${listings.point}::geometry)`,
      lng: sql<number | null>`ST_X(${listings.point}::geometry)`,
    })
    .from(listings)
    .leftJoin(industrialAreas, eq(industrialAreas.id, listings.industrialAreaId))
    .where(eq(listings.id, row.id));
  const [condition] = row.conditionId
    ? await conn.select({ key: conditions.key, label: conditions.label }).from(conditions).where(eq(conditions.id, row.conditionId))
    : [];
  const [unit] = row.unitId
    ? await conn.select({ key: units.key, label: units.label, decimals: units.decimals }).from(units).where(eq(units.id, row.unitId))
    : [];
  const [partBrand] = row.partBrandId
    ? await conn.select({ id: brands.id, name: brands.name }).from(brands).where(eq(brands.id, row.partBrandId))
    : [];

  const mediaRows = await conn
    .select()
    .from(listingMedia)
    .where(eq(listingMedia.listingId, row.id))
    .orderBy(asc(listingMedia.sortOrder), asc(listingMedia.createdAt));
  const media: ListingMediaItem[] = mediaRows.map((m) => ({
    id: m.id,
    type: m.type,
    url: publicUrl(m.key),
    thumbUrl: publicUrl(m.thumbKey),
    contentType: m.contentType,
    sizeBytes: m.sizeBytes,
    durationMs: m.durationMs,
    sortOrder: m.sortOrder,
  }));
  const photos = mediaRows.filter((m) => m.type === 'photo');

  const fitmentRows = await conn
    .select({ f: listingFitments, brandName: brands.name, modelName: machineModels.name })
    .from(listingFitments)
    .innerJoin(brands, eq(brands.id, listingFitments.brandId))
    .leftJoin(machineModels, eq(machineModels.id, listingFitments.modelId))
    .where(eq(listingFitments.listingId, row.id))
    .orderBy(asc(listingFitments.sortOrder));
  const fitments: Fitment[] = fitmentRows.map(({ f, brandName, modelName }) => ({
    id: f.id,
    brandId: f.brandId,
    brandName,
    modelId: f.modelId,
    modelName,
    modelOther: f.modelOther,
    yearFrom: f.yearFrom,
    yearTo: f.yearTo,
    note: f.note,
    source: f.source,
  }));

  let machine: MachineDetails | null = null;
  if (row.kind !== 'part') {
    const [m] = await conn
      .select({ m: listingMachines, brandName: brands.name, modelName: machineModels.name })
      .from(listingMachines)
      .leftJoin(brands, eq(brands.id, listingMachines.brandId))
      .leftJoin(machineModels, eq(machineModels.id, listingMachines.modelId))
      .where(eq(listingMachines.listingId, row.id));
    if (m) {
      machine = {
        brandId: m.m.brandId,
        brandName: m.brandName,
        brandOther: m.m.brandOther,
        modelId: m.m.modelId,
        modelName: m.modelName,
        modelOther: m.m.modelOther,
        year: m.m.year,
        hoursRun: m.m.hoursRun,
        underPower: m.m.underPower,
        inspectionByAppointment: m.m.inspectionByAppointment,
        reasonForSale: m.m.reasonForSale,
        serialNumber: m.m.serialNumber,
      };
    }
  }

  let rentalRow: RentalRow | null = null;
  let rental: RentalTerms | null = null;
  if (row.kind === 'machine_rental') {
    [rentalRow = null] = await conn.select().from(listingRentals).where(eq(listingRentals.listingId, row.id));
    if (rentalRow) {
      const { listingId: _id, ...terms } = rentalRow;
      rental = terms;
    }
  }

  const [b] = await conn
    .select({ b: businesses, areaName: industrialAreas.name })
    .from(businesses)
    .leftJoin(industrialAreas, eq(industrialAreas.id, businesses.industrialAreaId))
    .where(eq(businesses.id, row.businessId));
  const [live] = await conn
    .select({ n: sql<number>`count(*)::int` })
    .from(listings)
    .where(and(eq(listings.businessId, row.businessId), inArray(listings.status, [...PUBLIC_LISTING_STATUSES])));

  const card: ListingCard = {
    id: row.id,
    ref: row.ref,
    kind: row.kind,
    status: row.status,
    title: row.title ?? '',
    side: row.side,
    condition: condition ?? null,
    quantity: trimQuantity(row.quantity),
    unit: unit ?? null,
    priceModel: row.priceModel,
    pricePaise: row.pricePaise,
    gstMode: row.gstMode,
    rate: headlineRate(rentalRow),
    thumbUrl: publicUrl(photos[0]?.thumbKey),
    city: row.city,
    industrialAreaName: refs?.areaName ?? null,
    distanceKm: null,
    refreshedAt: iso(row.refreshedAt),
    businessId: row.businessId,
  };

  const detail: ListingDetail = {
    ...card,
    description: row.description,
    categoryId: row.categoryId,
    categoryPath: node?.path ?? [],
    specs: row.specs,
    partNumber: row.partNumber,
    partBrand: partBrand ?? null,
    minOrderQty: trimQuantity(row.minOrderQty),
    conditionNote: row.conditionNote,
    delivery: row.delivery,
    state: row.state,
    media,
    fitments,
    machine,
    rental,
    seller: {
      businessId: row.businessId,
      displayName: b ? await businessDisplayName(conn, b.b) : '',
      industrialAreaName: b?.areaName ?? null,
      city: b?.b.city ?? null,
      gstVerified: !!b?.b.verificationLevels.includes('gst'),
      memberSince: b ? b.b.createdAt.toISOString() : '',
      liveListings: live?.n ?? 0,
    },
    isOwner: false,
    publishedAt: iso(row.publishedAt),
  };

  return {
    row,
    node,
    template,
    detail,
    location: {
      source: row.locationSource,
      pincode: row.pincode,
      city: row.city,
      state: row.state,
      industrialAreaId: row.industrialAreaId,
      industrialAreaName: refs?.areaName ?? null,
      industrialAreaOther: row.industrialAreaOther,
      addressLine: row.addressLine,
      lat: refs?.lat == null ? null : Number(refs.lat),
      lng: refs?.lng == null ? null : Number(refs.lng),
    },
    photoCount: photos.length,
    videoCount: mediaRows.length - photos.length,
  };
}

/**
 * What today's rules would ask for on the stored listing (§7.3 nudges): `side` / `SIDE_REQUIRED` when the node has
 * sides and the listing has none, `specs.<key>` / `required`, `photos` / `required`, `priceModel` / `required`,
 * `pricePaise` / `PRICE_REQUIRED`, `gstMode` / `required` (unless Price on request), `rental.rates` / `RATE_REQUIRED`.
 * Never blocks an edit.
 */
export function attentionProblems(l: Pick<LoadedListing, 'row' | 'node' | 'template' | 'photoCount' | 'detail'>): ListingProblem[] {
  const { row } = l;
  const problems: ListingProblem[] = [];
  if (row.kind === 'part' && l.node?.effectiveHasSides && (row.side === null || row.side === 'not_applicable')) {
    problems.push({ field: 'side', code: 'SIDE_REQUIRED' });
  }
  if (l.template) {
    const result = checkSpecs(l.template, row.specs, row.specs);
    if (!result.ok) {
      for (const [key, code] of Object.entries(result.errors)) if (code === 'required') problems.push({ field: `specs.${key}`, code });
    }
  }
  if (l.photoCount === 0) problems.push({ field: 'photos', code: 'required' });
  if (row.kind === 'machine_rental') {
    if (!headlineRate(l.detail.rental)) problems.push({ field: 'rental.rates', code: 'RATE_REQUIRED' });
  } else if (!row.priceModel) {
    problems.push({ field: 'priceModel', code: 'required' });
  } else if (row.priceModel !== 'on_request') {
    if (row.pricePaise == null) problems.push({ field: 'pricePaise', code: 'PRICE_REQUIRED' });
    if (row.gstMode == null) problems.push({ field: 'gstMode', code: 'required' });
  }
  return problems;
}

/** Keys of the template's active optional fields that can be filled (the score's "every optional field" item). */
function optionalSpecKeys(template: EffectiveTemplate | null): string[] {
  if (!template) return [];
  return template.fields
    .filter((f) => f.status === 'active' && !isRequiredField(f))
    .filter((f) => (f.type === 'single_select' || f.type === 'multi_select' ? f.options.some((o) => o.status === 'active') : true))
    .map((f) => f.key);
}

/** Whether a listing has an open report (`open` or `reviewing`): side / fit edits then go back to review (R16). */
export async function hasOpenReport(conn: Conn, listingId: string): Promise<boolean> {
  const [row] = await conn
    .select({ id: reports.id })
    .from(reports)
    .where(and(eq(reports.targetType, 'listing'), eq(reports.targetId, listingId), inArray(reports.status, ['open', 'reviewing'])))
    .limit(1);
  return row !== undefined;
}

/**
 * The owner's view of their listing, any status (§7.3–§7.5): the detail with private fields, `needsAttention`,
 * `reviewOnEdit`, `expiresAt` / `expiringSoon` (`live` / `rented` only, from the current settings), moderation,
 * status reason, score, flags and media URLs.
 */
export async function toOwnerView(conn: Conn, row: ListingRow, settings: AppSettingsValues): Promise<ListingOwnerView> {
  const loaded = await loadListing(conn, row);
  const d = loaded.detail;

  let expiresAt: Date | null = null;
  let expiringSoon = false;
  if ((row.status === 'live' || row.status === 'rented') && row.refreshedAt) {
    expiresAt = new Date(row.refreshedAt.getTime() + settings.listing_expiry_days * DAY_MS);
    expiringSoon = expiresAt.getTime() - Date.now() <= settings.listing_expiry_reminder_days * DAY_MS;
  }

  return {
    ...d,
    isOwner: true,
    version: row.version,
    unitId: row.unitId,
    conditionId: row.conditionId,
    partBrandId: row.partBrandId,
    flags: row.flags,
    acceptedFlags: row.acceptedFlags,
    reviewReasons: row.reviewReasons,
    needsAttention: attentionProblems(loaded),
    reviewOnEdit: await hasOpenReport(conn, row.id),
    expiresAt: iso(expiresAt),
    expiringSoon,
    moderation: row.moderationOutcome
      ? {
          outcome: row.moderationOutcome,
          note: row.moderationNote,
          at: (row.moderatedAt ?? row.statusChangedAt ?? row.updatedAt).toISOString(),
        }
      : null,
    statusReason: row.statusReason,
    score: listingScore({
      kind: row.kind,
      photoCount: loaded.photoCount,
      videoCount: loaded.videoCount,
      partNumber: row.partNumber,
      fitmentCount: d.fitments.length,
      year: d.machine?.year ?? null,
      hoursRun: d.machine?.hoursRun ?? null,
      specs: row.specs,
      optionalSpecKeys: optionalSpecKeys(loaded.template),
      description: row.description,
    }),
    location: loaded.location,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
