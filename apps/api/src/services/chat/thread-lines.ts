import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { enquiryStatus, threadTurns, type PartySide, type SystemLineCode } from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import {
  businessBlocks,
  chatMessages,
  chatThreadUserState,
  chatThreads,
  deals,
  listings,
  offers,
  rentalBookings,
  users,
} from '../../db/schema.js';
import { lockThread } from '../deals/locks.js';
import { publicListingWhere } from '../listings/public-where.service.js';
import type { ThreadRow } from './members.js';
import { emitMessageNew } from './message-emit.js';

/**
 * The only writer of `chat_messages` (F6 + F7 spec §5.2–§5.3; ported from textile `message.service.ts` `insertMessage`,
 * `addSystemMessage`, `addCardMessage`). Every row moves the thread's inbox columns in the same transaction and queues
 * `message:new` per reader (`emitMessageNew`). Callers hold the thread's lock (last in the §8.5 order) or let
 * `insertSystemLine` / `insertCardMessage` take it.
 */

export type MessageRow = typeof chatMessages.$inferSelect;
export type MessageValues = Omit<typeof chatMessages.$inferInsert, 'threadId' | 'id' | 'seq' | 'createdAt'>;

/** Clears `archived_at` for the members of `businessId` (a new line from the other side brings the thread back). */
async function unarchiveFor(tx: Tx, threadId: string, businessId: string): Promise<void> {
  await tx
    .update(chatThreadUserState)
    .set({ archivedAt: null, updatedAt: sql`now()` })
    .where(
      and(
        eq(chatThreadUserState.threadId, threadId),
        isNotNull(chatThreadUserState.archivedAt),
        inArray(chatThreadUserState.userId, tx.select({ id: users.id }).from(users).where(eq(users.businessId, businessId))),
      ),
    );
}

/**
 * Inserts a row and updates the thread: `last_message_seq / at`; the sender side's `last_buyer_seq` / `last_seller_seq`
 * (a system line raises both); `first_seller_reply_at` on the first seller-sent row; the receiving business's archive
 * cleared (for a system line, the side other than `actorSide`, none from a job). Then queues `message:new`.
 */
export async function insertMessage(
  tx: Tx,
  thread: ThreadRow,
  values: MessageValues,
  opts: { actorSide?: PartySide } = {},
): Promise<MessageRow> {
  const [row] = await tx.insert(chatMessages).values({ ...values, threadId: thread.id }).returning();
  const side = values.senderSide ?? null;
  const [updated] = await tx
    .update(chatThreads)
    .set({
      // greatest(): two transactions can commit their rows out of seq order; a pointer never moves back.
      lastMessageSeq: sql`greatest(${chatThreads.lastMessageSeq}, ${row!.seq})`,
      lastMessageAt: row!.createdAt,
      ...(side !== 'seller' ? { lastBuyerSeq: sql`greatest(${chatThreads.lastBuyerSeq}, ${row!.seq})` } : {}),
      ...(side !== 'buyer' ? { lastSellerSeq: sql`greatest(${chatThreads.lastSellerSeq}, ${row!.seq})` } : {}),
      ...(side === 'seller' ? { firstSellerReplyAt: sql`coalesce(${chatThreads.firstSellerReplyAt}, now())` } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(chatThreads.id, thread.id))
    .returning();
  const actor = side ?? opts.actorSide ?? null;
  if (actor !== null) await unarchiveFor(tx, thread.id, actor === 'buyer' ? thread.sellerBusinessId : thread.buyerBusinessId);
  await emitMessageNew(tx, updated ?? thread, row!);
  return row!;
}

/**
 * A system event stored as a code plus values (ids, numbers, safe names: no free text); each reader's app words it in
 * their language. `actorSide`: the party whose action caused it, so the other side's archive returns; jobs pass none.
 */
export async function insertSystemLine(
  tx: Tx,
  threadId: string,
  code: SystemLineCode,
  values: Record<string, string | number>,
  opts: { actorSide?: PartySide } = {},
): Promise<MessageRow> {
  const thread = await lockThread(tx, threadId);
  return insertMessage(tx, thread, { kind: 'system', systemCode: code, systemValues: values }, opts);
}

/**
 * An offer, deal or (M14 §8, plan D9) rental booking card; its contents are read live from the offer / deal / booking
 * each time a reader loads it. A booking card is the renter's (`senderSide: 'buyer'`) and is the first message of a
 * thread a request opened (no enquiry card then).
 */
export async function insertCardMessage(
  tx: Tx,
  threadId: string,
  card: {
    kind: 'offer' | 'deal' | 'booking';
    offerId?: string;
    dealId?: string;
    rentalBookingId?: string;
    senderSide: PartySide;
    senderUserId: string | null;
  },
): Promise<MessageRow> {
  const thread = await lockThread(tx, threadId);
  return insertMessage(tx, thread, {
    kind: card.kind,
    senderSide: card.senderSide,
    senderUserId: card.senderUserId,
    offerId: card.kind === 'offer' ? card.offerId ?? null : null,
    dealId: card.kind === 'deal' ? card.dealId ?? null : null,
    rentalBookingId: card.kind === 'booking' ? card.rentalBookingId ?? null : null,
  });
}

/**
 * Writes `buyer_turn` / `seller_turn` from `threadTurns` (§6.10): the pending offer's turn, an `open` enquiry (derived
 * status) for the seller, and the thread's deals waiting on a side. Called by every transaction that changes an input.
 *
 * M14 (plan D10): the thread's **open** rental bookings add their turn (`requested` → the owner = seller, `countered`
 * → the renter = buyer) and count as an open negotiation. The date-dependent rental turns (mark on site, mark returned)
 * are never stored here (they would go stale at midnight): they live in the Deals tab badge, computed on read. A thread
 * with any booking has no "unanswered enquiry" turn: the booking card replaces the enquiry card (D9).
 */
export async function recomputeTurns(tx: Tx, threadId: string): Promise<{ buyer: boolean; seller: boolean }> {
  const [thread] = await tx.select().from(chatThreads).where(eq(chatThreads.id, threadId));
  if (!thread) return { buyer: false, seller: false };
  // A negotiation is open while an offer is pending or a backup (§6.7); the turn comes from the pending one only.
  const live = await tx
    .select({ status: offers.status, turn: offers.turn })
    .from(offers)
    .where(and(eq(offers.threadId, threadId), inArray(offers.status, ['pending', 'backup'])));
  const open = live.find((o) => o.status === 'pending');
  const threadDeals = await tx
    .select({ status: deals.status, cancelRequestedSide: deals.cancelRequestedSide })
    .from(deals)
    .where(eq(deals.threadId, threadId));
  const [pub] = await tx
    .select({ id: listings.id })
    .from(listings)
    .where(and(eq(listings.id, thread.listingId), publicListingWhere()));
  const [block] = await tx
    .select({ one: sql<number>`1` })
    .from(businessBlocks)
    .where(
      or(
        and(eq(businessBlocks.blockerBusinessId, thread.buyerBusinessId), eq(businessBlocks.blockedBusinessId, thread.sellerBusinessId)),
        and(eq(businessBlocks.blockerBusinessId, thread.sellerBusinessId), eq(businessBlocks.blockedBusinessId, thread.buyerBusinessId)),
      ),
    )
    .limit(1);
  const bookings = await tx
    .select({ status: rentalBookings.status, turn: rentalBookings.turn })
    .from(rentalBookings)
    .where(eq(rentalBookings.threadId, threadId));
  const openBookings = bookings.filter((b) => b.status === 'requested' || b.status === 'countered');
  const status = enquiryStatus({
    dealCount: thread.dealCount,
    firstSellerReplyAt: thread.firstSellerReplyAt,
    hasOpenNegotiation: live.length > 0 || openBookings.length > 0,
    listingPublic: pub !== undefined,
    blocked: block !== undefined,
  });
  const offerTurns = threadTurns({
    openTurn: open?.turn ?? null,
    // Only an OPEN booking (requested / countered) suppresses the enquiry's owner turn (C0 review M6): a past booking
    // on the thread doesn't stop a later enquiry message from being the seller's turn.
    enquiryOpen: status === 'open' && openBookings.length === 0,
    deals: threadDeals,
  });
  const turns = {
    buyer: offerTurns.buyer || openBookings.some((b) => b.turn === 'renter'),
    seller: offerTurns.seller || openBookings.some((b) => b.turn === 'owner'),
  };
  if (turns.buyer !== thread.buyerTurn || turns.seller !== thread.sellerTurn) {
    await tx.update(chatThreads).set({ buyerTurn: turns.buyer, sellerTurn: turns.seller }).where(eq(chatThreads.id, threadId));
  }
  return turns;
}
