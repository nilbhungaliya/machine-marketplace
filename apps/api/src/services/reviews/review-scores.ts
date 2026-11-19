import type { SellerScore } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';

/**
 * Seller scores (F6 + F7 spec §10.4). L4-2 owns this file.
 */

/** Published, not hidden buyer reviews of the business; null under the minimum count. */
// F6F7-STUB(L4): L4-2 implements the score.
export async function sellerScore(_conn: Db | Tx, _businessId: string): Promise<SellerScore | null> {
  return null;
}
