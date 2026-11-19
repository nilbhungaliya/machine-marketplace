import type { FastifyPluginAsync } from 'fastify';
import { notImplemented } from '../../lib/member-guard.js';

// Admin Deals (F6 + F7 spec §16.1–§16.2): read-only. L3 owns this file (L3-3); C0-4b stubs. Roles: support, operations.

const tags = ['Admin deals'];

const adminDealRoutes: FastifyPluginAsync = async (fastify) => {
  const read = { schema: { tags }, preHandler: fastify.requireAdminRole('support', 'operations') };
  // F6F7-STUB(L3): L3-3 → `AdminDealRow` page.
  fastify.get('/admin/deals', read, async () => notImplemented());
  // F6F7-STUB(L3): L3-3 → `AdminDealDetail`.
  fastify.get('/admin/deals/:id', read, async () => notImplemented());
};

export default adminDealRoutes;
