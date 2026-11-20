import { Server as SocketIOServer } from 'socket.io';
import type { FastifyInstance } from 'fastify';
import { loadActiveAdmin, loadActiveUser, verifyAdminToken, verifyUserToken } from '../plugins/auth.js';
import { AppError } from '../lib/errors.js';
import { ADMIN_ALL_ROOM, adminRoleRoom, adminUserRoom, businessRoom, userRoom } from './rooms.js';
import { and, eq, or } from 'drizzle-orm';
import { chatThreads, users as usersTable } from '../db/schema.js';
import { setViewing } from '../services/chat/viewing.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sets (or clears) the user's viewing key when the thread is their business's; returns whether it changed anything. */
async function onThreadViewing(fastify: FastifyInstance, userId: string, data: unknown): Promise<boolean> {
  if (!fastify.redis) return false;
  const threadId = (data as { threadId?: unknown } | null)?.threadId ?? null;
  if (threadId === null) {
    await setViewing(fastify.redis, userId, null);
    return true;
  }
  if (typeof threadId !== 'string' || !UUID.test(threadId)) return false;
  const [me] = await fastify.db
    .select({ businessId: usersTable.businessId, status: usersTable.status })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!me?.businessId || me.status !== 'active') return false;
  const [thread] = await fastify.db
    .select({ id: chatThreads.id })
    .from(chatThreads)
    .where(and(eq(chatThreads.id, threadId), or(eq(chatThreads.buyerBusinessId, me.businessId), eq(chatThreads.sellerBusinessId, me.businessId))));
  if (!thread) return false;
  await setViewing(fastify.redis, userId, threadId);
  return true;
}

declare module 'fastify' {
  interface FastifyInstance {
    io: SocketIOServer;
  }
}

/**
 * Real-time layer (chat, offer and deal events; the admin live feed).
 *
 * Namespaces, each authenticated by the same JWT as REST, sent as
 * `io(url + '/user', { auth: { token } })`:
 * - `/user`  — app users; joined to their user room and business room (needs the db plugin: the handshake reads the
 *   user's status and business id)
 * - `/admin` — admin panel; joined to all-admins, their role room (the admin row's role) and own room; the handshake
 *   reads the admin row like requireAdmin (admin close-out R13)
 *
 * Call after `app.ready()`, since it needs the HTTP server.
 */
export function setupSocketIO(fastify: FastifyInstance): SocketIOServer {
  const io = new SocketIOServer(fastify.server, {
    cors: { origin: true, credentials: true },
  });
  fastify.decorate('io', io);
  fastify.addHook('onClose', async () => { io.close(); });

  const users = io.of('/user');
  // As requireUser (ruling R5): the token names the user; status and business id come from the database, so a
  // suspended user's reconnect is refused and a business created after sign-in gets its room.
  users.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    let userId: string;
    try {
      userId = verifyUserToken(token).userId;
    } catch {
      return next(new Error('Invalid token'));
    }
    try {
      const user = await loadActiveUser(fastify.db, userId);
      socket.data.userId = user.userId;
      socket.data.businessId = user.businessId;
      next();
    } catch (err) {
      if (err instanceof AppError && err.code === 'ACCOUNT_SUSPENDED') return next(new Error('ACCOUNT_SUSPENDED'));
      if (err instanceof AppError && err.code === 'UNAUTHORIZED') return next(new Error('Invalid token'));
      fastify.log.error({ err }, 'socket handshake lookup failed');
      next(new Error('Server error'));
    }
  });
  users.on('connection', (socket) => {
    socket.join(userRoom(socket.data.userId));
    if (socket.data.businessId) socket.join(businessRoom(socket.data.businessId));
    // F6 + F7 §11.5, §13: `thread:viewing { threadId | null }` every 20 s while a thread is on screen, so a chat push
    // skips a user reading that thread. Ignored unless the user's business (read from the database now) is a party.
    // An optional ack answers `{ ok }` once handled.
    socket.on('thread:viewing', async (data: unknown, ack?: (r: { ok: boolean }) => void) => {
      let ok = false;
      try {
        ok = await onThreadViewing(fastify, socket.data.userId as string, data);
      } catch (err) {
        fastify.log.warn({ err }, 'thread:viewing failed');
      }
      if (typeof ack === 'function') ack({ ok });
    });
  });

  const admins = io.of('/admin');
  // As requireAdmin (admin close-out R13): the token names the admin and its token version; the row decides whether the
  // session still stands and which role room to join. An ended session is refused with `ADMIN_SESSION_ENDED`.
  admins.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    let claims: { adminId: string; tv: number };
    try {
      claims = verifyAdminToken(token);
    } catch {
      return next(new Error('Invalid token'));
    }
    try {
      const admin = await loadActiveAdmin(fastify.db, claims.adminId, claims.tv);
      socket.data.adminId = admin.adminId;
      socket.data.role = admin.role;
      socket.data.tv = admin.tv;
      next();
    } catch (err) {
      if (err instanceof AppError && err.code === 'ADMIN_SESSION_ENDED') return next(new Error('ADMIN_SESSION_ENDED'));
      fastify.log.error({ err }, 'admin socket handshake lookup failed');
      next(new Error('Server error'));
    }
  });
  admins.on('connection', (socket) => {
    socket.join([ADMIN_ALL_ROOM, adminRoleRoom(socket.data.role), adminUserRoom(socket.data.adminId)]);
  });

  fastify.log.info('Socket.IO namespaces registered: /user, /admin');
  return io;
}
