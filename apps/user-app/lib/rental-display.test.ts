import { describe, expect, it } from 'vitest';
import type { RentalEstimateResult, RentalTermsSnapshot, RentalVersionView } from '@mpm/shared-types';
import { bookingStatusChip, dateRangeLabel, estimateLines, moneySteps } from './rental-display';

const version = (over: Partial<RentalVersionView> = {}): RentalVersionView => ({
  seq: 1, proposedBy: 'renter', startDate: '2026-11-21', endDate: '2026-11-23', period: 'day', count: 3, machines: 1,
  withOperator: false, ownerDelivers: true, estimatePaise: 3_380_000, totalPaise: 3_380_000, message: null,
  messageFlagged: false, createdAt: '2026-11-20T10:00:00.000Z', ...over,
});

const terms: RentalTermsSnapshot = {
  rateHourPaise: null, rateDayPaise: 960_000, rateWeekPaise: null, rateMonthPaise: null, shiftHours: 8, monthDays: 26,
  operator: 'optional', operatorRateDayPaise: 80_000, fuel: 'client', transport: 'either', transportChargePaise: 250_000,
  depositPaise: null, minDuration: null, minDurationPeriod: null, serviceRadiusKm: null,
};

describe('rental display (M14 §14.2)', () => {
  it('moneySteps marks a final amount that differs from the agreed total', () => {
    const base = { current: version(), agreedTotalPaise: 3_380_000 };
    expect(moneySteps({ ...base, finalAmountPaise: 3_500_000 })).toEqual({
      estimate: 3_380_000, agreed: 3_380_000, final: 3_500_000, changed: true,
    });
    expect(moneySteps({ ...base, finalAmountPaise: 3_380_000 }).changed).toBe(false);
    expect(moneySteps({ ...base, finalAmountPaise: null }).changed).toBe(false);
  });

  it("a countered booking is the renter's answer and the owner's wait", () => {
    expect(bookingStatusChip('countered', 'renter')).toEqual({ tone: 'new', key: 'rentals.status.yourAnswer' });
    expect(bookingStatusChip('countered', 'owner')).toEqual({ tone: 'warn', key: 'rentals.status.waitingRenter' });
    expect(bookingStatusChip('requested', 'owner').tone).toBe('new');
    expect(bookingStatusChip('cancelled', 'renter')).toEqual({ tone: 'neutral', key: 'rentals.status.cancelled' });
  });

  it('estimateLines leaves out zero parts', () => {
    const e: RentalEstimateResult = {
      endDate: '2026-11-23', days: 3, rentPaise: 2_880_000, operatorPaise: 0, transportPaise: 500_000,
      totalPaise: 3_380_000, free: true, minimumMet: true, beyondServiceRadius: null, withOperator: false,
      ownerDelivers: true,
    };
    expect(estimateLines(e)).toEqual([
      { key: 'rentals.money.rent', paise: 2_880_000 },
      { key: 'rentals.money.transport', paise: 500_000 },
      { key: 'rentals.money.total', paise: 3_380_000 },
    ]);
    // A version: parts from the terms; the owner's own total adds the estimate line.
    expect(estimateLines(version({ totalPaise: 3_000_000 }), terms).map((l) => l.key)).toEqual([
      'rentals.money.rent', 'rentals.money.transport', 'rentals.money.estimate', 'rentals.money.total',
    ]);
  });

  it('dateRangeLabel reads one day, one month, two months and two years', () => {
    expect(dateRangeLabel('2026-11-21', '2026-11-21', 'en')).toBe('21 Nov');
    expect(dateRangeLabel('2026-11-21', '2026-11-23', 'en')).toBe('21–23 Nov');
    expect(dateRangeLabel('2026-11-28', '2026-12-02', 'en')).toBe('28 Nov – 2 Dec');
    expect(dateRangeLabel('2026-12-28', '2027-01-03', 'en')).toBe('28 Dec 2026 – 3 Jan 2027');
  });
});
