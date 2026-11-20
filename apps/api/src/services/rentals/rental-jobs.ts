import type { TxApp } from '../../lib/tx-effects.js';

// M14 lane A2 (plan A2-3, spec §9): the four rental jobs. Each reads candidate ids without locks, then per row (its own
// savepoint, `runJobTx` + `effectsTx`): listing, then booking `FOR NO KEY UPDATE SKIP LOCKED`, re-check, act.

/** `rental-booking-expiry` (5 min): open requests past `reply_due_at` or starting before today → `expired`. */
export async function runRentalBookingExpiry(_app: TxApp): Promise<void> {
  // M14-STUB(A2)
}

/** `rental-booking-auto-complete` (5 min): `returned` past `auto_complete_at` → `completed` (`auto`). */
export async function runRentalAutoComplete(_app: TxApp): Promise<void> {
  // M14-STUB(A2)
}

/** `rental-booking-reminders` (1 h): starts tomorrow, due back, overdue, not started; each once. */
export async function runRentalReminders(_app: TxApp): Promise<void> {
  // M14-STUB(A2)
}

/** `rental-status-sync` (15 min): rental listings whose `rented` disagrees with today's capacity; overrun clashes. */
export async function runRentalStatusSync(_app: TxApp): Promise<void> {
  // M14-STUB(A2)
}
