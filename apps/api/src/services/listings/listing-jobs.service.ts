import { and, asc, inArray, lt, notInArray, sql, type SQL } from 'drizzle-orm';
import { listings } from '../../db/schema.js';
import { effectsTx, runJobTx, type TxApp } from '../../lib/tx-effects.js';
import { afterListingStatusWrite } from '../deals/holds.js';
import { getSettings } from '../settings.service.js';
import { applySystemTransition } from './listing-lifecycle.service.js';

// The listing expiry job (F2 spec §7.4, amendment 1, R11; plan Task 15). Every hour, `live` and `rented` listings whose
// `refreshed_at` is older than `listing_expiry_days` (read on every run, so a changed setting applies at once) become
// `expired` (status + history, actor `system`). It locks only the listings (`FOR UPDATE SKIP LOCKED`), never the
// business: taking a business lock after a listing lock would invert the order every seller write uses. A listing
// another transaction holds is skipped this run; `applySystemTransition` keeps `AND status = $from`, so a renew that
// commits first wins. Each row runs in its own savepoint: a row that fails is rolled back alone, logged and left out of
// the rest of the run (it is tried again next hour), and the batch goes on. No reminder job in this build (R11).
// F6 + F7 (§8.3, §14, §22): batches run through `runJobTx` and each row's savepoint is an `effectsTx`, so a row's queued
// emits go out only if it expired; after the move `afterListingStatusWrite` reconciles the listing's open offers (it
// locks only the listing too). A `reserved` listing never expires; a `live` one with holds may, and its deals go on.

/** Rows per batch (one transaction each) and batches per run (§7.4). */
export const EXPIRY_BATCH_SIZE = 200;
export const EXPIRY_MAX_BATCHES = 10;

export interface ListingExpiryOptions {
  /** Tests only: limit the run to these businesses' listings, so a run never touches another suite's fixtures. */
  businessIds?: string[];
  /** Where a failing row is reported (the job passes `app.log`). Default: `console.error`. */
  log?: { error: (obj: Record<string, unknown>, msg: string) => void };
}

/** One run of the expiry job: up to 10 batches of 200, oldest `refreshed_at` first. Returns how many expired. */
export async function runListingExpiry(app: TxApp, opts: ListingExpiryOptions = {}): Promise<{ expired: number }> {
  const scope: SQL | undefined = opts.businessIds ? inArray(listings.businessId, opts.businessIds) : undefined;
  if (opts.businessIds && opts.businessIds.length === 0) return { expired: 0 };
  // Called on the logger (pino's methods need their `this`).
  const logError = (obj: Record<string, unknown>, msg: string) => (opts.log ? opts.log.error(obj, msg) : console.error(msg, obj));
  /** Rows that failed this run: not selected again by a later batch. */
  const failed: string[] = [];
  let expired = 0;
  for (let batch = 0; batch < EXPIRY_MAX_BATCHES; batch++) {
    const { selected, done } = await runJobTx(app, async (tx) => {
      const { listing_expiry_days: days } = await getSettings(tx);
      const rows = await tx
        .select()
        .from(listings)
        .where(
          and(
            inArray(listings.status, ['live', 'rented']),
            lt(listings.refreshedAt, sql`now() - make_interval(days => ${days}::int)`),
            // M14 §7.1: a booked machine is an active listing; a rental with an active booking never expires.
            sql`NOT EXISTS (
              SELECT 1 FROM rental_bookings rb
              WHERE rb.listing_id = ${listings.id} AND rb.status IN ('confirmed', 'on_rent', 'returned', 'disputed')
            )`,
            scope,
            failed.length > 0 ? notInArray(listings.id, failed) : undefined,
          ),
        )
        .orderBy(asc(listings.refreshedAt))
        .limit(EXPIRY_BATCH_SIZE)
        .for('update', { skipLocked: true });
      let done = 0;
      for (const row of rows) {
        try {
          await effectsTx(tx, async (sp) => {
            await applySystemTransition(sp, row, 'expire', { lockBusiness: false });
            await afterListingStatusWrite(sp, row.id);
          });
          done++;
        } catch (err) {
          failed.push(row.id);
          logError({ job: 'listing-expiry', listingId: row.id, err }, 'listing expiry failed for one listing; skipped');
        }
      }
      return { selected: rows.length, done };
    });
    expired += done;
    if (selected < EXPIRY_BATCH_SIZE) break;
  }
  return { expired };
}
