import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import errorHandlerPlugin from './plugins/error-handler.js';
import dbPlugin from './plugins/db.js';
import redisPlugin from './plugins/redis.js';
import rateLimitPlugin from './plugins/rate-limit.js';
import authPlugin from './plugins/auth.js';
import healthRoutes from './routes/health.js';
import adminAuthRoutes from './routes/admin/auth.js';
import authOtpRoutes from './routes/auth-otp.js';
import usersRoutes from './routes/users.js';

export interface BuildAppOptions {
  /** false in unit tests that must not touch Postgres/Redis. */
  infra?: boolean;
  logger?: boolean;
}

export async function buildApp({ infra = true, logger = true }: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger });

  if (process.env.NODE_ENV !== 'production') {
    await app.register(swagger, {
      openapi: {
        info: { title: 'Machine Parts Marketplace API', version: '0.1.0' },
        components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
      },
    });
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }

  await app.register(cors, { origin: true, credentials: true });
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);
  await app.register(healthRoutes);

  if (infra) {
    await app.register(dbPlugin);
    await app.register(redisPlugin);
    await app.register(rateLimitPlugin);
    await app.register(authOtpRoutes);
    await app.register(usersRoutes);
    await app.register(adminAuthRoutes);
  }

  return app;
}
