import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../../lib/errors.js';

// AD7 admin users (admin close-out §11.2; lane A2): super_admin only (`requireAdminRole()` with no roles). Every
// mutation writes `audit_log`; role change, deactivate, password link and sign out end the admin's sessions.
//   GET /admin/admin-users → AdminUserRow[]
//   POST /admin/admin-users { name, email, role } → AdminUserCreateResult
//   PATCH /admin/admin-users/:id { name?, role? } → AdminUserRow
//   POST /admin/admin-users/:id/deactivate { reason } | /reactivate → AdminUserRow
//   POST /admin/admin-users/:id/password-link → AdminPasswordLink
//   POST /admin/admin-users/:id/sign-out → AdminUserRow

const tags = ['Admin users'];
// AC-STUB(A2): every handler below answers 501 until lane A2 builds it.
const notImplemented = (): never => {
  throw new AppError('Not implemented yet', 501, 'NOT_IMPLEMENTED');
};

const adminUsersRoutes: FastifyPluginAsync = async (fastify) => {
  const superAdmin = { schema: { tags }, preHandler: fastify.requireAdminRole() };
  fastify.get('/admin/admin-users', superAdmin, async () => notImplemented());
  fastify.post('/admin/admin-users', superAdmin, async () => notImplemented());
  fastify.patch('/admin/admin-users/:id', superAdmin, async () => notImplemented());
  fastify.post('/admin/admin-users/:id/deactivate', superAdmin, async () => notImplemented());
  fastify.post('/admin/admin-users/:id/reactivate', superAdmin, async () => notImplemented());
  fastify.post('/admin/admin-users/:id/password-link', superAdmin, async () => notImplemented());
  fastify.post('/admin/admin-users/:id/sign-out', superAdmin, async () => notImplemented());
};

export default adminUsersRoutes;
