import { and, asc, count, desc, eq, gte, ilike, lt, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  DEAL_STATUSES,
  milliToQuantity,
  quantityToMilli,
  type AdminDealDetail,
  type AdminDealList,
  type AdminDealRow,
  type AdminDisputeDetail,
  type AdminDisputeList,
  type AdminDisputeRow,
  type DealCancelReason,
  type DealStatus,
  type DisputeStatus,
  type SignedPhoto,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { adminUsers, businesses, dealDisputes, dealEvents, dealReviews, deals, listings, rentalBookings, stockHolds } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { privatePhotoUrl } from '../chat/private-photo.js';

/**
 * Admin Deals and Disputes reads (F6 + F7 spec §16.1–§16.2; ported from textile `services/deals/deal-admin.service.ts`).
 * Read-only: actions live in the dispute resolve. Deal detail shows the structured notes only, never `notes_text`
 * (`hasText` says one exists). Staff read business names and the dispute description as stored.
 */

type Conn = Db | Tx;

export const ADMIN_DEALS_PAGE_SIZE_MAX = 100;

export interface AdminDealQuery {
  status?: DealStatus;
  /** Deal ref (digits, optionally `#`), business name or listing title. */
  search?: string;
  /** Accepted on or after / before (`YYYY-MM-DD`, IST days are close enough for an admin filter: UTC dates). */
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

/** The list's business aliases: the deals export joins them the same way (`adminDealWhere` reads them). */
export const buyerBiz = alias(businesses, 'buyer_biz');
export const sellerBiz = alias(businesses, 'seller_biz');

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const trimQty = (q: string): string => milliToQuantity(quantityToMilli(q));

function notFound(what: string): AppError {
  return new AppError(`${what} not found`, 404, 'NOT_FOUND');
}

const openDisputeId = sql<string | null>`(SELECT dd.id FROM deal_disputes dd WHERE dd.deal_id = ${deals.id} AND dd.status = 'open' LIMIT 1)`;

const dealRowSelect = {
  deal: deals,
  listingRef: listings.ref,
  buyerName: buyerBiz.tradeName,
  sellerName: sellerBiz.tradeName,
  openDisputeId,
};

type DealRowSelect = {
  deal: typeof deals.$inferSelect;
  listingRef: number;
  buyerName: string;
  sellerName: string;
  openDisputeId: string | null;
};

function toAdminDealRow(r: DealRowSelect): AdminDealRow {
  const d = r.deal;
  return {
    id: d.id,
    ref: d.ref,
    threadId: d.threadId,
    listing: { id: d.listingId, ref: r.listingRef, title: d.listingTitle },
    buyer: { businessId: d.buyerBusinessId, name: r.buyerName },
    seller: { businessId: d.sellerBusinessId, name: r.sellerName },
    status: d.status,
    pricePerUnitPaise: d.pricePerUnitPaise,
    quantity: trimQty(d.quantity),
    unitLabel: d.unitLabel,
    totalPaise: d.totalPaise.toString(),
    openDisputeId: r.openDisputeId,
    acceptedAt: d.acceptedAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

function searchWhere(search: string): SQL | null {
  const s = search.trim();
  if (!s) return null;
  const ref = /^#?(\d{1,15})$/.exec(s);
  const like = `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const text = or(ilike(buyerBiz.tradeName, like), ilike(sellerBiz.tradeName, like), ilike(deals.listingTitle, like))!;
  return ref ? or(eq(deals.ref, Number(ref[1])), text)! : text;
}

type AdminDealFilters = Omit<AdminDealQuery, 'page' | 'pageSize'>;

/** Every filter but the status (the tab counts group by status over these). */
function baseConditions(q: AdminDealFilters): SQL[] {
  const base: SQL[] = [];
  const search = q.search ? searchWhere(q.search) : null;
  if (search) base.push(search);
  if (q.from) base.push(gte(deals.acceptedAt, sql`${q.from}::date`));
  if (q.to) base.push(lt(deals.acceptedAt, sql`${q.to}::date + 1`));
  return base;
}

/**
 * The list's condition over `deals` joined to `listings`, `buyerBiz` and `sellerBiz` (admin close-out plan A4-3: the
 * deals export joins and filters the same way); undefined without a filter.
 */
export function adminDealWhere(q: AdminDealFilters): SQL | undefined {
  const where = q.status ? [...baseConditions(q), eq(deals.status, q.status)] : baseConditions(q);
  return where.length ? and(...where) : undefined;
}

/** `GET /admin/deals?status=&search=&from=&to=&page=&pageSize=`: newest change first; counts by status for the tabs. */
export async function listAdminDeals(conn: Conn, q: AdminDealQuery): Promise<AdminDealList> {
  const pageSize = Math.min(Math.max(1, Math.floor(q.pageSize)), ADMIN_DEALS_PAGE_SIZE_MAX);
  const page = Math.max(1, Math.floor(q.page));
  const base = baseConditions(q);

  const rows = await conn
    .select(dealRowSelect)
    .from(deals)
    .innerJoin(listings, eq(listings.id, deals.listingId))
    .innerJoin(buyerBiz, eq(buyerBiz.id, deals.buyerBusinessId))
    .innerJoin(sellerBiz, eq(sellerBiz.id, deals.sellerBusinessId))
    .where(adminDealWhere(q))
    .orderBy(desc(deals.updatedAt), desc(deals.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const byStatus = await conn
    .select({ status: deals.status, n: count() })
    .from(deals)
    .innerJoin(buyerBiz, eq(buyerBiz.id, deals.buyerBusinessId))
    .innerJoin(sellerBiz, eq(sellerBiz.id, deals.sellerBusinessId))
    .where(base.length ? and(...base) : undefined)
    .groupBy(deals.status);
  const counts = Object.fromEntries(DEAL_STATUSES.map((s) => [s, 0])) as Record<DealStatus, number>;
  for (const c of byStatus) counts[c.status] = c.n;
  const total = q.status ? counts[q.status] : Object.values(counts).reduce((a, b) => a + b, 0);

  return { rows: rows.map(toAdminDealRow), total, page, pageSize, counts };
}

async function signedAll(keys: string[]): Promise<SignedPhoto[]> {
  const out: SignedPhoto[] = [];
  for (const key of keys) {
    try {
      out.push(await privatePhotoUrl(key));
    } catch {
      // Storage unavailable: the detail still loads without the photo.
    }
  }
  return out;
}

// M14 R12, §5.5a: a dispute is about a deal or a rental booking (exactly one), so both are `LEFT JOIN`ed and the parties
// read from whichever is set (a booking's renter is the buyer side, its owner the seller side).
const disputeBuyerId = sql<string>`coalesce(${deals.buyerBusinessId}, ${rentalBookings.renterBusinessId})`;
const disputeSellerId = sql<string>`coalesce(${deals.sellerBusinessId}, ${rentalBookings.ownerBusinessId})`;

const disputeRowSelect = {
  dispute: dealDisputes,
  dealRef: deals.ref,
  bookingRef: rentalBookings.ref,
  threadId: sql<string>`coalesce(${deals.threadId}, ${rentalBookings.threadId})`,
  buyerId: disputeBuyerId,
  sellerId: disputeSellerId,
  buyerName: buyerBiz.tradeName,
  sellerName: sellerBiz.tradeName,
};

type DisputeRowSelect = {
  dispute: typeof dealDisputes.$inferSelect;
  dealRef: number | null;
  bookingRef: number | null;
  threadId: string;
  buyerId: string;
  sellerId: string;
  buyerName: string;
  sellerName: string;
};

function toAdminDisputeRow(r: DisputeRowSelect): AdminDisputeRow {
  const d = r.dispute;
  return {
    id: d.id,
    subject: d.rentalBookingId ? { kind: 'rental', rentalBookingId: d.rentalBookingId } : { kind: 'deal', dealId: d.dealId! },
    dealId: d.dealId,
    dealRef: r.dealRef,
    rentalBookingRef: r.bookingRef,
    category: d.category,
    status: d.status,
    outcome: d.outcome,
    openedBySide: d.openedBySide,
    buyer: { businessId: r.buyerId, name: r.buyerName },
    seller: { businessId: r.sellerId, name: r.sellerName },
    createdAt: d.createdAt.toISOString(),
    resolvedAt: iso(d.resolvedAt),
  };
}

function disputesQuery(conn: Conn) {
  return conn
    .select(disputeRowSelect)
    .from(dealDisputes)
    .leftJoin(deals, eq(deals.id, dealDisputes.dealId))
    .leftJoin(rentalBookings, eq(rentalBookings.id, dealDisputes.rentalBookingId))
    .innerJoin(buyerBiz, eq(buyerBiz.id, disputeBuyerId))
    .innerJoin(sellerBiz, eq(sellerBiz.id, disputeSellerId));
}

/** `GET /admin/deals/:id`: terms, structured notes (no free text), timeline, hold, review state, disputes. */
export async function getAdminDeal(conn: Conn, dealId: string): Promise<AdminDealDetail> {
  const [r] = await conn
    .select(dealRowSelect)
    .from(deals)
    .innerJoin(listings, eq(listings.id, deals.listingId))
    .innerJoin(buyerBiz, eq(buyerBiz.id, deals.buyerBusinessId))
    .innerJoin(sellerBiz, eq(sellerBiz.id, deals.sellerBusinessId))
    .where(eq(deals.id, dealId));
  if (!r) throw new AppError('Deal not found', 404, 'DEAL_NOT_FOUND');
  const d = r.deal;
  const events = await conn.select().from(dealEvents).where(eq(dealEvents.dealId, d.id)).orderBy(asc(dealEvents.createdAt), asc(dealEvents.id));
  const [hold] = await conn.select({ status: stockHolds.status, quantity: stockHolds.quantity }).from(stockHolds).where(eq(stockHolds.dealId, d.id));
  const reviews = await conn
    .select({ side: dealReviews.reviewerSide, publishedAt: dealReviews.publishedAt })
    .from(dealReviews)
    .where(eq(dealReviews.dealId, d.id));
  const disputes = await disputesQuery(conn).where(eq(dealDisputes.dealId, d.id)).orderBy(desc(dealDisputes.createdAt));
  return {
    ...toAdminDealRow(r),
    gstMode: d.gstMode,
    notes: {
      paymentMethod: d.paymentMethod,
      advancePaise: d.advancePaise === null ? null : d.advancePaise.toString(),
      fulfilment: d.fulfilment,
      expectedOn: d.expectedOn,
      hasText: !!d.notesText,
    },
    handedOverAt: iso(d.handedOverAt),
    problemDeadlineAt: iso(d.problemDeadlineAt),
    autoCompleteAt: iso(d.autoCompleteAt),
    completedAt: iso(d.completedAt),
    completedHow: d.completedHow,
    cancelledAt: iso(d.cancelledAt),
    cancelledBySide: d.cancelledBySide,
    cancelReason: (d.cancelReason as DealCancelReason | null) ?? null,
    cancelRequest:
      d.cancelRequestedSide && d.cancelRequestedAt
        ? { side: d.cancelRequestedSide, reason: (d.cancelRequestedReason as DealCancelReason | null) ?? null, at: d.cancelRequestedAt.toISOString() }
        : null,
    timeline: events.map((e) => ({ code: e.code, actorSide: e.actorSide, values: e.values, at: e.createdAt.toISOString() })),
    hold: hold ? { status: hold.status, quantity: trimQty(hold.quantity) } : null,
    reviews: {
      buyerSubmitted: reviews.some((x) => x.side === 'buyer'),
      sellerSubmitted: reviews.some((x) => x.side === 'seller'),
      published: reviews.some((x) => x.publishedAt !== null),
    },
    disputes: disputes.map(toAdminDisputeRow),
  };
}

/** `GET /admin/disputes?status=&page=&pageSize=`: open first, oldest first (§16.1); resolved after, newest first. */
export async function listDisputes(
  conn: Conn,
  q: { status?: DisputeStatus; page: number; pageSize: number },
): Promise<AdminDisputeList> {
  const pageSize = Math.min(Math.max(1, Math.floor(q.pageSize)), ADMIN_DEALS_PAGE_SIZE_MAX);
  const page = Math.max(1, Math.floor(q.page));
  const where = q.status ? eq(dealDisputes.status, q.status) : undefined;
  const rows = await disputesQuery(conn)
    .where(where)
    .orderBy(
      sql`(${dealDisputes.status} = 'open') DESC`,
      sql`CASE WHEN ${dealDisputes.status} = 'open' THEN ${dealDisputes.createdAt} END ASC`,
      desc(dealDisputes.resolvedAt),
      asc(dealDisputes.id),
    )
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [t] = await conn.select({ n: count() }).from(dealDisputes).where(where);
  return { rows: rows.map(toAdminDisputeRow), total: t?.n ?? 0, page, pageSize };
}

/** `GET /admin/disputes/count`: open disputes, for the nav badge. */
export async function openDisputeCount(conn: Conn): Promise<{ open: number }> {
  const [t] = await conn.select({ n: count() }).from(dealDisputes).where(eq(dealDisputes.status, 'open'));
  return { open: t?.n ?? 0 };
}

/**
 * `GET /admin/disputes/:id`: the problem as reported (photos signed for 300 s), the resolution, and the deal (null for a
 * rental booking's dispute: its booking is read from `/admin/rental-bookings/:id`, M14).
 */
export async function getDispute(conn: Conn, disputeId: string): Promise<AdminDisputeDetail> {
  const [r] = await disputesQuery(conn).where(eq(dealDisputes.id, disputeId));
  if (!r) throw notFound('Dispute');
  const d = r.dispute;
  let resolvedByAdminName: string | null = null;
  if (d.resolvedByAdminId) {
    const [a] = await conn.select({ name: adminUsers.name }).from(adminUsers).where(eq(adminUsers.id, d.resolvedByAdminId));
    resolvedByAdminName = a?.name ?? null;
  }
  const deal = d.dealId ? await getAdminDeal(conn, d.dealId) : null;
  return {
    ...toAdminDisputeRow(r),
    description: d.description,
    photos: await signedAll(d.photoKeys),
    messageToParties: d.messageToParties,
    internalNote: d.internalNote,
    stockReturned: d.stockReturned,
    resolvedByAdminName,
    deal,
    threadId: r.threadId,
  };
}
