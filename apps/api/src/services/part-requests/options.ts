import type { PartRequestOptions } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { getSettings } from '../settings.service.js';
import { requestLimitState } from './request-input.js';

// `GET /part-requests/options` (spec §12.2): public, settings only for a guest (the No results card reads `reachN`);
// a signed-in user with a business also gets its open limit, open count and posts left today (plan D8). Lane A1.

export async function partRequestOptions(conn: Db | Tx, user: UserTokenPayload | null): Promise<PartRequestOptions> {
  const s = await getSettings(conn);
  const limits = user?.businessId ? await requestLimitState(conn, user.businessId) : null;
  return {
    validityDays: [s.part_request_validity_days_1, s.part_request_validity_days_2, s.part_request_validity_days_3],
    defaultValidityDays: s.part_request_validity_days_2,
    reachN: s.part_request_reach_n,
    openLimit: limits ? limits.openLimit : null,
    openCount: limits ? limits.openCount : null,
    postsLeftToday: limits ? Math.max(0, limits.postsPerDay - limits.postsToday) : null,
    maxDays: s.part_request_max_days,
  };
}
