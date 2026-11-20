import { and, eq, inArray } from 'drizzle-orm';
import {
  requestSideAccepts,
  type ListingKind,
  type PartRequestKind,
  type PartSide,
  type ReplyFitReason,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { categories, listings, partRequestReplies } from '../../db/schema.js';
import { machineCategoryOf } from './categories.js';
import type { PartRequestRow } from './locks.js';

// Whether a listing can answer a request (spec §9.2; textile `reply.service.ts` fit check): same kind, category under
// the request's machine category (sellers categorise differently), `requestSideAccepts`, condition accepted. Shared by
// the reply picker, the reply send and the pending-reply delivery re-check (`no_longer_fits`).

type Conn = Db | Tx;

/** The first reason a listing doesn't fit (`kind`, `category`, `side`, `condition`), or null when it fits. Pure. */
export function replyFitReason(
  req: { kind: PartRequestKind; side: PartSide | null; conditionIds: string[]; rootPath: string },
  listing: { kind: ListingKind; side: PartSide | null; conditionId: string | null; categoryPath: string | null },
): Exclude<ReplyFitReason, 'replied'> | null {
  if (listing.kind !== req.kind) return 'kind';
  const p = listing.categoryPath;
  if (!p || !(p === req.rootPath || p.startsWith(`${req.rootPath}/`))) return 'category';
  if (!requestSideAccepts(req.side, listing.side)) return 'side';
  if (req.conditionIds.length > 0 && (!listing.conditionId || !req.conditionIds.includes(listing.conditionId))) return 'condition';
  return null;
}

/**
 * Each listing's fit for the request: `replied` when the listing already has a pending, delivered or withdrawn reply on
 * it (one reply per listing per request, withdraw final), else `replyFitReason`. Unknown listing ids are left out.
 */
export async function replyFitReasons(
  conn: Conn,
  request: PartRequestRow,
  listingIds: string[],
): Promise<Map<string, ReplyFitReason | null>> {
  const out = new Map<string, ReplyFitReason | null>();
  if (listingIds.length === 0) return out;
  const root = await machineCategoryOf(conn, request.categoryId);
  const rows = await conn
    .select({
      id: listings.id,
      kind: listings.kind,
      side: listings.side,
      conditionId: listings.conditionId,
      categoryPath: categories.path,
    })
    .from(listings)
    .leftJoin(categories, eq(categories.id, listings.categoryId))
    .where(inArray(listings.id, listingIds));
  const replied = new Set(
    (
      await conn
        .select({ listingId: partRequestReplies.listingId })
        .from(partRequestReplies)
        .where(
          and(
            eq(partRequestReplies.partRequestId, request.id),
            inArray(partRequestReplies.listingId, listingIds),
            inArray(partRequestReplies.status, ['pending', 'delivered', 'withdrawn']),
          ),
        )
    ).map((r) => r.listingId),
  );
  for (const l of rows) {
    if (replied.has(l.id)) {
      out.set(l.id, 'replied');
      continue;
    }
    out.set(
      l.id,
      root
        ? replyFitReason(
            { kind: request.kind, side: request.side, conditionIds: request.conditionIds, rootPath: root.path },
            { kind: l.kind, side: l.side, conditionId: l.conditionId, categoryPath: l.categoryPath },
          )
        : 'category',
    );
  }
  return out;
}
