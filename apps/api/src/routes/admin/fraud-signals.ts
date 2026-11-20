import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../../lib/errors.js';

// AD6 fraud signals (admin close-out §8.3; lane A3): moderator, support. The review writes `audit_log`
// (`fraud_signal.review`).
//   GET /admin/fraud-signals?status&kind&businessId&page&pageSize → FraudSignalPage
//   GET /admin/fraud-signals/:id → FraudSignalDetail
//   POST /admin/fraud-signals/:id/review { outcome: 'dismissed' | 'actioned', note } → FraudSignalRow

const tags = ['Admin fraud signals'];
// AC-STUB(A3): every handler below answers 501 until lane A3 builds it.
const notImplemented = (): never => {
  throw new AppError('Not implemented yet', 501, 'NOT_IMPLEMENTED');
};

const adminFraudSignalRoutes: FastifyPluginAsync = async (fastify) => {
  const staff = { schema: { tags }, preHandler: fastify.requireAdminRole('moderator', 'support') };
  fastify.get('/admin/fraud-signals', staff, async () => notImplemented());
  fastify.get('/admin/fraud-signals/:id', staff, async () => notImplemented());
  fastify.post('/admin/fraud-signals/:id/review', staff, async () => notImplemented());
};

export default adminFraudSignalRoutes;
