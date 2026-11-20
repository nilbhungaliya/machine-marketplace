import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../lib/errors.js';
import { groupRateLimit } from '../lib/group-limit.js';
import { refuseViewer } from '../lib/member-guard.js';
import { perUser } from '../lib/per-user-limit.js';
import { partRequestOptions } from '../services/part-requests/options.js';

// Part requests (F8 spec §12.2; lane A1): the buyer's requests and the sellers' read side. Thin controllers:
// Zod-parse → service → `{ data }`. Every business write but `read` refuses a viewer; **I** routes take an
// `Idempotency-Key`. The preHandlers and limits are final; the handlers are C0 stubs (`501 NOT_IMPLEMENTED`).

const tags = ['Part requests'];

export const notImplemented = (): AppError => new AppError('Not implemented yet', 501, 'NOT_IMPLEMENTED');

const partRequestRoutes: FastifyPluginAsync = async (fastify) => {
  const read = { schema: { tags }, preHandler: [fastify.requireUser] };
  /** Create, edit, renew, close, fulfil (I): 30 per 10 minutes per user across the group (plan D10). */
  const requestWrite = {
    schema: { tags },
    preHandler: [fastify.requireUser, refuseViewer, groupRateLimit('part_request', 30, 600)],
    config: { idempotent: true },
  };
  const feedback = { schema: { tags }, preHandler: [fastify.requireUser, refuseViewer, groupRateLimit('part_request_feedback', 60, 600)] };

  // Public: settings for a guest (the No results card reads `reachN`); counts for a signed-in business.
  fastify.get('/part-requests/options', { schema: { tags }, preHandler: fastify.optionalUser }, async (request) => ({
    data: await partRequestOptions(fastify.db, request.user ?? null),
  }));

  fastify.post(
    '/part-requests/photos/presign',
    { schema: { tags }, preHandler: [fastify.requireUser, refuseViewer], config: perUser(30) },
    async () => {
      throw notImplemented(); // F8-STUB(A1)
    },
  );

  fastify.post('/part-requests', requestWrite, async () => {
    throw notImplemented(); // F8-STUB(A1)
  });
  fastify.patch('/part-requests/:id', requestWrite, async () => {
    throw notImplemented(); // F8-STUB(A1)
  });
  for (const action of ['renew', 'close', 'fulfil'] as const) {
    fastify.post(`/part-requests/:id/${action}`, requestWrite, async () => {
      throw notImplemented(); // F8-STUB(A1)
    });
  }

  // The buyer opened the page: marks its grouped rows and delivered replies seen. Not a business write (no viewer check).
  fastify.post('/part-requests/:id/read', read, async () => {
    throw notImplemented(); // F8-STUB(A1)
  });

  for (const path of ['/part-requests/mine', '/part-requests/home', '/part-requests/for-sellers', '/part-requests/:id']) {
    fastify.get(path, read, async () => {
      throw notImplemented(); // F8-STUB(A1)
    });
  }
  for (const sub of ['replies', 'matches', 'compare', 'photos'] as const) {
    fastify.get(`/part-requests/:id/${sub}`, read, async () => {
      throw notImplemented(); // F8-STUB(A1)
    });
  }

  fastify.post('/part-requests/:id/not-relevant', feedback, async () => {
    throw notImplemented(); // F8-STUB(A1)
  });
  fastify.delete('/part-requests/:id/not-relevant', feedback, async () => {
    throw notImplemented(); // F8-STUB(A1)
  });

  fastify.post('/part-requests/:id/report', { schema: { tags }, preHandler: [fastify.requireUser, refuseViewer] }, async () => {
    throw notImplemented(); // F8-STUB(A1)
  });
};

export default partRequestRoutes;
