import { and, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import {
  CHAT_LIMITS,
  DEAL_STATUSES,
  type AdminBusinessDealHistory,
  type DealStatus,
  type DealsPage,
  type DealView,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { dealDisputes, deals, rentalBookings } from '../../db/schema.js';
import { ValidationError } from '../../lib/errors.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { buildDealView, dbNow, dealForParty, readerFor, toDealListRows } from './deal-view.js';

/**
 * Deal reads (F6 + F7 spec §9, §12.2, §16; ported from textile `services/deals/deal-view.ts` `getDeal`, `listDeals`).
 * L3-1 / L3-3 own this file.
 */

type Conn = Db | Tx;

export const DEAL_TABS = ['active', 'completed', 'cancelled'] as const;
export type DealTab = (typeof DEAL_TABS)[number];
export const DEAL_SIDE_FILTERS = ['all', 'buying', 'selling'] as const;
export type DealSideFilter = (typeof DEAL_SIDE_FILTERS)[number];

const TAB_STATUSES: Record<DealTab, DealStatus[]> = {
  active: ['agreed', 'handed_over', 'disputed'],
  completed: ['completed'],
  cancelled: ['cancelled'],
};

const PAGE_SIZE = CHAT_LIMITS.inboxPageSize;

/** `GET /deals/:id`: the Deal record for the caller (`404 DEAL_NOT_FOUND` for an outsider). */
export async function getDealView(conn: Conn, user: UserTokenPayload, dealId: string): Promise<DealView> {
  const { deal, reader } = await dealForParty(conn, user, dealId);
  return buildDealView(conn, deal, reader, await dbNow(conn));
}

function sideWhere(businessId: string, side: DealSideFilter): SQL {
  if (side === 'buying') return eq(deals.buyerBusinessId, businessId);
  if (side === 'selling') return eq(deals.sellerBusinessId, businessId);
  return or(eq(deals.buyerBusinessId, businessId), eq(deals.sellerBusinessId, businessId))!;
}

/** "Your turn" (§9.2 last bullet, `dealYourTurn`) for a business, as SQL. */
function yourTurnWhere(businessId: string, side: DealSideFilter): SQL {
  const seller = and(
    eq(deals.sellerBusinessId, businessId),
    sql`(${deals.status} = 'agreed' OR (${deals.status} = 'handed_over' AND ${deals.cancelRequestedSide} = 'buyer'))`,
  )!;
  const buyer = and(
    eq(deals.buyerBusinessId, businessId),
    sql`${deals.status} = 'handed_over' AND (${deals.cancelRequestedSide} IS NULL OR ${deals.cancelRequestedSide} = 'seller')`,
  )!;
  if (side === 'buying') return buyer;
  if (side === 'selling') return seller;
  return or(buyer, seller)!;
}

interface Cursor {
  at: string;
  id: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

function decodeCursor(raw: string): Cursor {
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor;
    if (typeof c.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(c.at) || !/^[0-9a-f-]{36}$/i.test(c.id)) throw new Error();
    return c;
  } catch {
    throw new ValidationError('Invalid cursor', undefined, 'INVALID_CURSOR');
  }
}

/** `updated_at` in UTC to the microsecond, so the keyset never skips a row two writes left in the same millisecond. */
const updatedAtText = sql<string>`to_char(${deals.updatedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;

/**
 * `GET /deals?tab=&side=&cursor=` (§12.2): the business's deals, newest change first, 20 a page by keyset
 * (`updated_at`, `id`); counts per tab and "your turn" for the side filter.
 */
export async function listDeals(
  conn: Conn,
  user: UserTokenPayload,
  q: { tab: DealTab; side: DealSideFilter; cursor?: string },
): Promise<DealsPage> {
  const reader = await readerFor(conn, user);
  if (!reader) return { items: [], nextCursor: null, counts: { active: 0, completed: 0, cancelled: 0, yourTurn: 0 } };
  const mine = sideWhere(reader.businessId, q.side);
  const where: SQL[] = [mine, inArray(deals.status, TAB_STATUSES[q.tab])];
  if (q.cursor) {
    const c = decodeCursor(q.cursor);
    where.push(sql`(${deals.updatedAt}, ${deals.id}) < ((${c.at}::timestamp AT TIME ZONE 'UTC'), ${c.id}::uuid)`);
  }
  const rows = await conn
    .select({ deal: deals, at: updatedAtText })
    .from(deals)
    .where(and(...where))
    .orderBy(desc(deals.updatedAt), desc(deals.id))
    .limit(PAGE_SIZE + 1);
  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  const nextCursor = rows.length > PAGE_SIZE && last ? encodeCursor({ at: last.at, id: last.deal.id }) : null;

  const [c] = await conn
    .select({
      active: sql<number>`count(*) FILTER (WHERE ${inArray(deals.status, TAB_STATUSES.active)})::int`,
      completed: sql<number>`count(*) FILTER (WHERE ${deals.status} = 'completed')::int`,
      cancelled: sql<number>`count(*) FILTER (WHERE ${deals.status} = 'cancelled')::int`,
      yourTurn: sql<number>`count(*) FILTER (WHERE ${yourTurnWhere(reader.businessId, q.side)})::int`,
    })
    .from(deals)
    .where(mine);

  return {
    items: await toDealListRows(conn, page.map((r) => r.deal), reader.businessId),
    nextCursor,
    counts: { active: c?.active ?? 0, completed: c?.completed ?? 0, cancelled: c?.cancelled ?? 0, yourTurn: c?.yourTurn ?? 0 },
  };
}

/** Deals waiting on this user's business (the Deals tab badge, `dealYourTurn`). */
export async function dealsYourTurnCount(conn: Conn, user: UserTokenPayload): Promise<number> {
  const reader = await readerFor(conn, user);
  if (!reader) return 0;
  const [row] = await conn.select({ n: sql<number>`count(*)::int` }).from(deals).where(yourTurnWhere(reader.businessId, 'all'));
  return row?.n ?? 0;
}

/**
 * Admin business detail (§16.1): deals by status (as buyer or seller) and disputes with outcomes — the business's deal
 * disputes and, M14 R12, its rental booking disputes (as renter or owner).
 */
export async function businessDealHistory(conn: Conn, businessId: string): Promise<AdminBusinessDealHistory> {
  const byStatus = Object.fromEntries(DEAL_STATUSES.map((s) => [s, 0])) as Record<DealStatus, number>;
  const mine = or(eq(deals.buyerBusinessId, businessId), eq(deals.sellerBusinessId, businessId))!;
  const counts = await conn
    .select({ status: deals.status, n: sql<number>`count(*)::int` })
    .from(deals)
    .where(mine)
    .groupBy(deals.status);
  for (const c of counts) byStatus[c.status] = c.n;
  const disputes = await conn
    .select({
      id: dealDisputes.id,
      dealId: dealDisputes.dealId,
      dealRef: deals.ref,
      rentalBookingId: dealDisputes.rentalBookingId,
      rentalBookingRef: rentalBookings.ref,
      category: dealDisputes.category,
      status: dealDisputes.status,
      outcome: dealDisputes.outcome,
      createdAt: dealDisputes.createdAt,
      resolvedAt: dealDisputes.resolvedAt,
    })
    .from(dealDisputes)
    .leftJoin(deals, eq(deals.id, dealDisputes.dealId))
    .leftJoin(rentalBookings, eq(rentalBookings.id, dealDisputes.rentalBookingId))
    .where(
      or(
        mine,
        eq(rentalBookings.renterBusinessId, businessId),
        eq(rentalBookings.ownerBusinessId, businessId),
      ),
    )
    .orderBy(desc(dealDisputes.createdAt))
    .limit(100);
  return {
    byStatus,
    disputes: disputes.map(({ rentalBookingId, ...d }) => ({
      ...d,
      subject: rentalBookingId
        ? { kind: 'rental' as const, rentalBookingId }
        : { kind: 'deal' as const, dealId: d.dealId! },
      createdAt: d.createdAt.toISOString(),
      resolvedAt: d.resolvedAt ? d.resolvedAt.toISOString() : null,
    })),
  };
}
