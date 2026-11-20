import * as Yup from 'yup';
import {
  meetsRentalMinimum, RENTAL_LIMITS, RENTAL_PERIODS, rentalCountLimits, resolveRentalChoices,
  type RentalChangeInput, type RentalEstimateRequest, type RentalPeriod, type RentalRequestInput, type RentalTermsSnapshot,
} from '@mpm/shared-types';
import { toAsciiDigits } from './digits';

// The Request booking form (M14 spec §6.2, R1; plan B2-1): the values as the fields hold them, the Yup mirror of the
// server's checks (so the form never sends what `POST /listings/:id/bookings` would refuse for its shape), and the
// request / change / estimate bodies. Pure; build the schema inside the component so messages follow the language.
// What only the server knows (dates taken, the owner's GST, limits, the pincode directory) stays the server's answer.

export type Translate = (key: string, options?: Record<string, unknown>) => string;

export interface RentalRequestValues {
  /** IST `YYYY-MM-DD`; null until picked. */
  startDate: string | null;
  period: RentalPeriod;
  count: number;
  machines: number;
  /** Asked only when the listing's operator is `optional` (R1); ignored otherwise. */
  withOperator: boolean;
  /** Asked only when the listing's transport is `either`; ignored otherwise. */
  ownerDelivers: boolean;
  /** As typed (Hindi / Gujarati digits allowed). */
  sitePincode: string;
  siteAddress: string;
  /** The request's note (≤ 500), or a renter's change message (≤ 300). */
  note: string;
}

const RATE_KEY: Record<RentalPeriod, keyof RentalTermsSnapshot> = {
  hour: 'rateHourPaise',
  day: 'rateDayPaise',
  week: 'rateWeekPaise',
  month: 'rateMonthPaise',
};

/** The periods the listing prices, in order hour → month (the Charged by segments). */
export function periodsOffered(terms: RentalTermsSnapshot): RentalPeriod[] {
  return RENTAL_PERIODS.filter((p) => terms[RATE_KEY[p]] != null);
}

/** Day when the listing prices it, else the first priced of hour / week / month; null when nothing is priced. */
export function defaultPeriod(terms: RentalTermsSnapshot): RentalPeriod | null {
  const offered = periodsOffered(terms);
  if (offered.includes('day')) return 'day';
  return offered[0] ?? null;
}

/** The listing leaves the operator to the renter (R1). */
export const asksOperator = (terms: Pick<RentalTermsSnapshot, 'operator'>): boolean => terms.operator === 'optional';
/** The listing leaves transport to the renter (R1). */
export const asksTransport = (terms: Pick<RentalTermsSnapshot, 'transport'>): boolean => terms.transport === 'either';

/** The site pincode's digits, or null when it isn't six digits. */
export function pincodeDigits(text: string): string | null {
  const d = toAsciiDigits(text).replace(/\s/g, '');
  return /^\d{6}$/.test(d) ? d : null;
}

/** A new form, or one from a prefill (the listing page, a pending sign-in, a Booking record's Change). */
export function rentalRequestValues(
  terms: RentalTermsSnapshot,
  prefill?: Partial<RentalRequestInput> | null,
): RentalRequestValues {
  const offered = periodsOffered(terms);
  const period = prefill?.period && offered.includes(prefill.period) ? prefill.period : (defaultPeriod(terms) ?? 'day');
  return {
    startDate: prefill?.startDate ?? null,
    period,
    count: prefill?.count ?? 1,
    machines: prefill?.machines ?? 1,
    withOperator: prefill?.withOperator ?? false,
    ownerDelivers: prefill?.ownerDelivers ?? false,
    sitePincode: prefill?.sitePincode ?? '',
    siteAddress: prefill?.siteAddress ?? '',
    note: prefill?.note ?? '',
  };
}

export interface RentalSchemaOptions {
  /** IST today: a start before it is refused (`RENTAL_DATES_INVALID`). */
  today?: string;
  /** The note's limit: 500 for a request, 300 for a change's message. */
  noteMax?: number;
  /** A change has no site fields (the site stays the request's). */
  change?: boolean;
}

/**
 * The form's rules (§6.2): a start date (today or later); a period the listing prices; a count within the period's
 * limits (hours 1–24, days 1–90, weeks 1–26, months 1–6) that meets the listing's minimum; machines 1 … the listing's
 * quantity; a six-digit site pincode; the address ≤ 200; the note ≤ 500 (a change's message ≤ 300).
 */
export function rentalRequestSchema(t: Translate, terms: RentalTermsSnapshot, quantity: number, opts: RentalSchemaOptions = {}) {
  const offered = periodsOffered(terms);
  const noteMax = opts.noteMax ?? RENTAL_LIMITS.requestNoteMax;
  const maxMachines = Math.max(1, Math.min(quantity, RENTAL_LIMITS.machinesMax));
  return Yup.object({
    startDate: Yup.string()
      .nullable()
      .required(t('rentals.form.errors.startDate'))
      .test('today', t('rentals.form.errors.startPast'), (d) => d == null || !opts.today || d >= opts.today),
    period: Yup.mixed<RentalPeriod>()
      .required()
      .test('offered', t('rentals.form.errors.period'), (p) => p != null && offered.includes(p)),
    count: Yup.number()
      .required()
      .test('count', function test(n) {
        const period = this.parent.period as RentalPeriod;
        const lim = rentalCountLimits[period];
        if (!lim || n == null || !Number.isInteger(n) || n < lim.min || n > lim.max) {
          return this.createError({ message: t('rentals.form.errors.count', { max: lim?.max ?? 1 }) });
        }
        if (!meetsRentalMinimum(terms, period, n)) return this.createError({ message: t('rentals.form.errors.minimum') });
        return true;
      }),
    machines: Yup.number()
      .required()
      .integer(t('rentals.form.errors.machines', { max: maxMachines }))
      .min(1, t('rentals.form.errors.machines', { max: maxMachines }))
      .max(maxMachines, t('rentals.form.errors.machines', { max: maxMachines })),
    withOperator: Yup.boolean(),
    ownerDelivers: Yup.boolean(),
    sitePincode: opts.change
      ? Yup.string()
      : Yup.string().test('pincode', t('rentals.form.errors.pincode'), (v) => pincodeDigits(v ?? '') !== null),
    siteAddress: Yup.string().max(RENTAL_LIMITS.siteAddressMax, t('rentals.form.errors.addressMax', { max: RENTAL_LIMITS.siteAddressMax })),
    note: Yup.string().test('noteMax', t('rentals.form.errors.noteMax', { max: noteMax }), (v) => (v ?? '').trim().length <= noteMax),
  });
}

/** The field errors of a filled form (first message per field); `{}` when it is valid. */
export function validateRentalRequest(
  schema: ReturnType<typeof rentalRequestSchema>,
  values: RentalRequestValues,
): Partial<Record<keyof RentalRequestValues, string>> {
  try {
    schema.validateSync(values, { abortEarly: false });
    return {};
  } catch (err) {
    if (!(err instanceof Yup.ValidationError)) throw err;
    const out: Partial<Record<keyof RentalRequestValues, string>> = {};
    for (const e of err.inner.length ? err.inner : [err]) {
      const field = (e.path ?? '') as keyof RentalRequestValues;
      if (field && !out[field]) out[field] = e.message;
    }
    return out;
  }
}

/** Operator and transport only where the listing offers a choice (else the server forces them, R1). */
function choices(v: RentalRequestValues, terms: RentalTermsSnapshot): { withOperator?: boolean; ownerDelivers?: boolean } {
  const out: { withOperator?: boolean; ownerDelivers?: boolean } = {};
  if (asksOperator(terms)) out.withOperator = v.withOperator;
  if (asksTransport(terms)) out.ownerDelivers = v.ownerDelivers;
  return out;
}

const optText = (s: string): string | undefined => {
  const trimmed = s.trim();
  return trimmed === '' ? undefined : trimmed;
};

/** `POST /listings/:id/bookings` body from a valid form. */
export function toRentalRequestInput(v: RentalRequestValues, terms: RentalTermsSnapshot): RentalRequestInput {
  const input: RentalRequestInput = {
    startDate: v.startDate ?? '',
    period: v.period,
    count: v.count,
    machines: v.machines,
    ...choices(v, terms),
    sitePincode: pincodeDigits(v.sitePincode) ?? '',
  };
  const address = optText(v.siteAddress);
  if (address) input.siteAddress = address;
  const note = optText(v.note);
  if (note) input.note = note;
  return input;
}

/** A renter's changed request (`POST /rental-bookings/:id/change`): no total (renters don't type money, §6.3). */
export function toRentalChangeInput(v: RentalRequestValues, terms: RentalTermsSnapshot, versionSeq: number): RentalChangeInput {
  const input: RentalChangeInput = {
    versionSeq,
    startDate: v.startDate ?? '',
    period: v.period,
    count: v.count,
    machines: v.machines,
    ...choices(v, terms),
  };
  const message = optText(v.note);
  if (message) input.message = message;
  return input;
}

/** `POST /rentals/estimate` body, or null until a start date is picked; the pincode only once it is six digits. */
export function toEstimateRequest(listingId: string, v: RentalRequestValues, terms: RentalTermsSnapshot): RentalEstimateRequest | null {
  if (!v.startDate) return null;
  const lim = rentalCountLimits[v.period];
  if (!Number.isInteger(v.count) || v.count < lim.min || v.count > lim.max || v.machines < 1) return null;
  const req: RentalEstimateRequest = {
    listingId,
    startDate: v.startDate,
    period: v.period,
    count: v.count,
    machines: v.machines,
    ...choices(v, terms),
  };
  const pin = pincodeDigits(v.sitePincode);
  if (pin) req.sitePincode = pin;
  return req;
}

/** What the renter ends up with on operator and transport for these terms (for the form's summary line). */
export function resolvedChoices(v: RentalRequestValues, terms: RentalTermsSnapshot) {
  return resolveRentalChoices(terms, { withOperator: v.withOperator, ownerDelivers: v.ownerDelivers });
}
