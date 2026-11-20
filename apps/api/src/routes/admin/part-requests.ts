import type { FastifyPluginAsync } from 'fastify';
import { notImplemented } from '../part-requests.js';

// Admin part requests (F8 spec §14; lane A3): list, detail, photos, remove / restore with a reason (audit-logged).
// Moderators and support (super_admin passes every role check). The handlers are C0 stubs (`501 NOT_IMPLEMENTED`).

const tags = ['Admin: part requests'];

const adminPartRequestRoutes: FastifyPluginAsync = async (fastify) => {
  const staff = { schema: { tags }, preHandler: fastify.requireAdminRole('moderator', 'support') };

  for (const path of ['/admin/part-requests', '/admin/part-requests/:id', '/admin/part-requests/:id/photos']) {
    fastify.get(path, staff, async () => {
      throw notImplemented(); // F8-STUB(A3)
    });
  }
  for (const action of ['remove', 'restore'] as const) {
    fastify.post(`/admin/part-requests/:id/${action}`, staff, async () => {
      throw notImplemented(); // F8-STUB(A3)
    });
  }
};

export default adminPartRequestRoutes;
