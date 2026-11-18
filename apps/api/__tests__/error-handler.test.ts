import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock('../src/lib/sentry.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/lib/sentry.js')>();
  return { ...original, Sentry: { captureException } };
});
import { buildApp } from '../src/app.js';

/** What node-postgres throws: an Error carrying the SQLSTATE in `code`. */
function pgError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code, severity: 'ERROR' });
}

describe('central error handler', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ infra: false, logger: false });
    // Throwaway routes that fail the way a concurrent edit does.
    app.get('/__test/deadlock', async () => { throw pgError('40P01', 'deadlock detected'); });
    app.get('/__test/serialization', async () => {
      throw pgError('40001', 'could not serialize access due to concurrent update');
    });
    app.get('/__test/other-pg', async () => { throw pgError('42P01', 'relation "nope" does not exist'); });
    await app.ready();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => captureException.mockClear());

  it.each(['deadlock', 'serialization'])('a %s failure → 409 RETRY, not reported to Sentry', async (kind) => {
    const res = await app.inject({ method: 'GET', url: `/__test/${kind}` });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'This changed at the same time as another edit. Try again.', code: 'RETRY' });
    expect(captureException).not.toHaveBeenCalled();
  });

  it('any other database error is still a reported 500', async () => {
    const res = await app.inject({ method: 'GET', url: '/__test/other-pg' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
