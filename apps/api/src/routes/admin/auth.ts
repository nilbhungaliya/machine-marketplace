import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { loginAdmin } from '../../services/admin-auth.service.js';

const loginBody = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

// Thin controller: validate → service → `{ data }`. No business logic here.
const adminAuthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/admin/auth/login',
    { schema: { tags: ['Admin Auth'] }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const { email, password } = loginBody.parse(request.body);
      return { data: await loginAdmin(fastify.db, email, password) };
    },
  );

  // The session as the admin row says now (admin close-out R13): the row's role and token version, never the token's.
  fastify.get(
    '/admin/auth/me',
    { schema: { tags: ['Admin Auth'] }, preHandler: fastify.requireAdmin },
    async (request) => ({ data: request.admin }),
  );

  // Admin close-out §11.2 (lane A2). Password links: public, 10 / min per IP; the token travels in the body only.
  //   POST /admin/auth/password/inspect { token } → PasswordLinkInfo
  //   POST /admin/auth/password/set { token, password } → { ok } (bumps the admin's token version)
  //   POST /admin/auth/password/change { current, password } → { token } (a fresh token of the new version)
  //   POST /admin/auth/sign-out-everywhere → { ok } (bumps the caller's own token version)
  // AC-STUB(A2): these four answer 501 until lane A2 builds them.
  const notImplemented = (): never => {
    throw new AppError('Not implemented yet', 501, 'NOT_IMPLEMENTED');
  };
  const publicLink = { schema: { tags: ['Admin Auth'] }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };
  fastify.post('/admin/auth/password/inspect', publicLink, async () => notImplemented());
  fastify.post('/admin/auth/password/set', publicLink, async () => notImplemented());
  const signedIn = { schema: { tags: ['Admin Auth'] }, preHandler: fastify.requireAdmin };
  fastify.post('/admin/auth/password/change', signedIn, async () => notImplemented());
  fastify.post('/admin/auth/sign-out-everywhere', signedIn, async () => notImplemented());
};

export default adminAuthRoutes;
