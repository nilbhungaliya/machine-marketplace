import type { Tx } from '../../db/index.js';
import { queueBusinessEmit } from '../../lib/tx-effects.js';

/**
 * `part_request:updated { partRequestId, reason }` to the buyer business room, after commit (spec §11): ids only. Sent
 * on a delivered reply, a new match and a status change by a job or an admin; clients refetch. No seller socket.
 */
export function emitRequestUpdated(
  tx: Tx,
  request: { id: string; businessId: string },
  reason: 'reply' | 'match' | 'status',
): void {
  queueBusinessEmit(tx, request.businessId, 'part_request:updated', { partRequestId: request.id, reason });
}
