import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { ListingKind, ListingStatus } from '@mpm/shared-types';
import { listings } from '../../db/schema.js';
import { publicListingWhere, type ListingColumns } from '../listings/public-where.service.js';

// What discovery shows (F4 + F5 spec §R7): the one rule every search, home, browse, suggestion count, card and saved
// query starts from. Never hand-write the status list.

/** Statuses discovery shows everywhere. `rented` is shown only for rentals, and only where rentals are asked for. */
export const DISCOVERY_STATUSES = ['live', 'reserved'] as const satisfies readonly ListingStatus[];

/** The listing columns the rule reads: `listings` itself or an alias of it. */
export interface DiscoveryColumns extends ListingColumns {
  kind: AnyColumn;
}

const STATUSES = sql.join(
  DISCOVERY_STATUSES.map((s) => sql`${s}`),
  sql`, `,
);

/**
 * `publicListingWhere()` (public status, owner not restricted) and §R7's kind rule: `live` and `reserved` listings, plus
 * `rented` listings of kind `machine_rental` when `kinds` is empty or contains `machine_rental` (listing type All or
 * For rent; never under Parts or Machines for sale). The kinds filter itself is the caller's.
 */
export function discoveryWhere(t: DiscoveryColumns = listings, opts: { kinds?: readonly ListingKind[] | null } = {}): SQL {
  const kinds = opts.kinds ?? [];
  const rentals = kinds.length === 0 || kinds.includes('machine_rental');
  const rented = rentals ? sql` OR (${t.status} = 'rented' AND ${t.kind} = 'machine_rental')` : sql``;
  return sql`(${publicListingWhere(t)} AND (${t.status} IN (${STATUSES})${rented}))`;
}
