import type { PartRequestOptions } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { getSettings } from '../settings.service.js';

// `GET /part-requests/options` (spec §12.2): public, settings only for a guest (the No results card reads `reachN`).
// Lane A1 owns this file and fills the signed-in business's counts.

export async function partRequestOptions(conn: Db | Tx, _user: UserTokenPayload | null): Promise<PartRequestOptions> {
  const s = await getSettings(conn);
  return {
    validityDays: [s.part_request_validity_days_1, s.part_request_validity_days_2, s.part_request_validity_days_3],
    defaultValidityDays: s.part_request_validity_days_2,
    reachN: s.part_request_reach_n,
    // F8-STUB(A1): the signed-in business's open limit, open count and posts left today.
    openLimit: null,
    openCount: null,
    postsLeftToday: null,
    maxDays: s.part_request_max_days,
  };
}
