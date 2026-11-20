import { and, asc, desc, eq, or } from 'drizzle-orm';
import type { BlockedBusinessItem } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { businessBlocks, businesses, chatThreads } from '../../db/schema.js';
import { ValidationError } from '../../lib/errors.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { lockListingsInOrder } from '../deals/locks.js';
import { closeChainsBetween } from '../offers/reconcile.js';
import { exitBookingsForBlock } from '../rentals/system-exits.js';
import { publicText } from './chat-view.js';
import { assertCanWrite, getThreadForParty } from './members.js';
import { insertSystemLine, recomputeTurns } from './thread-lines.js';
import { otherBusinessId } from './thread.service.js';

/**
 * Block (F6 + F7 spec §6.11): from the thread menu by a non-viewer. The two businesses can't start threads with each
 * other or write in existing ones, and their open offers and backups close (`blocked`, L2's `closeChainsBetween`).
 * Deals in progress continue. Unblock from Profile › Blocked businesses. Lock order (§8.5, plan review I7): the
 * listings of every thread between the pair (both directions) in id order, then the offers (inside
 * `closeChainsBetween`), then each thread; the `blocked` line is written **last**.
 */

type Conn = Db | Tx;

/** Threads between two businesses, either direction, in id order. */
async function threadsBetween(conn: Conn, a: string, b: string) {
  return conn
    .select()
    .from(chatThreads)
    .where(
      or(
        and(eq(chatThreads.buyerBusinessId, a), eq(chatThreads.sellerBusinessId, b)),
        and(eq(chatThreads.buyerBusinessId, b), eq(chatThreads.sellerBusinessId, a)),
      ),
    )
    .orderBy(asc(chatThreads.id));
}

/** `POST /threads/:id/block` → `{ blocked: true }`. Blocking again changes nothing. */
export async function blockFromThread(tx: Tx, user: UserTokenPayload, threadId: string): Promise<{ blocked: true }> {
  const { thread, reader } = await getThreadForParty(tx, user, threadId);
  assertCanWrite(reader);
  const mine = reader.businessId;
  const other = otherBusinessId(thread, reader);
  if (mine === other) throw new ValidationError("You can't block your own business", undefined, 'BLOCK_SELF');

  const threads = await threadsBetween(tx, mine, other);
  await lockListingsInOrder(tx, threads.map((t) => t.listingId));
  const inserted = await tx
    .insert(businessBlocks)
    .values({ blockerBusinessId: mine, blockedBusinessId: other, createdByUserId: reader.userId })
    .onConflictDoNothing()
    .returning({ blocker: businessBlocks.blockerBusinessId });
  if (inserted.length === 0) return { blocked: true };

  await closeChainsBetween(tx, mine, other);
  // M14 (spec §6.1): open rental requests between the two end (`blocked`); confirmed bookings continue.
  await exitBookingsForBlock(tx, mine, other);
  for (const t of threads) {
    await recomputeTurns(tx, t.id);
    const side = t.buyerBusinessId === mine ? 'buyer' : 'seller';
    // Last: after the offers' own lines, so it is the thread's last line.
    await insertSystemLine(tx, t.id, 'blocked', { side }, { actorSide: side });
  }
  return { blocked: true };
}

/** `DELETE /users/me/blocks/:businessId`: lifts my business's block (a block by the other business stays). */
export async function unblock(tx: Tx, user: UserTokenPayload, businessId: string): Promise<{ blocked: false }> {
  const mine = user.businessId;
  if (!mine) return { blocked: false };
  const removed = await tx
    .delete(businessBlocks)
    .where(and(eq(businessBlocks.blockerBusinessId, mine), eq(businessBlocks.blockedBusinessId, businessId)))
    .returning({ blocked: businessBlocks.blockedBusinessId });
  if (removed.length > 0) {
    for (const t of await threadsBetween(tx, mine, businessId)) await recomputeTurns(tx, t.id);
  }
  return { blocked: false };
}

/** `GET /users/me/blocks`: the businesses mine has blocked, newest first (names masked). */
export async function listBlocks(
  conn: Conn,
  user: UserTokenPayload,
): Promise<{ items: BlockedBusinessItem[] }> {
  if (!user.businessId) return { items: [] };
  const rows = await conn
    .select({ businessId: businessBlocks.blockedBusinessId, name: businesses.tradeName, createdAt: businessBlocks.createdAt })
    .from(businessBlocks)
    .innerJoin(businesses, eq(businesses.id, businessBlocks.blockedBusinessId))
    .where(eq(businessBlocks.blockerBusinessId, user.businessId))
    .orderBy(desc(businessBlocks.createdAt));
  return { items: rows.map((r) => ({ businessId: r.businessId, name: publicText(r.name) ?? '', blockedAt: r.createdAt.toISOString() })) };
}

