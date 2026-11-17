import { Server as SocketIOServer } from 'socket.io';
import type { FastifyInstance } from 'fastify';
import { verifyAdminToken, verifyUserToken } from '../plugins/auth.js';
import { ADMIN_ALL_ROOM, adminRoleRoom, adminUserRoom, businessRoom, userRoom } from './rooms.js';

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
 * - `/user`  — app users; joined to their user room and business room
 * - `/admin` — admin panel; joined to all-admins, their role room and own room
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
  users.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      const payload = verifyUserToken(token);
      socket.data.userId = payload.userId;
      socket.data.businessId = payload.businessId;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });
  users.on('connection', (socket) => {
    socket.join(userRoom(socket.data.userId));
    if (socket.data.businessId) socket.join(businessRoom(socket.data.businessId));
  });

  const admins = io.of('/admin');
  admins.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      const payload = verifyAdminToken(token);
      socket.data.adminId = payload.adminId;
      socket.data.role = payload.role;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });
  admins.on('connection', (socket) => {
    socket.join([ADMIN_ALL_ROOM, adminRoleRoom(socket.data.role), adminUserRoom(socket.data.adminId)]);
  });

  fastify.log.info('Socket.IO namespaces registered: /user, /admin');
  return io;
}
