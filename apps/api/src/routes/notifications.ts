import type { FastifyPluginAsync } from 'fastify';
import { notImplemented } from '../lib/member-guard.js';

// In-app notifications, preferences and the app language (F6 + F7 spec §11, §12.2). L4 owns this file; C0-4b stubs.
// Per-user state: viewers may use every route here.

const tags = ['Notifications'];

const notificationRoutes: FastifyPluginAsync = async (fastify) => {
  const user = { schema: { tags }, preHandler: [fastify.requireUser] };

  // F6F7-STUB(L4): L4-3 → `NotificationsPage`.
  fastify.get('/notifications', user, async () => notImplemented());
  fastify.get('/notifications/unread-count', user, async () => notImplemented());
  fastify.post('/notifications/:id/read', user, async () => notImplemented());
  fastify.post('/notifications/read-all', user, async () => notImplemented());
  // F6F7-STUB(L4): L4-3 `{ push: boolean }`.
  fastify.get('/notifications/preferences', user, async () => notImplemented());
  fastify.put('/notifications/preferences', user, async () => notImplemented());
  // F6F7-STUB(L4): L4-3 server text follows the app's language.
  fastify.put('/users/me/language', user, async () => notImplemented());
};

export default notificationRoutes;
