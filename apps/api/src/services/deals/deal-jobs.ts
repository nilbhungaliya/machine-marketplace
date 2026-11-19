import type { TxApp } from '../../lib/tx-effects.js';

/**
 * Deal jobs (F6 + F7 spec §9.3, §14). L3-4 owns this file. Run from `jobs/index.ts`.
 */

/** `deal-auto-complete` (5 min): `handed_over` past `auto_complete_at` → completed. */
// F6F7-STUB(L3): L3-4 implements auto-complete.
export async function autoCompleteDeals(_app: TxApp): Promise<void> {
  return;
}

/** `deal-agreed-reminder` (daily): nudge both sides of deals `agreed` longer than `deal_agreed_reminder_days`. */
// F6F7-STUB(L3): L3-4 implements the reminder.
export async function remindAgreedDeals(_app: TxApp): Promise<void> {
  return;
}
