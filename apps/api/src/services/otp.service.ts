import { randomInt } from 'node:crypto';
import type { Redis } from 'ioredis';
import { AppError } from '../lib/errors.js';

const OTP_TTL_SECONDS = 5 * 60;
const RESEND_AFTER_SECONDS = 30;
const MAX_ATTEMPTS = 5;

interface Entry { code: string; attempts: number; expiresAt: number }

// Fallback store for local dev without Redis. Never used when REDIS_URL is set.
const memory = new Map<string, Entry>();

const key = (phone: string) => `otp:${phone}`;

/** Real SMS delivery is not wired yet; outside production the code is returned so the app is usable. */
function deliveryMode(): 'dev' | 'msg91' {
  if (process.env.MSG91_AUTH_KEY) return 'msg91';
  if (process.env.NODE_ENV === 'production') {
    throw new AppError('OTP provider is not configured', 503, 'OTP_UNAVAILABLE');
  }
  return 'dev';
}

export async function sendOtp(
  redis: Redis | undefined,
  phone: string,
  log: (msg: string) => void,
): Promise<{ resendAfter: number; devCode?: string }> {
  if (deliveryMode() === 'msg91') {
    // Implement MSG91 delivery here (scope F1): store the code as below, then send it.
    throw new AppError('MSG91 delivery is not implemented yet', 501, 'OTP_NOT_IMPLEMENTED');
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const entry: Entry = { code, attempts: 0, expiresAt: Date.now() + OTP_TTL_SECONDS * 1000 };
  if (redis) await redis.set(key(phone), JSON.stringify(entry), 'EX', OTP_TTL_SECONDS);
  else memory.set(key(phone), entry);

  log(`[dev] OTP for ${phone}: ${code}`);
  return { resendAfter: RESEND_AFTER_SECONDS, devCode: code };
}

/** Throws unless `code` matches; a match is single-use. */
export async function verifyOtp(redis: Redis | undefined, phone: string, code: string): Promise<void> {
  const raw = redis ? await redis.get(key(phone)) : memory.get(key(phone));
  const entry: Entry | undefined = typeof raw === 'string' ? JSON.parse(raw) : raw ?? undefined;

  if (!entry || entry.expiresAt < Date.now()) throw new AppError('OTP expired. Request a new one.', 400, 'OTP_EXPIRED');
  if (entry.attempts >= MAX_ATTEMPTS) throw new AppError('Too many attempts. Request a new OTP.', 400, 'OTP_TOO_MANY_ATTEMPTS');

  if (entry.code !== code) {
    entry.attempts += 1;
    const ttl = Math.max(1, Math.ceil((entry.expiresAt - Date.now()) / 1000));
    if (redis) await redis.set(key(phone), JSON.stringify(entry), 'EX', ttl);
    else memory.set(key(phone), entry);
    throw new AppError('Incorrect OTP', 400, 'OTP_WRONG');
  }

  if (redis) await redis.del(key(phone));
  else memory.delete(key(phone));
}
