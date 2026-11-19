import type { FastifyPluginAsync } from 'fastify';
import { notImplemented } from '../../lib/member-guard.js';

// Admin Disputes (F6 + F7 spec §9.5, §16.1–§16.2). L3 owns this file (L3-3); C0-4b stubs. Role: support. The resolve
// writes `audit_log` (`deal.dispute_resolve`).

const tags = ['Admin disputes'];

const adminDisputeRoutes: FastifyPluginAsync = async (fastify) => {
  const support = { schema: { tags }, preHandler: fastify.requireAdminRole('support') };
  // F6F7-STUB(L3): L3-3 → `AdminDisputeRow` page.
  fastify.get('/admin/disputes', support, async () => notImplemented());
  // F6F7-STUB(L3): L3-3 → `{ open }` for the nav badge.
  fastify.get('/admin/disputes/count', support, async () => notImplemented());
  // F6F7-STUB(L3): L3-3 → `AdminDisputeDetail`.
  fastify.get('/admin/disputes/:id', support, async () => notImplemented());
  // F6F7-STUB(L3): L3-3 resolve.
  fastify.post('/admin/disputes/:id/resolve', support, async () => notImplemented());
};

export default adminDisputeRoutes;
