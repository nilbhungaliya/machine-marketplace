import type { TxApp } from '../../lib/tx-effects.js';

/**
 * Offer jobs (F6 + F7 spec §7.9, §14). L2-5 owns this file. Run from `jobs/index.ts`.
 */

/** `offer-expiry` (1 min): pending past `expires_at` → expired; backups older than `offer_backup_max_days` → expired. */
// F6F7-STUB(L2): L2-5 implements the expiry job.
export async function expireOffers(_app: TxApp): Promise<void> {
  return;
}

/** `offer-expiring-soon` (5 min): `offer_expiring` notifications. */
// F6F7-STUB(L2): L2-5 implements the expiring-soon notices.
export async function notifyExpiringOffers(_app: TxApp): Promise<void> {
  return;
}
