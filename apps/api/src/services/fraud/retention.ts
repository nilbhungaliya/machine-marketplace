import type { TxApp } from '../../lib/tx-effects.js';

/**
 * The `admin-retention` job (admin close-out §9): deletes sightings older than 90 days, signals closed more than a year
 * ago and password tokens used or expired more than 7 days ago, in batches of 1 000 (`FOR UPDATE SKIP LOCKED`).
 */
export async function runAdminRetention(_app: TxApp): Promise<void> {
  // AC-STUB(A3)
}
