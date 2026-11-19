import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

// The single .env lives at the repo root (see /.env.example).
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

type Env = Record<string, string | undefined>;

/** F4 + F5 §4.8, §5.10: the discovery cursor secret is at least this long. */
export const DISCOVERY_CURSOR_SECRET_MIN_LENGTH = 32;

/** The discovery cursor secret (`DISCOVERY_CURSOR_SECRET`, ≥ 32 characters); throws when it is missing or short. */
export function discoveryCursorSecret(env: Env = process.env): string {
  const value = env.DISCOVERY_CURSOR_SECRET;
  if (!value || value.length < DISCOVERY_CURSOR_SECRET_MIN_LENGTH) {
    throw new Error(
      `DISCOVERY_CURSOR_SECRET must be set to at least ${DISCOVERY_CURSOR_SECRET_MIN_LENGTH} characters (see .env.example)`,
    );
  }
  return value;
}

/**
 * The prefix of discovery's Redis keys (`DISCOVERY_REDIS_PREFIX`): empty in dev and production; the vitest env sets a
 * per-worker `test:<runId>:` so tests never touch the unprefixed keys.
 */
export function discoveryRedisPrefix(env: Env = process.env): string {
  return env.DISCOVERY_REDIS_PREFIX ?? '';
}

/** Variables the API refuses to start without (called first thing by `index.ts`). */
export function assertApiEnv(env: Env = process.env): void {
  discoveryCursorSecret(env);
}
