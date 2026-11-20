import { asc, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../../db/index.js';
import { partRequestReplies, partRequests } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { lockBuyerBusiness } from '../deals/locks.js';

/**
 * Row locks for F8 (spec §9.5), in **this order** whenever a transaction takes more than one:
 *
 *   the actor's own business (`FOR NO KEY UPDATE`, only where a limit is counted) → part request (`FOR NO KEY UPDATE`
 *   for buyer / admin / job writes, `FOR SHARE` for a reply, create-listing-with-request, not relevant) → replies /
 *   targets / matches / feedback rows
 *
 * Jobs and admin lock requests in id order and **never** a business row. `part_requests` are **never** locked
 * `FOR UPDATE`: F6 accept inserts the fulfil-prompt notification, whose FK takes `KEY SHARE` on the request, which
 * `FOR NO KEY UPDATE` and `FOR SHARE` allow. F8 takes no explicit listing lock (reply / match / target inserts take
 * `KEY SHARE` on the listing through their FK: request → listing (KEY SHARE) → child rows).
 */

export type PartRequestRow = typeof partRequests.$inferSelect;
export type ReplyRow = typeof partRequestReplies.$inferSelect;
/** The request table, or an `alias(partRequests, …)`, for SQL builders such as `eligibleSellerSql`. */
export type PartRequestColumns = typeof partRequests;

/** `404 PART_REQUEST_NOT_FOUND`: a missing request and one the reader may not see answer the same (§6). */
export function partRequestNotFound(): AppError {
  return new AppError('Requirement not found', 404, 'PART_REQUEST_NOT_FOUND');
}

/**
 * The request row, `FOR NO KEY UPDATE` (buyer, admin and job writes) or `FOR SHARE` (reply, create-with-request, not
 * relevant). Null when it doesn't exist or, with `skipLocked`, another transaction holds it; callers turn null into
 * `partRequestNotFound()` or a skip.
 */
export async function lockPartRequest(
  tx: Tx,
  id: string,
  mode: 'no_key_update' | 'share',
  opts: { skipLocked?: boolean } = {},
): Promise<PartRequestRow | null> {
  const strength = mode === 'share' ? 'share' : 'no key update';
  const q = tx.select().from(partRequests).where(eq(partRequests.id, id));
  const [row] = await (opts.skipLocked ? q.for(strength, { skipLocked: true }) : q.for(strength));
  return row ?? null;
}

/** Several requests `FOR NO KEY UPDATE` in id order (jobs, admin). Missing ids are skipped. */
export async function lockPartRequestsInOrder(tx: Tx, ids: string[]): Promise<PartRequestRow[]> {
  if (ids.length === 0) return [];
  const sorted = [...new Set(ids)].sort();
  return tx.select().from(partRequests).where(inArray(partRequests.id, sorted)).orderBy(asc(partRequests.id)).for('no key update');
}

/** The actor's own business, first (`FOR NO KEY UPDATE`), where a limit is counted: F6's `lockBuyerBusiness`. */
export const lockOwnBusiness = lockBuyerBusiness;
