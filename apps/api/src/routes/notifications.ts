import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { LANGUAGES } from '@mpm/shared-types';
import { runTx } from '../lib/tx-effects.js';
import {
  getPushPreference,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationUnreadCount,
  setPushPreference,
  setUserLanguage,
} from '../services/notifications/notification-read.service.js';

// In-app notifications, preferences and the app language (F6 + F7 spec §11, §12.2). L4 owns this file.
// Per-user state: viewers may use every route here.

const tags = ['Notifications'];

const idParams = z.object({ id: z.string().uuid() });
const cursorQuery = z.object({ cursor: z.string().max(500).optional() });
const preferencesBody = z.object({ push: z.boolean() }).strict();
const languageBody = z.object({ language: z.enum(LANGUAGES) }).strict();

const notificationRoutes: FastifyPluginAsync = async (fastify) => {
  const user = { schema: { tags }, preHandler: [fastify.requireUser] };

  fastify.get('/notifications', user, async (request) => {
    const { cursor } = cursorQuery.parse(request.query);
    return { data: await listNotifications(fastify.db, request.user!.userId, cursor) };
  });

  fastify.get('/notifications/unread-count', user, async (request) => ({
    data: { unreadCount: await notificationUnreadCount(fastify.db, request.user!.userId) },
  }));

  fastify.post('/notifications/:id/read', user, async (request) => {
    const { id } = idParams.parse(request.params);
    return { data: await runTx(fastify, (tx) => markNotificationRead(tx, request.user!.userId, id)) };
  });

  fastify.post('/notifications/read-all', user, async (request) => ({
    data: await runTx(fastify, (tx) => markAllNotificationsRead(tx, request.user!.userId)),
  }));

  // One push switch (review change 29).
  fastify.get('/notifications/preferences', user, async (request) => ({
    data: await getPushPreference(fastify.db, request.user!.userId),
  }));
  fastify.put('/notifications/preferences', user, async (request) => {
    const { push } = preferencesBody.parse(request.body ?? {});
    return { data: await setPushPreference(fastify.db, request.user!.userId, push) };
  });

  // Server-rendered text (the list and pushes) follows the app's language.
  fastify.put('/users/me/language', user, async (request) => {
    const { language } = languageBody.parse(request.body ?? {});
    return { data: await setUserLanguage(fastify.db, request.user!.userId, language) };
  });
};

export default notificationRoutes;
