import { and, asc, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import {
  MY_LISTINGS_GROUPS,
  REMOVED_BY_TEAM_DAYS,
  listingScore,
  type AppSettingsValues,
  type EffectiveTemplate,
  type ListingCard,
  type ListingDetail,
  type ListingOwnerView,
  type ListingStatus,
  type MyListingCard,
  type MyListingsGroup,
  type MyListingsView,
  type RentalTerms,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { listingFitments, listingMachines, listingMedia, listingRentals, listings } from '../../db/schema.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { getSettings } from '../settings.service.js';
import { loadNode, type ListingNode } from './listing-validate.service.js';
import { distancesKm } from '../discovery/distance.js';
import {
  attentionProblems,
  expiryOf,
  loadCards,
  loadListing,
  moderationOf,
  optionalSpecKeys,
  templateOf,
  toOwnerView,
} from './listing-view.service.js';
import { listingNotFound, type ListingRow } from './locks.js';
import { publicListingWhere } from './public-where.service.js';

// Listing reads (F2 spec §7.1, §8.1, §10, §14; plan Task 10): the public listing page, the owner view, My listings and a
// seller's public listings. A listing that isn't public is `404 LISTING_NOT_FOUND` to anyone but its owner, so ids
// don't leak existence. Public payloads never carry the serial number, the address line, the pincode or the point.

type Conn = Db | Tx;

/** The signed-in viewer of a public route (`fastify.optionalUser`), or a guest. */
export type Viewer = UserTokenPayload | undefined;

/**
 * The public detail (§4.4, §4.7, §8.1): the loaded detail without the serial number, plus the distance from the
 * viewer's business. `ListingDetail` has no pincode, address line or point; the owner view's `location` isn't copied.
 */
function toPublicDetail(detail: ListingDetail, distanceKm: number | null): ListingDetail {
  let machine = detail.machine;
  if (machine) {
    const { serialNumber: _serial, ...rest } = machine;
    machine = rest;
  }
  return { ...detail, machine, distanceKm, isOwner: false };
}

/**
 * Whether an admin removed the listing within `REMOVED_BY_TEAM_DAYS` (R50): the latest history row into `removed` has
 * actor `admin` and is newer than 30 days. A listing the seller removed is never shown again.
 */
function removedByTeamSql(t: { id: typeof listings.id } = listings): SQL {
  return sql`COALESCE((
    SELECT h.actor = 'admin' AND h.created_at > now() - make_interval(days => ${REMOVED_BY_TEAM_DAYS}::int)
    FROM listing_status_history h
    WHERE h.listing_id = ${t.id} AND h.to_status = 'removed'
    ORDER BY h.created_at DESC
    LIMIT 1
  ), false)`;
}

/**
 * `GET /listings/:id/owner` (§7.5, §14): the owner view in any status, for the caller's business only (`404`
 * otherwise); a `removed` listing only when an admin removed it in the last 30 days (its reason is `statusReason`).
 */
export async function getOwnerView(conn: Conn, user: UserTokenPayload, id: string): Promise<ListingOwnerView> {
  if (!user.businessId) throw listingNotFound();
  const [row] = await conn
    .select()
    .from(listings)
    .where(and(eq(listings.id, id), eq(listings.businessId, user.businessId), sql`(${listings.status} <> 'removed' OR ${removedByTeamSql()})`));
  if (!row) throw listingNotFound();
  return toOwnerView(conn, row, await getSettings(conn));
}

/**
 * `GET /listings/:id` (`optionalUser`, §8.1, R20): the owner gets their owner view (any status, as `getOwnerView`);
 * anyone else gets the public detail of a public listing (`publicListingWhere`), with the distance in whole km from
 * their business when both points are known; else `404 LISTING_NOT_FOUND`.
 */
export async function getListing(conn: Conn, id: string, viewer: Viewer): Promise<ListingDetail | ListingOwnerView> {
  const [owned] = viewer?.businessId
    ? await conn.select({ id: listings.id }).from(listings).where(and(eq(listings.id, id), eq(listings.businessId, viewer.businessId)))
    : [];
  if (owned && viewer) return getOwnerView(conn, viewer, id);

  const [row] = await conn.select().from(listings).where(and(eq(listings.id, id), publicListingWhere()));
  if (!row) throw listingNotFound();
  const loaded = await loadListing(conn, row);
  const distance = (await distancesKm(conn, [row.id], viewer?.businessId)).get(row.id) ?? null;
  return toPublicDetail(loaded.detail, distance);
}

const GROUP_STATUSES: Record<Exclude<MyListingsGroup, 'removed_by_team'>, readonly ListingStatus[]> = {
  live: ['live', 'reserved', 'rented'],
  review: ['pending_review', 'rejected'],
  paused: ['paused', 'expired', 'unavailable', 'hidden'],
  sold: ['sold'],
  drafts: ['draft'],
};

function groupWhere(group: MyListingsGroup): SQL {
  if (group === 'removed_by_team') return sql`(${listings.status} = 'removed' AND ${removedByTeamSql()})`;
  return sql`${listings.status} IN (${sql.join(GROUP_STATUSES[group].map((s) => sql`${s}`), sql`, `)})`;
}

export const MY_LISTINGS_PAGE_SIZE = 20;

type CategoryInfo = { node: ListingNode | null; template: EffectiveTemplate | null };

/**
 * The My listings cards of one page (§10) in a fixed number of queries, whatever the page size: the cards
 * (`loadCards`), then photo / video counts, fitment counts, machine year and hours, rental rates, and the node and
 * template once per distinct category. Built from the same helpers as `toOwnerView` (`attentionProblems`,
 * `listingScore`, `expiryOf`, `moderationOf`), so a card agrees with the owner view.
 */
async function myCards(conn: Conn, rows: ListingRow[], settings: AppSettingsValues): Promise<MyListingCard[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const cards = await loadCards(conn, rows);

  const mediaCounts = await conn
    .select({ listingId: listingMedia.listingId, type: listingMedia.type, n: sql<number>`count(*)::int` })
    .from(listingMedia)
    .where(inArray(listingMedia.listingId, ids))
    .groupBy(listingMedia.listingId, listingMedia.type);
  const fitmentCounts = await conn
    .select({ listingId: listingFitments.listingId, n: sql<number>`count(*)::int` })
    .from(listingFitments)
    .where(inArray(listingFitments.listingId, ids))
    .groupBy(listingFitments.listingId);
  const machineIds = rows.filter((r) => r.kind !== 'part').map((r) => r.id);
  const machineRows = machineIds.length
    ? await conn
        .select({ listingId: listingMachines.listingId, year: listingMachines.year, hoursRun: listingMachines.hoursRun })
        .from(listingMachines)
        .where(inArray(listingMachines.listingId, machineIds))
    : [];
  const rentalIds = rows.filter((r) => r.kind === 'machine_rental').map((r) => r.id);
  const rentalRows = rentalIds.length ? await conn.select().from(listingRentals).where(inArray(listingRentals.listingId, rentalIds)) : [];

  // Node and template once per distinct category and template kind.
  const categories = new Map<string, CategoryInfo>();
  for (const r of rows) {
    if (!r.categoryId) continue;
    const key = `${r.categoryId}:${r.kind === 'part' ? 'part' : 'machine'}`;
    if (categories.has(key)) continue;
    categories.set(key, { node: await loadNode(conn, r.categoryId), template: await templateOf(conn, r) });
  }

  const photos = new Map<string, number>();
  const videos = new Map<string, number>();
  for (const m of mediaCounts) (m.type === 'photo' ? photos : videos).set(m.listingId, Number(m.n));
  const fitments = new Map(fitmentCounts.map((f) => [f.listingId, Number(f.n)]));
  const machines = new Map(machineRows.map((m) => [m.listingId, m]));
  const rentals = new Map(rentalRows.map(({ listingId, ...terms }) => [listingId, terms as RentalTerms]));

  return rows.map((row, i) => {
    const info = row.categoryId ? categories.get(`${row.categoryId}:${row.kind === 'part' ? 'part' : 'machine'}`) : undefined;
    const photoCount = photos.get(row.id) ?? 0;
    const machine = machines.get(row.id);
    const { expiresAt, expiringSoon } = expiryOf(row, settings);
    const score = listingScore({
      kind: row.kind,
      photoCount,
      videoCount: videos.get(row.id) ?? 0,
      partNumber: row.partNumber,
      fitmentCount: fitments.get(row.id) ?? 0,
      year: machine?.year ?? null,
      hoursRun: machine?.hoursRun ?? null,
      specs: row.specs,
      optionalSpecKeys: optionalSpecKeys(info?.template ?? null),
      description: row.description,
    });
    return {
      ...cards[i]!,
      updatedAt: row.updatedAt.toISOString(),
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      expiringSoon,
      moderation: moderationOf(row),
      statusReason: row.statusReason,
      scoreMissing: score.missing,
      needsAttention: attentionProblems({
        row,
        node: info?.node ?? null,
        template: info?.template ?? null,
        photoCount,
        detail: { rental: rentals.get(row.id) ?? null },
      }),
    };
  });
}

/**
 * `GET /listings/mine?group=&page=` (§10, R29): the counts of every group in one query, plus one page (20, newest
 * update first) of the asked group. Groups: Live (`live`, `reserved`, `rented`), In review (`pending_review`,
 * `rejected`), Paused (`paused`, `expired`, `unavailable`, `hidden`), Sold, Drafts, and Removed by our team (an admin
 * removed it within 30 days). The page costs a fixed number of queries (`myCards`).
 */
export async function listMine(conn: Conn, user: UserTokenPayload, group: MyListingsGroup, page: number): Promise<MyListingsView> {
  const counts = Object.fromEntries(MY_LISTINGS_GROUPS.map((g) => [g, 0])) as Record<MyListingsGroup, number>;
  if (!user.businessId) return { counts, group, items: [], total: 0, page, pageSize: MY_LISTINGS_PAGE_SIZE };

  const mine = eq(listings.businessId, user.businessId);
  const [row] = await conn
    .select(
      Object.fromEntries(
        MY_LISTINGS_GROUPS.map((g) => [g, sql<number>`(count(*) FILTER (WHERE ${groupWhere(g)}))::int`]),
      ) as Record<MyListingsGroup, SQL<number>>,
    )
    .from(listings)
    .where(mine);
  for (const g of MY_LISTINGS_GROUPS) counts[g] = Number(row?.[g] ?? 0);

  const rows = await conn
    .select()
    .from(listings)
    .where(and(mine, groupWhere(group)))
    .orderBy(desc(listings.updatedAt), asc(listings.id))
    .limit(MY_LISTINGS_PAGE_SIZE)
    .offset((page - 1) * MY_LISTINGS_PAGE_SIZE);
  const items = await myCards(conn, rows, await getSettings(conn));
  return { counts, group, items, total: counts[group], page, pageSize: MY_LISTINGS_PAGE_SIZE };
}

export const SELLER_LISTINGS_MAX = 50;

/**
 * `GET /businesses/:id/listings?limit=&exclude=` (§8.1 items 8–9, R23): a seller's public listings, newest first
 * (`published_at`), at most 50, optionally without one (the listing being viewed). A restricted business has none.
 */
export async function listSellerListings(
  conn: Conn,
  businessId: string,
  opts: { limit: number; exclude?: string; viewer?: Viewer },
): Promise<ListingCard[]> {
  const rows: ListingRow[] = await conn
    .select()
    .from(listings)
    .where(and(eq(listings.businessId, businessId), publicListingWhere(), opts.exclude ? ne(listings.id, opts.exclude) : undefined))
    .orderBy(sql`${listings.publishedAt} DESC NULLS LAST`, desc(listings.createdAt))
    .limit(Math.min(opts.limit, SELLER_LISTINGS_MAX));
  return loadCards(conn, rows, { viewerBusinessId: opts.viewer?.businessId, viewerUserId: opts.viewer?.userId });
}
