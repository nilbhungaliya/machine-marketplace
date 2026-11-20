import { asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  isMatched,
  partRequestDaysLeft,
  type PartRequestBuyerView,
  type PartRequestCommon,
  type PartRequestFitView,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { brands, businesses, machineModels, partRequestFitments, units } from '../../db/schema.js';
import { maskContact } from '../../lib/mask-contact.js';
import { businessDisplayName } from '../business/profile.service.js';
import { trimQuantity } from '../listings/listing-view.service.js';
import { getSettings } from '../settings.service.js';
import type { PartRequestRow } from './locks.js';

// The request as its buyer sees it (spec §12.2; plan A1-1; textile `services/requirements/requirement-view.ts`), and
// the part every reader shares (`requestCommon`, also used by the seller view). `name` and `note` are masked for every
// reader (R9); the stored text is untouched.

type Conn = Db | Tx;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "The seller isn't blocked either way with the request's business" for a reply / match row: the rows the buyer sees
 * (§12.2). `sellerCol` and `requestBusinessCol` are SQL references.
 */
export function notBlockedSql(sellerCol: SQL, requestBusinessCol: SQL): SQL {
  return sql`NOT EXISTS (
    SELECT 1 FROM business_blocks nb
    WHERE (nb.blocker_business_id = ${sellerCol} AND nb.blocked_business_id = ${requestBusinessCol})
       OR (nb.blocker_business_id = ${requestBusinessCol} AND nb.blocked_business_id = ${sellerCol})
  )`;
}

/** Fit rows with brand and model names, by request, in the buyer's order. */
export async function loadFitViews(conn: Conn, requestIds: string[]): Promise<Map<string, PartRequestFitView[]>> {
  const out = new Map<string, PartRequestFitView[]>();
  if (requestIds.length === 0) return out;
  const rows = await conn
    .select({
      requestId: partRequestFitments.partRequestId,
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
    .where(inArray(partRequestFitments.partRequestId, requestIds))
    .orderBy(asc(partRequestFitments.sortOrder), asc(partRequestFitments.id));
  for (const { requestId, ...fit } of rows) out.set(requestId, [...(out.get(requestId) ?? []), fit]);
  return out;
}

/** One fit line: "Brand Model, 2015–2020" (list rows show the first). */
export function fitLine(f: PartRequestFitView | undefined): string | null {
  if (!f) return null;
  const name = [f.brandName, f.modelName].filter(Boolean).join(' ');
  if (f.yearFrom !== null && f.yearTo !== null) return `${name}, ${f.yearFrom === f.yearTo ? f.yearFrom : `${f.yearFrom}–${f.yearTo}`}`;
  if (f.yearFrom !== null) return `${name}, ${f.yearFrom}+`;
  if (f.yearTo !== null) return `${name}, up to ${f.yearTo}`;
  return name;
}

/** Delivered replies and matches the buyer sees (blocked sellers left out), with their unseen counts. */
export async function buyerCounts(
  conn: Conn,
  row: Pick<PartRequestRow, 'id' | 'businessId'>,
): Promise<{ replies: number; matches: number; newReplies: number; newMatches: number }> {
  const { rows } = await conn.execute<{ replies: number; new_replies: number; matches: number; new_matches: number }>(sql`
    SELECT
      (SELECT count(*)::int FROM part_request_replies rr
        WHERE rr.part_request_id = ${row.id} AND rr.status = 'delivered'
          AND ${notBlockedSql(sql`rr.seller_business_id`, sql`${row.businessId}::uuid`)}) AS replies,
      (SELECT count(*)::int FROM part_request_replies rr
        WHERE rr.part_request_id = ${row.id} AND rr.status = 'delivered' AND rr.buyer_viewed_at IS NULL
          AND ${notBlockedSql(sql`rr.seller_business_id`, sql`${row.businessId}::uuid`)}) AS new_replies,
      (SELECT count(*)::int FROM part_request_matches m
        WHERE m.part_request_id = ${row.id} AND ${notBlockedSql(sql`m.seller_business_id`, sql`${row.businessId}::uuid`)}) AS matches,
      (SELECT count(*)::int FROM part_request_matches m
        WHERE m.part_request_id = ${row.id} AND m.seen_at IS NULL
          AND ${notBlockedSql(sql`m.seller_business_id`, sql`${row.businessId}::uuid`)}) AS new_matches`);
  const r = rows[0]!;
  return { replies: Number(r.replies), matches: Number(r.matches), newReplies: Number(r.new_replies), newMatches: Number(r.new_matches) };
}

/** What every reader sees (§12.3): masked name and note, category path, fits, unit, days left, the Matched badge. */
export async function requestCommon(conn: Conn, row: PartRequestRow, counts?: { replies: number; matches: number }): Promise<PartRequestCommon> {
  const { rows: path } = await conn.execute<{ id: string; name: string }>(sql`
    SELECT a.id, a.name FROM categories c
    JOIN categories a ON (c.path = a.path OR c.path LIKE a.path || '/%')
    WHERE c.id = ${row.categoryId}
    ORDER BY length(a.path)`);
  const [unit] = await conn.select({ id: units.id, key: units.key, label: units.label }).from(units).where(eq(units.id, row.unitId));
  const fits = (await loadFitViews(conn, [row.id])).get(row.id) ?? [];
  const c = counts ?? (await buyerCounts(conn, row));
  return {
    id: row.id,
    ref: row.ref,
    kind: row.kind,
    status: row.status,
    matched: isMatched({ deliveredReplyCount: c.replies, matchCount: c.matches }),
    categoryId: row.categoryId,
    categoryPath: path.map((p) => ({ id: p.id, name: p.name })),
    name: maskContact(row.name),
    partNumber: row.partNumber,
    side: row.side,
    fits,
    specs: row.specs,
    quantity: trimQuantity(row.quantity) ?? row.quantity,
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
    daysLeft: partRequestDaysLeft(row.expiresAt, new Date()),
    expiresAt: row.expiresAt.toISOString(),
    firstPostedAt: row.firstPostedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * §9.4: while the request is `active`, the newest non-cancelled deal (`agreed`, `handed_over`, `disputed`, `completed`)
 * of the buyer business on a listing that is a delivered reply or a match of this request; null otherwise.
 */
async function fulfilPrompt(conn: Conn, row: PartRequestRow): Promise<PartRequestBuyerView['fulfilPrompt']> {
  if (row.status !== 'active') return null;
  const { rows } = await conn.execute<{ deal_id: string; seller_business_id: string }>(sql`
    SELECT d.id AS deal_id, d.seller_business_id FROM deals d
    WHERE d.buyer_business_id = ${row.businessId} AND d.status <> 'cancelled'
      AND d.listing_id IN (
        SELECT rr.listing_id FROM part_request_replies rr WHERE rr.part_request_id = ${row.id} AND rr.status = 'delivered'
        UNION
        SELECT m.listing_id FROM part_request_matches m WHERE m.part_request_id = ${row.id})
    ORDER BY d.accepted_at DESC, d.id DESC
    LIMIT 1`);
  const d = rows[0];
  if (!d) return null;
  const [seller] = await conn
    .select({ id: businesses.id, tradeName: businesses.tradeName, legalName: businesses.legalName })
    .from(businesses)
    .where(eq(businesses.id, d.seller_business_id));
  return { dealId: d.deal_id, businessName: seller ? maskContact(await businessDisplayName(conn, seller)) : '' };
}

/** The buyer business's own view (`GET /part-requests/:id` as the buyer and every buyer write's reply). */
export async function buyerView(conn: Conn, row: PartRequestRow): Promise<PartRequestBuyerView> {
  const counts = await buyerCounts(conn, row);
  const common = await requestCommon(conn, row, counts);
  const { rows: targeted } = await conn.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM part_request_targets WHERE part_request_id = ${row.id}`,
  );
  const s = await getSettings(conn);
  return {
    ...common,
    role: 'buyer',
    version: row.version,
    photoKeys: row.photoKeys,
    budgetPerUnitPaise: row.budgetPerUnitPaise,
    budgetVisible: row.budgetVisible,
    validityDays: row.validityDays,
    closeReason: row.closeReason,
    fulfilledDealId: row.fulfilledDealId,
    counts,
    targetedCount: Number(targeted[0]?.n ?? 0),
    fulfilPrompt: await fulfilPrompt(conn, row),
    renewableUntil: new Date(row.firstPostedAt.getTime() + s.part_request_max_days * DAY_MS).toISOString(),
  };
}
