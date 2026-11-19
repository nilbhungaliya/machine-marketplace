import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ADMIN_REASON_MAX, ADMIN_REASON_MIN, DEAL_LIMITS, DISPUTE_OUTCOMES, DISPUTE_STATUSES } from '@mpm/shared-types';
import { isStorableText } from '../../lib/spec-check.js';
import { runTx } from '../../lib/tx-effects.js';
import { getDispute, listDisputes, openDisputeCount } from '../../services/deals/deal-admin.service.js';
import { resolveDispute } from '../../services/deals/dispute.service.js';

// Admin Disputes (F6 + F7 spec §9.6, §16.1–§16.2). L3 owns this file (L3-3). Role: support. The resolve writes
// `audit_log` (`deal.dispute_resolve`) in its transaction (`runTx`, so the deal's emits go out after commit).

const tags = ['Admin disputes'];

const idParams = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  status: z.enum(DISPUTE_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
const storable = (s: string) => isStorableText(s);
const resolveBody = z
  .object({
    outcome: z.enum(DISPUTE_OUTCOMES),
    stockReturned: z.boolean().optional(),
    internalNote: z.string().trim().min(ADMIN_REASON_MIN).max(ADMIN_REASON_MAX).refine(storable, 'contains characters that cannot be saved'),
    messageToParties: z
      .string()
      .trim()
      .max(DEAL_LIMITS.messageToPartiesMax)
      .refine(storable, 'contains characters that cannot be saved')
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
  })
  .strict()
  .refine((b) => b.outcome !== 'cancelled' || b.stockReturned !== undefined, {
    message: 'Say whether the goods went back to the seller',
    path: ['stockReturned'],
  });

const adminDisputeRoutes: FastifyPluginAsync = async (fastify) => {
  const support = { schema: { tags }, preHandler: fastify.requireAdminRole('support') };

  fastify.get('/admin/disputes', support, async (request) => {
    const q = listQuery.parse(request.query);
    return { data: await listDisputes(fastify.db, q) };
  });

  fastify.get('/admin/disputes/count', support, async () => ({ data: await openDisputeCount(fastify.db) }));

  fastify.get('/admin/disputes/:id', support, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    reply.headers({ 'Cache-Control': 'private, no-store' });
    return { data: await getDispute(fastify.db, id) };
  });

  fastify.post('/admin/disputes/:id/resolve', support, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = resolveBody.parse(request.body ?? {});
    await runTx(fastify, (tx) =>
      resolveDispute(tx, request.admin!.adminId, id, {
        outcome: body.outcome,
        stockReturned: body.stockReturned ?? null,
        internalNote: body.internalNote,
        messageToParties: body.messageToParties ?? null,
      }),
    );
    return { data: await getDispute(fastify.db, id) };
  });
};

export default adminDisputeRoutes;
