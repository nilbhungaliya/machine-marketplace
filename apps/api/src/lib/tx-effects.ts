import type { FastifyInstance } from 'fastify';
import type { AdminRole } from '@mpm/shared-types';
import type { Tx } from '../db/index.js';
import { adminRoleRoom, businessRoom, userRoom } from '../socket/rooms.js';

/**
 * After-commit effects (F6 + F7 plan P2). `runTx` opens a transaction and gives it a queue; services queue socket
 * emits on the `tx` (`queueUserEmit`, `queueAdminEmit`, `queueBusinessEmit`), and they are sent only after the
 * transaction commits — dropped when it rolls back, so no client hears about a change that didn't happen.
 *
 * Nested transactions (savepoints: `tx.transaction(...)` or `effectsTx(tx, fn)`) get a child queue that merges into its
 * parent when the savepoint is released and is discarded when it rolls back, so a job's per-row savepoint loses only
 * that row's emits.
 *
 * Queuing on a `tx` that has no queue (a write outside `runTx`) throws under tests, so a missed `runTx` is caught; in
 * other environments it logs a warning and drops the emit. The flush is a no-op when the app has no `io` (`buildApp`
 * without sockets, as in most tests).
 */

export type TxApp = Pick<FastifyInstance, 'db' | 'io' | 'log'>;

type Namespace = '/user' | '/admin';

export interface QueuedEmit {
  namespace: Namespace;
  room: string;
  event: string;
  payload: unknown;
}

const queues = new WeakMap<object, QueuedEmit[]>();

/** Gives `tx` its queue and makes every nested transaction on it get a child queue (merged on release). */
function register(tx: Tx, queue: QueuedEmit[]): void {
  queues.set(tx, queue);
  const original = tx.transaction.bind(tx) as Tx['transaction'];
  const patched = (async (fn: (sp: Tx) => Promise<unknown>, config?: unknown) => {
    const child: QueuedEmit[] = [];
    const result = await (original as (f: (sp: Tx) => Promise<unknown>, c?: unknown) => Promise<unknown>)(async (sp) => {
      register(sp, child);
      return fn(sp);
    }, config);
    // Reached only when the savepoint was released: keep its emits.
    queue.push(...child);
    return result;
  }) as unknown as Tx['transaction'];
  (tx as { transaction: Tx['transaction'] }).transaction = patched;
}

function flush(app: TxApp, queue: QueuedEmit[]): void {
  if (queue.length === 0) return;
  // `io` is declared on every instance but only set by `setupSocketIO` (index.ts and socket tests).
  const io = (app as { io?: FastifyInstance['io'] }).io;
  if (!io) return;
  for (const e of queue) {
    try {
      io.of(e.namespace).to(e.room).emit(e.event, e.payload);
    } catch (err) {
      app.log.warn({ err, event: e.event }, 'after-commit emit failed');
    }
  }
}

/** Runs `fn` in a transaction with an effects queue; queued emits go out after commit. */
export async function runTx<T>(app: TxApp, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const queue: QueuedEmit[] = [];
  const result = await app.db.transaction(async (tx) => {
    register(tx, queue);
    return fn(tx);
  });
  flush(app, queue);
  return result;
}

/** `runTx` for background jobs (§14: jobs queue emits and notifications like routes). */
export const runJobTx = runTx;

/** A savepoint whose emits are kept when it is released and discarded when it rolls back. */
export function effectsTx<T>(tx: Tx, fn: (sp: Tx) => Promise<T>): Promise<T> {
  return tx.transaction(fn) as Promise<T>;
}

/** Whether `tx` has an effects queue (it was opened by `runTx` / `runJobTx`, or is a savepoint inside one). */
export function hasEffects(tx: Tx): boolean {
  return queues.has(tx);
}

function queueEmit(tx: Tx, emit: QueuedEmit): void {
  const queue = queues.get(tx);
  if (!queue) {
    const message = `emit "${emit.event}" queued outside runTx: open the transaction with runTx / runJobTx`;
    if (process.env.NODE_ENV === 'test') throw new Error(message);
    console.warn(message);
    return;
  }
  queue.push(emit);
}

/** An event to one user's sockets (`userRoom`, /user). Payloads with text are built per reader (R10). */
export function queueUserEmit(tx: Tx, userId: string, event: string, payload: unknown): void {
  queueEmit(tx, { namespace: '/user', room: userRoom(userId), event, payload });
}

/** An id-only event to every socket of a business (`businessRoom`, /user). Never text (R10). */
export function queueBusinessEmit(tx: Tx, businessId: string, event: string, payload: unknown): void {
  queueEmit(tx, { namespace: '/user', room: businessRoom(businessId), event, payload });
}

/** An id-only event to one admin role's sockets (`adminRoleRoom`, /admin). */
export function queueAdminEmit(tx: Tx, role: AdminRole, event: string, payload: unknown): void {
  queueEmit(tx, { namespace: '/admin', room: adminRoleRoom(role), event, payload });
}
