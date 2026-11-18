import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { users } from '../src/db/schema.js';
import { signAdminToken, signUserToken } from '../src/plugins/auth.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';

// fastify.optionalUser (F2 spec §14, R55): public routes see the user only for a valid user token of an active user;
// anything else is a guest, never a 401 / 403. A test-only route reports what the preHandler left on the request.

const ROUTE = '/__test/optional-user';

describe('fastify.optionalUser', () => {
  let app: FastifyInstance;
  let active: TestBusinessUser;
  let suspended: TestBusinessUser;
  let blocked: TestBusinessUser;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    app.get(ROUTE, { preHandler: app.optionalUser }, async (request) => ({
      data: { user: request.user ? request.user.userId : null, businessId: request.user?.businessId ?? null },
    }));
    active = await createTestBusinessUser();
    suspended = await createTestBusinessUser();
    blocked = await createTestBusinessUser();
    await db.update(users).set({ status: 'suspended' }).where(eq(users.id, suspended.userId));
    await db.update(users).set({ status: 'blocked' }).where(eq(users.id, blocked.userId));
  });

  afterAll(async () => {
    // Before app.close(): closing the app ends the shared pg pool.
    await deleteTestBusinesses([active, suspended, blocked].filter((u) => !!u).map((u) => u.businessId));
    await app?.close();
  });

  async function whoAmI(authorization?: string) {
    const res = await app.inject({ method: 'GET', url: ROUTE, headers: authorization ? { authorization } : {} });
    expect(res.statusCode, res.body).toBe(200);
    return res.json().data as { user: string | null; businessId: string | null };
  }

  it('sets the user for a valid token of an active user, with the business from the row', async () => {
    expect(await whoAmI(`Bearer ${active.token}`)).toEqual({ user: active.userId, businessId: active.businessId });
    // An old token without the business still resolves it from the row.
    const oldToken = signUserToken({ userId: active.userId, businessId: null });
    expect(await whoAmI(`Bearer ${oldToken}`)).toEqual({ user: active.userId, businessId: active.businessId });
  });

  it('treats no header and a non-Bearer header as a guest', async () => {
    expect((await whoAmI()).user).toBeNull();
    expect((await whoAmI(`Basic ${active.token}`)).user).toBeNull();
  });

  it('treats a malformed, expired or wrongly-signed token as a guest', async () => {
    expect((await whoAmI('Bearer not-a-jwt')).user).toBeNull();
    const expired = jwt.sign(
      { userId: active.userId, businessId: active.businessId, typ: 'user', exp: Math.floor(Date.now() / 1000) - 60 },
      process.env.JWT_SECRET!,
    );
    expect((await whoAmI(`Bearer ${expired}`)).user).toBeNull();
    const wrongSecret = jwt.sign({ userId: active.userId, businessId: active.businessId, typ: 'user' }, 'not-the-secret');
    expect((await whoAmI(`Bearer ${wrongSecret}`)).user).toBeNull();
  });

  it('treats an admin token as a guest', async () => {
    const admin = signAdminToken({ adminId: randomUUID(), role: 'super_admin' });
    expect((await whoAmI(`Bearer ${admin}`)).user).toBeNull();
  });

  it('treats a suspended or blocked user, or one that no longer exists, as a guest', async () => {
    expect((await whoAmI(`Bearer ${suspended.token}`)).user).toBeNull();
    expect((await whoAmI(`Bearer ${blocked.token}`)).user).toBeNull();
    const ghost = signUserToken({ userId: randomUUID(), businessId: null });
    expect((await whoAmI(`Bearer ${ghost}`)).user).toBeNull();
  });
});
