import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import type { PartRequestWorkKind } from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { partRequestWork } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { isUniqueViolation } from '../../lib/pg-errors.js';
import { Sentry } from '../../lib/sentry.js';
import { runJobTx, type TxApp } from '../../lib/tx-effects.js';
import { processListingChanged } from './reply-delivery.js';
import { processTargetRequest } from './targeting.js';

// The `part-request-work` job (spec §5.7, §7.1, §8.2; plan A2-1; ports textile `jobs/requirement-jobs.ts` batching, F6
// `offer-jobs.ts` one transaction per row, F4 `refresh-jobs.ts` queue table).
//
// 1. **Claim** in one short committed statement: due unclaimed rows, or rows claimed over 10 minutes ago and neither done
//    nor failed (a process that died mid-row), oldest due first, `FOR UPDATE SKIP LOCKED`, so two runs never take one
//    row. The claim sets `claimed_at`, which takes the row out of `part_request_work_unclaimed_uq`: an event that
//    arrives while the row runs inserts a **new** row and never waits on the job.
// 2. **One transaction per row** (`runJobTx`): the handler and `done_at` commit together.
// 3. **On error**, outside the failed transaction: after the 5th attempt `failed_at` (dead letter, kept out of the
//    unique predicate, so later enqueues still work); else, when a newer unclaimed row for the same subject exists, this
//    one is closed (`done_at`: the newer one reads the subject as it is then), otherwise the claim is released with a
//    backoff of 30 s / 2 min / 10 min / 1 h. A newer row arriving between that check and the release makes the release
//    a unique violation: caught, and the row is closed instead. `last_error` holds an error code only.

/** The two kinds of work, each run inside the row's transaction. */
export interface WorkHandlers {
  target_request(tx: Tx, requestId: string): Promise<void>;
  listing_changed(tx: Tx, listingId: string): Promise<void>;
}

const DEFAULT_HANDLERS: WorkHandlers = {
  target_request: processTargetRequest,
  listing_changed: processListingChanged,
};

/** Rows per run (spec §7.6). */
export const WORK_BATCH = 20;
/** Attempts before a row is dead-lettered (`failed_at`). */
export const WORK_MAX_ATTEMPTS = 5;
/** Backoff after attempt 1, 2, 3, 4 (seconds). */
export const WORK_BACKOFF_SECONDS = [30, 120, 600, 3600] as const;
/** A claim older than this with no outcome is taken again. */
export const WORK_STALE_CLAIM_MINUTES = 10;

type ClaimedRow = {
  id: string;
  kind: PartRequestWorkKind;
  subject_id: string;
  attempts: number;
};

/** The error code stored in `last_error`: an `AppError` code, else `internal` (never a message: no data). */
function errorCode(err: unknown): string {
  return err instanceof AppError ? err.code : 'internal';
}

async function claim(app: TxApp, batch: number): Promise<ClaimedRow[]> {
  const { rows } = await app.db.execute<ClaimedRow & { next_attempt_at: string }>(sql`
    UPDATE part_request_work w SET claimed_at = now(), attempts = w.attempts + 1
    WHERE w.id IN (
      SELECT q.id FROM part_request_work q
      WHERE (q.claimed_at IS NULL AND q.next_attempt_at <= now())
         OR (q.claimed_at < now() - make_interval(mins => ${WORK_STALE_CLAIM_MINUTES}::int)
             AND q.done_at IS NULL AND q.failed_at IS NULL)
      ORDER BY q.next_attempt_at, q.id
      LIMIT ${batch}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING w.id, w.kind, w.subject_id, w.attempts, w.next_attempt_at`);
  return [...rows]
    .sort((a, b) => String(a.next_attempt_at).localeCompare(String(b.next_attempt_at)) || a.id.localeCompare(b.id))
    .map((r) => ({ id: r.id, kind: r.kind, subject_id: r.subject_id, attempts: Number(r.attempts) }));
}

const markDone = (app: TxApp, id: string, code: string) =>
  app.db.update(partRequestWork).set({ doneAt: sql`now()` as unknown as Date, lastError: code }).where(eq(partRequestWork.id, id));

/** After a failed attempt: dead letter, close (a newer row covers it) or release with a backoff. */
async function afterFailure(app: TxApp, row: ClaimedRow, code: string): Promise<void> {
  if (row.attempts >= WORK_MAX_ATTEMPTS) {
    await app.db
      .update(partRequestWork)
      .set({ failedAt: sql`now()` as unknown as Date, lastError: code })
      .where(eq(partRequestWork.id, row.id));
    return;
  }
  const [newer] = await app.db
    .select({ id: partRequestWork.id })
    .from(partRequestWork)
    .where(
      and(
        eq(partRequestWork.kind, row.kind),
        eq(partRequestWork.subjectId, row.subject_id),
        isNull(partRequestWork.claimedAt),
        ne(partRequestWork.id, row.id),
      ),
    )
    .limit(1);
  if (newer) {
    await markDone(app, row.id, code);
    return;
  }
  const backoff = WORK_BACKOFF_SECONDS[Math.min(row.attempts, WORK_BACKOFF_SECONDS.length) - 1]!;
  try {
    await app.db
      .update(partRequestWork)
      .set({
        claimedAt: null,
        nextAttemptAt: sql`now() + make_interval(secs => ${backoff}::int)` as unknown as Date,
        lastError: code,
      })
      .where(eq(partRequestWork.id, row.id));
  } catch (err) {
    // A newer unclaimed row arrived after the check: it covers this one.
    if (!isUniqueViolation(err)) throw err;
    await markDone(app, row.id, code);
  }
}

/**
 * Claims up to `batch` (20) rows and runs each in its own transaction (spec §8.2). Returns how many rows finished and
 * how many failed this run. `handlers` replaces the defaults (tests).
 */
export async function runPartRequestWork(
  app: TxApp,
  opts: { batch?: number; handlers?: Partial<WorkHandlers> } = {},
): Promise<{ processed: number; failed: number }> {
  const handlers: WorkHandlers = { ...DEFAULT_HANDLERS, ...opts.handlers };
  const rows = await claim(app, opts.batch ?? WORK_BATCH);
  let processed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await runJobTx(app, async (tx) => {
        await handlers[row.kind](tx, row.subject_id);
        await tx.update(partRequestWork).set({ doneAt: sql`now()` as unknown as Date }).where(eq(partRequestWork.id, row.id));
      });
      processed++;
    } catch (err) {
      failed++;
      const code = errorCode(err);
      app.log.error({ workId: row.id, code, job: 'part-request-work' }, 'part request work row failed');
      if (!(err instanceof AppError)) Sentry.captureException(err, { tags: { job: 'part-request-work' }, extra: { workId: row.id } });
      try {
        await afterFailure(app, row, code);
      } catch (releaseErr) {
        // The row keeps its claim; the stale-claim rule takes it again in 10 minutes.
        app.log.error({ workId: row.id, job: 'part-request-work' }, 'part request work release failed');
        Sentry.captureException(releaseErr, { tags: { job: 'part-request-work' }, extra: { workId: row.id } });
      }
    }
  }
  return { processed, failed };
}
