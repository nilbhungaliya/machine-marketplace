import { and, asc, eq, gt, lte, or, sql } from 'drizzle-orm';
import { notifications, offers } from '../../db/schema.js';
import { Sentry } from '../../lib/sentry.js';
import { runJobTx, type TxApp } from '../../lib/tx-effects.js';
import { insertSystemLine, recomputeTurns } from '../chat/thread-lines.js';
import { getSettings } from '../settings.service.js';
import { loadThread, notifyOffer } from './offer.service.js';
import { emitOfferUpdated } from './offer-view.js';

/**
 * Offer jobs (F6 + F7 spec §7.9, §14; ported from textile `offer-jobs.ts`). L2-5 owns this file. Run from
 * `jobs/index.ts`. Every rule uses the database clock. Each due row gets its own transaction (`runJobTx`, so its line
 * and emits behave as a route's): candidate ids are read unlocked, then the listing is locked, then the row
 * `FOR UPDATE SKIP LOCKED` with the status filter re-checked — an action holding the row decides it, and two runs at
 * once expire a row once.
 */

const BATCH = 100;

/** `offer-expiry` (1 min): pending past `expires_at` → expired; backups older than `offer_backup_max_days` → expired. */
export async function expireOffers(app: TxApp): Promise<{ expired: number }> {
  const { offer_backup_max_days: backupDays } = await getSettings(app.db);
  const due = or(
    and(eq(offers.status, 'pending'), lte(offers.expiresAt, sql`now()`)),
    and(eq(offers.status, 'backup'), lte(offers.backupSince, sql`now() - make_interval(days => ${backupDays}::int)`)),
  )!;
  let expired = 0;
  for (;;) {
    const candidates = await app.db
      .select({ id: offers.id, listingId: offers.listingId })
      .from(offers)
      .where(due)
      .orderBy(asc(offers.id))
      .limit(BATCH);
    let changed = 0;
    for (const c of candidates) {
      try {
        const done = await runJobTx(app, async (tx) => {
          // §8.5: listing, then the offer; either held by an action → skip, the next tick tries again.
          const { rows } = await tx.execute(sql`SELECT id FROM listings WHERE id = ${c.listingId} FOR UPDATE SKIP LOCKED`);
          if (rows.length === 0) return false;
          const [offer] = await tx.select().from(offers).where(and(eq(offers.id, c.id), due)).for('update', { skipLocked: true });
          if (!offer) return false;
          const [row] = await tx
            .update(offers)
            .set({ status: 'expired', updatedAt: sql`now()` })
            .where(and(eq(offers.id, c.id), due))
            .returning();
          if (!row) return false;
          await insertSystemLine(tx, row.threadId, 'offer_expired', { offerId: row.id });
          await recomputeTurns(tx, row.threadId);
          await emitOfferUpdated(tx, await loadThread(tx, row.threadId), row);
          return true;
        });
        if (done) changed++;
      } catch (err) {
        app.log.error({ err, offerId: c.id, job: 'offer-expiry' }, 'offer expiry failed on an offer');
        Sentry.captureException(err, { tags: { job: 'offer-expiry' }, extra: { offerId: c.id } });
      }
    }
    expired += changed;
    // A batch that changed nothing is all locked or failing: the next tick tries again.
    if (candidates.length < BATCH || changed === 0) break;
  }
  return { expired };
}

/**
 * `offer-expiring-soon` (5 min): one `offer_expiring` notification to the turn side of each `pending` row expiring
 * within `offer_expiring_notice_hours`. Dedupe key `offer_expiring:<offerId>:<expires_at>`, so a repeat run is a no-op
 * and a revived (or reconfirmed) offer with a new `expires_at` gets its own. Rows already told are excluded in the scan;
 * each row is re-read in its own transaction (still pending, same `expires_at`) before the notice. No row locks: the
 * dedupe key makes it once.
 */
export async function notifyExpiringOffers(app: TxApp): Promise<{ notified: number }> {
  const { offer_expiring_notice_hours: hours } = await getSettings(app.db);
  // The dedupe key as SQL (`toISOString()` of the millisecond-truncated `expires_at`), so rows already told are skipped
  // in the query and a large backlog can't starve the rest.
  const dedupeKeySql = sql`'offer_expiring:' || ${offers.id}::text || ':' || to_char(${offers.expiresAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
  const rows = await app.db
    .select({ id: offers.id, expiresAtText: sql<string>`${offers.expiresAt}::text` })
    .from(offers)
    .where(
      and(
        eq(offers.status, 'pending'),
        gt(offers.expiresAt, sql`now()`),
        lte(offers.expiresAt, sql`now() + make_interval(hours => ${hours}::int)`),
        sql`NOT EXISTS (SELECT 1 FROM ${notifications} n WHERE n.offer_id = ${offers.id} AND n.type = 'offer_expiring' AND n.dedupe_key = ${dedupeKeySql})`,
      ),
    )
    .orderBy(asc(offers.expiresAt))
    .limit(1000);
  let notified = 0;
  for (const c of rows) {
    try {
      const sent = await runJobTx(app, async (tx) => {
        // Re-read: still pending with the same `expires_at` (an answer, a revive or a reconfirm since the scan → skip).
        const [row] = await tx
          .select()
          .from(offers)
          .where(and(eq(offers.id, c.id), eq(offers.status, 'pending'), sql`${offers.expiresAt} = ${c.expiresAtText}::timestamptz`));
        if (!row) return false;
        await notifyOffer(tx, 'offer_expiring', row, row.turn, `offer_expiring:${row.id}:${row.expiresAt!.toISOString()}`);
        return true;
      });
      if (sent) notified++;
    } catch (err) {
      app.log.error({ err, offerId: c.id, job: 'offer-expiring-soon' }, 'expiring-soon notice failed on an offer');
      Sentry.captureException(err, { tags: { job: 'offer-expiring-soon' }, extra: { offerId: c.id } });
    }
  }
  return { notified };
}
