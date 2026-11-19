import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import { DISCOVERY_LIMITS } from '@mpm/shared-types';
import { discoveryRedisPrefix } from '../../env.js';
import { TooManyRequestsError } from '../../lib/errors.js';
import { verifyUserToken } from '../../plugins/auth.js';

// Discovery rate limits (F4 + F5 spec R17, §7). Per user when signed in, else per install id (the `X-Install-Id` UUID
// the app keeps), else per IP; plus an outer cap per IP across every `/discover/*` route, because carrier NAT puts many
// users behind one IP and the install id can be faked (a fairness limit, not a security control).
//
// @fastify/rate-limit runs on `onRequest`, before `optionalUser` and before the body is parsed: the key verifies the
// token itself (signature only, no database read), and count-only has its own path so it gets its own bucket.

export type DiscoveryBucket = 'search' | 'count' | 'suggest' | 'other';

export interface DiscoveryRateLimits {
  search: number;
  count: number;
  suggest: number;
  other: number;
  /** Outer cap per IP across every `/discover/*` route. */
  ipOuter: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WINDOW_MS = 60_000;

function positiveInt(name: string, raw: string | undefined): number | null {
  if (raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`${name} must be a positive integer, got "${raw}"`);
  return n;
}

/**
 * Requests per minute (§7): search 120, count 240, suggest 240, other 120, IP cap 1 200. `DISCOVERY_RATE_LIMIT_MAX`
 * replaces every per-key limit and `DISCOVERY_IP_RATE_MAX` the IP cap (tests raise them; one suite lowers them).
 */
export function discoveryRateLimits(env: Record<string, string | undefined> = process.env): DiscoveryRateLimits {
  const perKey = positiveInt('DISCOVERY_RATE_LIMIT_MAX', env.DISCOVERY_RATE_LIMIT_MAX);
  const ip = positiveInt('DISCOVERY_IP_RATE_MAX', env.DISCOVERY_IP_RATE_MAX);
  return {
    search: perKey ?? DISCOVERY_LIMITS.rateLimitSearch,
    count: perKey ?? DISCOVERY_LIMITS.rateLimitCount,
    suggest: perKey ?? DISCOVERY_LIMITS.rateLimitSuggest,
    other: perKey ?? DISCOVERY_LIMITS.rateLimitOther,
    ipOuter: ip ?? DISCOVERY_LIMITS.rateLimitIpOuter,
  };
}

/** `u:<userId>` for a valid user token, else `i:<install id>` for a UUID `X-Install-Id`, else `ip:<ip>`. */
export function discoveryRateKey(request: Pick<FastifyRequest, 'headers' | 'ip'>): string {
  const auth = request.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    try {
      return `u:${verifyUserToken(auth.slice(7)).userId}`;
    } catch {
      // A bad or non-user token is a guest.
    }
  }
  const install = request.headers['x-install-id'];
  if (typeof install === 'string' && UUID.test(install)) return `i:${install.toLowerCase()}`;
  return `ip:${request.ip}`;
}

/** Route `config` for a `/discover/*` route: its bucket's limit per minute, keyed by `discoveryRateKey`. */
export function discoveryRouteLimit(bucket: DiscoveryBucket, limits: DiscoveryRateLimits = discoveryRateLimits()) {
  return {
    rateLimit: {
      max: limits[bucket],
      timeWindow: WINDOW_MS,
      keyGenerator: (request: FastifyRequest) => discoveryRateKey(request),
    },
  };
}

/**
 * The outer per-IP cap as an `onRequest` hook for the discovery routes (a fixed one-minute window in Redis). It can't be
 * a second @fastify/rate-limit handler: the plugin runs one limit per request. Without Redis it does nothing. Over the
 * cap: `429 RATE_LIMITED` with `Retry-After` (seconds) and `details.retryAt` from the window's remaining time.
 */
export function discoveryIpCap(redis: Redis | undefined, max: number) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!redis) return;
    const key = `${discoveryRedisPrefix()}discover:ip:${request.ip}`;
    const result = await redis.multi().incr(key).pexpire(key, WINDOW_MS, 'NX').pttl(key).exec();
    const current = Number(result?.[0]?.[1] ?? 0);
    if (current <= max) return;
    const pttl = Number(result?.[2]?.[1] ?? -1);
    const leftMs = pttl > 0 ? pttl : WINDOW_MS;
    reply.header('retry-after', String(Math.ceil(leftMs / 1000)));
    throw new TooManyRequestsError('Too many requests', 'RATE_LIMITED', { retryAt: new Date(Date.now() + leftMs).toISOString() });
  };
}
