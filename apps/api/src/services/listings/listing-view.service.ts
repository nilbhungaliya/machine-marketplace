import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  listingScore,
  milliToQuantity,
  quantityToMilli,
  type AppSettingsValues,
  type EffectiveTemplate,
  type Fitment,
  type ListingCard,
  type ListingCardTag,
  type ListingDetail,
  type ListingMediaItem,
  type ListingOwnerView,
  type ListingProblem,
  type MachineDetails,
  type RentalPeriod,
  type RentalTerms,
  type SearchSide,
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
  savedListings,
  units,
} from '../../db/schema.js';
import { NotFoundError } from '../../lib/errors.js';
import { publicUrl } from '../../lib/media-url.js';
import { checkSpecs, isRequiredField } from '../../lib/spec-check.js';
import { businessDisplayName } from '../business/profile.service.js';
import { sellerScore } from '../reviews/review-scores.js';
import { loadTemplate } from '../catalog/read.service.js';
import { distancesKm, snappedDistancesKm, type LatLng } from '../discovery/distance.js';
import { loadNode, type ListingNode } from './listing-validate.service.js';
import type { ListingRow } from './locks.js';
import { publicListingWhere } from './public-where.service.js';

// Listing payloads (F2 spec §7.3–§7.5, §8.1, §13.4). The owner view is built here (plan Task 6); Task 10 builds the
// public detail from the same loader and strips the private fields (serial number, address line, pincode, point).

type Conn = Db | Tx;
const DAY_MS = 24 * 60 * 60 * 1000;

/** `numeric(14,3)` comes back as `'2.500'`: drop trailing zeros (`'2.5'`, `'1'`). */
export function trimQuantity(value: string | null): string | null {
  if (value === null) return null;
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}

/**
 * F6 + F7 §8.4: what buyers can still take, `quantity − held_quantity` (trimmed, never below 0); null without a
 * quantity. The same as `availableOf` in `services/deals/holds.ts`, kept here so views don't import the hold writer.
 */
export function availableQuantityOf(row: Pick<ListingRow, 'quantity' | 'heldQuantity'>): string | null {
  if (row.quantity === null) return null;
  const available = quantityToMilli(row.quantity) - quantityToMilli(row.heldQuantity);
  return milliToQuantity(available < 0n ? 0n : available);
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
export async function templateOf(conn: Conn, row: Pick<ListingRow, 'categoryId' | 'kind'>): Promise<EffectiveTemplate | null> {
  if (!row.categoryId) return null;
  try {
    return await loadTemplate(conn, row.categoryId, row.kind === 'part' ? 'part' : 'machine', { includeRetired: true, allowInactive: true });
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

interface CardParts {
  condition: { key: string; label: string } | null;
  unit: { key: string; label: string; decimals: number } | null;
  rental: Pick<RentalRow, 'rateDayPaise' | 'rateHourPaise' | 'rateWeekPaise' | 'rateMonthPaise'> | null;
  thumbKey: string | null;
  areaName: string | null;
  distanceKm: number | null;
  saved?: boolean | null;
  tags?: ListingCardTag[];
}

/** A listing card (§13.4 `ListingCard`): never a pincode, address line or point. */
function cardFrom(row: ListingRow, p: CardParts): ListingCard {
  return {
    id: row.id,
    ref: row.ref,
    kind: row.kind,
    status: row.status,
    title: row.title ?? '',
    side: row.side,
    condition: p.condition,
    quantity: trimQuantity(row.quantity),
    // F6 + F7 §8.4: quantity − held_quantity.
    availableQuantity: availableQuantityOf(row),
    unit: p.unit,
    priceModel: row.priceModel,
    pricePaise: row.pricePaise,
    gstMode: row.gstMode,
    rate: headlineRate(p.rental),
    thumbUrl: publicUrl(p.thumbKey),
    city: row.city,
    industrialAreaName: p.areaName,
    distanceKm: p.distanceKm,
    refreshedAt: iso(row.refreshedAt),
    businessId: row.businessId,
    saved: p.saved ?? null,
    tags: p.tags ?? cardTags(row, null),
  };
}

export interface LoadCardsOptions {
  /** The signed-in viewer: `saved` is true / false for them, null without one (F4 + F5 §7). */
  viewerUserId?: string | null;
  /** F2: the distance from the viewer business (rounded km) when no `origin` is given. */
  viewerBusinessId?: string | null;
  /** Discovery: the resolved origin; the distance is the snapped whole km of §6.2 from the listing's search point. */
  origin?: LatLng | null;
  /** The search's side filter: a Pair under Left / Right gets "Pair: contains a left / right" (R6). */
  side?: SearchSide | null;
}

/** A card's tags (§4.7): Reserved, On rent (a rented rental), and a Pair shown under a Left / Right side filter. */
export function cardTags(row: Pick<ListingRow, 'status' | 'kind' | 'side'>, side: SearchSide | null | undefined): ListingCardTag[] {
  const tags: ListingCardTag[] = [];
  if (row.status === 'reserved') tags.push('reserved');
  if (row.status === 'rented' && row.kind === 'machine_rental') tags.push('on_rent');
  if (row.side === 'pair' && side === 'left') tags.push('pair_contains_left');
  if (row.side === 'pair' && side === 'right') tags.push('pair_contains_right');
  return tags;
}

/** Which of the listings the user saved. */
async function savedIds(conn: Conn, userId: string, listingIds: string[]): Promise<Set<string>> {
  const rows = await conn
    .select({ id: savedListings.listingId })
    .from(savedListings)
    .where(and(eq(savedListings.userId, userId), inArray(savedListings.listingId, listingIds)));
  return new Set(rows.map((r) => r.id));
}

/**
 * Cards for many listings in a fixed number of queries (seller listings, Other side, discovery): conditions, units,
 * industrial areas, the first photo's thumbnail, rental rates, the distance (from `origin`, else from the viewer
 * business), `saved` for a signed-in viewer and the tags. Order as given.
 */
export async function loadCards(conn: Conn, rows: ListingRow[], opts: LoadCardsOptions = {}): Promise<ListingCard[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const uniq = (xs: Array<string | null>) => [...new Set(xs.filter((x): x is string => x !== null))];
  const conditionIds = uniq(rows.map((r) => r.conditionId));
  const unitIds = uniq(rows.map((r) => r.unitId));
  const areaIds = uniq(rows.map((r) => r.industrialAreaId));

  const conditionRows = conditionIds.length
    ? await conn.select({ id: conditions.id, key: conditions.key, label: conditions.label }).from(conditions).where(inArray(conditions.id, conditionIds))
    : [];
  const unitRows = unitIds.length
    ? await conn.select({ id: units.id, key: units.key, label: units.label, decimals: units.decimals }).from(units).where(inArray(units.id, unitIds))
    : [];
  const areaRows = areaIds.length
    ? await conn.select({ id: industrialAreas.id, name: industrialAreas.name }).from(industrialAreas).where(inArray(industrialAreas.id, areaIds))
    : [];
  const photoRows = await conn
    .select({ listingId: listingMedia.listingId, thumbKey: listingMedia.thumbKey })
    .from(listingMedia)
    .where(and(inArray(listingMedia.listingId, ids), eq(listingMedia.type, 'photo')))
    .orderBy(asc(listingMedia.sortOrder), asc(listingMedia.createdAt));
  const rentalIds = rows.filter((r) => r.kind === 'machine_rental').map((r) => r.id);
  const rentalRows = rentalIds.length ? await conn.select().from(listingRentals).where(inArray(listingRentals.listingId, rentalIds)) : [];
  const distances = opts.origin ? await snappedDistancesKm(conn, ids, opts.origin) : await distancesKm(conn, ids, opts.viewerBusinessId);
  const saved = opts.viewerUserId ? await savedIds(conn, opts.viewerUserId, ids) : null;

  const thumbs = new Map<string, string | null>();
  for (const p of photoRows) if (!thumbs.has(p.listingId)) thumbs.set(p.listingId, p.thumbKey);
  const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));
  const conds = byId(conditionRows);
  const unitMap = byId(unitRows);
  const areas = byId(areaRows);
  const rentals = new Map(rentalRows.map((r) => [r.listingId, r]));

  return rows.map((row) => {
    const c = row.conditionId ? conds.get(row.conditionId) : undefined;
    const u = row.unitId ? unitMap.get(row.unitId) : undefined;
    return cardFrom(row, {
      condition: c ? { key: c.key, label: c.label } : null,
      unit: u ? { key: u.key, label: u.label, decimals: u.decimals } : null,
      rental: rentals.get(row.id) ?? null,
      thumbKey: thumbs.get(row.id) ?? null,
      areaName: row.industrialAreaId ? (areas.get(row.industrialAreaId)?.name ?? null) : null,
      distanceKm: distances.get(row.id) ?? null,
      saved: saved ? saved.has(row.id) : null,
      tags: cardTags(row, opts.side),
    });
  });
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
    .where(and(eq(listings.businessId, row.businessId), publicListingWhere()));

  const card = cardFrom(row, {
    condition: condition ?? null,
    unit: unit ?? null,
    rental: rentalRow,
    thumbKey: photos[0]?.thumbKey ?? null,
    areaName: refs?.areaName ?? null,
    distanceKm: null,
  });

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
      // F6 + F7 §10.4 (null until L4's score has enough published reviews).
      score: await sellerScore(conn, row.businessId),
    },
    isOwner: false,
    publishedAt: iso(row.publishedAt),
    // F6 + F7 §12.2: the signed-in buyer's thread and negotiation, filled by `getListing` (null here).
    myThreadId: null,
    openNegotiation: null,
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
export function attentionProblems(
  l: Pick<LoadedListing, 'row' | 'node' | 'template' | 'photoCount'> & { detail: Pick<ListingDetail, 'rental'> },
): ListingProblem[] {
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
export function optionalSpecKeys(template: EffectiveTemplate | null): string[] {
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

/** `expiresAt` / `expiringSoon` (§7.4): `live` / `rented` only, from the current settings. */
export function expiryOf(
  row: Pick<ListingRow, 'status' | 'refreshedAt'>,
  settings: AppSettingsValues,
): { expiresAt: Date | null; expiringSoon: boolean } {
  if ((row.status !== 'live' && row.status !== 'rented') || !row.refreshedAt) return { expiresAt: null, expiringSoon: false };
  const expiresAt = new Date(row.refreshedAt.getTime() + settings.listing_expiry_days * DAY_MS);
  return { expiresAt, expiringSoon: expiresAt.getTime() - Date.now() <= settings.listing_expiry_reminder_days * DAY_MS };
}

/** A moderator's last decision as the owner sees it. */
export function moderationOf(row: ListingRow): ListingOwnerView['moderation'] {
  return row.moderationOutcome
    ? { outcome: row.moderationOutcome, note: row.moderationNote, at: (row.moderatedAt ?? row.statusChangedAt ?? row.updatedAt).toISOString() }
    : null;
}

/**
 * The owner's view of their listing, any status (§7.3–§7.5): the detail with private fields, `needsAttention`,
 * `reviewOnEdit`, `expiresAt` / `expiringSoon` (`live` / `rented` only, from the current settings), moderation,
 * status reason, score, flags and media URLs.
 */
export async function toOwnerView(conn: Conn, row: ListingRow, settings: AppSettingsValues): Promise<ListingOwnerView> {
  const loaded = await loadListing(conn, row);
  const d = loaded.detail;

  const { expiresAt, expiringSoon } = expiryOf(row, settings);

  return {
    ...d,
    isOwner: true,
    version: row.version,
    // F6 + F7 §8.4: on hold in open deals ("On hold in deals: n").
    heldQuantity: trimQuantity(row.heldQuantity) ?? '0',
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
    moderation: moderationOf(row),
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
