import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { redact, scrub } from '../src/lib/sentry.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { addTestMember } from './_helpers/test-deals.js';

// F8 route contracts (plan C0-4b): every new route is registered with its final guards. Calls use a random id and
// empty bodies, so "allowed" means "neither 401 nor 403" (the C0 stubs answer 501; the lanes' handlers 400 / 404).

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
const id = randomUUID();

/** [method, url, business write (viewer refused)] */
const USER_ROUTES: Array<[Method, string, boolean]> = [
  ['POST', '/part-requests/photos/presign', true],
  ['POST', '/part-requests', true],
  ['PATCH', `/part-requests/${id}`, true],
  ['POST', `/part-requests/${id}/renew`, true],
  ['POST', `/part-requests/${id}/close`, true],
  ['POST', `/part-requests/${id}/fulfil`, true],
  ['POST', `/part-requests/${id}/read`, false],
  ['GET', '/part-requests/mine', false],
  ['GET', '/part-requests/home', false],
  ['GET', '/part-requests/for-sellers', false],
  ['GET', `/part-requests/${id}`, false],
  ['GET', `/part-requests/${id}/replies`, false],
  ['GET', `/part-requests/${id}/matches`, false],
  ['GET', `/part-requests/${id}/compare`, false],
  ['GET', `/part-requests/${id}/photos`, false],
  ['POST', `/part-requests/${id}/not-relevant`, true],
  ['DELETE', `/part-requests/${id}/not-relevant`, true],
  ['POST', `/part-requests/${id}/report`, true],
  ['GET', `/part-requests/${id}/reply-options`, false],
  ['POST', `/part-requests/${id}/replies`, true],
  ['POST', `/part-requests/${id}/replies/${id}/withdraw`, true],
  ['GET', `/listings/${id}/part-request-demand`, false],
];

const ADMIN_ROUTES: Array<[Method, string]> = [
  ['GET', '/admin/part-requests'],
  ['GET', `/admin/part-requests/${id}`],
  ['GET', `/admin/part-requests/${id}/photos`],
  ['POST', `/admin/part-requests/${id}/remove`],
  ['POST', `/admin/part-requests/${id}/restore`],
];

let app: FastifyInstance;
const admins: Record<string, { id: string; token: string }> = {};
let owner: TestBusinessUser;
let viewer: { userId: string; token: string };

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
  for (const role of ['operations', 'category_manager', 'moderator', 'support', 'super_admin'] as const) admins[role] = await createTestAdmin(role);
  owner = await createTestBusinessUser();
  viewer = await addTestMember(owner.businessId, 'viewer');
});

afterAll(async () => {
  await deleteTestBusinesses([owner.businessId]);
  await deleteTestAdmins(Object.values(admins).map((a) => a.id));
  await app.close();
});

const call = (method: Method, url: string, token?: string, payload: object = {}) =>
  app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(method === 'GET' ? {} : { payload }) });

describe('F8 routes', () => {
  it.each(USER_ROUTES)('%s %s needs a signed-in user', async (method, url) => {
    expect((await call(method, url)).statusCode).toBe(401);
  });

  it('GET /part-requests/options is public: settings for a guest, no counts', async () => {
    const res = await call('GET', '/part-requests/options');
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ validityDays: [7, 15, 30], defaultValidityDays: 15, reachN: 15, openCount: null, maxDays: 90 });
  });

  it.each(USER_ROUTES.filter(([, , write]) => write))('%s %s refuses a viewer', async (method, url) => {
    const res = await call(method, url, viewer.token);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('VIEWER_READ_ONLY');
  });

  it('lets a viewer read and mark a request read', async () => {
    expect((await call('POST', `/part-requests/${id}/read`, viewer.token)).statusCode).not.toBe(403);
    expect((await call('GET', '/part-requests/mine', viewer.token)).statusCode).not.toBe(403);
  });

  it.each(ADMIN_ROUTES)('%s %s: moderator and support only (super_admin passes)', async (method, url) => {
    expect((await call(method, url)).statusCode).toBe(401);
    for (const role of ['operations', 'category_manager']) expect((await call(method, url, admins[role]!.token)).statusCode).toBe(403);
    for (const role of ['moderator', 'support', 'super_admin']) {
      expect([401, 403]).not.toContain((await call(method, url, admins[role]!.token)).statusCode);
    }
  });

  it('GET /users/me/badges carries requestsForYou', async () => {
    const res = await call('GET', '/users/me/badges', owner.token);
    expect(res.json().data.requestsForYou).toBe(0);
  });
});

describe('Sentry redaction (§17)', () => {
  it('drops note, message and photoKeys anywhere; name only in a /part-requests body', () => {
    const body = { name: 'Roller 9876543210', note: 'n', message: 'm', photoKeys: ['k'], kind: 'part' };
    expect(redact(body, { url: '/part-requests' })).toEqual({
      name: '[redacted]', note: '[redacted]', message: '[redacted]', photoKeys: '[redacted]', kind: 'part',
    });
    expect(redact({ name: 'x' }, { url: `https://api.example.test/admin/part-requests/${id}/remove` })).toEqual({ name: '[redacted]' });
    expect(redact({ name: 'Test Co', message: 'm' })).toEqual({ name: 'Test Co', message: '[redacted]' });
    expect(redact({ name: 'Test Co' }, { url: '/listings/part-requests-like' })).toEqual({ name: 'Test Co' });
    const event = scrub({ request: { url: '/part-requests/x', headers: {} }, extra: { body: { name: 'x' } } } as any);
    expect(event.extra.body.name).toBe('[redacted]');
  });
});
