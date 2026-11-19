import { eq, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { INDIAN_MOBILE_REGEX, type ContactPhoneState, type ContactPhoneView } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { businesses, users } from '../../db/schema.js';
import { discoveryRedisPrefix } from '../../env.js';
import { AppError, ValidationError } from '../../lib/errors.js';
import { currentContactNumber, withdrawContactConsents } from '../consent/contact-consent.service.js';
import { sendOtp, verifyOtp } from '../otp.service.js';

/**
 * The business contact number (F6 + F7 spec §5.12, §6.6; textile `contact-consent.service.ts`'s number half): owner
 * only (the route's `ownerOnly`), OTP-verified with F1's OTP service (an unverified number could point at someone
 * else). It is used only as the revealed number (R6), never public. Whenever the business's current number changes
 * (a contact number added, replaced or removed, so the owner-phone fallback starts or stops), a business-wide
 * `withdraw` of the old number is written, so no tick of an old number counts again (P6).
 *
 * The number waiting for its code is kept in Redis for 10 minutes (`contact-phone:pending:<businessId>`).
 */

const PENDING_TTL_SECONDS = 600;
const pendingKey = (businessId: string) => `${discoveryRedisPrefix()}contact-phone:pending:${businessId}`;

/** 10 digits, or +91 / 91 / 0 and 10 digits (spaces and hyphens allowed); stored E.164. */
export function normaliseContactPhone(raw: string): string {
  const compact = raw.replace(/[\s-]/g, '');
  const national = compact.startsWith('+91') ? compact.slice(3) : compact.length === 12 && compact.startsWith('91') ? compact.slice(2) : compact.length === 11 && compact.startsWith('0') ? compact.slice(1) : compact;
  if (!INDIAN_MOBILE_REGEX.test(national)) {
    throw new ValidationError('Enter a 10-digit Indian mobile number', { field: 'phone' }, 'CONTACT_PHONE_INVALID');
  }
  return `+91${national}`;
}

async function stateOf(conn: Db | Tx, businessId: string): Promise<ContactPhoneState> {
  const [b] = await conn
    .select({ phone: businesses.contactPhone, verifiedAt: businesses.contactPhoneVerifiedAt })
    .from(businesses)
    .where(eq(businesses.id, businessId));
  return { contactPhone: b?.phone ?? null, verifiedAt: b?.verifiedAt?.toISOString() ?? null };
}

/**
 * `GET /businesses/me/contact-phone`: the owner reads the number and whether the owner-phone fallback is in use (never
 * the phone itself); any other member reads only `canEdit: false`, so the screen shows the owner-only line.
 */
export async function contactPhoneView(conn: Db | Tx, user: { userId: string; businessId: string }): Promise<ContactPhoneView> {
  const [u] = await conn.select({ memberRole: users.memberRole }).from(users).where(eq(users.id, user.userId));
  if (u?.memberRole !== 'owner') return { contactPhone: null, verifiedAt: null, ownerPhoneFallback: false, canEdit: false };
  const state = await stateOf(conn, user.businessId);
  const current = await currentContactNumber(conn, user.businessId);
  return { ...state, ownerPhoneFallback: current?.source === 'owner_phone', canEdit: true };
}

/** `POST /businesses/me/contact-phone/otp/send { phone }`: sends the code and keeps the number pending. */
export async function sendContactPhoneOtp(
  redis: Redis | undefined,
  businessId: string,
  rawPhone: string,
  log: (msg: string) => void,
): Promise<{ resendAfter: number; devCode?: string }> {
  const phone = normaliseContactPhone(rawPhone);
  if (!redis) throw new AppError('The code service is not available right now', 503, 'OTP_UNAVAILABLE');
  const sent = await sendOtp(redis, phone, log);
  await redis.set(pendingKey(businessId), phone, 'EX', PENDING_TTL_SECONDS);
  return sent;
}

/**
 * `POST /businesses/me/contact-phone/otp/verify { code }`: the pending number becomes the verified contact number.
 * Replacing a number (or leaving the owner-phone fallback) withdraws the old one (`number_replaced`).
 */
export async function verifyContactPhone(
  tx: Tx,
  redis: Redis | undefined,
  user: { userId: string; businessId: string },
  code: string,
): Promise<ContactPhoneState> {
  if (!redis) throw new AppError('The code service is not available right now', 503, 'OTP_UNAVAILABLE');
  const phone = await redis.get(pendingKey(user.businessId));
  if (!phone) throw new AppError('The code has expired. Enter the number again.', 400, 'OTP_EXPIRED');
  await verifyOtp(redis, phone, code);

  // The row lock serialises two verifies of one business (no other row is held here).
  await tx.select({ id: businesses.id }).from(businesses).where(eq(businesses.id, user.businessId)).for('no key update');
  const before = await currentContactNumber(tx, user.businessId);
  await tx
    .update(businesses)
    .set({ contactPhone: phone, contactPhoneVerifiedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(businesses.id, user.businessId));
  if (before && before.phone !== phone) {
    await withdrawContactConsents(tx, user.businessId, before.phone, 'number_replaced', { userId: user.userId, source: before.source });
  }
  await redis.del(pendingKey(user.businessId));
  return stateOf(tx, user.businessId);
}

/** `DELETE /businesses/me/contact-phone`: removes it (`number_removed`); the owner's phone becomes the fallback. */
export async function removeContactPhone(tx: Tx, user: { userId: string; businessId: string }): Promise<ContactPhoneState> {
  await tx.select({ id: businesses.id }).from(businesses).where(eq(businesses.id, user.businessId)).for('no key update');
  const before = await currentContactNumber(tx, user.businessId);
  if (before?.source !== 'business_contact') return stateOf(tx, user.businessId);
  await tx
    .update(businesses)
    .set({ contactPhone: null, contactPhoneVerifiedAt: null, updatedAt: sql`now()` })
    .where(eq(businesses.id, user.businessId));
  await withdrawContactConsents(tx, user.businessId, before.phone, 'number_removed', { userId: user.userId, source: 'business_contact' });
  return stateOf(tx, user.businessId);
}
