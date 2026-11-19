import { asc, eq, inArray } from 'drizzle-orm';
import {
  MAX_COUNTER_ROUNDS,
  counterBounds,
  milliToQuantity,
  percentBelowAsking,
  quantityToMilli,
  type OfferCloseReason,
  type OfferKind,
  type OfferView,
  type PartySide,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { offers, units } from '../../db/schema.js';
import { visibleText } from '../chat/chat-view.js';
import type { ChatReader, ThreadRow } from '../chat/members.js';
import { emitToThreadMembers } from '../chat/chat-emit.js';
import { offerActions } from './offer-rules.js';

/**
 * What a reader sees of an offer (F6 + F7 spec §7, OfferView; ported from textile `offer-view.ts`). The chain context
 * (opening kind, each side's latest price) is the same for every reader; the actions, masking and scam flag are per
 * reader. Note and reject note go through `visibleText` (masked until the thread's contact is unlocked, always for a
 * viewer).
 */

export type OfferRow = typeof offers.$inferSelect;
type Conn = Db | Tx;

/** A negotiation as the counter bounds see it (§7.4): B, S and the opening kind. */
export interface ChainContext {
  openingKind: OfferKind;
  /** B: the buyer's latest price in the negotiation; null before the buyer's first price (after a quote). */
  buyerLatestPaise: number | null;
  /** S: the seller's latest price — the asking snapshot until the seller counters, or the quote. */
  sellerLatestPaise: number | null;
  /** Quantity of the buyer's / seller's own latest row; null when that side has no row yet. */
  buyerLatestQuantity: string | null;
  sellerLatestQuantity: string | null;
  unit: { key: string; label: string; decimals: number } | null;
}

/** Reads the negotiation's rows and its unit (one query each). */
export async function chainContext(conn: Conn, row: Pick<OfferRow, 'negotiationId' | 'unitId'>): Promise<ChainContext> {
  const rows = await conn
    .select({ round: offers.round, kind: offers.kind, senderSide: offers.senderSide, price: offers.pricePerUnitPaise, quantity: offers.quantity, asking: offers.askingPricePaise })
    .from(offers)
    .where(eq(offers.negotiationId, row.negotiationId))
    .orderBy(asc(offers.round), asc(offers.createdAt));
  const opening = rows[0];
  let buyer: number | null = null;
  let seller: number | null = opening?.asking ?? null;
  let buyerQty: string | null = null;
  let sellerQty: string | null = null;
  for (const r of rows) {
    if (r.senderSide === 'buyer') {
      buyer = r.price;
      buyerQty = r.quantity;
    } else {
      seller = r.price;
      sellerQty = r.quantity;
    }
  }
  const unit = row.unitId
    ? ((await conn.select({ key: units.key, label: units.label, decimals: units.decimals }).from(units).where(eq(units.id, row.unitId)))[0] ?? null)
    : null;
  return { openingKind: opening?.kind ?? 'offer', buyerLatestPaise: buyer, sellerLatestPaise: seller, buyerLatestQuantity: buyerQty, sellerLatestQuantity: sellerQty, unit };
}

/** The inclusive counter range for `side`, or null when no counter is possible (§7.4: buy-now, rounds used, empty). */
export function boundsFor(
  row: Pick<OfferRow, 'status' | 'round'>,
  ctx: ChainContext,
  side: PartySide,
): { minPaise: number; maxPaise: number } | null {
  if (row.status !== 'pending' || row.round >= MAX_COUNTER_ROUNDS || ctx.openingKind === 'buy_now') return null;
  if (ctx.sellerLatestPaise === null) return null;
  const b = counterBounds({ by: side, buyerLatestPaise: ctx.buyerLatestPaise, sellerLatestPaise: ctx.sellerLatestPaise });
  return b.minPaise > b.maxPaise ? null : b;
}

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

/** Pure: the row as `reader` sees it. `now` only decides whether actions are offered (display, not a rule). */
export function toOfferView(
  row: OfferRow,
  reader: Pick<ChatReader, 'side' | 'memberRole'>,
  thread: Pick<ThreadRow, 'contactUnlockedAt'>,
  ctx: ChainContext,
  now: Date = new Date(),
): OfferView {
  const expired = row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime();
  const turnBounds = boundsFor(row, ctx, row.turn);
  const isMine = reader.side === row.senderSide;
  return {
    id: row.id,
    threadId: row.threadId,
    listingId: row.listingId,
    negotiationId: row.negotiationId,
    previousOfferId: row.previousOfferId,
    kind: row.kind,
    round: row.round,
    roundsLeft: Math.max(0, MAX_COUNTER_ROUNDS - row.round),
    status: row.status,
    closeReason: (row.closeReason as OfferCloseReason | null) ?? null,
    senderSide: row.senderSide,
    isMine,
    turn: row.turn,
    needsReconfirm: row.needsReconfirm,
    pricePerUnitPaise: row.pricePerUnitPaise,
    quantity: milliToQuantity(quantityToMilli(row.quantity)),
    totalPaise: row.totalPaise.toString(),
    askingPricePaise: row.askingPricePaise,
    // P13: negotiable chains only (a quote chain has no asking snapshot; buy-now is at asking).
    percentBelowAsking:
      ctx.openingKind === 'offer' && row.askingPricePaise !== null ? percentBelowAsking(row.pricePerUnitPaise, row.askingPricePaise) : null,
    unit: ctx.unit,
    gstMode: row.gstMode,
    validityHours: row.validityHours,
    expiresAt: iso(row.expiresAt),
    backupSince: iso(row.backupSince),
    note: visibleText(row.note, reader, thread),
    rejectNote: visibleText(row.rejectNote, reader, thread),
    scamWarning: row.scamFlag && !isMine,
    answeredAt: iso(row.answeredAt),
    createdAt: row.createdAt.toISOString(),
    actions: offerActions(row, reader.side, reader.memberRole, { canCounter: turnBounds !== null, expired }),
    bounds: turnBounds,
  };
}

/** One row as one reader sees it (reads the chain). */
export async function loadOfferView(conn: Conn, row: OfferRow, reader: Pick<ChatReader, 'side' | 'memberRole'>, thread: Pick<ThreadRow, 'contactUnlockedAt'>): Promise<OfferView> {
  return toOfferView(row, reader, thread, await chainContext(conn, row));
}

/** Several rows of one thread for one reader (the thread screen, L1). */
export async function loadOfferViews(
  conn: Conn,
  offerIds: string[],
  reader: Pick<ChatReader, 'side' | 'memberRole'>,
  thread: Pick<ThreadRow, 'id' | 'contactUnlockedAt'>,
): Promise<Map<string, OfferView>> {
  const result = new Map<string, OfferView>();
  const ids = [...new Set(offerIds)];
  if (ids.length === 0) return result;
  const rows = await conn.select().from(offers).where(inArray(offers.id, ids));
  const contexts = new Map<string, ChainContext>();
  for (const row of rows) {
    if (row.threadId !== thread.id) continue;
    let ctx = contexts.get(row.negotiationId);
    if (!ctx) contexts.set(row.negotiationId, (ctx = await chainContext(conn, row)));
    result.set(row.id, toOfferView(row, reader, thread, ctx));
  }
  return result;
}

/** `offer:updated { threadId, offer }` to every member of both businesses, each with their own view (R10, §13). */
export async function emitOfferUpdated(tx: Tx, thread: ThreadRow, row: OfferRow): Promise<void> {
  const ctx = await chainContext(tx, row);
  await emitToThreadMembers(tx, thread, 'offer:updated', (reader) => ({ threadId: thread.id, offer: toOfferView(row, reader, thread, ctx) }));
}
