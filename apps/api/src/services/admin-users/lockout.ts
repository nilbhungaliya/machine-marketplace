import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { discoveryRedisPrefix } from '../../env.js';
import { TooManyRequestsError } from '../../lib/errors.js';

/**
 * Admin login lockout (admin close-out R15, plan D14 as amended in the A2 review). Two Redis counters, both holding
 * hashes only (never the email or the IP):
 * - per **email + IP**: 5 failures lock that pair for 15 min (the window starts at the first failure and again at the
 *   5th), so an attacker hammering one address can't keep the admin out from their own;
 * - per **email**: a ceiling of 50 failures an hour from any IP, then `429` for that email until the hour passes.
 * Each attempt counts before bcrypt (`INCR` first, so parallel attempts can't slip past a check): over a limit →
 * `429 TOO_MANY_ATTEMPTS` (`details.retryAt`). A success deletes the email + IP key and takes its attempt back off the
 * email count; a password set from a link clears every key of the email. The pair keys of an email are tracked in a
 * set so they can be cleared. Without Redis (tests with `infra: false`) there is no lockout.
 */

export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_LOCKOUT_SECONDS = 15 * 60;
export const LOGIN_EMAIL_MAX_FAILURES = 50;
export const LOGIN_EMAIL_WINDOW_SECONDS = 60 * 60;

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const normal = (email: string) => email.trim().toLowerCase();

function emailBase(email: string): string {
  return `${discoveryRedisPrefix()}admin-login:${sha(normal(email))}`;
}

/** The per-email ceiling key. */
export function loginEmailKey(email: string): string {
  return `${emailBase(email)}:all`;
}

/** The email + IP key (5 failures / 15 min). */
export function loginPairKey(email: string, ip: string): string {
  return `${emailBase(email)}:ip:${sha(ip)}`;
}

function pairSetKey(email: string): string {
  return `${emailBase(email)}:ips`;
}

function tooMany(ttl: number, fallback: number): TooManyRequestsError {
  const leftSeconds = ttl > 0 ? ttl : fallback;
  return new TooManyRequestsError('Too many failed sign-ins. Try again later.', 'TOO_MANY_ATTEMPTS', {
    retryAt: new Date(Date.now() + leftSeconds * 1000).toISOString(),
  });
}

/**
 * Counts this attempt against both limits and throws `429 TOO_MANY_ATTEMPTS` when it is over either. Call before
 * bcrypt; on success call `loginSucceeded`.
 */
export async function countLoginAttempt(redis: Redis | undefined, email: string, ip: string): Promise<void> {
  if (!redis) return;
  const pair = loginPairKey(email, ip);
  const [[, pairCount], [, pairTtl]] = (await redis.multi().incr(pair).ttl(pair).exec()) as [[null, number], [null, number]];
  if (pairTtl < 0 || pairCount === LOGIN_MAX_FAILURES) await redis.expire(pair, LOGIN_LOCKOUT_SECONDS);
  if (pairCount === 1) {
    const set = pairSetKey(email);
    await redis.multi().sadd(set, pair).expire(set, LOGIN_EMAIL_WINDOW_SECONDS).exec();
  }
  if (pairCount > LOGIN_MAX_FAILURES) throw tooMany(pairTtl, LOGIN_LOCKOUT_SECONDS);

  const all = loginEmailKey(email);
  const [[, allCount], [, allTtl]] = (await redis.multi().incr(all).ttl(all).exec()) as [[null, number], [null, number]];
  if (allTtl < 0) await redis.expire(all, LOGIN_EMAIL_WINDOW_SECONDS);
  if (allCount > LOGIN_EMAIL_MAX_FAILURES) throw tooMany(allTtl, LOGIN_EMAIL_WINDOW_SECONDS);
}

/** A successful login: the pair starts again, and the attempt no longer counts toward the email's ceiling. */
export async function loginSucceeded(redis: Redis | undefined, email: string, ip: string): Promise<void> {
  if (!redis) return;
  const all = loginEmailKey(email);
  await redis.del(loginPairKey(email, ip));
  const left = await redis.decr(all);
  if (left <= 0) await redis.del(all);
}

/** A password set from a link: every lock of the email ends (both limits, every IP). */
export async function clearLoginFailures(redis: Redis | undefined, email: string): Promise<void> {
  if (!redis) return;
  const set = pairSetKey(email);
  const pairs = await redis.smembers(set);
  await redis.del(loginEmailKey(email), set, ...pairs);
}
