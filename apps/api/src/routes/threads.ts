import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CHAT_LIMITS, CONVERSATION_REPORT_REASONS, QUICK_ENQUIRIES } from '@mpm/shared-types';
import { groupRateLimit } from '../lib/group-limit.js';
import { refuseViewer } from '../lib/member-guard.js';
import { perUser } from '../lib/per-user-limit.js';
import { ValidationError } from '../lib/errors.js';
import { isStorableText } from '../lib/spec-check.js';
import { runTx } from '../lib/tx-effects.js';
import { blockFromThread } from '../services/chat/block.service.js';
import { reportConversation } from '../services/chat/conversation-report.service.js';
import { sendEnquiry } from '../services/chat/enquiry.service.js';
import { listThreads, markRead, setArchived } from '../services/chat/inbox.service.js';
import { assertCanWrite, getThreadForParty } from '../services/chat/members.js';
import { checkMessageText, listMessages, messagePhotos, precheckSend, sendMessage, toThreadMessages } from '../services/chat/message.service.js';
import { finalizePrivatePhotos, presignPrivatePhoto } from '../services/chat/private-photo.js';
import { assertNotBlocked, getThreadDetail } from '../services/chat/thread.service.js';
import { shareContact } from '../services/consent/contact-consent.service.js';
import { runIdempotent } from '../services/idempotency.service.js';

// Threads, enquiries and messages (F6 + F7 spec §6, §12.2). Thin: Zod-parse → service → `{ data }`. Party checks read
// membership from the database (outsiders 404); viewers are refused every write except read and archive (P15).
// `POST /listings/:id/enquiry` lives here (P12).

const tags = ['Chat'];

const text = (max: number) => z.string().max(max * 2).refine(isStorableText, 'contains characters that cannot be stored');
const idParams = z.object({ id: z.string().uuid() });
const messageParams = z.object({ id: z.string().uuid(), messageId: z.string().uuid() });

const enquiryBody = z
  .object({
    quick: z.array(z.enum(QUICK_ENQUIRIES)).max(QUICK_ENQUIRIES.length).default([]),
    quantity: z.string().max(20).nullable().optional(),
    note: text(CHAT_LIMITS.noteMax).nullable().optional(),
    fit: z
      .object({
        brandId: z.string().uuid(),
        modelId: z.string().uuid().nullable().optional(),
        year: z.number().int().min(1900).max(2100).nullable().optional(),
      })
      // Names the client sends are dropped: the server resolves them (§6.3).
      .nullable()
      .optional(),
  })
  .strict();

const inboxQuery = z.object({
  filter: z.enum(['all', 'buying', 'selling', 'your_turn']).default('all'),
  archived: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  cursor: z.string().max(300).optional(),
});

const messagesQuery = z.object({ before: z.string().regex(/^\d{1,18}$/).transform(Number).optional() });

const sendBody = z
  .object({
    clientMessageId: z.string().uuid(),
    // Length after trim is the service's (`checkMessageText`); this cap only bounds the body (leading / trailing space).
    text: z.string().max(CHAT_LIMITS.messageMax + 200).refine(isStorableText, 'contains characters that cannot be stored').nullable().optional(),
    photoKeys: z.array(z.string().min(1).max(300)).max(20).optional(),
  })
  .strict();

const presignBody = z.object({ contentType: z.string().max(100), contentLength: z.number().int().positive() }).strict();
const readBody = z.object({ seq: z.union([z.number().int().nonnegative(), z.string().regex(/^\d{1,18}$/).transform(Number)]) }).strict();

const reportBody = z
  .object({
    reason: z.enum(CONVERSATION_REPORT_REASONS),
    details: text(CHAT_LIMITS.reportDetailsMax).nullable().optional(),
    block: z.boolean().optional(),
  })
  .strict();

const threadRoutes: FastifyPluginAsync = async (fastify) => {
  const read = { schema: { tags }, preHandler: [fastify.requireUser] };
  // Archive and read are per-user state: viewers may (P15).
  const perUserState = { schema: { tags }, preHandler: [fastify.requireUser] };
  const write = { schema: { tags }, preHandler: [fastify.requireUser, refuseViewer] };
  const idempotentWrite = { ...write, config: { idempotent: true } };
  const user = (request: FastifyRequest) => request.user!;

  // §6.1, §6.3 → `{ threadId, message }`.
  fastify.post('/listings/:id/enquiry', idempotentWrite, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = enquiryBody.parse(request.body ?? {});
    return runIdempotent(request, reply, fastify, async (tx) => ({
      status: 200,
      body: { data: await sendEnquiry(tx, user(request), id, body) },
    }));
  });

  // §6.10 → `InboxPage`.
  fastify.get('/threads', read, async (request) => {
    const q = inboxQuery.parse(request.query ?? {});
    return { data: await listThreads(fastify.db, user(request), q) };
  });

  // → `ThreadDetail`.
  fastify.get('/threads/:id', read, async (request) => {
    const { id } = idParams.parse(request.params);
    return { data: await getThreadDetail(fastify.db, user(request), id) };
  });

  // → `ThreadMessage[]`, newest first, 30 a page (`?before=<seq>`).
  fastify.get('/threads/:id/messages', read, async (request) => {
    const { id } = idParams.parse(request.params);
    const { before } = messagesQuery.parse(request.query ?? {});
    return { data: await listMessages(fastify.db, user(request), id, before) };
  });

  // §6.4, §6.8 → `ThreadMessage`. Photos are finalized before the transaction; a retry (same `Idempotency-Key`, or the
  // same `clientMessageId`) replays without touching storage (P11; the idempotency plugin replays a stored reply first).
  fastify.post(
    '/threads/:id/messages',
    {
      schema: { tags },
      preHandler: [fastify.requireUser, refuseViewer, groupRateLimit('message', CHAT_LIMITS.messagesPerMinute, 60)],
      config: { idempotent: true },
    },
    async (request, reply) => {
      const { id } = idParams.parse(request.params);
      const body = sendBody.parse(request.body);
      let photoKeys: string[] = [];
      if (body.photoKeys && body.photoKeys.length > 0) {
        const { thread, reader, retried } = await precheckSend(fastify.db, user(request), id, body.clientMessageId);
        if (!retried) {
          if (body.photoKeys.length > CHAT_LIMITS.photosPerMessage) {
            throw new ValidationError('Too many photos', { max: CHAT_LIMITS.photosPerMessage }, 'TOO_MANY_PHOTOS');
          }
          // The caption is checked before any upload is consumed.
          checkMessageText(body.text, body.photoKeys.length);
        }
        if (retried) {
          const [message] = await toThreadMessages(fastify.db, [retried], reader, thread);
          return runIdempotent(request, reply, fastify, async () => ({ status: 200, body: { data: message } }));
        }
        photoKeys = await finalizePrivatePhotos(reader.businessId, body.photoKeys, { kind: 'chat', threadId: thread.id });
      }
      return runIdempotent(request, reply, fastify, async (tx) => ({
        status: 200,
        body: { data: await sendMessage(tx, user(request), id, { clientMessageId: body.clientMessageId, text: body.text, photoKeys }) },
      }));
    },
  );

  // §6.8 → `{ url, key, expiresAt }`.
  fastify.post('/threads/:id/photos/presign', { ...write, config: perUser(30) }, async (request) => {
    const { id } = idParams.parse(request.params);
    const { contentType, contentLength } = presignBody.parse(request.body);
    const { thread, reader } = await getThreadForParty(fastify.db, user(request), id);
    assertCanWrite(reader);
    await assertNotBlocked(fastify.db, thread);
    const signed = await presignPrivatePhoto(reader.businessId, contentType, contentLength);
    return { data: { url: signed.url, key: signed.key, expiresAt: signed.expiresAt.toISOString() } };
  });

  // → `{ photos: SignedPhoto[] }`, fresh signed URLs (members only).
  fastify.get('/threads/:id/messages/:messageId/photos', read, async (request) => {
    const { id, messageId } = messageParams.parse(request.params);
    return { data: { photos: await messagePhotos(fastify.db, user(request), id, messageId) } };
  });

  // §5.3 → `{ unread }`.
  fastify.post('/threads/:id/read', perUserState, async (request) => {
    const { id } = idParams.parse(request.params);
    const { seq } = readBody.parse(request.body);
    return { data: await runTx(fastify, (tx) => markRead(tx, user(request), id, seq)) };
  });

  // §6.10 archive / unarchive, per user.
  fastify.put('/threads/:id/archive', perUserState, async (request) => {
    const { id } = idParams.parse(request.params);
    return { data: await runTx(fastify, (tx) => setArchived(tx, user(request), id, true)) };
  });
  fastify.delete('/threads/:id/archive', perUserState, async (request) => {
    const { id } = idParams.parse(request.params);
    return { data: await runTx(fastify, (tx) => setArchived(tx, user(request), id, false)) };
  });

  // §6.6 → `{ revealed, number }`.
  fastify.post('/threads/:id/share-contact', idempotentWrite, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    return runIdempotent(request, reply, fastify, async (tx) => {
      const { thread, reader } = await getThreadForParty(tx, user(request), id);
      return { status: 200, body: { data: await shareContact(tx, thread, reader) } };
    });
  });

  // §6.12 → `{ reported: true }`.
  fastify.post('/threads/:id/report', write, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = reportBody.parse(request.body);
    return { data: await runTx(fastify, (tx) => reportConversation(tx, user(request), id, body)) };
  });

  // §6.11 → `{ blocked: true }`.
  fastify.post('/threads/:id/block', write, async (request) => {
    const { id } = idParams.parse(request.params);
    return { data: await runTx(fastify, (tx) => blockFromThread(tx, user(request), id)) };
  });

};

export default threadRoutes;
