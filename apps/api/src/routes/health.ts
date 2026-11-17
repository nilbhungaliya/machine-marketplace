import type { FastifyPluginAsync } from 'fastify';

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health', { schema: { tags: ['Health'] } }, async () => ({
    data: { status: 'ok', time: new Date().toISOString() },
  }));
};

export default healthRoutes;
