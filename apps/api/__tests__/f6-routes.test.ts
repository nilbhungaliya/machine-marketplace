import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { redact } from '../src/lib/sentry.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { addTestMember } from './_helpers/test-deals.js';

// F6 + F7 route contracts (plan C0-4b): every new route is registered with its final guards. The calls use a random
// id and empty bodies, so "allowed" here means "neither 401 nor 403" (the handler then answers 400 / 404 / 409).

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const id = randomUUID();

const USER_ROUTES: Array<[Method, string]> = [
  ['POST', `/listings/${id}/enquiry`],
  ['POST', `/listings/${id}/offers`],
  ['GET', '/offers/options'],
  ['GET', '/threads'],
  ['GET', `/threads/${id}`],
  ['GET', `/threads/${id}/messages`],
  ['POST', `/threads/${id}/messages`],
  ['POST', `/threads/${id}/photos/presign`],
  ['GET', `/threads/${id}/messages/${id}/photos`],
  ['POST', `/threads/${id}/read`],
  ['PUT', `/threads/${id}/archive`],
  ['DELETE', `/threads/${id}/archive`],
  ['POST', `/threads/${id}/share-contact`],
  ['POST', `/threads/${id}/report`],
  ['POST', `/threads/${id}/block`],
  ['GET', '/users/me/blocks'],
  ['DELETE', `/users/me/blocks/${id}`],
  ['POST', `/threads/${id}/quote`],
  ['POST', `/offers/${id}/accept`],
  ['POST', `/offers/${id}/counter`],
  ['POST', `/offers/${id}/reject`],
  ['POST', `/offers/${id}/withdraw`],
  ['POST', `/offers/${id}/reconfirm`],
  ['GET', '/deals'],
  ['GET', `/deals/${id}`],
  ['PATCH', `/deals/${id}/notes`],
  ['POST', `/deals/${id}/photos/presign`],
  ['POST', `/deals/${id}/hand-over`],
  ['POST', `/deals/${id}/confirm-received`],
  ['POST', `/deals/${id}/cancel`],
  ['POST', `/deals/${id}/cancel-request`],
  ['POST', `/deals/${id}/cancel-request/accept`],
  ['POST', `/deals/${id}/cancel-request/clear`],
  ['POST', `/deals/${id}/problem`],
  ['GET', `/deals/${id}/review`],
  ['POST', `/deals/${id}/review`],
  ['POST', `/reviews/${id}/reply`],
  ['POST', `/reviews/${id}/report`],
  ['GET', '/users/me/reviews'],
  ['GET', '/notifications'],
  ['GET', '/notifications/unread-count'],
  ['POST', `/notifications/${id}/read`],
  ['POST', '/notifications/read-all'],
  ['GET', '/notifications/preferences'],
  ['PUT', '/notifications/preferences'],
  ['PUT', '/users/me/devices'],
  ['DELETE', '/users/me/devices/install-1'],
  ['PUT', '/users/me/language'],
  ['GET', '/users/me/badges'],
  ['GET', '/businesses/me/contact-phone'],
  ['POST', '/businesses/me/contact-phone/otp/send'],
  ['POST', '/businesses/me/contact-phone/otp/verify'],
  ['DELETE', '/businesses/me/contact-phone'],
];

// §16.1 roles; `category_manager` is in none of them.
const ADMIN_ROUTES: Array<[Method, string]> = [
  ['GET', '/admin/enquiries'],
  ['GET', `/admin/enquiries/${id}`],
  ['GET', '/admin/deals'],
  ['GET', `/admin/deals/${id}`],
  ['GET', '/admin/disputes'],
  ['GET', '/admin/disputes/count'],
  ['GET', `/admin/disputes/${id}`],
  ['POST', `/admin/disputes/${id}/resolve`],
  ['POST', `/admin/threads/${id}/read`],
  ['GET', '/admin/reports'],
  ['POST', `/admin/reports/${id}/resolve`],
  ['POST', `/admin/reviews/${id}/hide`],
  ['POST', `/admin/reviews/${id}/unhide`],
  ['POST', `/admin/reviews/${id}/hide-reply`],
];

let app: FastifyInstance;
let outsider: { id: string; token: string };
let superAdmin: { id: string; token: string };
let owner: TestBusinessUser;
let viewer: { userId: string; token: string };

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
  outsider = await createTestAdmin('category_manager');
  superAdmin = await createTestAdmin('super_admin');
  owner = await createTestBusinessUser();
  viewer = await addTestMember(owner.businessId, 'viewer');
});

afterAll(async () => {
  await deleteTestBusinesses([owner.businessId]);
  await deleteTestAdmins([outsider.id, superAdmin.id]);
  await app.close();
});

const call = (method: Method, url: string, token?: string, payload: object = {}) =>
  app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(method === 'GET' ? {} : { payload }) });

describe('F6 + F7 routes', () => {
  it.each(USER_ROUTES)('%s %s needs a signed-in user', async (method, url) => {
    expect((await call(method, url)).statusCode).toBe(401);
  });

  it.each(ADMIN_ROUTES)('%s %s refuses a role outside §16.1 and lets super_admin through', async (method, url) => {
    expect((await call(method, url)).statusCode).toBe(401);
    const refused = await call(method, url, outsider.token);
    expect(refused.statusCode).toBe(403);
    const allowed = await call(method, url, superAdmin.token);
    expect([401, 403]).not.toContain(allowed.statusCode);
  });

  it('refuses a viewer on a business write but lets it archive and mark read (P15)', async () => {
    const write = await call('POST', `/threads/${id}/block`, viewer.token);
    expect(write.statusCode).toBe(403);
    expect(write.json().code).toBe('VIEWER_READ_ONLY');
    expect((await call('PUT', `/threads/${id}/archive`, viewer.token)).statusCode).not.toBe(403);
    expect((await call('POST', `/threads/${id}/read`, viewer.token, { seq: 1 })).statusCode).not.toBe(403);
  });

  it('refuses a settings change that breaks a §17 cross-check', async () => {
    const res = await call('PATCH', '/admin/settings', superAdmin.token, { offer_validity_hours_1: 48, offer_validity_hours_2: 24 });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'SETTING_INVALID', details: { key: 'offer_validity_hours_1' } });
  });
});

describe('Sentry redaction (§19)', () => {
  it.each(['text', 'note', 'notesText', 'description', 'replyText', 'messageToParties', 'contactPhone', 'phone', 'number', 'fcmToken', 'photoKeys'])(
    'drops %s',
    (key) => {
      expect(redact({ nested: { [key]: 'secret' } })).toEqual({ nested: { [key]: '[redacted]' } });
    },
  );
});
