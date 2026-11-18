import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';
import { and, eq, inArray } from 'drizzle-orm';
import { io as connect, type Socket } from 'socket.io-client';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { auditLog, users } from '../src/db/schema.js';
import type { UserTokenPayload } from '../src/plugins/auth.js';
import { setupSocketIO } from '../src/socket/setup.js';
import { businessRoom } from '../src/socket/rooms.js';
import { signInWithPhone } from '../src/services/user.service.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { createTestBusinessUser, deleteTestBusinesses, type TestBusinessUser } from './_helpers/test-businesses.js';
import { deleteTestUsers, uniqueTestPhone } from './_helpers/test-users.js';

// Account status (F1 + A2 spec §8.2): suspension and blocking take effect at once — the next request with an old token
// gets 403 ACCOUNT_SUSPENDED, a socket handshake is refused, open sockets are disconnected. Ruling R5: the user's
// business id comes from the database on every request and handshake, never from the token.

describe('account status', () => {
  let app: FastifyInstance;
  let url: string;
  const open: Socket[] = [];
  const businessIds: string[] = [];
  const userIds: string[] = [];
  const adminIds: string[] = [];
  let officer: { id: string; token: string };
  let moderator: { id: string; token: string };
  let superAdmin: { id: string; token: string };
  let support: { id: string; token: string };

  function client(token: string): Promise<Socket> {
    const socket = connect(`${url}/user`, { auth: { token }, transports: ['websocket'], reconnection: false });
    open.push(socket);
    return new Promise((resolve, reject) => {
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', reject);
    });
  }

  async function newUser(): Promise<TestBusinessUser> {
    const u = await createTestBusinessUser();
    businessIds.push(u.businessId);
    return u;
  }

  const me = (token: string) => app.inject({ method: 'GET', url: '/businesses/me', headers: { authorization: `Bearer ${token}` } });
  const act = (adminToken: string, userId: string, action: string, body: unknown = { reason: 'Testing account status' }) =>
    app.inject({
      method: 'POST',
      url: `/admin/users/${userId}/${action}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: body as Record<string, unknown>,
    });
  const statusOf = async (userId: string) => (await db.select({ s: users.status }).from(users).where(eq(users.id, userId)))[0]!.s;
  const auditRows = (userId: string, action: string) =>
    db.select().from(auditLog).where(and(eq(auditLog.entityId, userId), eq(auditLog.action, action)));

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    // Test-only probe: what requireUser put on the request (ruling R5).
    app.get('/__test/whoami', { preHandler: app.requireUser }, async (request) => ({ data: request.user }));
    setupSocketIO(app);
    await app.listen({ port: 0, host: '127.0.0.1' });
    url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    officer = await createTestAdmin('verification_officer');
    moderator = await createTestAdmin('moderator');
    superAdmin = await createTestAdmin('super_admin');
    support = await createTestAdmin('support');
    adminIds.push(officer.id, moderator.id, superAdmin.id, support.id);
  });

  afterAll(async () => {
    open.forEach((s) => s.disconnect());
    const owned = await db.select({ businessId: users.businessId }).from(users).where(inArray(users.id, userIds));
    const all = [...businessIds, ...owned.map((r) => r.businessId).filter((id): id is string => !!id)];
    await deleteTestBusinesses([...new Set(all)]);
    await deleteTestUsers(userIds);
    await deleteTestAdmins(adminIds);
    await app.close();
  });

  describe('REST', () => {
    it('suspend refuses the same token at once; reinstate lets it back in', async () => {
      const u = await newUser();
      expect((await me(u.token)).statusCode).toBe(200);

      const res = await act(officer.token, u.userId, 'suspend');
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({ id: u.userId, status: 'suspended' });
      expect(await statusOf(u.userId)).toBe('suspended');

      const refused = await me(u.token);
      expect(refused.statusCode).toBe(403);
      expect(refused.json().code).toBe('ACCOUNT_SUSPENDED');

      const back = await act(moderator.token, u.userId, 'reinstate');
      expect(back.statusCode).toBe(200);
      expect(back.json().data.status).toBe('active');
      expect((await me(u.token)).statusCode).toBe(200);

      const [suspendAudit] = await auditRows(u.userId, 'user.suspend');
      expect(suspendAudit).toMatchObject({ adminId: officer.id, entityType: 'user', before: { status: 'active' } });
      expect(suspendAudit!.after).toMatchObject({ status: 'suspended', reason: 'Testing account status' });
      const [reinstateAudit] = await auditRows(u.userId, 'user.reinstate');
      expect(reinstateAudit).toMatchObject({ adminId: moderator.id, before: { status: 'suspended' } });
      expect(reinstateAudit!.after).toMatchObject({ status: 'active' });
    });

    it('a moderator cannot block; a super admin can, and reinstate refuses a blocked user; unblock lifts it', async () => {
      const u = await newUser();
      const byMod = await act(moderator.token, u.userId, 'block');
      expect(byMod.statusCode).toBe(403);
      const byOfficer = await act(officer.token, u.userId, 'block');
      expect(byOfficer.statusCode).toBe(403);
      expect(await statusOf(u.userId)).toBe('active');

      const blocked = await act(superAdmin.token, u.userId, 'block');
      expect(blocked.statusCode).toBe(200);
      expect(blocked.json().data.status).toBe('blocked');
      const refused = await me(u.token);
      expect(refused.statusCode).toBe(403);
      expect(refused.json().code).toBe('ACCOUNT_SUSPENDED');

      const reinstate = await act(officer.token, u.userId, 'reinstate');
      expect(reinstate.statusCode).toBe(409);
      expect(reinstate.json().code).toBe('USER_BLOCKED');

      const unblockByMod = await act(moderator.token, u.userId, 'unblock');
      expect(unblockByMod.statusCode).toBe(403);

      const unblocked = await act(superAdmin.token, u.userId, 'unblock');
      expect(unblocked.statusCode).toBe(200);
      expect(unblocked.json().data.status).toBe('active');
      expect((await me(u.token)).statusCode).toBe(200);

      expect(await auditRows(u.userId, 'user.block')).toHaveLength(1);
      expect(await auditRows(u.userId, 'user.unblock')).toHaveLength(1);
      expect(await auditRows(u.userId, 'user.reinstate')).toHaveLength(0);
    });

    it('a suspended user can be blocked; block on a blocked user is 409', async () => {
      const u = await newUser();
      expect((await act(officer.token, u.userId, 'suspend')).statusCode).toBe(200);
      expect((await act(superAdmin.token, u.userId, 'block')).statusCode).toBe(200);
      const again = await act(superAdmin.token, u.userId, 'block');
      expect(again.statusCode).toBe(409);
      expect(again.json().code).toBe('USER_NOT_ACTIVE');
    });

    it('refuses transitions from the wrong state with stable codes and writes no audit', async () => {
      const u = await newUser();
      const reinstate = await act(officer.token, u.userId, 'reinstate');
      expect(reinstate.statusCode).toBe(409);
      expect(reinstate.json().code).toBe('USER_NOT_SUSPENDED');
      const unblock = await act(superAdmin.token, u.userId, 'unblock');
      expect(unblock.statusCode).toBe(409);
      expect(unblock.json().code).toBe('USER_NOT_BLOCKED');

      expect((await act(officer.token, u.userId, 'suspend')).statusCode).toBe(200);
      const twice = await act(officer.token, u.userId, 'suspend');
      expect(twice.statusCode).toBe(409);
      expect(twice.json().code).toBe('USER_NOT_ACTIVE');
      expect(await auditRows(u.userId, 'user.suspend')).toHaveLength(1);
      expect(await auditRows(u.userId, 'user.reinstate')).toHaveLength(0);
      expect(await auditRows(u.userId, 'user.unblock')).toHaveLength(0);
    });

    it('requires a reason of 3–500 characters', async () => {
      const u = await newUser();
      expect((await act(officer.token, u.userId, 'suspend', {})).statusCode).toBe(400);
      expect((await act(officer.token, u.userId, 'suspend', { reason: '  a ' })).statusCode).toBe(400);
      expect((await act(officer.token, u.userId, 'suspend', { reason: 'x'.repeat(501) })).statusCode).toBe(400);
      expect(await statusOf(u.userId)).toBe('active');
      expect(await auditRows(u.userId, 'user.suspend')).toHaveLength(0);
    });

    it('refuses roles without the right, an unknown user and a bad id', async () => {
      const u = await newUser();
      expect((await act(support.token, u.userId, 'suspend')).statusCode).toBe(403);
      const unknown = await act(officer.token, '00000000-0000-4000-8000-000000000000', 'suspend');
      expect(unknown.statusCode).toBe(404);
      expect((await act(officer.token, 'not-a-uuid', 'suspend')).statusCode).toBe(400);
      expect((await app.inject({ method: 'POST', url: `/admin/users/${u.userId}/suspend`, payload: { reason: 'abc' } })).statusCode).toBe(401);
    });

    it('a token for a user that no longer exists is 401', async () => {
      const phone = uniqueTestPhone();
      const signIn = await signInWithPhone(db, phone);
      await db.delete(users).where(eq(users.id, signIn.user.id));
      const res = await me(signIn.token);
      expect(res.statusCode).toBe(401);
    });

    it('ruling R5: a business created after sign-in resolves on the old token', async () => {
      const signIn = await signInWithPhone(db, uniqueTestPhone());
      userIds.push(signIn.user.id);
      const token = signIn.token; // carries businessId null
      const created = await app.inject({
        method: 'PATCH',
        url: '/businesses/me',
        headers: { authorization: `Bearer ${token}` },
        payload: { name: 'Late Owner', businessName: `Late Works ${Date.now()}`, activities: ['buy'] },
      });
      expect(created.statusCode).toBe(200);
      const [row] = await db.select({ businessId: users.businessId }).from(users).where(eq(users.id, signIn.user.id));
      expect(row!.businessId).toBeTruthy();

      expect((await me(token)).statusCode).toBe(200);
      const who = await app.inject({ method: 'GET', url: '/__test/whoami', headers: { authorization: `Bearer ${token}` } });
      expect(who.statusCode).toBe(200);
      expect(who.json().data as UserTokenPayload).toEqual({ userId: signIn.user.id, businessId: row!.businessId });

      // ...and the /user socket joins the business room from the database value.
      const socket = await client(token);
      const got = new Promise((resolve) => socket.on('deal:updated', resolve));
      app.io.of('/user').to(businessRoom(row!.businessId!)).emit('deal:updated', { dealId: 'd1' });
      expect(await got).toEqual({ dealId: 'd1' });
    });
  });

  describe('socket', () => {
    it("refuses a suspended user's handshake with ACCOUNT_SUSPENDED", async () => {
      const u = await newUser();
      expect((await act(officer.token, u.userId, 'suspend')).statusCode).toBe(200);
      await expect(client(u.token)).rejects.toThrow('ACCOUNT_SUSPENDED');
    });

    it("refuses a handshake for a user that doesn't exist", async () => {
      const signIn = await signInWithPhone(db, uniqueTestPhone());
      await db.delete(users).where(eq(users.id, signIn.user.id));
      await expect(client(signIn.token)).rejects.toThrow('Invalid token');
    });

    it("disconnects an active user's open socket within 2 s of a suspension", async () => {
      const u = await newUser();
      const socket = await client(u.token);
      const disconnected = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no disconnect within 2 s')), 2000);
        socket.on('disconnect', (reason) => { clearTimeout(timer); resolve(reason); });
      });
      expect((await act(officer.token, u.userId, 'suspend')).statusCode).toBe(200);
      expect(await disconnected).toBe('io server disconnect');
    });

    it('disconnects on a block too', async () => {
      const u = await newUser();
      const socket = await client(u.token);
      const disconnected = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no disconnect within 2 s')), 2000);
        socket.on('disconnect', () => { clearTimeout(timer); resolve(); });
      });
      expect((await act(superAdmin.token, u.userId, 'block')).statusCode).toBe(200);
      await disconnected;
    });
  });
});
