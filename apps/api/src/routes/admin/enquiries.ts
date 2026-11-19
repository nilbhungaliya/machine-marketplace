import type { FastifyPluginAsync } from 'fastify';
import { notImplemented } from '../../lib/member-guard.js';

// Admin Enquiries & offers (F6 + F7 spec §16.1–§16.2): read-only, no message or note text. L2 owns this file (L2-5);
// C0-4b stubs. Roles: support, operations (super_admin passes).

const tags = ['Admin enquiries'];

const adminEnquiryRoutes: FastifyPluginAsync = async (fastify) => {
  const read = { schema: { tags }, preHandler: fastify.requireAdminRole('support', 'operations') };
  // F6F7-STUB(L2): L2-5 → `AdminEnquiryRow` page.
  fastify.get('/admin/enquiries', read, async () => notImplemented());
  // F6F7-STUB(L2): L2-5 → `AdminEnquiryDetail` (the offer chain).
  fastify.get('/admin/enquiries/:threadId', read, async () => notImplemented());
};

export default adminEnquiryRoutes;
