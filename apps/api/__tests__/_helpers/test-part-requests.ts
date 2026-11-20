import { and, eq, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import {
  normalizePartName,
  normalizePartNumber,
  partNumberBase,
  type PartRequestAudience,
  type PartRequestDropReason,
  type PartRequestFeedbackReason,
  type PartRequestFitInput,
  type PartRequestKind,
  type PartRequestMatchSource,
  type PartRequestMatchTier,
  type PartRequestReach,
  type PartRequestReplyStatus,
  type PartRequestStatus,
  type PartSide,
} from '@mpm/shared-types';
import { db, type Db, type Tx } from '../../src/db/index.js';
import {
  businesses,
  categories,
  listings,
  notificationDeliveries,
  notifications,
  partRequestFeedback,
  partRequestFitments,
  partRequestMatches,
  partRequestPushCounts,
  partRequestReplies,
  partRequestTargets,
  partRequestWork,
  partRequests,
  reports,
  units,
} from '../../src/db/schema.js';
import { createTestCatalog, deleteTestCatalog } from './test-catalog.js';

// F8 fixtures (plan C0-2). Rows are written directly, so request, reply and match tests start from any state without
// the services. Cleanup: `deleteF8Rows` (called by `deleteListingsOf`, `deleteTestListings`, `deleteTestUsers` and,
// through `deleteListingsOf`, `deleteTestBusinesses`, before `deleteF6Rows`), so a suite's usual
// `deleteTestBusinesses` in `afterAll` removes this feature's rows first.

type Conn = Db | Tx;
type Point = { lat: number; lng: number };
export type TestPartRequestRow = typeof partRequests.$inferSelect;

const DAY_MS = 24 * 60 * 60 * 1000;
const ids = (rows: Array<{ id: string }>): string[] => rows.map((r) => r.id);

export interface TestPartTree {
  machineCategory: { id: string; path: string };
  /** "Test Loom": sides on. */
  machineType: { id: string; path: string };
  /** `hasSides` (default true): "Test Temples" (inherits sides from the loom); false: "Test Motors" (sides off). */
  partGroup: { id: string; path: string };
  /** The tree's own unit and condition (from `createTestCatalog`). */
  unitId: string;
  conditionId: string;
  /** Deletes the tree (and any node a test added under it), its unit and condition. Run after the businesses. */
  cleanup: () => Promise<void>;
}

/** A machine category → machine type → part group tree (`createTestCatalog`'s). */
export async function createTestPartTree(opts: { hasSides?: boolean } = {}): Promise<TestPartTree> {
  const c = await createTestCatalog();
  const nodeIds = [c.categoryId, c.machineTypeId, opts.hasSides === false ? c.motorsGroupId : c.partGroupId];
  const rows = await db.select({ id: categories.id, path: categories.path }).from(categories).where(inArray(categories.id, nodeIds));
  const node = (id: string) => {
    const r = rows.find((x) => x.id === id);
    if (!r) throw new Error('createTestPartTree: node missing');
    return { id: r.id, path: r.path };
  };
  return {
    machineCategory: node(nodeIds[0]!),
    machineType: node(nodeIds[1]!),
    partGroup: node(nodeIds[2]!),
    unitId: c.unitId,
    conditionId: c.conditionId,
    cleanup: () => deleteTestCatalog(c.categoryId),
  };
}

export interface TestPartRequestOptions {
  businessId: string;
  userId: string;
  categoryId: string;
  /** Default `part`. */
  kind?: PartRequestKind;
  /** Default "Test temple roller". */
  name?: string;
  partNumber?: string | null;
  side?: PartSide | null;
  fits?: PartRequestFitInput[];
  conditionIds?: string[];
  /** Default "1". */
  quantity?: string;
  /** Default the first unit by sort order. */
  unitId?: string;
  /** Default `radius_200`. */
  reach?: PartRequestReach;
  /** Default `any_seller` (fixtures need no GST; pass `verified_only` to test it). */
  audience?: PartRequestAudience;
  /** Default `active`; `closed` gets `close_reason` `other`, `removed` gets `removed_at` and `return_status` `active`. */
  status?: PartRequestStatus;
  returnStatus?: PartRequestStatus | null;
  /** Default the business's location; null for none. */
  point?: Point | null;
  /** Default the business's state. */
  state?: string | null;
  /** Default now + 15 days. */
  expiresAt?: Date;
  firstPostedAt?: Date;
  budgetPerUnitPaise?: number | null;
  budgetVisible?: boolean;
  note?: string | null;
}

/**
 * Writes a part request directly (norms through the shared normalisers, the business's location snapshot unless told,
 * fitments in order), bypassing the services. Returns the row.
 */
export async function insertTestPartRequest(o: TestPartRequestOptions, conn: Conn = db): Promise<TestPartRequestRow> {
  const [biz] = await conn
    .select({ pincode: businesses.pincode, city: businesses.city, state: businesses.state, location: businesses.location })
    .from(businesses)
    .where(eq(businesses.id, o.businessId));
  if (!biz) throw new Error('insertTestPartRequest: no such business');
  let unitId = o.unitId;
  if (!unitId) {
    const [u] = await conn.select({ id: units.id }).from(units).orderBy(units.sortOrder, units.id).limit(1);
    if (!u) throw new Error('insertTestPartRequest: no unit in the database; pass unitId');
    unitId = u.id;
  }
  const kind = o.kind ?? 'part';
  const name = o.name ?? 'Test temple roller';
  const side = o.side ?? null;
  const partNumber = kind === 'part' ? o.partNumber ?? null : null;
  const norm = partNumber ? normalizePartNumber(partNumber) : null;
  const status = o.status ?? 'active';
  const now = new Date();
  const point =
    o.point === undefined
      ? biz.location
        ? sql`${biz.location}::geography`
        : null
      : o.point
        ? sql`ST_SetSRID(ST_MakePoint(${o.point.lng}, ${o.point.lat}), 4326)::geography`
        : null;

  const [row] = await conn
    .insert(partRequests)
    .values({
      businessId: o.businessId,
      createdByUserId: o.userId,
      kind,
      status,
      returnStatus: o.returnStatus !== undefined ? o.returnStatus : status === 'removed' ? 'active' : null,
      categoryId: o.categoryId,
      name,
      nameNorm: normalizePartName(name),
      partNumber,
      partNumberNorm: norm,
      partNumberBase: norm ? partNumberBase(norm, side) : null,
      side: kind === 'part' ? side : null,
      quantity: o.quantity ?? '1',
      unitId,
      conditionIds: o.conditionIds ?? [],
      budgetPerUnitPaise: o.budgetPerUnitPaise ?? null,
      budgetVisible: o.budgetVisible ?? false,
      reach: o.reach ?? 'radius_200',
      audience: o.audience ?? 'any_seller',
      point,
      pincode: biz.pincode,
      city: biz.city,
      state: o.state !== undefined ? o.state : biz.state,
      note: o.note ?? null,
      validityDays: 15,
      firstPostedAt: o.firstPostedAt ?? now,
      expiresAt: o.expiresAt ?? new Date(now.getTime() + 15 * DAY_MS),
      closeReason: status === 'closed' ? 'other' : null,
      closedAt: status === 'closed' ? now : null,
      fulfilledAt: status === 'fulfilled' ? now : null,
      removedAt: status === 'removed' ? now : null,
      removedReason: status === 'removed' ? 'Test removal' : null,
    })
    .returning();
  if (o.fits?.length) {
    await conn.insert(partRequestFitments).values(
      o.fits.map((f, i) => ({
        partRequestId: row!.id,
        brandId: f.brandId,
        modelId: f.modelId ?? null,
        yearFrom: f.yearFrom ?? null,
        yearTo: f.yearTo ?? null,
        sortOrder: i,
      })),
    );
  }
  return row!;
}

/** A reply row (default `delivered` now). */
export async function insertTestReply(
  o: {
    partRequestId: string;
    sellerBusinessId: string;
    listingId: string;
    userId: string;
    status?: PartRequestReplyStatus;
    message?: string | null;
    dropReason?: PartRequestDropReason | null;
  },
  conn: Conn = db,
): Promise<typeof partRequestReplies.$inferSelect> {
  const status = o.status ?? 'delivered';
  const now = new Date();
  const [row] = await conn
    .insert(partRequestReplies)
    .values({
      partRequestId: o.partRequestId,
      sellerBusinessId: o.sellerBusinessId,
      listingId: o.listingId,
      createdByUserId: o.userId,
      message: o.message ?? null,
      status,
      dropReason: status === 'dropped' ? o.dropReason ?? 'not_eligible' : null,
      deliveredAt: status === 'delivered' ? now : null,
      withdrawnAt: status === 'withdrawn' ? now : null,
      droppedAt: status === 'dropped' ? now : null,
    })
    .returning();
  return row!;
}

/** A match row (default tier `name`, source `listing_live`). */
export async function insertTestMatch(
  o: {
    partRequestId: string;
    listingId: string;
    sellerBusinessId: string;
    tier?: PartRequestMatchTier;
    distanceKm?: number | null;
    source?: PartRequestMatchSource;
    pushed?: boolean;
  },
  conn: Conn = db,
): Promise<typeof partRequestMatches.$inferSelect> {
  const [row] = await conn
    .insert(partRequestMatches)
    .values({
      partRequestId: o.partRequestId,
      listingId: o.listingId,
      sellerBusinessId: o.sellerBusinessId,
      tier: o.tier ?? 'name',
      distanceKm: o.distanceKm ?? null,
      source: o.source ?? 'listing_live',
      pushed: o.pushed ?? false,
    })
    .returning();
  return row!;
}

/** A target row (default score 50, rank 1, pass 1, not pushed). */
export async function insertTestTarget(
  o: {
    partRequestId: string;
    businessId: string;
    score?: string;
    rank?: number;
    pass?: number;
    bestListingId?: string | null;
    pushed?: boolean;
    openedAt?: Date | null;
  },
  conn: Conn = db,
): Promise<typeof partRequestTargets.$inferSelect> {
  const [row] = await conn
    .insert(partRequestTargets)
    .values({
      partRequestId: o.partRequestId,
      businessId: o.businessId,
      score: o.score ?? '50',
      rank: o.rank ?? 1,
      pass: o.pass ?? 1,
      bestListingId: o.bestListingId ?? null,
      pushed: o.pushed ?? false,
      openedAt: o.openedAt ?? null,
    })
    .returning();
  return row!;
}

/** A Not relevant row (reason default none). */
export async function insertTestFeedback(
  o: { partRequestId: string; businessId: string; userId: string; reason?: PartRequestFeedbackReason | null },
  conn: Conn = db,
): Promise<typeof partRequestFeedback.$inferSelect> {
  const [row] = await conn
    .insert(partRequestFeedback)
    .values({ partRequestId: o.partRequestId, businessId: o.businessId, userId: o.userId, reason: o.reason ?? null })
    .returning();
  return row!;
}

/**
 * Every F8 row in the database, by table (plus notifications pointing at a request and part-request reports): the
 * "left clean" checks expect all zeros.
 */
export async function countF8Rows(conn: Conn = db): Promise<Record<string, number>> {
  const n = async (q: Promise<Array<{ n: number }>>): Promise<number> => Number((await q)[0]?.n ?? 0);
  const c = sql<number>`count(*)::int`;
  return {
    part_requests: await n(conn.select({ n: c }).from(partRequests)),
    part_request_fitments: await n(conn.select({ n: c }).from(partRequestFitments)),
    part_request_targets: await n(conn.select({ n: c }).from(partRequestTargets)),
    part_request_replies: await n(conn.select({ n: c }).from(partRequestReplies)),
    part_request_matches: await n(conn.select({ n: c }).from(partRequestMatches)),
    part_request_feedback: await n(conn.select({ n: c }).from(partRequestFeedback)),
    part_request_work: await n(conn.select({ n: c }).from(partRequestWork)),
    part_request_push_counts: await n(conn.select({ n: c }).from(partRequestPushCounts)),
    notifications_with_request: await n(conn.select({ n: c }).from(notifications).where(isNotNull(notifications.partRequestId))),
    part_request_reports: await n(conn.select({ n: c }).from(reports).where(sql`${reports.targetType} = 'part_request'`)),
  };
}

/**
 * Deletes F8 rows hanging off the given businesses, users, listings and requests, deepest foreign key first:
 * deliveries + notifications of those requests, reports on them, work rows (the requests, the listings passed and every
 * listing of the businesses passed), push counts, feedback, matches, replies, targets, fitments, then the requests
 * (the businesses' own and those passed). No-op when every list is empty. Call before `deleteF6Rows`.
 */
export async function deleteF8Rows(
  conn: Conn,
  opts: { businessIds: string[]; userIds?: string[]; listingIds?: string[]; partRequestIds?: string[] },
): Promise<void> {
  const businessIds = opts.businessIds;
  const userIds = opts.userIds ?? [];
  if (businessIds.length === 0 && userIds.length === 0 && !opts.listingIds?.length && !opts.partRequestIds?.length) return;

  const listingIds = [...(opts.listingIds ?? [])];
  if (businessIds.length) {
    listingIds.push(...ids(await conn.select({ id: listings.id }).from(listings).where(inArray(listings.businessId, businessIds))));
  }

  const requestWhere: SQL[] = [];
  if (opts.partRequestIds?.length) requestWhere.push(inArray(partRequests.id, opts.partRequestIds));
  if (businessIds.length) requestWhere.push(inArray(partRequests.businessId, businessIds));
  if (userIds.length) requestWhere.push(inArray(partRequests.createdByUserId, userIds));
  const requestIds = requestWhere.length
    ? ids(await conn.select({ id: partRequests.id }).from(partRequests).where(or(...requestWhere)))
    : [];

  if (requestIds.length) {
    const notificationIds = ids(
      await conn.select({ id: notifications.id }).from(notifications).where(inArray(notifications.partRequestId, requestIds)),
    );
    if (notificationIds.length) {
      await conn.delete(notificationDeliveries).where(inArray(notificationDeliveries.notificationId, notificationIds));
      await conn.delete(notifications).where(inArray(notifications.id, notificationIds));
    }
    await conn.delete(reports).where(and(sql`${reports.targetType} = 'part_request'`, inArray(reports.targetId, requestIds)));
  }

  const subjectIds = [...requestIds, ...listingIds];
  if (subjectIds.length) await conn.delete(partRequestWork).where(inArray(partRequestWork.subjectId, subjectIds));
  if (businessIds.length) await conn.delete(partRequestPushCounts).where(inArray(partRequestPushCounts.businessId, businessIds));

  const childWhere = <T extends typeof partRequestFeedback | typeof partRequestTargets>(
    t: T,
    extra: SQL[],
  ): SQL | undefined => {
    const w: SQL[] = [...extra];
    if (requestIds.length) w.push(inArray(t.partRequestId, requestIds));
    if (businessIds.length) w.push(inArray(t.businessId, businessIds));
    return w.length ? or(...w) : undefined;
  };

  const feedbackWhere = childWhere(partRequestFeedback, userIds.length ? [inArray(partRequestFeedback.userId, userIds)] : []);
  if (feedbackWhere) await conn.delete(partRequestFeedback).where(feedbackWhere);

  const matchWhere: SQL[] = [];
  if (requestIds.length) matchWhere.push(inArray(partRequestMatches.partRequestId, requestIds));
  if (listingIds.length) matchWhere.push(inArray(partRequestMatches.listingId, listingIds));
  if (businessIds.length) matchWhere.push(inArray(partRequestMatches.sellerBusinessId, businessIds));
  if (matchWhere.length) await conn.delete(partRequestMatches).where(or(...matchWhere));

  const replyWhere: SQL[] = [];
  if (requestIds.length) replyWhere.push(inArray(partRequestReplies.partRequestId, requestIds));
  if (listingIds.length) replyWhere.push(inArray(partRequestReplies.listingId, listingIds));
  if (businessIds.length) replyWhere.push(inArray(partRequestReplies.sellerBusinessId, businessIds));
  if (userIds.length) replyWhere.push(inArray(partRequestReplies.createdByUserId, userIds));
  if (replyWhere.length) await conn.delete(partRequestReplies).where(or(...replyWhere));

  const targetWhere = childWhere(
    partRequestTargets,
    listingIds.length ? [inArray(partRequestTargets.bestListingId, listingIds)] : [],
  );
  if (targetWhere) await conn.delete(partRequestTargets).where(targetWhere);

  if (requestIds.length) {
    await conn.delete(partRequestFitments).where(inArray(partRequestFitments.partRequestId, requestIds));
    await conn.delete(partRequests).where(inArray(partRequests.id, requestIds));
  }
}

