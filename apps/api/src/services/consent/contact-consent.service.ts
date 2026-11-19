import type { Db, Tx } from '../../db/index.js';

/**
 * Share my number and the reveal (F6 + F7 spec §6.6, R6). L1-4 owns this file.
 */

/**
 * Sets `contact_unlocked_at` (with the `contact_shared` system line and deal event) when the thread has a deal and both
 * sides hold a valid consent. Returns whether the thread is unlocked after the call.
 */
// F6F7-STUB(L1): L1-4 implements the reveal.
export async function maybeReveal(_tx: Tx, _threadId: string): Promise<boolean> {
  return false;
}

/** Whether `businessId`'s latest consent in the thread is a `grant` of its current number (§5.5). */
// F6F7-STUB(L1): L1-4 implements the consent check.
export async function validConsent(_conn: Db | Tx, _threadId: string, _businessId: string): Promise<boolean> {
  return false;
}
