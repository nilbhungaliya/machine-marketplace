import type { TxApp } from '../../lib/tx-effects.js';

// The `part-request-work` job (spec §5.7, §7): claims `part_request_work` rows (`FOR UPDATE SKIP LOCKED`) and runs
// targeting (`target_request`) and matching / pending-reply delivery / match re-checks (`listing_changed`). Lane A2.

export async function runPartRequestWork(_app: TxApp): Promise<{ processed: number }> {
  // F8-STUB(A2): claim and run the queue.
  return { processed: 0 };
}
