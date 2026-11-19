import type { Redis } from 'ioredis';
import { discoveryRedisPrefix } from '../../env.js';

// The query reader's dictionary version (F4 + F5 spec §5.3): every synonym or catalogue write bumps it, and each API
// instance checks it at most every 5 s, so a change reaches every instance within 5 s. The key carries
// DISCOVERY_REDIS_PREFIX (empty in dev and production, per worker in tests).

/** `${prefix}discovery:reader:version`. */
export function readerVersionKey(): string {
  return `${discoveryRedisPrefix()}discovery:reader:version`;
}

/** Increments the version and returns it; 0 (no-op) without Redis. Call after the write commits. */
export async function bumpReaderVersion(redis: Redis | null | undefined): Promise<number> {
  if (!redis) return 0;
  return redis.incr(readerVersionKey());
}

/** The current version (0 when never bumped, or without Redis). */
export async function readReaderVersion(redis: Redis | null | undefined): Promise<number> {
  if (!redis) return 0;
  const value = await redis.get(readerVersionKey());
  const n = value === null ? 0 : Number(value);
  return Number.isFinite(n) ? n : 0;
}
