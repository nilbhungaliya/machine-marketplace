import fp from 'fastify-plugin';
import { db, pool } from '../db/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: typeof db;
    pool: typeof pool;
  }
}

export default fp(async (fastify) => {
  await pool.query('SELECT 1'); // fail fast on a bad DATABASE_URL
  fastify.decorate('db', db);
  fastify.decorate('pool', pool);
  fastify.addHook('onClose', async () => {
    await pool.end();
  });
});
