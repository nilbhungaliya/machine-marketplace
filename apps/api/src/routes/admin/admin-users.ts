import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ADMIN_ROLES } from '@mpm/shared-types';
import { reasonBody } from '../../lib/admin-text.js';
import {
  deactivateAdmin,
  inviteAdmin,
  issuePasswordLink,
  listAdminUsers,
  reactivateAdmin,
  signOutAdmin,
  updateAdmin,
} from '../../services/admin-users/admin-users.service.js';

// AD7 admin users (admin close-out §11.2; lane A2): super_admin only (`requireAdminRole()` with no roles). Every
// mutation writes `audit_log`; role change, deactivate, password link and sign out end the admin's sessions.
//   GET /admin/admin-users → AdminUserRow[]
//   POST /admin/admin-users { name, email, role } → AdminUserCreateResult
//   PATCH /admin/admin-users/:id { name?, role? } → AdminUserRow
//   POST /admin/admin-users/:id/deactivate { reason } | /reactivate { reason } → AdminUserRow
//   POST /admin/admin-users/:id/password-link → AdminPasswordLink (the panel builds `/set-password#t=<token>`, D13)
//   POST /admin/admin-users/:id/sign-out → AdminUserRow

const tags = ['Admin users'];

const idParams = z.object({ id: z.string().uuid() });
const name = z.string().trim().min(2).max(100);
const inviteBody = z
  .object({ name, email: z.string().trim().toLowerCase().email().max(254), role: z.enum(ADMIN_ROLES) })
  .strict();
const updateBody = z
  .object({ name: name.optional(), role: z.enum(ADMIN_ROLES).optional() })
  .strict()
  .refine((b) => b.name !== undefined || b.role !== undefined, 'Send a name or a role');
const emptyBody = z.object({}).strict();

const adminUsersRoutes: FastifyPluginAsync = async (fastify) => {
  const superAdmin = { schema: { tags }, preHandler: fastify.requireAdminRole() };

  fastify.get('/admin/admin-users', superAdmin, async () => ({ data: await listAdminUsers(fastify.db) }));

  fastify.post('/admin/admin-users', superAdmin, async (request) => {
    const body = inviteBody.parse(request.body ?? {});
    return { data: await inviteAdmin(fastify, request.admin!, body) };
  });

  fastify.patch('/admin/admin-users/:id', superAdmin, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = updateBody.parse(request.body ?? {});
    return { data: await updateAdmin(fastify, request.admin!, id, body) };
  });

  fastify.post('/admin/admin-users/:id/deactivate', superAdmin, async (request) => {
    const { id } = idParams.parse(request.params);
    const { reason } = reasonBody.parse(request.body ?? {});
    return { data: await deactivateAdmin(fastify, request.admin!, id, { reason }) };
  });

  fastify.post('/admin/admin-users/:id/reactivate', superAdmin, async (request) => {
    const { id } = idParams.parse(request.params);
    const { reason } = reasonBody.parse(request.body ?? {});
    return { data: await reactivateAdmin(fastify, request.admin!, id, { reason }) };
  });

  fastify.post('/admin/admin-users/:id/password-link', superAdmin, async (request) => {
    const { id } = idParams.parse(request.params);
    emptyBody.parse(request.body ?? {});
    return { data: await issuePasswordLink(fastify, request.admin!, id) };
  });

  fastify.post('/admin/admin-users/:id/sign-out', superAdmin, async (request) => {
    const { id } = idParams.parse(request.params);
    emptyBody.parse(request.body ?? {});
    return { data: await signOutAdmin(fastify, request.admin!, id) };
  });
};

export default adminUsersRoutes;
