import type { FraudSignalRow } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';

/** A business's fraud signals for its admin detail page (admin close-out §7.3), open first. */
export async function openSignalsForBusiness(_conn: Db | Tx, _businessId: string): Promise<FraudSignalRow[]> {
  // AC-STUB(A3)
  return [];
}
