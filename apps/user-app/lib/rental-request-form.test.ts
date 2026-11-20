import { describe, expect, it } from 'vitest';
import type { RentalTermsSnapshot } from '@mpm/shared-types';
import {
  defaultPeriod, rentalRequestSchema, rentalRequestValues, toRentalRequestInput, validateRentalRequest,
  type RentalRequestValues,
} from './rental-request-form';

const t = (key: string) => key;
const TODAY = '2026-11-20';

const terms = (over: Partial<RentalTermsSnapshot> = {}): RentalTermsSnapshot => ({
  rateHourPaise: 140_000,
  rateDayPaise: 960_000,
  rateWeekPaise: null,
  rateMonthPaise: null,
  shiftHours: 8,
  monthDays: 26,
  operator: 'optional',
  operatorRateDayPaise: 100_000,
  fuel: 'client',
  transport: 'either',
  transportChargePaise: 250_000,
  depositPaise: null,
  minDuration: null,
  minDurationPeriod: null,
  serviceRadiusKm: 60,
  ...over,
});

const filled = (over: Partial<RentalRequestValues> = {}): RentalRequestValues => ({
  startDate: '2026-11-21',
  period: 'day',
  count: 3,
  machines: 1,
  withOperator: true,
  ownerDelivers: false,
  sitePincode: '360002',
  siteAddress: '',
  note: '',
  ...over,
});

const errors = (v: RentalRequestValues, tm = terms(), quantity = 2) =>
  validateRentalRequest(rentalRequestSchema(t, tm, quantity, { today: TODAY }), v);

describe('rentalRequestSchema (§6.2)', () => {
  it('accepts a filled request', () => {
    expect(errors(filled())).toEqual({});
  });

  it('refuses a period the listing does not price', () => {
    expect(errors(filled({ period: 'week', count: 1 })).period).toBe('rentals.form.errors.period');
  });

  it('refuses 0 machines and more machines than the listing has', () => {
    expect(errors(filled({ machines: 0 })).machines).toBe('rentals.form.errors.machines');
    expect(errors(filled({ machines: 3 }), terms(), 2).machines).toBe('rentals.form.errors.machines');
    expect(errors(filled({ machines: 2 }), terms(), 2).machines).toBeUndefined();
  });

  it('refuses a 5-digit pincode and reads Gujarati digits', () => {
    expect(errors(filled({ sitePincode: '36000' })).sitePincode).toBe('rentals.form.errors.pincode');
    expect(errors(filled({ sitePincode: '૩૬૦૦૦૨' })).sitePincode).toBeUndefined();
  });

  it('refuses a count beyond the period and one below the listing minimum', () => {
    expect(errors(filled({ period: 'hour', count: 25 })).count).toBe('rentals.form.errors.count');
    const min4h = terms({ minDuration: 4, minDurationPeriod: 'hour' });
    expect(errors(filled({ period: 'hour', count: 3 }), min4h).count).toBe('rentals.form.errors.minimum');
    expect(errors(filled({ period: 'day', count: 1 }), min4h).count).toBeUndefined();
  });

  it('needs a start date, today or later', () => {
    expect(errors(filled({ startDate: null })).startDate).toBe('rentals.form.errors.startDate');
    expect(errors(filled({ startDate: '2026-11-19' })).startDate).toBe('rentals.form.errors.startPast');
  });
});

describe('defaultPeriod', () => {
  it('picks day when priced, else the first priced of hour / week / month', () => {
    expect(defaultPeriod(terms())).toBe('day');
    expect(defaultPeriod(terms({ rateDayPaise: null, rateHourPaise: null, rateWeekPaise: 5_800_000 }))).toBe('week');
    expect(defaultPeriod(terms({ rateDayPaise: null, rateHourPaise: null }))).toBeNull();
  });
});

describe('toRentalRequestInput', () => {
  it('sends operator / transport only where the listing offers a choice, and trims empty text away', () => {
    const fixed = terms({ operator: 'included', transport: 'owner_delivers' });
    const input = toRentalRequestInput(filled({ sitePincode: '३६०००२', siteAddress: '  ', note: ' hi ' }), fixed);
    expect(input).toEqual({ startDate: '2026-11-21', period: 'day', count: 3, machines: 1, sitePincode: '360002', note: 'hi' });
    expect(toRentalRequestInput(filled(), terms())).toMatchObject({ withOperator: true, ownerDelivers: false });
  });

  it('a prefill with an unpriced period falls back to the default', () => {
    expect(rentalRequestValues(terms(), { period: 'month' }).period).toBe('day');
  });
});
