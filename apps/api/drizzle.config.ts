import type { Config } from 'drizzle-kit';
import { config } from 'dotenv';
import path from 'node:path';

// The single .env lives at the repo root.
config({ path: path.resolve(__dirname, '../../.env') });

export default {
  schema: './src/db/schema.ts',
  out: '../../infra/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
