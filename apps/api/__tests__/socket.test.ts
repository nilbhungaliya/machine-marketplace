import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { buildApp } from '../src/app.js';
import { setupSocketIO } from '../src/socket/setup.js';
import { signAdminToken, signUserToken } from '../src/plugins/auth.js';
import { adminRoleRoom, userRoom } from '../src/socket/rooms.js';

process.env.JWT_SECRET ??= 'test-user-secret';
process.env.ADMIN_JWT_SECRET ??= 'test-admin-secret';

let app: FastifyInstance;
let url: string;
const open: Socket[] = [];

function client(nsp: string, token?: string): Promise<Socket> {
  const socket = connect(`${url}${nsp}`, { auth: token ? { token } : {}, transports: ['websocket'], reconnection: false });
  open.push(socket);
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

beforeAll(async () => {
  app = await buildApp({ infra: false, logger: false });
  setupSocketIO(app);
  await app.listen({ port: 0, host: '127.0.0.1' });
  url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  open.forEach((s) => s.disconnect());
  await app.close();
});

describe('socket auth', () => {
  it('rejects a connection without a token', async () => {
    await expect(client('/user')).rejects.toThrow('Authentication required');
  });

  it('rejects a user token on the admin namespace', async () => {
    await expect(client('/admin', signUserToken({ userId: 'u1', businessId: null }))).rejects.toThrow('Invalid token');
  });

  it('rejects a user token on the admin namespace even when both secrets are the same', async () => {
    const saved = process.env.ADMIN_JWT_SECRET;
    process.env.ADMIN_JWT_SECRET = process.env.JWT_SECRET;
    try {
      await expect(client('/admin', signUserToken({ userId: 'u1', businessId: null }))).rejects.toThrow('Invalid token');
    } finally {
      process.env.ADMIN_JWT_SECRET = saved;
    }
  });

  it('rejects an admin token on the user namespace', async () => {
    await expect(client('/user', signAdminToken({ adminId: 'a1', role: 'moderator' }))).rejects.toThrow('Invalid token');
  });
});

describe('room delivery', () => {
  it('delivers a user-room emit to that user only', async () => {
    const mine = await client('/user', signUserToken({ userId: 'u1', businessId: 'b1' }));
    const other = await client('/user', signUserToken({ userId: 'u2', businessId: null }));
    let otherGot = false;
    other.on('offer:received', () => { otherGot = true; });

    const got = new Promise((resolve) => mine.on('offer:received', resolve));
    app.io.of('/user').to(userRoom('u1')).emit('offer:received', { offerId: 'o1' });
    expect(await got).toEqual({ offerId: 'o1' });
    expect(otherGot).toBe(false);
  });

  it('puts admins in their role room', async () => {
    const mod = await client('/admin', signAdminToken({ adminId: 'a1', role: 'moderator' }));
    const got = new Promise((resolve) => mod.on('admin:pending_changed', resolve));
    app.io.of('/admin').to(adminRoleRoom('moderator')).emit('admin:pending_changed', { section: 'moderation' });
    expect(await got).toEqual({ section: 'moderation' });
  });
});
