import { and, desc, eq } from 'drizzle-orm';
import type { SellerReplyView } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { listings, partRequestReplies } from '../../db/schema.js';
import { maskContact } from '../../lib/mask-contact.js';

// The seller's own replies on a request (spec §12.3 "Your replies"; textile `services/requirements/reply-view.ts`).

type Conn = Db | Tx;

/** A request name as every reader and every notification sees it (R9): phones and emails masked. */
export function maskedRequestName(name: string): string {
  return maskContact(name);
}

/** The seller business's replies on the request, newest first; messages masked; `seenByBuyer` once the buyer opened it. */
export async function sellerReplyViews(conn: Conn, partRequestId: string, sellerBusinessId: string): Promise<SellerReplyView[]> {
  const rows = await conn
    .select({ r: partRequestReplies, listingTitle: listings.title })
    .from(partRequestReplies)
    .innerJoin(listings, eq(listings.id, partRequestReplies.listingId))
    .where(and(eq(partRequestReplies.partRequestId, partRequestId), eq(partRequestReplies.sellerBusinessId, sellerBusinessId)))
    .orderBy(desc(partRequestReplies.createdAt), desc(partRequestReplies.id));
  return rows.map(({ r, listingTitle }) => ({
    id: r.id,
    listingId: r.listingId,
    listingTitle: listingTitle ?? '',
    status: r.status,
    dropReason: r.dropReason,
    message: r.message === null ? null : maskContact(r.message),
    deliveredAt: r.deliveredAt?.toISOString() ?? null,
    withdrawnAt: r.withdrawnAt?.toISOString() ?? null,
    droppedAt: r.droppedAt?.toISOString() ?? null,
    seenByBuyer: r.buyerViewedAt !== null,
    createdAt: r.createdAt.toISOString(),
  }));
}
