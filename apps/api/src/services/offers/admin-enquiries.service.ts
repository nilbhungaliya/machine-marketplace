import { and, asc, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  milliToQuantity,
  quantityToMilli,
  type AdminEnquiryDetail,
  type AdminEnquiryRow,
  type AdminOfferChainEntry,
  type EnquiryStatus,
  type ListingKind,
  type OfferCloseReason,
  type OfferStatus,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { businessBlocks, businesses, chatThreads, deals, listings, offers } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { publicListingWhere } from '../listings/public-where.service.js';

/**
 * Admin Enquiries & offers (F6 + F7 spec §16.1, §16.2; R23): a read-only monitor for `support` and `operations`. Threads
 * with listing, parties, kind, derived enquiry status, the open negotiation, deals count and activity; the detail adds
 * the offer chain (prices, quantities, statuses, who, when). **No message or note text** is selected anywhere here.
 */

type Conn = Db | Tx;

export const ADMIN_ENQUIRY_PAGE_SIZES = [25, 50, 100] as const;

export interface AdminEnquiryFilters {
  enquiryStatus?: EnquiryStatus;
  /** The status of the thread's latest offer row. */
  offerStatus?: OfferStatus;
  kind?: ListingKind;
  /** Threads created on or after / before (ISO). */
  from?: string;
  to?: string;
  /** Buyer or seller business name. */
  q?: string;
  page: number;
  pageSize: number;
}

/** `GET /admin/enquiries` (no shared type yet: the admin list shape of `AdminListingList`). */
export interface AdminEnquiryList {
  rows: AdminEnquiryRow[];
  total: number;
  page: number;
  pageSize: number;
}

const buyer = alias(businesses, 'buyer');
const seller = alias(businesses, 'seller');

/** §6.2 in SQL, first match wins (the same rule as `enquiryStatus` in shared-types). */
const enquiryStatusSql: SQL<EnquiryStatus> = sql<EnquiryStatus>`CASE
  WHEN ${chatThreads.dealCount} > 0 THEN 'converted'
  WHEN EXISTS (
         SELECT 1 FROM ${businessBlocks} bb
         WHERE (bb.blocker_business_id = ${chatThreads.buyerBusinessId} AND bb.blocked_business_id = ${chatThreads.sellerBusinessId})
            OR (bb.blocker_business_id = ${chatThreads.sellerBusinessId} AND bb.blocked_business_id = ${chatThreads.buyerBusinessId}))
    OR (NOT ${publicListingWhere()} AND NOT EXISTS (
         SELECT 1 FROM ${offers} oo WHERE oo.thread_id = ${chatThreads.id} AND oo.status IN ('pending', 'backup')))
    THEN 'closed'
  WHEN ${chatThreads.firstSellerReplyAt} IS NOT NULL THEN 'replied'
  ELSE 'open' END`;

const latestOfferStatusSql = sql<OfferStatus | null>`(SELECT lo.status FROM ${offers} lo WHERE lo.thread_id = ${chatThreads.id}
  ORDER BY lo.created_at DESC, lo.id DESC LIMIT 1)`;

function whereOf(f: Partial<AdminEnquiryFilters>, threadId?: string): SQL | undefined {
  const conds: SQL[] = [];
  if (threadId) conds.push(eq(chatThreads.id, threadId));
  if (f.enquiryStatus) conds.push(sql`${enquiryStatusSql} = ${f.enquiryStatus}`);
  if (f.offerStatus) conds.push(sql`${latestOfferStatusSql} = ${f.offerStatus}`);
  if (f.kind) conds.push(eq(chatThreads.listingKind, f.kind));
  if (f.from) conds.push(gte(chatThreads.createdAt, new Date(f.from)));
  if (f.to) conds.push(lt(chatThreads.createdAt, new Date(f.to)));
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(or(ilike(buyer.tradeName, like), ilike(seller.tradeName, like))!);
  }
  return conds.length ? and(...conds) : undefined;
}

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());
const qty = (q: string): string => milliToQuantity(quantityToMilli(q));

async function selectRows(conn: Conn, where: SQL | undefined, limit: number, offset: number): Promise<AdminEnquiryRow[]> {
  const rows = await conn
    .select({
      threadId: chatThreads.id,
      listingId: listings.id,
      listingRef: listings.ref,
      listingTitle: listings.title,
      listingKind: chatThreads.listingKind,
      buyerId: buyer.id,
      buyerName: buyer.tradeName,
      sellerId: seller.id,
      sellerName: seller.tradeName,
      enquiryStatus: enquiryStatusSql,
      dealCount: chatThreads.dealCount,
      createdAt: chatThreads.createdAt,
      lastActivityAt: chatThreads.lastMessageAt,
    })
    .from(chatThreads)
    .innerJoin(listings, eq(listings.id, chatThreads.listingId))
    .innerJoin(buyer, eq(buyer.id, chatThreads.buyerBusinessId))
    .innerJoin(seller, eq(seller.id, chatThreads.sellerBusinessId))
    .where(where)
    .orderBy(desc(chatThreads.lastMessageAt), desc(chatThreads.id))
    .limit(limit)
    .offset(offset);
  if (rows.length === 0) return [];

  const open = await conn
    .select({
      threadId: offers.threadId,
      offerId: offers.id,
      round: offers.round,
      status: offers.status,
      price: offers.pricePerUnitPaise,
      quantity: offers.quantity,
      turn: offers.turn,
      expiresAt: offers.expiresAt,
    })
    .from(offers)
    .where(and(inArray(offers.threadId, rows.map((r) => r.threadId)), inArray(offers.status, ['pending', 'backup'])));
  const openBy = new Map(open.map((o) => [o.threadId, o]));

  return rows.map((r) => {
    const o = openBy.get(r.threadId);
    return {
      threadId: r.threadId,
      listing: { id: r.listingId, ref: r.listingRef, title: r.listingTitle ?? '', kind: r.listingKind },
      buyer: { businessId: r.buyerId, name: r.buyerName },
      seller: { businessId: r.sellerId, name: r.sellerName },
      enquiryStatus: r.enquiryStatus,
      negotiation: o
        ? {
            offerId: o.offerId,
            round: o.round,
            status: o.status,
            lastPricePerUnitPaise: o.price,
            quantity: qty(o.quantity),
            turn: o.turn,
            expiresAt: iso(o.expiresAt),
          }
        : null,
      dealCount: r.dealCount,
      createdAt: r.createdAt.toISOString(),
      lastActivityAt: r.lastActivityAt.toISOString(),
    };
  });
}

export async function listAdminEnquiries(conn: Conn, f: AdminEnquiryFilters): Promise<AdminEnquiryList> {
  const where = whereOf(f);
  const [{ n } = { n: 0 }] = await conn
    .select({ n: sql<number>`count(*)::int` })
    .from(chatThreads)
    .innerJoin(listings, eq(listings.id, chatThreads.listingId))
    .innerJoin(buyer, eq(buyer.id, chatThreads.buyerBusinessId))
    .innerJoin(seller, eq(seller.id, chatThreads.sellerBusinessId))
    .where(where);
  const rows = await selectRows(conn, where, f.pageSize, (f.page - 1) * f.pageSize);
  return { rows, total: n, page: f.page, pageSize: f.pageSize };
}

/** `GET /admin/enquiries/:threadId`: the row, every offer row of the thread in order, its deals. `404 THREAD_NOT_FOUND`. */
export async function adminEnquiryDetail(conn: Conn, threadId: string): Promise<AdminEnquiryDetail> {
  const [row] = await selectRows(conn, whereOf({}, threadId), 1, 0);
  if (!row) throw new AppError('Thread not found', 404, 'THREAD_NOT_FOUND');
  const chainRows = await conn
    .select({
      id: offers.id,
      negotiationId: offers.negotiationId,
      round: offers.round,
      kind: offers.kind,
      senderSide: offers.senderSide,
      status: offers.status,
      closeReason: offers.closeReason,
      pricePerUnitPaise: offers.pricePerUnitPaise,
      quantity: offers.quantity,
      totalPaise: offers.totalPaise,
      validityHours: offers.validityHours,
      expiresAt: offers.expiresAt,
      needsReconfirm: offers.needsReconfirm,
      createdAt: offers.createdAt,
      answeredAt: offers.answeredAt,
    })
    .from(offers)
    .where(eq(offers.threadId, threadId))
    .orderBy(asc(offers.createdAt), asc(offers.round), asc(offers.id));
  const chain: AdminOfferChainEntry[] = chainRows.map((o) => ({
    id: o.id,
    negotiationId: o.negotiationId,
    round: o.round,
    kind: o.kind,
    senderSide: o.senderSide,
    status: o.status,
    closeReason: (o.closeReason as OfferCloseReason | null) ?? null,
    pricePerUnitPaise: o.pricePerUnitPaise,
    quantity: qty(o.quantity),
    totalPaise: o.totalPaise.toString(),
    validityHours: o.validityHours,
    expiresAt: iso(o.expiresAt),
    needsReconfirm: o.needsReconfirm,
    createdAt: o.createdAt.toISOString(),
    answeredAt: iso(o.answeredAt),
  }));
  const threadDeals = await conn
    .select({ id: deals.id, ref: deals.ref, status: deals.status })
    .from(deals)
    .where(eq(deals.threadId, threadId))
    .orderBy(asc(deals.createdAt));
  return { row, chain, deals: threadDeals };
}
