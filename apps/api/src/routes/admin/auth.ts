import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
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

  fastify.get(
    '/admin/auth/me',
    { schema: { tags: ['Admin Auth'] }, preHandler: fastify.requireAdmin },
    async (request) => ({ data: request.admin }),
  );
};

export default adminAuthRoutes;
