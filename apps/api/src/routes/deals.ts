import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DEAL_FULFILMENT, DEAL_LIMITS, DEAL_PAYMENT_METHODS, DISPUTE_CATEGORIES } from '@mpm/shared-types';
import type { Tx } from '../db/index.js';
import { groupRateLimit } from '../lib/group-limit.js';
import { refuseViewer } from '../lib/member-guard.js';
import { perUser } from '../lib/per-user-limit.js';
import { isRealDate, isStorableText } from '../lib/spec-check.js';
import { idempotencyContextOf } from '../plugins/idempotency.js';
import { deleteObject } from '../lib/storage.js';
import { DEAL_SIDE_FILTERS, DEAL_TABS, getDealView, listDeals } from '../services/deals/deal-read.service.js';
import {
  acceptCancelRequest,
  cancelDeal,
  clearCancelRequest,
  confirmReceived,
  editNotes,
  finalizeDealPhotos,
  handOver,
  presignDealPhoto,
  requestCancel,
} from '../services/deals/deal.service.js';
import { reportProblem } from '../services/deals/dispute.service.js';
import { IdempotencyKeyReusedError, readStoredResponse, runIdempotent } from '../services/idempotency.service.js';

// Deals (F6 + F7 spec §9, §12.2). Thin: Zod-parse → service → `{ data }`. Every deal write counts in the `deal` group
// (20 / min) and takes an optional `Idempotency-Key` (P11); photo actions check for a stored reply before finalizing.

const tags = ['Deals'];

const idParams = z.object({ id: z.string().uuid() });
const storable = (s: string) => isStorableText(s);
/** Trimmed text up to `max`; `''` and null clear it. */
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(storable, 'contains characters that cannot be saved')
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

const listQuery = z.object({
  tab: z.enum(DEAL_TABS).default('active'),
  side: z.enum(DEAL_SIDE_FILTERS).default('all'),
  cursor: z.string().max(500).optional(),
});

const notesBody = z
  .object({
    version: z.number().int().min(1),
    paymentMethod: z.enum(DEAL_PAYMENT_METHODS).nullable().optional(),
    /** Paise as a decimal string (P4). */
    advancePaise: z
      .string()
      .regex(/^\d{1,15}$/, 'must be a whole number of paise')
      .transform((v) => BigInt(v))
      .nullable()
      .optional(),
    fulfilment: z.enum(DEAL_FULFILMENT).nullable().optional(),
    expectedOn: z.string().refine(isRealDate, 'must be a date (YYYY-MM-DD)').nullable().optional(),
    text: optText(DEAL_LIMITS.dealNotesMax),
  })
  .strict();

const presignBody = z.object({ contentType: z.string().max(100), contentLength: z.number().int().positive() });
const handOverBody = z.object({ photoKey: z.string().max(200).optional(), note: optText(DEAL_LIMITS.handoverNoteMax) }).strict();
const cancelBody = z.object({ reason: z.string().max(60), note: optText(DEAL_LIMITS.cancelNoteMax) }).strict();
const cancelRequestBody = z.object({ reason: z.string().max(60).optional() }).strict();
const emptyBody = z.object({}).strict();
const problemBody = z
  .object({
    category: z.enum(DISPUTE_CATEGORIES),
    description: z
      .string()
      .trim()
      .min(DEAL_LIMITS.disputeDescriptionMin)
      .max(DEAL_LIMITS.disputeDescriptionMax)
      .refine(storable, 'contains characters that cannot be saved'),
    photoKeys: z.array(z.string().max(200)).max(DEAL_LIMITS.disputePhotosMax).optional(),
  })
  .strict();

const dealRoutes: FastifyPluginAsync = async (fastify) => {
  const read = { schema: { tags }, preHandler: [fastify.requireUser] };
  const write = {
    schema: { tags },
    preHandler: [fastify.requireUser, refuseViewer, groupRateLimit('deal', DEAL_LIMITS.dealActionsPerMinute, 60)],
    config: { idempotent: true },
  };

  /** A write: the service in `runIdempotent` (its transaction), replying `{ data }` with status 200. */
  const act = (request: FastifyRequest, reply: FastifyReply, fn: (tx: Tx) => Promise<unknown>) =>
    runIdempotent(request, reply, fastify, async (tx) => ({ status: 200, body: { data: await fn(tx) } }));

  /**
   * A write that finalizes photos before its transaction (P11, plan review m3): a stored reply for this key is replayed
   * without touching storage; otherwise the uploads are finalized, then the transaction runs, and the finals are deleted
   * again if it fails or turns out to be a replay of a concurrent first use (nothing points at them).
   */
  const actWithPhotos = async (
    request: FastifyRequest,
    reply: FastifyReply,
    dealId: string,
    keys: string[],
    fn: (tx: Tx, finals: string[]) => Promise<unknown>,
  ) => {
    const ctx = idempotencyContextOf(request);
    if (keys.length > 0 && ctx) {
      const stored = await readStoredResponse(fastify.db, ctx.scope, ctx.key);
      if (stored) {
        if (stored.requestHash !== ctx.requestHash) throw new IdempotencyKeyReusedError();
        ctx.replayed = true;
        return reply.code(stored.status).header('Idempotent-Replay', 'true').send(stored.body);
      }
    }
    const finals = await finalizeDealPhotos(fastify.db, request.user!, dealId, keys);
    const dropFinals = () => Promise.allSettled(finals.map((k) => deleteObject(k)));
    let sent: FastifyReply;
    try {
      sent = await act(request, reply, (tx) => fn(tx, finals));
    } catch (err) {
      await dropFinals();
      throw err;
    }
    // A concurrent first use stored its reply while we finalized: `runIdempotent` replayed it, so nothing points at
    // this request's finals (the stored reply names the first use's own copies).
    if (reply.getHeader('idempotent-replay') === 'true') await dropFinals();
    return sent;
  };

  fastify.get('/deals', read, async (request) => {
    const q = listQuery.parse(request.query);
    return { data: await listDeals(fastify.db, request.user!, q) };
  });

  fastify.get('/deals/:id', read, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    reply.headers({ 'Cache-Control': 'private, no-store' });
    return { data: await getDealView(fastify.db, request.user!, id) };
  });

  fastify.patch('/deals/:id/notes', write, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = notesBody.parse(request.body ?? {});
    return act(request, reply, (tx) => editNotes(tx, request.user!, id, body));
  });

  fastify.post(
    '/deals/:id/photos/presign',
    { schema: { tags }, preHandler: [fastify.requireUser, refuseViewer], config: perUser(DEAL_LIMITS.photoPresignPer10Min) },
    async (request) => {
      const { id } = idParams.parse(request.params);
      const body = presignBody.parse(request.body ?? {});
      return { data: await presignDealPhoto(fastify.db, request.user!, id, body.contentType, body.contentLength) };
    },
  );

  fastify.post('/deals/:id/hand-over', write, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = handOverBody.parse(request.body ?? {});
    const keys = body.photoKey ? [body.photoKey] : [];
    return actWithPhotos(request, reply, id, keys, (tx, finals) =>
      handOver(tx, request.user!, id, { photoKey: finals[0] ?? null, note: body.note ?? null }),
    );
  });

  fastify.post('/deals/:id/confirm-received', write, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    emptyBody.parse(request.body ?? {});
    return act(request, reply, (tx) => confirmReceived(tx, request.user!, id));
  });

  fastify.post('/deals/:id/cancel', write, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = cancelBody.parse(request.body ?? {});
    return act(request, reply, (tx) => cancelDeal(tx, request.user!, id, { reason: body.reason, note: body.note ?? null }));
  });

  fastify.post('/deals/:id/cancel-request', write, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = cancelRequestBody.parse(request.body ?? {});
    return act(request, reply, (tx) => requestCancel(tx, request.user!, id, { reason: body.reason ?? null }));
  });

  fastify.post('/deals/:id/cancel-request/accept', write, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    emptyBody.parse(request.body ?? {});
    return act(request, reply, (tx) => acceptCancelRequest(tx, request.user!, id));
  });

  fastify.post('/deals/:id/cancel-request/clear', write, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    emptyBody.parse(request.body ?? {});
    return act(request, reply, (tx) => clearCancelRequest(tx, request.user!, id));
  });

  fastify.post('/deals/:id/problem', write, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = problemBody.parse(request.body ?? {});
    return actWithPhotos(request, reply, id, body.photoKeys ?? [], (tx, finals) =>
      reportProblem(tx, request.user!, id, { category: body.category, description: body.description, photoKeys: finals }),
    );
  });
};

export default dealRoutes;
