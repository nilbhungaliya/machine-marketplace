import { and, count, eq, gte, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  DEAL_PAYMENT_METHODS,
  RENTAL_DECLINE_REASONS,
  RENTAL_DISPUTE_CATEGORIES,
  RENTAL_FINAL_REASONS,
  RENTAL_LIMITS,
  RENTAL_PERIODS,
  meetsRentalMinimum,
  rentalCountLimits,
  rentalEndDate,
  rentalEstimate,
  resolveRentalChoices,
  DEAL_LIMITS,
  type AppSettingsValues,
  type RentalPeriod,
  type RentalTermsSnapshot,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { rentalBookings, users } from '../../db/schema.js';
import { ConflictError, TooManyRequestsError, ValidationError } from '../../lib/errors.js';
import { IST_MIDNIGHT, IST_TODAY, addDays } from '../../lib/ist.js';
import { isRealDate, isStorableText } from '../../lib/spec-check.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { onboardingForUser } from '../business/profile.service.js';
import { pincodeDistrict } from '../locations/pincode.service.js';
import { periodNotOffered } from './estimate.js';

// What a renter (or an owner proposing a change) sends (M14 spec §6.2, §6.3, R1, R2; plan A1-1, F8 `request-input.ts`):
// the Zod bodies of every booking route, `parseRentalRequest` (the §6.2 checks in order, pure), the site pincode, the
// renter business's limits (D7) and the onboarding check every booking write runs.

type Conn = Db | Tx;

const MONEY_MAX = 10_000_000_000;
const storable = (s: string) => isStorableText(s);
/** Trimmed text up to `max`; `''` and null clear it. */
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(storable, 'contains characters that cannot be saved')
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();
/** A `YYYY-MM-DD` shape; whether it is a real date is the service's (`400 RENTAL_DATES_INVALID`). */
const dateShape = z.string().max(10);
const paise = z.number().int().min(0).max(MONEY_MAX);
const photoKeys = (max: number) => z.array(z.string().max(200)).max(max).optional();

export const rentalRequestBody = z
  .object({
    startDate: dateShape,
    period: z.enum(RENTAL_PERIODS),
    count: z.number().int(),
    machines: z.number().int(),
    withOperator: z.boolean().optional(),
    ownerDelivers: z.boolean().optional(),
    sitePincode: z.string().regex(/^\d{6}$/, 'must be a 6-digit pincode'),
    siteAddress: optText(RENTAL_LIMITS.siteAddressMax),
    note: optText(RENTAL_LIMITS.requestNoteMax),
  })
  .strict();
export type RentalRequestBody = z.infer<typeof rentalRequestBody>;

export const rentalEstimateBody = z
  .object({
    listingId: z.string().uuid(),
    startDate: dateShape,
    period: z.enum(RENTAL_PERIODS),
    count: z.number().int(),
    machines: z.number().int(),
    withOperator: z.boolean().optional(),
    ownerDelivers: z.boolean().optional(),
    sitePincode: z.string().regex(/^\d{6}$/).optional(),
  })
  .strict();

export const rentalChangeBody = z
  .object({
    versionSeq: z.number().int().min(1),
    startDate: dateShape,
    period: z.enum(RENTAL_PERIODS),
    count: z.number().int(),
    machines: z.number().int(),
    withOperator: z.boolean().optional(),
    ownerDelivers: z.boolean().optional(),
    totalPaise: paise.optional(),
    message: optText(RENTAL_LIMITS.messageMax),
  })
  .strict();
export type RentalChangeBody = z.infer<typeof rentalChangeBody>;

export const versionBody = z.object({ versionSeq: z.number().int().min(1) }).strict();
export const declineBody = z.object({ versionSeq: z.number().int().min(1), reason: z.enum(RENTAL_DECLINE_REASONS) }).strict();
export const emptyBody = z.object({}).strict();
export const onSiteBody = z
  .object({ hourMeter: z.number().int().min(0).max(RENTAL_LIMITS.hourMeterMax).optional(), photoKeys: photoKeys(RENTAL_LIMITS.photosMax) })
  .strict();
export const returnedBody = z
  .object({
    hourMeter: z.number().int().min(0).max(RENTAL_LIMITS.hourMeterMax).optional(),
    finalAmountPaise: paise,
    finalReason: z.enum(RENTAL_FINAL_REASONS).optional(),
    finalNote: optText(RENTAL_LIMITS.shortNoteMax),
    damageNote: optText(RENTAL_LIMITS.damageNoteMax),
    photoKeys: photoKeys(RENTAL_LIMITS.photosMax),
  })
  .strict();
export const cancelBody = z.object({ reason: z.string().max(60), note: optText(RENTAL_LIMITS.shortNoteMax) }).strict();
export const notesBody = z
  .object({
    version: z.number().int().min(1),
    paymentMethod: z.enum(DEAL_PAYMENT_METHODS).nullable().optional(),
    advancePaise: paise.nullable().optional(),
    depositPaise: paise.nullable().optional(),
    depositReturned: z.boolean().nullable().optional(),
    expectedOnSiteTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM')
      .nullable()
      .optional(),
    text: optText(RENTAL_LIMITS.notesMax),
  })
  .strict();
export type RentalNotesBody = z.infer<typeof notesBody>;
export const problemBody = z
  .object({
    category: z.enum(RENTAL_DISPUTE_CATEGORIES),
    description: z
      .string()
      .trim()
      .min(DEAL_LIMITS.disputeDescriptionMin)
      .max(DEAL_LIMITS.disputeDescriptionMax)
      .refine(storable, 'contains characters that cannot be saved'),
    photoKeys: photoKeys(5),
  })
  .strict();
export const presignBody = z.object({ contentType: z.string().max(100), contentLength: z.number().int().positive() }).strict();

/** The terms a request or change asks for (the site and note aside). */
export interface RentalTermsInput {
  startDate: string;
  period: RentalPeriod;
  count: number;
  machines: number;
  withOperator?: boolean;
  ownerDelivers?: boolean;
}

/** The checked choices: end date, the forced operator / transport choices and the server's estimate (R1, R2). */
export interface ResolvedRequest {
  startDate: string;
  endDate: string;
  period: RentalPeriod;
  count: number;
  machines: number;
  withOperator: boolean;
  ownerDelivers: boolean;
  estimatePaise: number;
}

/**
 * The §6.2 checks in order, pure (`today` is the IST date, `advanceDays` the setting): the period is priced (`400
 * RENTAL_PERIOD_NOT_OFFERED`), the count fits the period (`400 RENTAL_COUNT_INVALID`), machines 1 … the listing's
 * quantity (`400 RENTAL_MACHINES_INVALID`), the start date is today … today + `advanceDays` (`400 RENTAL_DATES_INVALID`),
 * the listing's minimum is met (`400 BELOW_MINIMUM`). Operator / transport are forced where the listing offers no choice
 * (`resolveRentalChoices`). The pincode is `resolveSite`'s (it needs the directory).
 */
export function parseRentalRequest(
  listing: { quantity: number },
  terms: RentalTermsSnapshot,
  input: RentalTermsInput,
  today: string,
  advanceDays: number,
): ResolvedRequest {
  const choices = resolveRentalChoices(terms, input);
  const money = rentalEstimate(terms, { period: input.period, count: 1, machines: 1, ...choices });
  if (!money) throw periodNotOffered();
  const limits = rentalCountLimits[input.period];
  if (!Number.isSafeInteger(input.count) || input.count < limits.min || input.count > limits.max) {
    throw new ValidationError('That many periods can’t be booked', { min: limits.min, max: limits.max }, 'RENTAL_COUNT_INVALID');
  }
  if (!Number.isSafeInteger(input.machines) || input.machines < 1 || input.machines > Math.min(listing.quantity, RENTAL_LIMITS.machinesMax)) {
    throw new ValidationError('That many machines can’t be booked', { max: listing.quantity }, 'RENTAL_MACHINES_INVALID');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) || !isRealDate(input.startDate)) {
    throw new ValidationError('Pick a start date', { reason: 'invalid' }, 'RENTAL_DATES_INVALID');
  }
  const latest = addDays(today, advanceDays);
  if (input.startDate < today || input.startDate > latest) {
    throw new ValidationError('Pick a start date from today', { from: today, to: latest }, 'RENTAL_DATES_INVALID');
  }
  if (!meetsRentalMinimum(terms, input.period, input.count)) {
    throw new ValidationError('This machine has a minimum booking', { minDuration: terms.minDuration, period: terms.minDurationPeriod }, 'BELOW_MINIMUM');
  }
  const estimate = rentalEstimate(terms, { period: input.period, count: input.count, machines: input.machines, ...choices })!;
  return {
    startDate: input.startDate,
    endDate: rentalEndDate(input.startDate, input.period, input.count),
    period: input.period,
    count: input.count,
    machines: input.machines,
    ...choices,
    estimatePaise: estimate.totalPaise,
  };
}

/** The site's city and state from the pincode directory (`400 PINCODE_UNKNOWN` when it has no office). */
export async function resolveSite(conn: Conn, pincode: string): Promise<{ city: string; state: string }> {
  const where = await pincodeDistrict(conn, pincode);
  if (!where) throw new ValidationError('We could not find this pincode', { pincode: 'unknown' }, 'PINCODE_UNKNOWN');
  return { city: where.city, state: where.state };
}

/** Today's IST date by the database clock. */
export async function istTodayOf(conn: Conn): Promise<string> {
  const { rows } = await conn.execute<{ d: string }>(sql`SELECT ${IST_TODAY}::text AS d`);
  return rows[0]!.d;
}

/** Every booking write (plan Global constraints): an onboarded business, else `409 ONBOARDING_INCOMPLETE`. */
export async function assertOnboardedForRental(conn: Conn, user: Pick<UserTokenPayload, 'userId'>): Promise<string> {
  const incomplete = () => new ConflictError('Finish setting up your business first', 'ONBOARDING_INCOMPLETE');
  const [u] = await conn.select({ name: users.name, businessId: users.businessId }).from(users).where(eq(users.id, user.userId));
  if (!u?.businessId) throw incomplete();
  if ((await onboardingForUser(conn, u)) !== 'done') throw incomplete();
  return u.businessId;
}

/**
 * The renter business's limits (R8, D7), with its row locked by the caller: open requests (`requested` / `countered`)
 * against `rental_open_limit_{unverified,verified}` (`409 RENTAL_OPEN_LIMIT`), then requests created since IST midnight
 * in any status against `rental_requests_per_day` (`429 RENTAL_DAILY_LIMIT` with `retryAt`).
 */
export async function assertRenterLimits(tx: Tx, businessId: string, verified: boolean, settings: AppSettingsValues): Promise<void> {
  const [open] = await tx
    .select({ n: count() })
    .from(rentalBookings)
    .where(and(eq(rentalBookings.renterBusinessId, businessId), inArray(rentalBookings.status, ['requested', 'countered'])));
  const openLimit = verified ? settings.rental_open_limit_verified : settings.rental_open_limit_unverified;
  if ((open?.n ?? 0) >= openLimit) {
    throw new ConflictError('You have too many booking requests waiting for an answer', 'RENTAL_OPEN_LIMIT', { limit: openLimit, verified });
  }
  const [today] = await tx
    .select({ n: count() })
    .from(rentalBookings)
    .where(and(eq(rentalBookings.renterBusinessId, businessId), gte(rentalBookings.createdAt, IST_MIDNIGHT)));
  if ((today?.n ?? 0) >= settings.rental_requests_per_day) {
    const { rows } = await tx.execute(sql`SELECT (${IST_MIDNIGHT} + interval '1 day') AS retry_at`);
    const retryAt = new Date((rows[0] as { retry_at: string | Date }).retry_at).toISOString();
    throw new TooManyRequestsError('You have sent many booking requests today. Try again tomorrow.', 'RENTAL_DAILY_LIMIT', {
      retryAt,
      limit: settings.rental_requests_per_day,
    });
  }
}
