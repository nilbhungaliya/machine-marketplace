import { and, eq, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  partRequestDaysLeft,
  type PartRequestBuyerBlock,
  type PartRequestSellerView,
  type SellerPartRequestRow,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { businesses, partRequestTargets, partRequests, units, users } from '../../db/schema.js';
import { maskContact } from '../../lib/mask-contact.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { businessPointSql, snappedKmBetweenSql } from '../discovery/distance.js';
import { trimQuantity } from '../listings/listing-view.service.js';
import { getSettings } from '../settings.service.js';
import { buyerCounts, fitLine, loadFitViews, requestCommon } from './buyer-view.js';
import { eligibleSellerSql } from './eligibility.js';
import { partRequestNotFound, type PartRequestRow } from './locks.js';
import { sellerReplyViews } from './reply-views.js';

// The request as an eligible seller sees it (spec §12.3; plan A1-4; textile `services/requirements/eligibility.ts` seller
// list). Never the buyer's phone, email, pincode, address, point or industrial area id, nor the budget when private;
// `name`, `note` and the buyer's trade name masked; distances snapped whole km from the seller's business point.

type Conn = Db | Tx;

/** The buyer business row joined to a seller read. */
const bb = alias(businesses, 'bb');

/**
 * Per-request facts for one seller business, as SQL over the `part_requests` row of the query (table unaliased):
 * targeted (+ when), not relevant, matching stock, snapped km and reach, reply counts. Shared by the list, Home and the
 * detail, so every surface sorts and labels the same way.
 */
export function sellerFacts(sellerBusinessId: string) {
  const s = sql`${sellerBusinessId}::uuid`;
  const sellerPoint = businessPointSql(sellerBusinessId);
  const km = snappedKmBetweenSql(sql`part_requests.point`, sellerPoint);
  const notifiedAt = sql<Date | null>`(SELECT t.notified_at FROM part_request_targets t
    WHERE t.part_request_id = part_requests.id AND t.business_id = ${s})`;
  const targeted = sql<boolean>`(${notifiedAt} IS NOT NULL)`;
  const notRelevant = sql<boolean>`EXISTS (SELECT 1 FROM part_request_feedback f
    WHERE f.part_request_id = part_requests.id AND f.business_id = ${s})`;
  const hasStock = sql<boolean>`EXISTS (
    SELECT 1 FROM listings sl
    JOIN categories slc ON slc.id = sl.category_id
    JOIN categories src ON src.id = part_requests.category_id
    WHERE sl.business_id = ${s} AND sl.status = 'live' AND sl.kind::text = part_requests.kind::text
      AND (slc.path = src.path OR slc.path LIKE src.path || '/%'))`;
  const inReach = sql<boolean>`(CASE part_requests.reach
    WHEN 'radius_50' THEN COALESCE(${km} <= 50, false)
    WHEN 'radius_200' THEN COALESCE(${km} <= 200, false)
    WHEN 'state' THEN COALESCE(lower(part_requests.state) = lower((SELECT sb.state FROM businesses sb WHERE sb.id = ${s})), false)
    ELSE true END)`;
  const replyCount = sql<number>`(SELECT count(*)::int FROM part_request_replies rr
    WHERE rr.part_request_id = part_requests.id AND rr.status = 'delivered')`;
  const myReplyCount = sql<number>`(SELECT count(*)::int FROM part_request_replies rr
    WHERE rr.part_request_id = part_requests.id AND rr.seller_business_id = ${s} AND rr.status IN ('pending', 'delivered'))`;
  const replied = sql<boolean>`EXISTS (SELECT 1 FROM part_request_replies rr
    WHERE rr.part_request_id = part_requests.id AND rr.seller_business_id = ${s})`;
  /** Sort group (§12.3): 0 targeted, 1 in reach with stock, 2 in reach, 3 outside with stock, 4 outside. */
  const group = sql<number>`(CASE WHEN ${targeted} THEN 0
    WHEN ${inReach} THEN (CASE WHEN ${hasStock} THEN 1 ELSE 2 END)
    ELSE (CASE WHEN ${hasStock} THEN 3 ELSE 4 END) END)`;
  /** Targeted rows by their notice, the others by the request's creation. */
  const sortAt = sql<Date>`COALESCE(${notifiedAt}, part_requests.created_at)`;
  return { eligible: eligibleSellerSql(sellerBusinessId), notifiedAt, targeted, notRelevant, hasStock, inReach, km, replyCount, myReplyCount, replied, group, sortAt };
}

export type SellerFacts = ReturnType<typeof sellerFacts>;

/** The rows a seller read selects: the request, its buyer block, unit label and the facts. */
export function sellerSelect(conn: Conn, f: SellerFacts) {
  return conn
    .select({
      r: partRequests,
      unitLabel: units.label,
      buyerTradeName: bb.tradeName,
      buyerCity: bb.city,
      buyerVerified: sql<boolean>`(bb.verification_levels ? 'gst')`,
      buyerSince: sql<number>`extract(year from bb.created_at)::int`,
      targeted: f.targeted,
      notRelevant: f.notRelevant,
      hasStock: f.hasStock,
      inReach: f.inReach,
      km: f.km,
      replyCount: f.replyCount,
      myReplyCount: f.myReplyCount,
      group: f.group,
      sortAt: sql<string>`to_char(${f.sortAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`,
    })
    .from(partRequests)
    .innerJoin(bb, eq(bb.id, partRequests.businessId))
    .innerJoin(units, eq(units.id, partRequests.unitId));
}

export type SellerRecord = Awaited<ReturnType<ReturnType<typeof sellerSelect>['where']>>[number];

export function buyerBlock(rec: Pick<SellerRecord, 'buyerTradeName' | 'buyerCity' | 'buyerVerified' | 'buyerSince'>): PartRequestBuyerBlock {
  return {
    tradeName: maskContact(rec.buyerTradeName),
    city: rec.buyerCity,
    verified: rec.buyerVerified === true,
    memberSince: Number(rec.buyerSince),
  };
}

/** List rows (§12.3) for selected records; fits loaded in one query. */
export async function sellerRows(conn: Conn, recs: SellerRecord[]): Promise<SellerPartRequestRow[]> {
  const fits = await loadFitViews(conn, recs.map((x) => x.r.id));
  const now = new Date();
  return recs.map((x) => ({
    id: x.r.id,
    name: maskContact(x.r.name),
    kind: x.r.kind,
    side: x.r.side,
    quantity: trimQuantity(x.r.quantity) ?? x.r.quantity,
    unitLabel: x.unitLabel,
    firstFit: fitLine(fits.get(x.r.id)?.[0]),
    conditionIds: x.r.conditionIds,
    budgetPerUnitPaise: x.r.budgetVisible ? x.r.budgetPerUnitPaise : null,
    neededBy: x.r.neededBy,
    urgent: x.r.urgent,
    daysLeft: partRequestDaysLeft(x.r.expiresAt, now),
    city: x.r.city,
    distanceKm: x.km === null ? null : Number(x.km),
    inReach: x.inReach === true,
    replyCount: Number(x.replyCount),
    targeted: x.targeted === true,
    hasMatchingStock: x.hasStock === true,
    photoCount: x.r.photoKeys.length,
    buyer: buyerBlock(x),
    note: x.r.note === null ? null : maskContact(x.r.note),
    noteFlagged: x.r.noteFlagged,
    myReplyCount: Number(x.myReplyCount),
    createdAt: x.r.createdAt.toISOString(),
  }));
}

/**
 * The seller's view of one request (`GET /part-requests/:id` for an eligible business, §12.3). The first read by a
 * member of a targeted business sets `part_request_targets.opened_at` (the "Requests for you" badge). `canReply`: the
 * request is `active`, the reader isn't a viewer and the seller has reply slots left. 404 when not eligible.
 */
export async function sellerView(conn: Conn, user: UserTokenPayload, row: PartRequestRow): Promise<PartRequestSellerView> {
  const sellerBusinessId = user.businessId;
  if (!sellerBusinessId) throw partRequestNotFound();
  const f = sellerFacts(sellerBusinessId);
  const [rec] = await sellerSelect(conn, f).where(and(eq(partRequests.id, row.id), f.eligible));
  if (!rec) throw partRequestNotFound();

  await conn
    .update(partRequestTargets)
    .set({ openedAt: sql`now()` as unknown as Date })
    .where(and(eq(partRequestTargets.partRequestId, row.id), eq(partRequestTargets.businessId, sellerBusinessId), isNull(partRequestTargets.openedAt)));

  const counts = await buyerCounts(conn, rec.r);
  const common = await requestCommon(conn, rec.r, counts);
  const myReplies = await sellerReplyViews(conn, rec.r.id, sellerBusinessId);
  const [member] = await conn.select({ memberRole: users.memberRole }).from(users).where(eq(users.id, user.userId));
  // merge: replyAllowance — lane A2's `replyAllowance` (`./reply-options.ts`, not on this lane's base) is the one
  // definition of a seller's reply slots: at merge, take `slotsLeft` (and the `canReply` slot test) from it and drop
  // this inline count (`part_request_reply_listings_max` − the seller's pending + delivered replies).
  const s = await getSettings(conn);
  const slotsLeft = Math.max(0, s.part_request_reply_listings_max - Number(rec.myReplyCount));
  return {
    ...common,
    role: 'seller',
    budgetPerUnitPaise: rec.r.budgetVisible ? rec.r.budgetPerUnitPaise : null,
    buyer: buyerBlock(rec),
    distanceKm: rec.km === null ? null : Number(rec.km),
    inReach: rec.inReach === true,
    targeted: rec.targeted === true,
    notRelevant: rec.notRelevant === true,
    replyCount: Number(rec.replyCount),
    hasMatchingStock: rec.hasStock === true,
    myReplies,
    canReply: rec.r.status === 'active' && member?.memberRole !== 'viewer' && slotsLeft > 0,
    slotsLeft,
  };
}
