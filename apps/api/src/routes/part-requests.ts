import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  MY_PART_REQUEST_TABS,
  PART_REQUEST_CLOSE_REASONS,
  PART_REQUEST_FEEDBACK_REASONS,
  PART_REQUEST_KINDS,
  PART_REQUEST_REPORT_REASONS,
  SELLER_PART_REQUEST_TABS,
} from '@mpm/shared-types';
import type { Tx } from '../db/index.js';
import { groupRateLimit } from '../lib/group-limit.js';
import { refuseViewer } from '../lib/member-guard.js';
import { perUser } from '../lib/per-user-limit.js';
import { runTx } from '../lib/tx-effects.js';
import { runIdempotent } from '../services/idempotency.service.js';
import { compareColumns } from '../services/part-requests/compare.service.js';
import { clearNotRelevant, setNotRelevant } from '../services/part-requests/feedback.service.js';
import { partRequestHome } from '../services/part-requests/home.service.js';
import { partRequestOptions } from '../services/part-requests/options.js';
import { parsePartRequestPatch, partRequestInputSchema } from '../services/part-requests/request-input.js';
import { deletePhotoKeys, presignRequestPhoto, requestPhotoUrls } from '../services/part-requests/request-photos.js';
import { getPartRequestView, listMatches, listMyPartRequests, listReplies } from '../services/part-requests/request-read.service.js';
import { reportPartRequest } from '../services/part-requests/request-report.service.js';
import {
  closePartRequest,
  editPartRequest,
  fulfilPartRequest,
  insertPartRequest,
  markPartRequestRead,
  prepareEdit,
  preparePartRequest,
  renewPartRequest,
} from '../services/part-requests/request.service.js';
import { listForSellers } from '../services/part-requests/seller-read.service.js';

// Part requests (F8 spec §12.2; lane A1): the buyer's requests and the sellers' read side. Thin controllers:
// Zod-parse → service → `{ data }`. Every business write but `read` refuses a viewer; **I** routes take an
// `Idempotency-Key` (`runIdempotent`). Post and edit finalise photos before their transaction: the new finals are
// deleted when it fails (or turns out to be a concurrent replay), the dropped ones after it commits.

const tags = ['Part requests'];

const idParams = z.object({ id: z.string().uuid() });
const presignBody = z.object({ contentType: z.string().max(100), contentLength: z.number().int().positive() }).strict();
const renewBody = z.object({ days: z.number().int() }).strict();
const closeBody = z.object({ reason: z.enum(PART_REQUEST_CLOSE_REASONS) }).strict();
const fulfilBody = z.object({ dealId: z.string().uuid().optional() }).strict();
const emptyBody = z.object({}).strict();
const mineQuery = z.object({ status: z.enum(MY_PART_REQUEST_TABS).default('active'), cursor: z.string().max(1000).optional() });
const sellersQuery = z.object({
  tab: z.enum(SELLER_PART_REQUEST_TABS).default('matched'),
  kind: z.enum(PART_REQUEST_KINDS).optional(),
  forListing: z.string().uuid().optional(),
  cursor: z.string().max(1000).optional(),
});
const feedbackBody = z.object({ reason: z.enum(PART_REQUEST_FEEDBACK_REASONS).nullable().optional() }).strict();
const reportBody = z
  .object({ reason: z.enum(PART_REQUEST_REPORT_REASONS), details: z.string().max(2000).nullable().optional() })
  .strict();

const partRequestRoutes: FastifyPluginAsync = async (fastify) => {
  const read = { schema: { tags }, preHandler: [fastify.requireUser] };
  /** Create, edit, renew, close, fulfil (I): 30 per 10 minutes per user across the group (plan D10). */
  const requestWrite = {
    schema: { tags },
    preHandler: [fastify.requireUser, refuseViewer, groupRateLimit('part_request', 30, 600)],
    config: { idempotent: true },
  };
  const feedback = { schema: { tags }, preHandler: [fastify.requireUser, refuseViewer, groupRateLimit('part_request_feedback', 60, 600)] };

  /** An idempotent write: the service in `runIdempotent`'s transaction, `{ data }` with `status`. */
  const act = (request: FastifyRequest, reply: FastifyReply, fn: (tx: Tx) => Promise<unknown>, status = 200) =>
    runIdempotent(request, reply, fastify, async (tx) => ({ status, body: { data: await fn(tx) } }));

  /**
   * A write whose photos were finalised before its transaction: the finals are deleted again when the transaction
   * fails, or when `runIdempotent` replayed a concurrent first use (nothing points at this request's copies).
   */
  const actWithFinals = async (
    request: FastifyRequest,
    reply: FastifyReply,
    finals: string[],
    fn: (tx: Tx) => Promise<unknown>,
    status = 200,
  ): Promise<FastifyReply> => {
    let sent: FastifyReply;
    try {
      sent = await act(request, reply, fn, status);
    } catch (err) {
      await deletePhotoKeys(finals, request.log);
      throw err;
    }
    if (reply.getHeader('idempotent-replay') === 'true') await deletePhotoKeys(finals, request.log);
    return sent;
  };

  // Public: settings for a guest (the No results card reads `reachN`); counts for a signed-in business.
  fastify.get('/part-requests/options', { schema: { tags }, preHandler: fastify.optionalUser }, async (request) => ({
    data: await partRequestOptions(fastify.db, request.user ?? null),
  }));

  fastify.post(
    '/part-requests/photos/presign',
    { schema: { tags }, preHandler: [fastify.requireUser, refuseViewer], config: perUser(30) },
    async (request) => {
      const body = presignBody.parse(request.body ?? {});
      return { data: await presignRequestPhoto(fastify.db, request.user!, body) };
    },
  );

  fastify.post('/part-requests', requestWrite, async (request, reply) => {
    const input = partRequestInputSchema.parse(request.body ?? {});
    const prepared = await preparePartRequest(fastify.db, request.user!, input);
    return actWithFinals(request, reply, prepared.photoKeys, (tx) => insertPartRequest(tx, request.user!, prepared), 201);
  });

  fastify.patch('/part-requests/:id', requestWrite, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const patch = parsePartRequestPatch(request.body);
    const prepared = await prepareEdit(fastify.db, request.user!, id, patch);
    let dropped: string[] = [];
    const sent = await actWithFinals(request, reply, prepared.photos?.added ?? [], async (tx) => {
      const done = await editPartRequest(tx, request.user!, id, patch, prepared);
      dropped = done.droppedPhotos;
      return done.view;
    });
    // After commit: the stored photos the edit left out (best-effort).
    await deletePhotoKeys(dropped, request.log);
    return sent;
  });

  fastify.post('/part-requests/:id/renew', requestWrite, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = renewBody.parse(request.body ?? {});
    return act(request, reply, (tx) => renewPartRequest(tx, request.user!, id, body));
  });
  fastify.post('/part-requests/:id/close', requestWrite, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = closeBody.parse(request.body ?? {});
    return act(request, reply, (tx) => closePartRequest(tx, request.user!, id, body));
  });
  fastify.post('/part-requests/:id/fulfil', requestWrite, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = fulfilBody.parse(request.body ?? {});
    return act(request, reply, (tx) => fulfilPartRequest(tx, request.user!, id, body));
  });

  // The buyer opened the page: marks its grouped rows and delivered replies seen. Not a business write (no viewer check).
  fastify.post('/part-requests/:id/read', read, async (request) => {
    const { id } = idParams.parse(request.params);
    emptyBody.parse(request.body ?? {});
    return { data: await runTx(fastify, (tx) => markPartRequestRead(tx, request.user!, id)) };
  });

  fastify.get('/part-requests/mine', read, async (request) => {
    const q = mineQuery.parse(request.query);
    return { data: await listMyPartRequests(fastify.db, request.user!, q) };
  });
  fastify.get('/part-requests/home', read, async (request) => ({ data: await partRequestHome(fastify.db, request.user!) }));
  fastify.get('/part-requests/for-sellers', read, async (request) => {
    const q = sellersQuery.parse(request.query);
    return { data: await listForSellers(fastify.db, request.user!, q) };
  });
  fastify.get('/part-requests/:id', read, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    reply.headers({ 'Cache-Control': 'private, no-store' });
    return { data: await getPartRequestView(fastify.db, request.user!, id) };
  });
  fastify.get('/part-requests/:id/replies', read, async (request) => {
    const { id } = idParams.parse(request.params);
    return { data: await listReplies(fastify.db, request.user!, id) };
  });
  fastify.get('/part-requests/:id/matches', read, async (request) => {
    const { id } = idParams.parse(request.params);
    return { data: await listMatches(fastify.db, request.user!, id) };
  });
  fastify.get('/part-requests/:id/compare', read, async (request) => {
    const { id } = idParams.parse(request.params);
    return { data: await compareColumns(fastify.db, request.user!, id) };
  });
  fastify.get('/part-requests/:id/photos', read, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    reply.headers({ 'Cache-Control': 'private, no-store' });
    return { data: await requestPhotoUrls(fastify.db, request.user!, id) };
  });

  fastify.post('/part-requests/:id/not-relevant', feedback, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = feedbackBody.parse(request.body ?? {});
    return { data: await runTx(fastify, (tx) => setNotRelevant(tx, request.user!, id, body)) };
  });
  fastify.delete('/part-requests/:id/not-relevant', feedback, async (request) => {
    const { id } = idParams.parse(request.params);
    return { data: await runTx(fastify, (tx) => clearNotRelevant(tx, request.user!, id)) };
  });

  fastify.post('/part-requests/:id/report', { schema: { tags }, preHandler: [fastify.requireUser, refuseViewer] }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = reportBody.parse(request.body ?? {});
    return { data: await runTx(fastify, (tx) => reportPartRequest(tx, request.user!, id, body)) };
  });
};

export default partRequestRoutes;
