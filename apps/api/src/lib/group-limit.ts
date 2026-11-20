import type { FastifyReply, FastifyRequest } from 'fastify';
import { discoveryRedisPrefix } from '../env.js';
import { TooManyRequestsError } from './errors.js';

/**
 * A rate limit shared by a group of routes (F6 + F7 plan P8): every message send counts in `message`, every offer write
 * in `offer`, every deal write in `deal`, per signed-in user. A preHandler placed after `requireUser`: Redis `INCR` +
 * `EXPIRE` on `${prefix}rl:<group>:<userId>` (the prefix is discovery's: empty in dev and production, per worker in
 * tests). Over the limit → `429 RATE_LIMITED` with `details.retryAt`.
 *
 * `GROUP_RATE_LIMIT_MAX`, when set, replaces every group's max. It is read when the route is registered (when the app is
 * built): the vitest config sets 1 000 000, a limit test builds its own app with it set low. Without Redis the limit is
 * skipped (dev without `REDIS_URL`).
 */

/**
 * F8 (plan D10) adds the request writes, the reply sends and the seller's "not relevant" feedback. M14 (plan D6):
 * `rental_booking` (request, change: 20 / 10 min) and `rental_booking_action` (every other booking write and the
 * owner's block writes: 60 / 10 min).
 */
export type RateGroup =
  | 'message'
  | 'offer'
  | 'deal'
  | 'part_request'
  | 'part_request_reply'
  | 'part_request_feedback'
  | 'rental_booking'
  | 'rental_booking_action';

export function groupRateLimitKey(group: RateGroup, userId: string): string {
  return `${discoveryRedisPrefix()}rl:${group}:${userId}`;
}

/** `GROUP_RATE_LIMIT_MAX` when set (tests), else the group's own max; read when the route is registered. */
function resolvedMax(max: number): number {
  const override = Number(process.env.GROUP_RATE_LIMIT_MAX);
  return Number.isSafeInteger(override) && override > 0 ? override : max;
}

/** Counts one hit on `key` and throws `429 RATE_LIMITED` (`details.retryAt`) over `limit` in the window. */
async function hit(redis: NonNullable<FastifyRequest['server']['redis']>, key: string, limit: number, windowSeconds: number): Promise<void> {
  const [[, count], [, ttl]] = (await redis.multi().incr(key).ttl(key).exec()) as [[null, number], [null, number]];
  if (ttl < 0) await redis.expire(key, windowSeconds);
  if (count > limit) {
    const leftSeconds = ttl > 0 ? ttl : windowSeconds;
    throw new TooManyRequestsError('Too many requests. Try again in a minute.', 'RATE_LIMITED', {
      retryAt: new Date(Date.now() + leftSeconds * 1000).toISOString(),
    });
  }
}

export function groupRateLimit(group: RateGroup, max: number, windowSeconds: number) {
  const limit = resolvedMax(max);
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const redis = request.server.redis;
    const userId = request.user?.userId;
    if (!redis || !userId) return;
    await hit(redis, groupRateLimitKey(group, userId), limit, windowSeconds);
  };
}

/**
 * Admin close-out (plan D7, spec §17): `admin_export` (the five sheets and the audit export share one counter per admin,
 * 10 / 10 min) and `admin_reveal` (audit log reveals, 30 / hour).
 */
export type AdminRateGroup = 'admin_export' | 'admin_reveal';

export function adminRateLimitKey(group: AdminRateGroup, adminId: string): string {
  return `${discoveryRedisPrefix()}rl:${group}:${adminId}`;
}

/**
 * As `groupRateLimit`, per signed-in admin: a preHandler placed after `requireAdmin` / `requireAdminRole`, keyed by
 * `request.admin.adminId`, with the same `GROUP_RATE_LIMIT_MAX` override and `429 RATE_LIMITED`.
 */
export function adminRateLimit(group: AdminRateGroup, max: number, windowSeconds: number) {
  const limit = resolvedMax(max);
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const redis = request.server.redis;
    const adminId = request.admin?.adminId;
    if (!redis || !adminId) return;
    await hit(redis, adminRateLimitKey(group, adminId), limit, windowSeconds);
  };
}
