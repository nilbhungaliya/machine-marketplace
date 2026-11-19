import type { Redis } from 'ioredis';
import { CHAT_LIMITS } from '@mpm/shared-types';
import { discoveryRedisPrefix } from '../../env.js';

/**
 * Which thread a user has open (F6 + F7 spec §11.5, §13; ported from textile `services/notifications/viewing.ts`). The
 * app sends `thread:viewing { threadId | null }` on open / close and every 20 s; the key lives 45 s, so a crashed app
 * stops counting as "viewing" on its own. Push for a chat message skips a user viewing that thread.
 */

export const viewingKey = (userId: string): string => `${discoveryRedisPrefix()}viewing:${userId}`;

export async function setViewing(redis: Redis, userId: string, threadId: string | null): Promise<void> {
  if (threadId === null) await redis.del(viewingKey(userId));
  else await redis.set(viewingKey(userId), threadId, 'EX', CHAT_LIMITS.viewingTtlSeconds);
}

export async function isViewing(redis: Redis, userId: string, threadId: string): Promise<boolean> {
  return (await redis.get(viewingKey(userId))) === threadId;
}
