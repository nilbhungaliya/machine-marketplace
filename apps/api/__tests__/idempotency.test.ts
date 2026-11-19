import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { effectsTx, queueUserEmit, runTx, type TxApp } from '../src/lib/tx-effects.js';
import { runIdempotent, sweepIdempotencyKeys } from '../src/services/idempotency.service.js';
import { userRoom } from '../src/socket/rooms.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';

// Idempotency-Key (F6 + F7 plan P11, C0-3) on a test-only route registered here, and the after-commit effects queue
// (P2, `lib/tx-effects.ts`).

let app: FastifyInstance;
let alice: TestBusinessUser;
let bob: TestBusinessUser;
let runs = 0;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  app.post<{ Body: { x?: number; delayMs?: number; fail?: boolean } }>(
    '/__test/idem/:id',
    { preHandler: [app.requireUser], config: { idempotent: true } },
    (request, reply) =>
      runIdempotent(request, reply, app, async (tx) => {
        runs += 1;
        const n = runs;
        await tx.execute(sql`SELECT 1`);
        if (request.body?.delayMs) await new Promise((r) => setTimeout(r, request.body.delayMs));
        if (request.body?.fail) throw new Error('boom');
        return { status: 201, body: { data: { run: n, x: request.body?.x ?? null } } };
      }),
  );
  await app.ready();
  alice = await createTestBusinessUser();
  bob = await createTestBusinessUser();
});

afterAll(async () => {
  await deleteTestBusinesses([alice.businessId, bob.businessId]);
  await app.close();
});

const call = (user: TestBusinessUser, key: string | undefined, body: Record<string, unknown>, id = 'a') =>
  app.inject({
    method: 'POST',
    url: `/__test/idem/${id}`,
    headers: { authorization: `Bearer ${user.token}`, ...(key ? { 'idempotency-key': key } : {}) },
    payload: body,
  });

describe('runIdempotent', () => {
  it('replays the stored response with the header, and the handler runs once', async () => {
    const key = randomUUID();
    const first = await call(alice, key, { x: 1 });
    expect(first.statusCode).toBe(201);
    const before = runs;
    const second = await call(alice, key, { x: 1 });
    expect(second.statusCode).toBe(201);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(second.json()).toEqual(first.json());
    expect(runs).toBe(before);
  });

  it('runs every time without a key', async () => {
    const before = runs;
    await call(alice, undefined, { x: 1 });
    await call(alice, undefined, { x: 1 });
    expect(runs).toBe(before + 2);
  });

  it('answers 422 IDEMPOTENCY_KEY_REUSED for another body under the same key', async () => {
    const key = randomUUID();
    await call(alice, key, { x: 1 });
    const res = await call(alice, key, { x: 2 });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('runs the handler once for two concurrent first uses; the second replays', async () => {
    const key = randomUUID();
    const before = runs;
    const [a, b] = await Promise.all([call(alice, key, { x: 3, delayMs: 300 }), call(alice, key, { x: 3, delayMs: 300 })]);
    expect(runs).toBe(before + 1);
    expect(a.json()).toEqual(b.json());
    expect([a.headers['idempotent-replay'], b.headers['idempotent-replay']]).toContain('true');
  });

  it('answers 409 REQUEST_IN_PROGRESS while the first still holds the key past the lock timeout', async () => {
    vi.stubEnv('IDEMPOTENCY_LOCK_TIMEOUT_MS', '100');
    try {
      const key = randomUUID();
      const slow = call(alice, key, { x: 4, delayMs: 1500 });
      await new Promise((r) => setTimeout(r, 300));
      const second = await call(alice, key, { x: 4, delayMs: 1500 });
      expect(second.statusCode).toBe(409);
      expect(second.json().code).toBe('REQUEST_IN_PROGRESS');
      expect((await slow).statusCode).toBe(201);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("runs fresh for another user's same key", async () => {
    const key = randomUUID();
    const a = await call(alice, key, { x: 5 });
    const b = await call(bob, key, { x: 5 });
    expect(b.headers['idempotent-replay']).toBeUndefined();
    expect(b.json().data.run).not.toBe(a.json().data.run);
  });

  it('stores nothing when the handler throws, so a retry runs', async () => {
    const key = randomUUID();
    expect((await call(alice, key, { fail: true })).statusCode).toBe(500);
    const [row] = (await db.execute(sql`SELECT count(*)::int AS n FROM idempotency_keys WHERE key = ${key}`)).rows as { n: number }[];
    expect(row!.n).toBe(0);
  });

  it('sweep deletes a 25-hour-old key only', async () => {
    const oldKey = randomUUID();
    const newKey = randomUUID();
    await call(alice, oldKey, { x: 6 });
    await call(alice, newKey, { x: 6 });
    await db.execute(sql`UPDATE idempotency_keys SET created_at = now() - interval '25 hours' WHERE key = ${oldKey}`);
    await sweepIdempotencyKeys(db);
    const rows = (await db.execute(sql`SELECT key FROM idempotency_keys WHERE key IN (${oldKey}, ${newKey})`)).rows as { key: string }[];
    expect(rows.map((r) => r.key)).toEqual([newKey]);
  });
});

describe('tx-effects', () => {
  const emitted: Array<{ room: string; event: string }> = [];
  const fakeIo = {
    of: () => ({ to: (room: string) => ({ emit: (event: string) => void emitted.push({ room, event }) }) }),
  };
  const withIo = (): TxApp => ({ db: app.db, io: fakeIo, log: app.log }) as unknown as TxApp;
  const userId = randomUUID();

  it('flushes a queued emit after commit only, and drops it on rollback', async () => {
    emitted.length = 0;
    let seenInside = -1;
    await runTx(withIo(), async (tx) => {
      queueUserEmit(tx, userId, 'test:committed', {});
      seenInside = emitted.length;
    });
    expect(seenInside).toBe(0);
    expect(emitted).toEqual([{ room: userRoom(userId), event: 'test:committed' }]);

    emitted.length = 0;
    await expect(
      runTx(withIo(), async (tx) => {
        queueUserEmit(tx, userId, 'test:rolled-back', {});
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(emitted).toEqual([]);
  });

  it('keeps a released savepoint’s emits and loses only a rolled-back savepoint’s own', async () => {
    emitted.length = 0;
    await runTx(withIo(), async (tx) => {
      queueUserEmit(tx, userId, 'test:outer', {});
      await effectsTx(tx, async (sp) => queueUserEmit(sp, userId, 'test:released', {}));
      await effectsTx(tx, async (sp) => {
        queueUserEmit(sp, userId, 'test:lost', {});
        throw new Error('row failed');
      }).catch(() => undefined);
    });
    expect(emitted.map((e) => e.event)).toEqual(['test:outer', 'test:released']);
  });

  it('throws when an emit is queued outside runTx (tests)', async () => {
    await expect(db.transaction(async (tx) => queueUserEmit(tx, userId, 'test:orphan', {}))).rejects.toThrow(/outside runTx/);
  });

  it('flushes nothing when the app has no io', async () => {
    const noIo = { db: app.db, log: app.log } as unknown as TxApp;
    await expect(runTx(noIo, async (tx) => queueUserEmit(tx, userId, 'test:no-io', {}))).resolves.toBeUndefined();
  });
});
