import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AUDIT_PAGE_SIZES, FRAUD_SIGNAL_KINDS, FRAUD_SIGNAL_STATUSES } from '@mpm/shared-types';
import { getFraudSignal, listFraudSignals, reviewFraudSignal } from '../../services/fraud/admin.service.js';

// AD6 fraud signals (admin close-out §8.3; lane A3): moderator, support. The review writes `audit_log`
// (`fraud_signal.review`).
//   GET /admin/fraud-signals?status&kind&businessId&page&pageSize → FraudSignalPage (status `all` for every status)
//   GET /admin/fraud-signals/:id → FraudSignalDetail
//   POST /admin/fraud-signals/:id/review { outcome: 'dismissed' | 'actioned', note } → FraudSignalRow

const tags = ['Admin fraud signals'];
const listQuery = z
  .object({
    status: z.enum([...FRAUD_SIGNAL_STATUSES, 'all']).optional(),
    kind: z.enum(FRAUD_SIGNAL_KINDS).optional(),
    businessId: z.string().uuid().optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .refine((n) => (AUDIT_PAGE_SIZES as readonly number[]).includes(n), { message: 'pageSize must be 25, 50 or 100' })
      .default(25),
  })
  .strict();
const params = z.object({ id: z.string().uuid() });
const reviewBody = z.object({ outcome: z.enum(['dismissed', 'actioned']), note: z.string().max(2000) }).strict();

const adminFraudSignalRoutes: FastifyPluginAsync = async (fastify) => {
  const staff = { schema: { tags }, preHandler: fastify.requireAdminRole('moderator', 'support') };
  fastify.get('/admin/fraud-signals', staff, async (request) => {
    return { data: await listFraudSignals(fastify.db, listQuery.parse(request.query ?? {})) };
  });
  fastify.get('/admin/fraud-signals/:id', staff, async (request) => {
    const { id } = params.parse(request.params);
    return { data: await getFraudSignal(fastify.db, id) };
  });
  fastify.post('/admin/fraud-signals/:id/review', staff, async (request) => {
    const { id } = params.parse(request.params);
    const body = reviewBody.parse(request.body);
    return { data: await reviewFraudSignal(fastify, request.admin!, id, body) };
  });
};

export default adminFraudSignalRoutes;
