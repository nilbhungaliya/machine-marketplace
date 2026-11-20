import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import {
  enquiryStatus,
  type BlockState,
  type Counterpart,
  type DealListRow,
  type EnquiryStatus,
  type OfferView,
  type ThreadDetail,
  type ThreadListingStrip,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { businessBlocks, businesses, chatThreadUserState, deals, listings, offers, rentalBookings, units } from '../../db/schema.js';
import { ForbiddenError } from '../../lib/errors.js';
import { publicUrl } from '../../lib/media-url.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { contactState } from '../consent/contact-consent.service.js';
import { toDealListRows } from '../deals/deal-view.js';
import { availableQuantityOf, trimQuantity } from '../listings/listing-view.service.js';
import { publicListingWhere } from '../listings/public-where.service.js';
import { loadOfferViews } from '../offers/offer-view.js';
import { publicText } from './chat-view.js';
import { getThreadForParty, type ChatReader, type ThreadRow } from './members.js';

/**
 * Threads as a party reads them (F6 + F7 spec §6.1, §6.2, §6.11, §12.2 `GET /threads/:id`; ported from textile
 * `services/chat/thread.service.ts` `getThreadDetail`). The listing strip is read whatever the listing's status (review
 * change 8); names and titles are masked always (§6.5); the contact block is L1-4's `contactState`.
 */

type Conn = Db | Tx;

/** The other business of a thread for a reader. */
export function otherBusinessId(thread: Pick<ThreadRow, 'buyerBusinessId' | 'sellerBusinessId'>, reader: Pick<ChatReader, 'side'>): string {
  return reader.side === 'buyer' ? thread.sellerBusinessId : thread.buyerBusinessId;
}

/** Who blocked whom between two businesses, from `mine`'s point of view (§6.11). */
export async function blockStateBetween(conn: Conn, mine: string, other: string): Promise<BlockState> {
  const rows = await conn
    .select({ blocker: businessBlocks.blockerBusinessId })
    .from(businessBlocks)
    .where(
      or(
        and(eq(businessBlocks.blockerBusinessId, mine), eq(businessBlocks.blockedBusinessId, other)),
        and(eq(businessBlocks.blockerBusinessId, other), eq(businessBlocks.blockedBusinessId, mine)),
      ),
    );
  if (rows.some((r) => r.blocker === mine)) return 'blocked_by_me';
  if (rows.length > 0) return 'blocked_me';
  return 'none';
}

/** `403 BUSINESS_BLOCKED` when either business blocked the other (§6.4, §6.11). */
export async function assertNotBlocked(conn: Conn, thread: Pick<ThreadRow, 'buyerBusinessId' | 'sellerBusinessId'>): Promise<void> {
  if ((await blockStateBetween(conn, thread.buyerBusinessId, thread.sellerBusinessId)) !== 'none') {
    throw new ForbiddenError("You can't message this business", 'BUSINESS_BLOCKED');
  }
}

/** Counterparts by business id: name masked (§6.5), GST badge. */
export async function loadCounterparts(conn: Conn, ids: string[]): Promise<Map<string, Counterpart>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await conn
    .select({ id: businesses.id, name: businesses.tradeName, levels: businesses.verificationLevels })
    .from(businesses)
    .where(inArray(businesses.id, unique));
  return new Map(rows.map((r) => [r.id, { businessId: r.id, name: publicText(r.name) ?? '', gstVerified: r.levels.includes('gst') }]));
}

const THUMB = sql<string | null>`(SELECT m.thumb_key FROM listing_media m WHERE m.listing_id = ${listings.id} AND m.type = 'photo' ORDER BY m.sort_order, m.created_at LIMIT 1)`;

/** The thread's listing strip, whatever the listing's status: the latest deal's title snapshot when there is one. */
export async function listingStripOf(conn: Conn, thread: Pick<ThreadRow, 'id' | 'listingId'>): Promise<ThreadListingStrip> {
  const [row] = await conn
    .select({
      l: listings,
      unitKey: units.key,
      unitLabel: units.label,
      unitDecimals: units.decimals,
      thumbKey: THUMB,
      isPublic: sql<boolean>`${publicListingWhere()}`,
      dealTitle: sql<string | null>`(SELECT d.listing_title FROM deals d WHERE d.thread_id = ${thread.id} ORDER BY d.accepted_at DESC, d.id DESC LIMIT 1)`,
    })
    .from(listings)
    .leftJoin(units, eq(units.id, listings.unitId))
    .where(eq(listings.id, thread.listingId));
  const l = row!.l;
  return {
    listingId: l.id,
    ref: l.ref,
    kind: l.kind,
    title: publicText(row!.dealTitle ?? l.title ?? '') ?? '',
    thumbUrl: publicUrl(row!.thumbKey),
    status: l.status,
    priceModel: l.priceModel,
    pricePaise: l.pricePaise,
    gstMode: l.gstMode,
    unit: row!.unitKey ? { key: row!.unitKey, label: row!.unitLabel!, decimals: row!.unitDecimals! } : null,
    quantity: trimQuantity(l.quantity),
    availableQuantity: availableQuantityOf(l),
    minOrderQty: trimQuantity(l.minOrderQty),
    noLongerListed: !row!.isPublic,
  };
}

/** The derived enquiry status (§6.2) of one thread, from the database. */
export async function threadEnquiryStatus(conn: Conn, thread: ThreadRow): Promise<EnquiryStatus> {
  const [open] = await conn
    .select({ id: offers.id })
    .from(offers)
    .where(and(eq(offers.threadId, thread.id), inArray(offers.status, ['pending', 'backup'])))
    .limit(1);
  // M14 (as `recomputeTurns`): an open booking request is an open negotiation.
  const [openBooking] = await conn
    .select({ id: rentalBookings.id })
    .from(rentalBookings)
    .where(and(eq(rentalBookings.threadId, thread.id), inArray(rentalBookings.status, ['requested', 'countered'])))
    .limit(1);
  const [pub] = await conn.select({ id: listings.id }).from(listings).where(and(eq(listings.id, thread.listingId), publicListingWhere()));
  const block = await blockStateBetween(conn, thread.buyerBusinessId, thread.sellerBusinessId);
  return enquiryStatus({
    dealCount: thread.dealCount,
    firstSellerReplyAt: thread.firstSellerReplyAt,
    hasOpenNegotiation: open !== undefined || openBooking !== undefined,
    listingPublic: pub !== undefined,
    blocked: block !== 'none',
  });
}

/**
 * The offer cards as the reader sees them (`OfferView`, with actions and bounds): L2's `loadOfferViews`
 * (`services/offers/offer-view.ts`), notes through `visibleText` per reader. Rows of another thread are skipped.
 */
export async function offerViewsFor(
  conn: Conn,
  offerIds: string[],
  reader: ChatReader,
  thread: ThreadRow,
): Promise<Map<string, OfferView>> {
  return loadOfferViews(conn, offerIds, reader, thread);
}

/** The deals of a thread as list rows for the reader's business, newest first (L3's `toDealListRows`). */
export async function threadDealRows(conn: Conn, reader: ChatReader, thread: ThreadRow): Promise<DealListRow[]> {
  const rows = await conn
    .select()
    .from(deals)
    .where(eq(deals.threadId, thread.id))
    .orderBy(desc(deals.acceptedAt), desc(deals.id));
  return toDealListRows(conn, rows, reader.businessId);
}

/** Whether the thread has any deal (share my number is offered only then, §6.6). */
export async function threadHasDeal(conn: Conn, threadId: string): Promise<boolean> {
  const [d] = await conn.select({ id: deals.id }).from(deals).where(eq(deals.threadId, threadId)).limit(1);
  return d !== undefined;
}

/** `GET /threads/:id` (§12.2). Outsiders get `404 THREAD_NOT_FOUND`. */
export async function getThreadDetail(conn: Conn, user: UserTokenPayload, threadId: string): Promise<ThreadDetail> {
  const { thread, reader } = await getThreadForParty(conn, user, threadId);
  const other = otherBusinessId(thread, reader);
  const counterparts = await loadCounterparts(conn, [other]);
  const strip = await listingStripOf(conn, thread);
  const blockState = await blockStateBetween(conn, reader.businessId, other);
  const [state] = await conn
    .select()
    .from(chatThreadUserState)
    .where(and(eq(chatThreadUserState.threadId, thread.id), eq(chatThreadUserState.userId, reader.userId)));
  const lastReadSeq = state?.lastReadSeq ?? 0;
  const [unread] = await conn.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM chat_messages m
    WHERE m.thread_id = ${thread.id} AND m.seq > ${lastReadSeq}
      AND (m.sender_side IS NULL OR m.sender_side <> ${reader.side}::party_side)`).then((r) => r.rows);

  const [openRow] = await conn
    .select({ id: offers.id })
    .from(offers)
    .where(and(eq(offers.threadId, thread.id), inArray(offers.status, ['pending', 'backup'])))
    // L2's open negotiation (R11: one per thread): the newest `pending` or `backup` row.
    .orderBy(desc(offers.createdAt), desc(offers.id))
    .limit(1);
  const openViews = openRow ? await offerViewsFor(conn, [openRow.id], reader, thread) : new Map<string, OfferView>();

  return {
    id: thread.id,
    side: reader.side,
    memberRole: reader.memberRole,
    counterpart: counterparts.get(other)!,
    listingStrip: strip,
    enquiryStatus: await threadEnquiryStatus(conn, thread),
    canWrite: reader.memberRole !== 'viewer' && blockState === 'none',
    blockState,
    openNegotiation: openRow ? (openViews.get(openRow.id) ?? null) : null,
    deals: await threadDealRows(conn, reader, thread),
    contact: await contactState(conn, thread, reader),
    archived: state?.archivedAt != null,
    lastReadSeq: String(lastReadSeq),
    unread: unread?.n ?? 0,
    machineTip: thread.listingKind !== 'part',
    // M14 §8: the thread's rental bookings, newest first (the app's contact banner reads `confirmedAt`).
    bookings: (
      await conn
        .select({ id: rentalBookings.id, status: rentalBookings.status, confirmedAt: rentalBookings.confirmedAt })
        .from(rentalBookings)
        .where(eq(rentalBookings.threadId, thread.id))
        .orderBy(desc(rentalBookings.createdAt), desc(rentalBookings.id))
    ).map((b) => ({ id: b.id, status: b.status, confirmedAt: b.confirmedAt ? b.confirmedAt.toISOString() : null })),
  };
}
