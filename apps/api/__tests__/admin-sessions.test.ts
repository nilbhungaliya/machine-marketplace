import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { eq, sql } from 'drizzle-orm';
import { io as connect, type Socket } from 'socket.io-client';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { adminUsers } from '../src/db/schema.js';
import { signAdminToken } from '../src/plugins/auth.js';
import { setupSocketIO } from '../src/socket/setup.js';
import { runTx } from '../src/lib/tx-effects.js';
import { endAdminSessions } from '../src/services/admin-users/sessions.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';

// Admin close-out R13, §11.1, plan C0-3 / D2: the admin row is read on every request and socket handshake; a
// deactivated admin, one with no password or a token version other than the token's `tv` is 401 ADMIN_SESSION_ENDED,
// and the role comes from the row.

let app: FastifyInstance;
let url: string;
const open: Socket[] = [];
const adminIds: string[] = [];

async function admin(role: Parameters<typeof createTestAdmin>[0], opts?: Parameters<typeof createTestAdmin>[1]) {
  const a = await createTestAdmin(role, opts);
  adminIds.push(a.id);
  return a;
}

const me = (token: string) => app.inject({ method: 'GET', url: '/admin/auth/me', headers: { authorization: `Bearer ${token}` } });
const login = (email: string, password: string) =>
  app.inject({ method: 'POST', url: '/admin/auth/login', payload: { email, password } });

function client(token: string): Promise<Socket> {
  const socket = connect(`${url}/admin`, { auth: { token }, transports: ['websocket'], reconnection: false });
  open.push(socket);
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  setupSocketIO(app);
  await app.listen({ port: 0, host: '127.0.0.1' });
  url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  open.forEach((s) => s.disconnect());
  await deleteTestAdmins(adminIds);
  await app.close();
});

describe('requests (R13)', () => {
  it('ends the session of a deactivated admin', async () => {
    const a = await admin('support');
    expect((await me(a.token)).statusCode).toBe(200);
    await db.update(adminUsers).set({ isActive: false }).where(eq(adminUsers.id, a.id));
    const res = await me(a.token);
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('ADMIN_SESSION_ENDED');
  });

  it('ends a token whose version is behind the row, and takes a token of the new version', async () => {
    const a = await admin('moderator');
    await db.update(adminUsers).set({ tokenVersion: sql`${adminUsers.tokenVersion} + 1` }).where(eq(adminUsers.id, a.id));
    const old = await me(a.token);
    expect(old.statusCode).toBe(401);
    expect(old.json().code).toBe('ADMIN_SESSION_ENDED');
    const fresh = signAdminToken({ adminId: a.id, role: 'moderator', tv: 1 });
    const res = await me(fresh);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ adminId: a.id, role: 'moderator', tv: 1 });
  });

  it('takes the role from the row, not the token', async () => {
    const a = await admin('moderator');
    await db.update(adminUsers).set({ role: 'support' }).where(eq(adminUsers.id, a.id));
    const approve = await app.inject({
      method: 'POST',
      url: `/admin/listings/${randomUUID()}/approve`,
      headers: { authorization: `Bearer ${a.token}` },
      payload: { version: 1 },
    });
    expect(approve.statusCode).toBe(403);
    expect((await me(a.token)).json().data.role).toBe('support');
  });

  it('ends a token signed without a version', async () => {
    const a = await admin('super_admin');
    const legacy = jwt.sign({ adminId: a.id, role: 'super_admin', typ: 'admin' }, process.env.ADMIN_JWT_SECRET!, { expiresIn: '1h' });
    const res = await me(legacy);
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('ADMIN_SESSION_ENDED');
  });

  it('ends the session of an admin whose password was cleared (reset link out)', async () => {
    const a = await admin('support');
    await db.update(adminUsers).set({ passwordHash: null }).where(eq(adminUsers.id, a.id));
    expect((await me(a.token)).json().code).toBe('ADMIN_SESSION_ENDED');
  });

  it('keeps a bad signature a plain 401 UNAUTHORIZED', async () => {
    const res = await me('not-a-jwt');
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHORIZED');
  });
});

describe('sockets (R13, §15)', () => {
  it('refuses the handshake of an ended session', async () => {
    const a = await admin('support');
    await db.update(adminUsers).set({ isActive: false }).where(eq(adminUsers.id, a.id));
    await expect(client(a.token)).rejects.toThrow('ADMIN_SESSION_ENDED');
  });

  it('sends admin:session_ended with the new version and drops the sockets after commit', async () => {
    const a = await admin('moderator');
    const socket = await client(a.token);
    const ended = new Promise<unknown>((resolve) => socket.on('admin:session_ended', resolve));
    const dropped = new Promise<string>((resolve) => socket.on('disconnect', resolve));
    const tv = await runTx(app, (tx) => endAdminSessions(tx, a.id));
    expect(tv).toBe(1);
    expect(await ended).toEqual({ tv: 1 });
    await dropped;
    expect(socket.connected).toBe(false);
    expect((await me(a.token)).json().code).toBe('ADMIN_SESSION_ENDED');
  });

  it('does nothing when the transaction rolls back', async () => {
    const a = await admin('moderator');
    const socket = await client(a.token);
    let got = false;
    socket.on('admin:session_ended', () => { got = true; });
    await expect(
      runTx(app, async (tx) => {
        await endAdminSessions(tx, a.id);
        throw new Error('roll back');
      }),
    ).rejects.toThrow('roll back');
    // A round trip on the same socket: anything emitted before it would have arrived first.
    await new Promise((r) => setTimeout(r, 200));
    expect(got).toBe(false);
    expect(socket.connected).toBe(true);
    expect((await me(a.token)).statusCode).toBe(200);
  });
});

describe('login (§11.1)', () => {
  it('refuses an invited admin and a deactivated one with the wrong-password answer', async () => {
    const good = await admin('support', { password: 'correct horse battery' });
    const wrong = await login(good.email, 'not the password');
    expect(wrong.statusCode).toBe(401);

    const invited = await admin('support', { invited: true });
    const invitedRes = await login(invited.email, 'anything at all');
    expect(invitedRes.statusCode).toBe(401);
    expect(invitedRes.json()).toEqual(wrong.json());

    const gone = await admin('support', { password: 'correct horse battery' });
    await db.update(adminUsers).set({ isActive: false }).where(eq(adminUsers.id, gone.id));
    const goneRes = await login(gone.email, 'correct horse battery');
    expect(goneRes.statusCode).toBe(401);
    expect(goneRes.json()).toEqual(wrong.json());
  });

  it('sets last_login_at and signs the row version', async () => {
    const a = await admin('operations', { password: 'correct horse battery' });
    await db.update(adminUsers).set({ tokenVersion: 3 }).where(eq(adminUsers.id, a.id));
    const res = await login(a.email, 'correct horse battery');
    expect(res.statusCode).toBe(200);
    const token = res.json().data.token as string;
    expect((jwt.decode(token) as { tv: number }).tv).toBe(3);
    expect((await me(token)).statusCode).toBe(200);
    const [row] = await db.select({ at: adminUsers.lastLoginAt }).from(adminUsers).where(eq(adminUsers.id, a.id));
    expect(row!.at).not.toBeNull();
  });
});
