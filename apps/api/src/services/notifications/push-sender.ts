import type { TxApp } from '../../lib/tx-effects.js';

/**
 * Push delivery (F6 + F7 spec §11.5–§11.6). Opt-in: without Firebase keys deliveries are logged by the dev stub. L4-4
 * owns this file. Run from `jobs/index.ts` (`notification-push`, every 3 s).
 */

// F6F7-STUB(L4): L4-4 implements the sender.
export async function sendDuePushes(_app: TxApp): Promise<void> {
  return;
}
