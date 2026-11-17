import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('GET /health', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp({ infra: false, logger: false }); });
  afterAll(async () => { await app.close(); });

  it('returns ok in the { data } shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('ok');
  });

  it('unknown routes return the { error, code } shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Route not found', code: 'NOT_FOUND' });
  });
});
