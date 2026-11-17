import '../env.js';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

// One pool per process; plugins/db.ts decorates Fastify with this same instance.
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
pool.on('error', (err) => console.error('pg pool error (pool will auto-reconnect)', err));

export const db = drizzle(pool, { schema });
export type Db = typeof db;
