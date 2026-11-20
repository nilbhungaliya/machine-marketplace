import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import type { PartRequestWorkKind } from '@mpm/shared-types';
import { db, type Tx } from '../src/db/index.js';
import { partRequestWork } from '../src/db/schema.js';
import { ConflictError } from '../src/lib/errors.js';
import type { TxApp } from '../src/lib/tx-effects.js';
import { runPartRequestWork, type WorkHandlers } from '../src/services/part-requests/work-job.js';
import { enqueuePartRequestWork } from '../src/services/part-requests/work-queue.js';

// The F8 work job (plan A2-1, spec §5.7, §8.2): claim committed first, one transaction per row, retries with backoff,
// closing a row a newer one covers (also when the newer one lands mid-release), dead letter after 5 attempts, stale
// claims, two runs at once, and enqueues never waiting on a row being processed. Handlers are injected; subjects are
// random uuids (no FK), deleted in `afterAll`.

const noop = () => undefined;
const txApp = { db, log: { error: noop, warn: noop, info: noop } } as unknown as TxApp;
const subjects: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const enqueue = async (kind: PartRequestWorkKind = 'listing_changed', subject = randomUUID()) => {
  subjects.push(subject);
  await db.transaction((tx) => enqueuePartRequestWork(tx, kind, subject));
  return subject;
};
const rowsOf = (subject: string) => db.select().from(partRequestWork).where(eq(partRequestWork.subjectId, subject)).orderBy(partRequestWork.createdAt);
const one = async (subject: string) => (await rowsOf(subject))[0]!;
const secondsUntil = async (subject: string) =>
  Number(
    (
      await db.execute<{ s: number }>(
        sql`SELECT extract(epoch FROM next_attempt_at - now())::float8 AS s FROM part_request_work WHERE subject_id = ${subject}`,
      )
    ).rows[0]!.s,
  );

/** Handlers that run `fn` for every subject (both kinds). */
const handlers = (fn: (tx: Tx, subject: string) => Promise<void>): WorkHandlers => ({ target_request: fn, listing_changed: fn });

afterEach(async () => {
  // Nothing of this suite may stay due for another test's run.
  if (subjects.length) await db.delete(partRequestWork).where(inArray(partRequestWork.subjectId, subjects));
});

afterAll(async () => {
  if (subjects.length) await db.delete(partRequestWork).where(inArray(partRequestWork.subjectId, subjects));
});

describe('runPartRequestWork', () => {
  it('one transaction per row: a failing middle row is released with a 30 s backoff; the others finish and commit', async () => {
    const [a, b, c] = [await enqueue(), await enqueue('target_request'), await enqueue()];
    // Claim order is next_attempt_at: a, b, c.
    await db.execute(sql`UPDATE part_request_work SET next_attempt_at = now() - interval '3 seconds' WHERE subject_id = ${a}`);
    await db.execute(sql`UPDATE part_request_work SET next_attempt_at = now() - interval '2 seconds' WHERE subject_id = ${b}`);
    await db.execute(sql`UPDATE part_request_work SET next_attempt_at = now() - interval '1 seconds' WHERE subject_id = ${c}`);
    const seen: string[] = [];
    const result = await runPartRequestWork(txApp, {
      handlers: handlers(async (tx, subject) => {
        seen.push(subject);
        // A write of the handler's own, committed with done_at.
        await tx.execute(sql`UPDATE part_request_work SET last_error = 'probe' WHERE subject_id = ${subject}`);
        if (subject === b) throw new ConflictError('test', 'TEST_FAILURE');
      }),
    });
    expect(seen).toEqual([a, b, c]);
    expect(result).toEqual({ processed: 2, failed: 1 });
    const [ra, rb, rc] = [await one(a), await one(b), await one(c)];
    expect(ra.doneAt).not.toBeNull();
    expect(ra.lastError).toBe('probe');
    expect(rc.doneAt).not.toBeNull();
    expect(rb.doneAt).toBeNull();
    expect(rb.claimedAt).toBeNull();
    expect(rb.attempts).toBe(1);
    expect(rb.lastError).toBe('TEST_FAILURE');
    const wait = await secondsUntil(b);
    expect(wait).toBeGreaterThan(25);
    expect(wait).toBeLessThanOrEqual(30);
  });

  it('the 5th failure dead-letters the row; a new enqueue for the subject then inserts a fresh row', async () => {
    const s = await enqueue();
    await db.update(partRequestWork).set({ attempts: 4 }).where(eq(partRequestWork.subjectId, s));
    const result = await runPartRequestWork(txApp, {
      handlers: handlers(async () => {
        throw new Error('boom');
      }),
    });
    expect(result.failed).toBe(1);
    const row = await one(s);
    expect(row.attempts).toBe(5);
    expect(row.failedAt).not.toBeNull();
    expect(row.lastError).toBe('internal');
    await enqueue('listing_changed', s);
    const rows = await rowsOf(s);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.claimedAt).toBeNull();
  });

  it('a failing row with a newer unclaimed row for the subject is closed, not retried', async () => {
    const s = await enqueue();
    // The row was claimed 11 minutes ago by a process that died; a newer event queued a row since (not yet due).
    await db.execute(sql`UPDATE part_request_work SET claimed_at = now() - interval '11 minutes', attempts = 1 WHERE subject_id = ${s}`);
    await enqueue('listing_changed', s);
    await db.execute(sql`UPDATE part_request_work SET next_attempt_at = now() + interval '1 hour' WHERE subject_id = ${s} AND claimed_at IS NULL`);
    const result = await runPartRequestWork(txApp, { handlers: handlers(async () => Promise.reject(new Error('boom'))) });
    expect(result.failed).toBe(1);
    const [old, newer] = await rowsOf(s);
    expect(old!.doneAt).not.toBeNull();
    expect(old!.attempts).toBe(2);
    expect(newer!.claimedAt).toBeNull();
    expect(newer!.doneAt).toBeNull();
  });

  it('a newer row landing between the check and the release: the unique violation closes the row, no error escapes', async () => {
    const s = await enqueue();
    let other: Promise<unknown> = Promise.resolve();
    const result = await runPartRequestWork(txApp, {
      handlers: handlers(async () => {
        // Another connection inserts the newer row and commits only after the job's check has run: the release then
        // waits on the unique index and fails with 23505 when that insert commits.
        let inserted!: () => void;
        const ready = new Promise<void>((r) => (inserted = r));
        other = db.transaction(async (t2) => {
          await enqueuePartRequestWork(t2, 'listing_changed', s);
          inserted();
          await sleep(500);
        });
        await ready;
        throw new Error('boom');
      }),
    });
    await other;
    expect(result).toEqual({ processed: 0, failed: 1 });
    const [old, newer] = await rowsOf(s);
    expect(old!.doneAt).not.toBeNull();
    expect(old!.claimedAt).not.toBeNull();
    expect(newer!.claimedAt).toBeNull();
  });

  it('a claim older than 10 minutes with no outcome is taken again; a 2-minute-old one is not', async () => {
    const stale = await enqueue();
    const recent = await enqueue();
    await db.execute(sql`UPDATE part_request_work SET claimed_at = now() - interval '11 minutes', attempts = 1 WHERE subject_id = ${stale}`);
    await db.execute(sql`UPDATE part_request_work SET claimed_at = now() - interval '2 minutes', attempts = 1 WHERE subject_id = ${recent}`);
    const seen: string[] = [];
    await runPartRequestWork(txApp, { handlers: handlers(async (_tx, subject) => void seen.push(subject)) });
    expect(seen).toEqual([stale]);
    expect((await one(stale)).doneAt).not.toBeNull();
    expect((await one(recent)).doneAt).toBeNull();
  });

  it('two runs at once process each row once (SKIP LOCKED)', async () => {
    const mine = new Set<string>();
    for (let i = 0; i < 8; i++) mine.add(await enqueue());
    const seen: string[] = [];
    const h = handlers(async (_tx, subject) => {
      seen.push(subject);
      await sleep(20);
    });
    const [r1, r2] = await Promise.all([runPartRequestWork(txApp, { handlers: h }), runPartRequestWork(txApp, { handlers: h })]);
    expect(r1.processed + r2.processed).toBe(8);
    expect(seen.sort()).toEqual([...mine].sort());
  });

  it('an enqueue for a subject whose row is being processed inserts a second row at once', async () => {
    const s = await enqueue();
    let started!: () => void;
    let release!: () => void;
    const isRunning = new Promise<void>((r) => (started = r));
    const held = new Promise<void>((r) => (release = r));
    const run = runPartRequestWork(txApp, {
      handlers: handlers(async () => {
        started();
        await held;
      }),
    });
    await isRunning;
    const t0 = Date.now();
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '1s'`);
        await enqueuePartRequestWork(tx, 'listing_changed', s);
      });
      expect(Date.now() - t0).toBeLessThan(1000);
    } finally {
      release();
      await run;
    }
    const rows = await rowsOf(s);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.doneAt).not.toBeNull();
    expect(rows[1]!.claimedAt).toBeNull();
  });
});
