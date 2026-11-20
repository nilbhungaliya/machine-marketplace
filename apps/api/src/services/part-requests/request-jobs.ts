import { and, asc, eq, gt, isNull, lte, sql, type SQL } from 'drizzle-orm';
import type { Db, Tx } from '../../db/index.js';
import { partRequests } from '../../db/schema.js';
import { Sentry } from '../../lib/sentry.js';
import { runJobTx, type TxApp } from '../../lib/tx-effects.js';
import { getSettings } from '../settings.service.js';
import { notify } from '../notifications/notify.js';
import { writeRequestStatus } from './lifecycle.js';
import { lockPartRequest, type PartRequestRow } from './locks.js';
import { dropPendingRepliesForRequest } from './reply-drops.js';
import { maskedRequestName } from './reply-views.js';

/**
 * Request expiry, the expiring-soon reminder and history retention (spec §8.2, §9.1; ported from textile
 * `jobs/requirement-jobs.ts` + `services/notifications/reminders.ts`). Lane A3 owns this file. Run from
 * `jobs/index.ts`; every rule uses the database clock.
 *
 * Expiry and reminder: candidate ids are read **unlocked**, then each request gets its own transaction (`runJobTx`, so
 * its emits go out after commit) that locks it `FOR NO KEY UPDATE SKIP LOCKED` (`lockPartRequest`, never `FOR UPDATE`,
 * never a business row) and re-checks the condition under the lock. A request held by a buyer write (a renew, an edit)
 * or an admin is skipped, not waited on: the next run takes it. A renew that commits first moves `expires_at`, so the
 * re-check sees it and the request stays `active`.
 */

const BATCH = 100;

/** `<id>:<expires_at epoch seconds>`: one expiry / one reminder per validity period (a renew gives a new key). */
const expiresKey = (row: PartRequestRow): string => `${row.id}:${Math.floor(row.expiresAt.getTime() / 1000)}`;

/** Re-reads the rule under the lock, on the database clock. */
async function holds(tx: Tx, id: string, rule: SQL): Promise<boolean> {
  const [r] = await tx.select({ ok: sql<boolean>`${rule}` }).from(partRequests).where(eq(partRequests.id, id));
  return r?.ok === true;
}

const DUE = sql`${partRequests.status} = 'active' AND ${partRequests.expiresAt} <= now()`;

/**
 * `part-request-expiry` (hourly): `active` requests past `expires_at` → `expired` (`writeRequestStatus`, which emits
 * `part_request:updated { reason: 'status' }`), their pending replies dropped `request_expired` (each seller told), and
 * `part_request_expired` to the buyer business (dedupe `part_request_expired:<id>:<expires epoch>`).
 */
export async function expirePartRequests(app: TxApp): Promise<{ expired: number }> {
  let expired = 0;
  for (;;) {
    const candidates = await app.db
      .select({ id: partRequests.id })
      .from(partRequests)
      .where(and(eq(partRequests.status, 'active'), lte(partRequests.expiresAt, sql`now()`)))
      .orderBy(asc(partRequests.expiresAt), asc(partRequests.id))
      .limit(BATCH);
    let changed = 0;
    for (const c of candidates) {
      try {
        const done = await runJobTx(app, async (tx) => {
          const row = await lockPartRequest(tx, c.id, 'no_key_update', { skipLocked: true });
          if (!row || row.status !== 'active' || !(await holds(tx, row.id, DUE))) return false;
          const updated = await writeRequestStatus(tx, row, 'expire');
          await dropPendingRepliesForRequest(tx, updated, 'request_expired');
          await notify(tx, {
            type: 'part_request_expired',
            recipientBusinessId: updated.businessId,
            params: { requestTitle: maskedRequestName(updated.name) },
            destination: { partRequestId: updated.id },
            dedupeKey: `part_request_expired:${expiresKey(updated)}`,
          });
          return true;
        });
        if (done) changed++;
      } catch (err) {
        app.log.error({ err, partRequestId: c.id, job: 'part-request-expiry' }, 'part request expiry failed on a request');
        Sentry.captureException(err, { tags: { job: 'part-request-expiry' }, extra: { partRequestId: c.id } });
      }
    }
    expired += changed;
    // A batch that changed nothing is all locked or failing: the next run tries again.
    if (candidates.length < BATCH || changed === 0) break;
  }
  return { expired };
}

/**
 * `part-request-expiring-soon` (hourly): `part_request_expiring` to the buyer once per validity period, when
 * `expires_at − part_request_expiring_notice_hours ≤ now() < expires_at` and `expiring_notified_at IS NULL` (dedupe
 * `part_request_expiring:<id>:<expires epoch>`); stamps `expiring_notified_at`. A renew resets the column (A1), so the
 * renewed period gets its own reminder.
 */
export async function notifyExpiringPartRequests(app: TxApp): Promise<{ notified: number }> {
  const { part_request_expiring_notice_hours: hours } = await getSettings(app.db);
  const soon = sql`${partRequests.status} = 'active' AND ${partRequests.expiringNotifiedAt} IS NULL
    AND ${partRequests.expiresAt} > now()
    AND ${partRequests.expiresAt} - make_interval(hours => ${hours}::int) <= now()`;
  const candidates = await app.db
    .select({ id: partRequests.id })
    .from(partRequests)
    .where(
      and(
        eq(partRequests.status, 'active'),
        isNull(partRequests.expiringNotifiedAt),
        gt(partRequests.expiresAt, sql`now()`),
        lte(partRequests.expiresAt, sql`now() + make_interval(hours => ${hours}::int)`),
      ),
    )
    .orderBy(asc(partRequests.expiresAt), asc(partRequests.id))
    .limit(1000);
  let notified = 0;
  for (const c of candidates) {
    try {
      const sent = await runJobTx(app, async (tx) => {
        const row = await lockPartRequest(tx, c.id, 'no_key_update', { skipLocked: true });
        if (!row || !(await holds(tx, row.id, soon))) return false;
        await notify(tx, {
          type: 'part_request_expiring',
          recipientBusinessId: row.businessId,
          params: { requestTitle: maskedRequestName(row.name) },
          destination: { partRequestId: row.id },
          dedupeKey: `part_request_expiring:${expiresKey(row)}`,
        });
        await tx
          .update(partRequests)
          .set({ expiringNotifiedAt: sql`now()` as unknown as Date })
          .where(eq(partRequests.id, row.id));
        return true;
      });
      if (sent) notified++;
    } catch (err) {
      app.log.error({ err, partRequestId: c.id, job: 'part-request-expiring-soon' }, 'expiring-soon notice failed on a request');
      Sentry.captureException(err, { tags: { job: 'part-request-expiring-soon' }, extra: { partRequestId: c.id } });
    }
  }
  return { notified };
}

/**
 * `part-request-retention` (daily, §8.2): done work rows older than 7 days, failed (dead-letter) rows older than 30
 * days, and push-count rows for IST days more than 7 days back. Returns how many rows were deleted.
 */
export async function deletePartRequestHistory(db: Db): Promise<number> {
  const work = await db.execute(sql`
    DELETE FROM part_request_work
     WHERE (done_at IS NOT NULL AND done_at < now() - interval '7 days')
        OR (failed_at IS NOT NULL AND failed_at < now() - interval '30 days')`);
  const counts = await db.execute(sql`
    DELETE FROM part_request_push_counts
     WHERE day < (now() AT TIME ZONE 'Asia/Kolkata')::date - 7`);
  return (work.rowCount ?? 0) + (counts.rowCount ?? 0);
}
