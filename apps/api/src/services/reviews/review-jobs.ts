import type { TxApp } from '../../lib/tx-effects.js';

/**
 * Review jobs (F6 + F7 spec §10.3, §14). L4-1 owns this file. Run from `jobs/index.ts`.
 */

/** `review-publish` (15 min): single reviews past `publish_due_at` → published. */
// F6F7-STUB(L4): L4-1 implements blind publishing.
export async function publishDueReviews(_app: TxApp): Promise<void> {
  return;
}
