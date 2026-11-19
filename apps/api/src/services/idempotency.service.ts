import { and, eq, gt, lt, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db, Tx } from '../db/index.js';
import { idempotencyKeys } from '../db/schema.js';
import { AppError, ConflictError } from '../lib/errors.js';
import { runTx, type TxApp } from '../lib/tx-effects.js';
import { idempotencyContextOf } from '../plugins/idempotency.js';

/**
 * `Idempotency-Key` handling (F6 + F7 spec §12, §5.14; plan P11, C0-3; ported from textile
 * `services/idempotency.service.ts`). The key row is written with the handler's response inside the handler's own
 * transaction: both commit or neither does. "Still running" is a concurrent transaction holding the key's advisory lock,
 * not a row, so nothing needs reclaiming after a crash.
 * - Crash before commit: nothing happened; the retry runs once.
 * - Crash after commit, before the reply arrives: the retry replays the stored response (`Idempotent-Replay: true`).
 *
 * The key is optional on the wire (P11): without one the handler simply runs. A **returned** result is stored with its
 * status (a committed refusal such as accept's backup + 409 included); a thrown error rolls back and stores nothing.
 * Stored bodies can hold unmasked text or a revealed number (§19): they are never logged and live 24 h.
 */

export const IDEMPOTENCY_TTL_HOURS = 24;
const DEFAULT_LOCK_TIMEOUT_MS = 2000;

export interface StoredResponse {
  requestHash: string;
  status: number;
  body: unknown;
}

export class IdempotencyKeyReusedError extends AppError {
  constructor() {
    super('This Idempotency-Key was already used for a different request', 422, 'IDEMPOTENCY_KEY_REUSED');
  }
}

/** The stored, unexpired (< 24 h) response for a key, or undefined. Routes that do work before their transaction check it first. */
export async function readStoredResponse(conn: Db | Tx, scope: string, key: string): Promise<StoredResponse | undefined> {
  const [row] = await conn
    .select({ requestHash: idempotencyKeys.requestHash, status: idempotencyKeys.statusCode, body: idempotencyKeys.response })
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.scope, scope),
        eq(idempotencyKeys.key, key),
        gt(idempotencyKeys.createdAt, sql`now() - make_interval(hours => ${IDEMPOTENCY_TTL_HOURS}::int)`),
      ),
    );
  return row;
}

function lockTimeoutMs(): number {
  const raw = Number(process.env.IDEMPOTENCY_LOCK_TIMEOUT_MS);
  return Number.isSafeInteger(raw) && raw > 0 ? raw : DEFAULT_LOCK_TIMEOUT_MS;
}

function isLockTimeout(err: unknown): boolean {
  for (let e: unknown = err; typeof e === 'object' && e !== null; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === '55P03') return true;
  }
  return false;
}

/** JSON as stored and replayed (no `undefined`, no class instances). */
const toStoredJson = (body: unknown): unknown => JSON.parse(JSON.stringify(body ?? null));

function send(reply: FastifyReply, status: number, body: unknown, replayed: boolean): FastifyReply {
  if (replayed) reply.header('Idempotent-Replay', 'true');
  return reply.code(status).send(body);
}

/**
 * Runs `fn` in `runTx` (after-commit emits included) and sends its `{ status, body }`. With an `Idempotency-Key`:
 * first takes `pg_advisory_xact_lock(hashtext('idem:' || scope || ':' || key))` under a short `lock_timeout` (2 s;
 * `IDEMPOTENCY_LOCK_TIMEOUT_MS` overrides it) — a timeout is `409 REQUEST_IN_PROGRESS` —, then replays a stored
 * response (another request hash → `422 IDEMPOTENCY_KEY_REUSED`), else runs `fn` and stores its result in the same
 * transaction. The route needs `config: { idempotent: true }` (the plugin computes the scope and hash).
 */
export async function runIdempotent(
  request: FastifyRequest,
  reply: FastifyReply,
  app: TxApp,
  fn: (tx: Tx) => Promise<{ status: number; body: unknown }>,
): Promise<FastifyReply> {
  const ctx = idempotencyContextOf(request);
  if (!ctx) {
    const done = await runTx(app, fn);
    return send(reply, done.status, done.body, false);
  }

  const result = await runTx(app, async (tx) => {
    // The timeout covers the key's lock only: it is put back before `fn`, whose own row locks keep the default.
    const { rows } = await tx.execute(sql`SELECT current_setting('lock_timeout') AS previous`);
    const previous = (rows[0] as { previous: string }).previous;
    await tx.execute(sql`SELECT set_config('lock_timeout', ${`${lockTimeoutMs()}ms`}, true)`);
    try {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`idem:${ctx.scope}:${ctx.key}`}::text))`);
    } catch (err) {
      if (isLockTimeout(err)) throw new ConflictError('A request with this Idempotency-Key is still running', 'REQUEST_IN_PROGRESS');
      throw err;
    }
    await tx.execute(sql`SELECT set_config('lock_timeout', ${previous}, true)`);

    const stored = await readStoredResponse(tx, ctx.scope, ctx.key);
    if (stored) {
      if (stored.requestHash !== ctx.requestHash) throw new IdempotencyKeyReusedError();
      return { status: stored.status, body: stored.body, replayed: true };
    }
    // An expired row (> 24 h, not yet swept) gives way to this request.
    await tx.delete(idempotencyKeys).where(and(eq(idempotencyKeys.scope, ctx.scope), eq(idempotencyKeys.key, ctx.key)));

    const done = await fn(tx);
    const body = toStoredJson(done.body);
    await tx.insert(idempotencyKeys).values({ scope: ctx.scope, key: ctx.key, requestHash: ctx.requestHash, statusCode: done.status, response: body });
    return { status: done.status, body, replayed: false };
  });

  ctx.applied = true;
  return send(reply, result.status, result.body, result.replayed);
}

/** Deletes keys older than 24 h (the hourly `idempotency-cleanup` job, §14). Returns how many. */
export async function sweepIdempotencyKeys(db: Db): Promise<number> {
  const res = await db
    .delete(idempotencyKeys)
    .where(lt(idempotencyKeys.createdAt, sql`now() - make_interval(hours => ${IDEMPOTENCY_TTL_HOURS}::int)`));
  return res.rowCount ?? 0;
}
