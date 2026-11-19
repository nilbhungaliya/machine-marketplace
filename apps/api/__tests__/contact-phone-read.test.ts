import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { businesses } from '../src/db/schema.js';
import { signUserToken } from '../src/plugins/auth.js';
import { signInWithPhone } from '../src/services/user.service.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { addTestMember } from './_helpers/test-deals.js';
import { deleteTestUsers, uniqueTestPhone } from './_helpers/test-users.js';

// `GET /businesses/me/contact-phone` (F6 + F7 spec §6.6, wave B integration): the owner reads the state, any other
// member only `canEdit: false` (never a number), a user without a business gets `409 ONBOARDING_INCOMPLETE`.

let app: FastifyInstance;
let owner: TestBusinessUser;
let sales: { userId: string; token: string };

const read = (token: string) =>
  app.inject({ method: 'GET', url: '/businesses/me/contact-phone', headers: { authorization: `Bearer ${token}` } });

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
  owner = await createTestBusinessUser();
  sales = await addTestMember(owner.businessId, 'sales');
});

afterAll(async () => {
  await deleteTestBusinesses([owner.businessId]);
  await app.close();
});

describe('GET /businesses/me/contact-phone', () => {
  it('owner sees the state (fallback, then the number); a member sees canEdit false and no number; no business → 409', async () => {
    const fallback = await read(owner.token);
    expect(fallback.statusCode).toBe(200);
    expect(fallback.json().data).toEqual({ contactPhone: null, verifiedAt: null, ownerPhoneFallback: true, canEdit: true });
    expect(JSON.stringify(fallback.json())).not.toContain(owner.phone.slice(3));

    const phone = uniqueTestPhone();
    await db.update(businesses).set({ contactPhone: phone, contactPhoneVerifiedAt: new Date() }).where(eq(businesses.id, owner.businessId));
    const set = (await read(owner.token)).json().data;
    expect(set).toMatchObject({ contactPhone: phone, ownerPhoneFallback: false, canEdit: true });
    expect(typeof set.verifiedAt).toBe('string');

    const member = await read(sales.token);
    expect(member.statusCode).toBe(200);
    expect(member.json().data).toEqual({ contactPhone: null, verifiedAt: null, ownerPhoneFallback: false, canEdit: false });

    const signIn = await signInWithPhone(db, uniqueTestPhone());
    try {
      const res = await read(signUserToken({ userId: signIn.user.id, businessId: null }));
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('ONBOARDING_INCOMPLETE');
    } finally {
      await deleteTestUsers([signIn.user.id]);
    }
  });
});
