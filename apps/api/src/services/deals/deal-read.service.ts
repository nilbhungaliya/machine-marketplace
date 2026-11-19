import { DEAL_STATUSES, type AdminBusinessDealHistory, type DealStatus } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import type { UserTokenPayload } from '../../plugins/auth.js';

/**
 * Deal reads (F6 + F7 spec §9, §16). L3-1 / L3-3 own this file.
 */

/** Deals waiting on this user's business (the Deals tab badge, `dealYourTurn`). */
// F6F7-STUB(L3): L3-1 implements the count.
export async function dealsYourTurnCount(_conn: Db | Tx, _user: UserTokenPayload): Promise<number> {
  return 0;
}

/** Admin business detail (§16.1): deals by status (as buyer or seller) and disputes with outcomes. */
// F6F7-STUB(L3): L3-3 implements the history.
export async function businessDealHistory(_conn: Db | Tx, _businessId: string): Promise<AdminBusinessDealHistory> {
  const byStatus = Object.fromEntries(DEAL_STATUSES.map((s) => [s, 0])) as Record<DealStatus, number>;
  return { byStatus, disputes: [] };
}
