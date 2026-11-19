import type { FastifyPluginAsync } from 'fastify';
import { notImplemented } from '../lib/member-guard.js';

// Tab badges (F6 + F7 spec §12.2): `Badges { unreadThreads, dealsYourTurn, notificationsUnread }`. L1 owns this file.

const badgeRoutes: FastifyPluginAsync = async (fastify) => {
  // F6F7-STUB(L1): L1-3 from `unreadThreadCount`, `dealsYourTurnCount`, `notificationUnreadCount`.
  fastify.get('/users/me/badges', { schema: { tags: ['Chat'] }, preHandler: [fastify.requireUser] }, async () => notImplemented());
};

export default badgeRoutes;
