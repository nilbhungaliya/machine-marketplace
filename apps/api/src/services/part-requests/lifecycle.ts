import { and, eq, sql } from 'drizzle-orm';
import {
  PART_REQUEST_TRANSITIONS,
  partRequestTransition,
  type PartRequestAction,
  type PartRequestStatus,
} from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { partRequests } from '../../db/schema.js';
import { ConflictError } from '../../lib/errors.js';
import { emitRequestUpdated } from './emit.js';
import type { PartRequestRow } from './locks.js';

// The only writer of `part_requests.status` (spec §9.1; textile `requirement.service.ts` status write). Side effects
// beyond the row (dropping pending replies, notifications, re-targeting) are the caller's.

const notAllowed = (from: PartRequestStatus, action: PartRequestAction) =>
  new ConflictError('This requirement can’t do that now', 'PART_REQUEST_TRANSITION_NOT_ALLOWED', { from, action });

/**
 * Moves `row` by `action` (`partRequestTransition`; `restore` goes to `row.returnStatus`, `expired` when that is
 * `active` and `expires_at < now()`), as a conditional `UPDATE … WHERE id AND status = row.status`: an illegal action
 * or a row whose status changed underneath → `409 PART_REQUEST_TRANSITION_NOT_ALLOWED { from, action }`. Sets
 * `updated_at`; `close` stamps `closed_at`, `fulfil` `fulfilled_at`, `remove` `removed_at` and `return_status = from`,
 * `restore` clears `return_status`; `set` adds or overrides columns (close reason, fulfilled deal, removal reason…).
 * A `system` or `admin` action queues `part_request:updated { reason: 'status' }` to the buyer business (plan D13).
 */
export async function writeRequestStatus(
  tx: Tx,
  row: PartRequestRow,
  action: PartRequestAction,
  set: Partial<typeof partRequests.$inferInsert> = {},
): Promise<PartRequestRow> {
  let pastExpiry = false;
  if (action === 'restore' && row.returnStatus === 'active') {
    const [r] = await tx
      .select({ past: sql<boolean>`${partRequests.expiresAt} < now()` })
      .from(partRequests)
      .where(eq(partRequests.id, row.id));
    pastExpiry = r?.past === true;
  }
  const to = partRequestTransition(row.status, action, { returnStatus: row.returnStatus, pastExpiry });
  if (to === null) throw notAllowed(row.status, action);

  const stamps: Partial<typeof partRequests.$inferInsert> = {};
  if (action === 'close') stamps.closedAt = sql`now()` as unknown as Date;
  if (action === 'fulfil') stamps.fulfilledAt = sql`now()` as unknown as Date;
  if (action === 'remove') {
    stamps.removedAt = sql`now()` as unknown as Date;
    stamps.returnStatus = row.status;
  }
  if (action === 'restore') stamps.returnStatus = null;

  const [updated] = await tx
    .update(partRequests)
    .set({ ...stamps, ...set, status: to, updatedAt: sql`now()` as unknown as Date })
    .where(and(eq(partRequests.id, row.id), eq(partRequests.status, row.status)))
    .returning();
  if (!updated) {
    const [now] = await tx.select({ status: partRequests.status }).from(partRequests).where(eq(partRequests.id, row.id));
    throw notAllowed(now?.status ?? row.status, action);
  }

  const actor = PART_REQUEST_TRANSITIONS[action].actor;
  if (actor === 'system' || actor === 'admin') emitRequestUpdated(tx, updated, 'status');
  return updated;
}
