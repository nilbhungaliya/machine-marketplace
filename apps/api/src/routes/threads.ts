import type { FastifyPluginAsync } from 'fastify';
import { CHAT_LIMITS } from '@mpm/shared-types';
import { groupRateLimit } from '../lib/group-limit.js';
import { notImplemented, refuseViewer } from '../lib/member-guard.js';
import { perUser } from '../lib/per-user-limit.js';

// Threads, enquiries and messages (F6 + F7 spec §6, §12.2). L1 owns this file; the handlers are C0-4b stubs
// (`501 NOT_IMPLEMENTED`) registered with their final guards. `POST /listings/:id/enquiry` lives here (P12).

const tags = ['Chat'];

const threadRoutes: FastifyPluginAsync = async (fastify) => {
  const read = { schema: { tags }, preHandler: [fastify.requireUser] };
  // Archive and read are per-user state: viewers may (P15).
  const perUserState = { schema: { tags }, preHandler: [fastify.requireUser] };
  const write = { schema: { tags }, preHandler: [fastify.requireUser, refuseViewer] };
  const idempotentWrite = { ...write, config: { idempotent: true } };

  // F6F7-STUB(L1): L1-1 enquiry → `{ threadId, message }`.
  fastify.post('/listings/:id/enquiry', idempotentWrite, async () => notImplemented());
  // F6F7-STUB(L1): L1-3 inbox → `InboxPage`.
  fastify.get('/threads', read, async () => notImplemented());
  // F6F7-STUB(L1): L1-1 → `ThreadDetail`.
  fastify.get('/threads/:id', read, async () => notImplemented());
  // F6F7-STUB(L1): L1-1 → `ThreadMessage[]`.
  fastify.get('/threads/:id/messages', read, async () => notImplemented());
  // F6F7-STUB(L1): L1-1 / L1-2 → `ThreadMessage`. Idempotent so a photo send's retry replays without touching storage (P11).
  fastify.post(
    '/threads/:id/messages',
    {
      schema: { tags },
      preHandler: [fastify.requireUser, refuseViewer, groupRateLimit('message', CHAT_LIMITS.messagesPerMinute, 60)],
      config: { idempotent: true },
    },
    async () => notImplemented(),
  );
  // F6F7-STUB(L1): L1-2 → `{ url, key, expiresAt }`.
  fastify.post('/threads/:id/photos/presign', { ...write, config: perUser(30) }, async () => notImplemented());
  // F6F7-STUB(L1): L1-2 → fresh signed URLs.
  fastify.get('/threads/:id/messages/:messageId/photos', read, async () => notImplemented());
  // F6F7-STUB(L1): L1-3 → `{ unread: 0 }`.
  fastify.post('/threads/:id/read', perUserState, async () => notImplemented());
  // F6F7-STUB(L1): L1-3 archive / unarchive.
  fastify.put('/threads/:id/archive', perUserState, async () => notImplemented());
  fastify.delete('/threads/:id/archive', perUserState, async () => notImplemented());
  // F6F7-STUB(L1): L1-4 → `{ revealed, number? }`.
  fastify.post('/threads/:id/share-contact', idempotentWrite, async () => notImplemented());
  // F6F7-STUB(L1): L1-5 → `{ reported: true }`.
  fastify.post('/threads/:id/report', write, async () => notImplemented());
  // F6F7-STUB(L1): L1-5 → `{ blocked: true }`.
  fastify.post('/threads/:id/block', write, async () => notImplemented());
};

export default threadRoutes;
