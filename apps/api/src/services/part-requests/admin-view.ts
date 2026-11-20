import { asc, eq, sql } from 'drizzle-orm';
import {
  isMatched,
  milliToQuantity,
  partRequestDaysLeft,
  quantityToMilli,
  type AdminPartRequestDetail,
  type AdminPartRequestRow,
  type PartRequestKind,
  type PartRequestStatus,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { brands, businesses, machineModels, partRequestFitments, units } from '../../db/schema.js';
import { maskContact } from '../../lib/mask-contact.js';
import { adminReportsForTarget } from '../reports/admin-reports.service.js';
import { getSettings } from '../settings.service.js';
import { eligibleSellerCount } from './eligibility.js';
import type { PartRequestRow } from './locks.js';
import { maskedRequestName } from './reply-views.js';

/**
 * Admin views of a part request (F8 spec §14; textile `routes/admin/requirements.ts` mapping). Staff see what sellers
 * see plus the budget and audience, the buyer business by name, the targeted sellers, every reply and match, and the
 * reports; the request **name, note and reply messages are masked** (`maskContact`), and no phone, pincode, address,
 * point or photo key is ever selected into a view.
 */

type Conn = Db | Tx;

const iso = (v: Date | string): string => new Date(v).toISOString();
const isoOrNull = (v: Date | string | null): string | null => (v === null ? null : iso(v));
const qty = (q: string): string => milliToQuantity(quantityToMilli(q));
const DAY_MS = 24 * 60 * 60 * 1000;

/** The category's names root first, joined " › " (a correlated subquery on `pr.category_id`). */
export const CATEGORY_PATH_SQL = sql`(SELECT string_agg(a.name, ' › ' ORDER BY length(a.path))
  FROM categories c JOIN categories a ON (c.path = a.path OR c.path LIKE a.path || '/%')
  WHERE c.id = pr.category_id)`;

/** The list row's columns over `part_requests pr JOIN businesses b` (counts as correlated subqueries). */
export const ADMIN_ROW_COLUMNS = sql`pr.id, pr.ref, pr.name, pr.kind, pr.status, pr.city, pr.created_at, pr.expires_at,
  b.id AS business_id, b.trade_name,
  ${CATEGORY_PATH_SQL} AS category_path,
  (SELECT count(*)::int FROM part_request_targets t WHERE t.part_request_id = pr.id) AS targeted_count,
  (SELECT count(*)::int FROM part_request_replies rr WHERE rr.part_request_id = pr.id AND rr.status = 'delivered') AS reply_count,
  (SELECT count(*)::int FROM part_request_matches m WHERE m.part_request_id = pr.id) AS match_count,
  (SELECT count(*)::int FROM reports rp
    WHERE rp.target_type::text = 'part_request' AND rp.target_id = pr.id AND rp.status IN ('open', 'reviewing')) AS open_reports`;

export type AdminRowRaw = {
  id: string;
  ref: number | string;
  name: string;
  kind: PartRequestKind;
  status: PartRequestStatus;
  city: string | null;
  created_at: Date | string;
  expires_at: Date | string;
  business_id: string;
  trade_name: string;
  category_path: string | null;
  targeted_count: number;
  reply_count: number;
  match_count: number;
  open_reports: number;
};

export function toAdminRow(r: AdminRowRaw): AdminPartRequestRow {
  return {
    id: r.id,
    ref: Number(r.ref),
    name: maskedRequestName(r.name),
    kind: r.kind,
    categoryPath: r.category_path ?? '',
    buyer: { businessId: r.business_id, name: r.trade_name },
    city: r.city,
    status: r.status,
    targetedCount: Number(r.targeted_count),
    replyCount: Number(r.reply_count),
    matchCount: Number(r.match_count),
    openReports: Number(r.open_reports),
    createdAt: iso(r.created_at),
    expiresAt: iso(r.expires_at),
  };
}

/** `GET /admin/part-requests/:id`: the whole admin detail for a loaded request row. */
export async function adminDetailView(conn: Conn, row: PartRequestRow): Promise<AdminPartRequestDetail> {
  const now = new Date();
  const { part_request_max_days: maxDays } = await getSettings(conn);

  const [buyer] = await conn
    .select({ id: businesses.id, name: businesses.tradeName })
    .from(businesses)
    .where(eq(businesses.id, row.businessId));
  const [unit] = await conn
    .select({ id: units.id, key: units.key, label: units.label })
    .from(units)
    .where(eq(units.id, row.unitId));
  const path = await conn.execute<{ id: string; name: string }>(sql`
    SELECT a.id, a.name FROM categories c
    JOIN categories a ON (c.path = a.path OR c.path LIKE a.path || '/%')
    WHERE c.id = ${row.categoryId}
    ORDER BY length(a.path)`);
  const fits = await conn
    .select({
      brandId: partRequestFitments.brandId,
      brandName: brands.name,
      modelId: partRequestFitments.modelId,
      modelName: machineModels.name,
      yearFrom: partRequestFitments.yearFrom,
      yearTo: partRequestFitments.yearTo,
    })
    .from(partRequestFitments)
    .innerJoin(brands, eq(brands.id, partRequestFitments.brandId))
    .leftJoin(machineModels, eq(machineModels.id, partRequestFitments.modelId))
    .where(eq(partRequestFitments.partRequestId, row.id))
    .orderBy(asc(partRequestFitments.sortOrder), asc(partRequestFitments.id));

  const counts = (
    await conn.execute<{ replies: number; matches: number; new_replies: number; new_matches: number; targeted: number }>(sql`
      SELECT
        (SELECT count(*)::int FROM part_request_replies WHERE part_request_id = ${row.id} AND status = 'delivered') AS replies,
        (SELECT count(*)::int FROM part_request_matches WHERE part_request_id = ${row.id}) AS matches,
        (SELECT count(*)::int FROM part_request_replies
          WHERE part_request_id = ${row.id} AND status = 'delivered' AND buyer_viewed_at IS NULL) AS new_replies,
        (SELECT count(*)::int FROM part_request_matches WHERE part_request_id = ${row.id} AND seen_at IS NULL) AS new_matches,
        (SELECT count(*)::int FROM part_request_targets WHERE part_request_id = ${row.id}) AS targeted`)
  ).rows[0]!;

  const targets = await conn.execute<{
    business_id: string;
    name: string;
    rank: number;
    score: string;
    pushed: boolean;
    notified_at: Date | string;
    opened_at: Date | string | null;
    replied: boolean;
    not_relevant: boolean;
  }>(sql`
    SELECT t.business_id, b.trade_name AS name, t.rank, t.score::text AS score, t.pushed, t.notified_at, t.opened_at,
           EXISTS (SELECT 1 FROM part_request_replies rr
                    WHERE rr.part_request_id = t.part_request_id AND rr.seller_business_id = t.business_id) AS replied,
           EXISTS (SELECT 1 FROM part_request_feedback f
                    WHERE f.part_request_id = t.part_request_id AND f.business_id = t.business_id) AS not_relevant
    FROM part_request_targets t JOIN businesses b ON b.id = t.business_id
    WHERE t.part_request_id = ${row.id}
    ORDER BY t.pass, t.rank, t.business_id`);

  const replies = await conn.execute<{
    id: string;
    listing_id: string;
    listing_title: string | null;
    seller_id: string;
    seller_name: string;
    status: AdminPartRequestDetail['replies'][number]['status'];
    drop_reason: AdminPartRequestDetail['replies'][number]['dropReason'];
    message: string | null;
    created_at: Date | string;
  }>(sql`
    SELECT rr.id, rr.listing_id, l.title AS listing_title, b.id AS seller_id, b.trade_name AS seller_name,
           rr.status, rr.drop_reason, rr.message, rr.created_at
    FROM part_request_replies rr
    JOIN listings l ON l.id = rr.listing_id
    JOIN businesses b ON b.id = rr.seller_business_id
    WHERE rr.part_request_id = ${row.id}
    ORDER BY rr.created_at DESC, rr.id DESC`);

  const matches = await conn.execute<{
    listing_id: string;
    listing_title: string | null;
    seller_id: string;
    seller_name: string;
    tier: AdminPartRequestDetail['matches'][number]['tier'];
    distance_km: number | null;
    pushed: boolean;
    created_at: Date | string;
  }>(sql`
    SELECT m.listing_id, l.title AS listing_title, b.id AS seller_id, b.trade_name AS seller_name,
           m.tier, m.distance_km, m.pushed, m.created_at
    FROM part_request_matches m
    JOIN listings l ON l.id = m.listing_id
    JOIN businesses b ON b.id = m.seller_business_id
    WHERE m.part_request_id = ${row.id}
    ORDER BY m.created_at DESC, m.listing_id`);

  return {
    id: row.id,
    ref: row.ref,
    kind: row.kind,
    status: row.status,
    matched: isMatched({ deliveredReplyCount: Number(counts.replies), matchCount: Number(counts.matches) }),
    categoryId: row.categoryId,
    categoryPath: path.rows.map((p) => ({ id: p.id, name: p.name })),
    name: maskedRequestName(row.name),
    partNumber: row.partNumber,
    side: row.side,
    fits: fits.map((f) => ({
      brandId: f.brandId,
      brandName: f.brandName,
      modelId: f.modelId,
      modelName: f.modelName,
      yearFrom: f.yearFrom,
      yearTo: f.yearTo,
    })),
    specs: row.specs,
    quantity: qty(row.quantity),
    unit: unit ?? { id: row.unitId, key: '', label: '' },
    conditionIds: row.conditionIds,
    neededBy: row.neededBy,
    urgent: row.urgent,
    reach: row.reach,
    audience: row.audience,
    city: row.city,
    state: row.state,
    note: row.note === null ? null : maskContact(row.note),
    noteFlagged: row.noteFlagged,
    photoCount: row.photoKeys.length,
    daysLeft: partRequestDaysLeft(row.expiresAt, now),
    expiresAt: row.expiresAt.toISOString(),
    firstPostedAt: row.firstPostedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    version: row.version,
    budgetPerUnitPaise: row.budgetPerUnitPaise,
    budgetVisible: row.budgetVisible,
    validityDays: row.validityDays,
    closeReason: row.closeReason,
    fulfilledDealId: row.fulfilledDealId,
    counts: {
      replies: Number(counts.replies),
      matches: Number(counts.matches),
      newReplies: Number(counts.new_replies),
      newMatches: Number(counts.new_matches),
    },
    targetedCount: Number(counts.targeted),
    renewableUntil: new Date(row.firstPostedAt.getTime() + maxDays * DAY_MS).toISOString(),
    buyer: { businessId: row.businessId, name: buyer?.name ?? '' },
    eligibleNow: await eligibleSellerCount(conn, row.id),
    targets: targets.rows.map((t) => ({
      businessId: t.business_id,
      name: t.name,
      rank: Number(t.rank),
      score: t.score,
      pushed: t.pushed,
      notifiedAt: iso(t.notified_at),
      openedAt: isoOrNull(t.opened_at),
      replied: t.replied,
      notRelevant: t.not_relevant,
    })),
    replies: replies.rows.map((r) => ({
      id: r.id,
      listingId: r.listing_id,
      listingTitle: r.listing_title ?? '',
      seller: { businessId: r.seller_id, name: r.seller_name },
      status: r.status,
      dropReason: r.drop_reason,
      message: r.message === null ? null : maskContact(r.message),
      createdAt: iso(r.created_at),
    })),
    matches: matches.rows.map((m) => ({
      listingId: m.listing_id,
      listingTitle: m.listing_title ?? '',
      seller: { businessId: m.seller_id, name: m.seller_name },
      tier: m.tier,
      distanceKm: m.distance_km === null ? null : Number(m.distance_km),
      pushed: m.pushed,
      createdAt: iso(m.created_at),
    })),
    reports: await adminReportsForTarget(conn, 'part_request', row.id),
    removedAt: row.removedAt === null ? null : row.removedAt.toISOString(),
    removedReason: row.removedReason,
    returnStatus: row.returnStatus,
  };
}
