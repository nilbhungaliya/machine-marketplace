import type { Db } from '../../db/index.js';
import type { TxApp } from '../../lib/tx-effects.js';

// Request expiry, the expiring-soon reminder and history retention (spec §9.1, §14). Lane A3 owns this file.

/** `active` requests past `expires_at` → `expired` (`writeRequestStatus`, pending replies dropped). */
export async function expirePartRequests(_app: TxApp): Promise<{ expired: number }> {
  // F8-STUB(A3): claim due requests and expire them.
  return { expired: 0 };
}

/** `part_request_expiring` once per validity period, `part_request_expiring_notice_hours` ahead. */
export async function notifyExpiringPartRequests(_app: TxApp): Promise<{ notified: number }> {
  // F8-STUB(A3): notify and stamp `expiring_notified_at`.
  return { notified: 0 };
}

/** Old work rows, push counts and the like. Returns how many rows were deleted. */
export async function deletePartRequestHistory(_db: Db): Promise<number> {
  // F8-STUB(A3): retention.
  return 0;
}
