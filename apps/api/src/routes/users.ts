import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { completeProfile } from '../services/user.service.js';

const profileBody = z.object({
  name: z.string().trim().min(2).max(80),
  businessName: z.string().trim().min(2).max(120),
});

const usersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.patch(
    '/users/me',
    { schema: { tags: ['Users'] }, preHandler: fastify.requireUser },
    async (request) => {
      const body = profileBody.parse(request.body);
      return { data: await completeProfile(fastify.db, request.user!.userId, body) };
    },
  );
};

export default usersRoutes;
