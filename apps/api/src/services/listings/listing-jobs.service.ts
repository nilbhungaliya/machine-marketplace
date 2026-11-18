import { and, asc, inArray, lt, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/index.js';
import { listings } from '../../db/schema.js';
import { getSettings } from '../settings.service.js';
import { applySystemTransition } from './listing-lifecycle.service.js';

// The listing expiry job (F2 spec §7.4, amendment 1, R11; plan Task 15). Every hour, `live` and `rented` listings whose
// `refreshed_at` is older than `listing_expiry_days` (read on every run, so a changed setting applies at once) become
// `expired` (status + history, actor `system`). It locks only the listings (`FOR UPDATE SKIP LOCKED`), never the
// business: taking a business lock after a listing lock would invert the order every seller write uses. A listing
// another transaction holds is skipped this run; `applySystemTransition` keeps `AND status = $from`, so a renew that
// commits first wins. No reminder job in this build (R11).

/** Rows per batch (one transaction each) and batches per run (§7.4). */
export const EXPIRY_BATCH_SIZE = 200;
export const EXPIRY_MAX_BATCHES = 10;

export interface ListingExpiryOptions {
  /** Tests only: limit the run to these businesses' listings, so a run never touches another suite's fixtures. */
  businessIds?: string[];
}

/** One run of the expiry job: up to 10 batches of 200, oldest `refreshed_at` first. Returns how many expired. */
export async function runListingExpiry(db: Db, opts: ListingExpiryOptions = {}): Promise<{ expired: number }> {
  const scope: SQL | undefined = opts.businessIds ? inArray(listings.businessId, opts.businessIds) : undefined;
  if (opts.businessIds && opts.businessIds.length === 0) return { expired: 0 };
  let expired = 0;
  for (let batch = 0; batch < EXPIRY_MAX_BATCHES; batch++) {
    const n = await db.transaction(async (tx) => {
      const { listing_expiry_days: days } = await getSettings(tx);
      const rows = await tx
        .select()
        .from(listings)
        .where(
          and(
            inArray(listings.status, ['live', 'rented']),
            lt(listings.refreshedAt, sql`now() - make_interval(days => ${days}::int)`),
            scope,
          ),
        )
        .orderBy(asc(listings.refreshedAt))
        .limit(EXPIRY_BATCH_SIZE)
        .for('update', { skipLocked: true });
      for (const row of rows) await applySystemTransition(tx, row, 'expire', { lockBusiness: false });
      return rows.length;
    });
    expired += n;
    if (n < EXPIRY_BATCH_SIZE) break;
  }
  return { expired };
}
