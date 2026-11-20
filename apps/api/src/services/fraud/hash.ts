import { createHash, createHmac } from 'node:crypto';
import { phoneKey } from '../../lib/mask-contact.js';

/**
 * Hashing for fraud signals (admin close-out R10, §16): phone numbers become HMAC-SHA-256 with `SIGNAL_HASH_KEY` (a
 * plain hash of a 10-digit number is reversible by brute force), install ids SHA-256 (random UUIDs, not personal).
 * Neither the key nor a number is ever logged.
 */

export const SIGNAL_HASH_KEY_MIN_LENGTH = 32;

let warned = false;

/**
 * `SIGNAL_HASH_KEY` when it is at least 32 characters, else null: the phone rule is then off (opt-in like Sentry and
 * push), and the first call that finds it missing logs that once (never the value).
 */
export function signalHashKey(log?: { info: (msg: string) => void }): string | null {
  const key = process.env.SIGNAL_HASH_KEY;
  if (key && key.length >= SIGNAL_HASH_KEY_MIN_LENGTH) return key;
  if (!warned && log) {
    warned = true;
    log.info(`SIGNAL_HASH_KEY is not set (at least ${SIGNAL_HASH_KEY_MIN_LENGTH} characters): the repeated-phone fraud rule is off`);
  }
  return null;
}

/** HMAC-SHA-256 (hex) of a phone's last 10 ASCII digits (any script, spacing or prefix reads the same). */
export function hmacPhone(digits10: string, key: string): string {
  return createHmac('sha256', key).update(phoneKey(digits10) ?? digits10).digest('hex');
}

/** SHA-256 (hex) of an install id, lower-cased. */
export function installHash(installId: string): string {
  return createHash('sha256').update(installId.trim().toLowerCase()).digest('hex');
}

/** The first 8 hex characters of a hash: shows that two signals are about one phone / install, never the value. */
export function groupIdOf(hex: string): string {
  return hex.slice(0, 8);
}
