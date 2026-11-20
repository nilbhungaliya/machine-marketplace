import { describe, expect, it } from 'vitest';
import {
  appSettingDefaults,
  listingTransition,
  meetsRentalMinimum,
  notificationCategory,
  rentalBookingTransition,
  rentalEndDate,
  rentalEstimate,
  rentalYourTurn,
  sellerActions,
  validateSettings,
  type RentalBookingAction,
  type RentalBookingStatus,
  type RentalTermsSnapshot,
} from '@mpm/shared-types';

// M14 plan C0-1: the pure functions both the API and the app use (spec §6.1, §6.2, §6.6, R1, R2, §7.1, §11, §16).

type Side = 'renter' | 'owner' | 'system' | 'admin' | 'support';

describe('rentalBookingTransition (§6.1)', () => {
  const legal: Array<[RentalBookingStatus | null, RentalBookingAction, Side, RentalBookingStatus]> = [
    [null, 'request', 'renter', 'requested'],
    ['requested', 'confirm', 'owner', 'confirmed'],
    ['requested', 'change', 'owner', 'countered'],
    ['requested', 'decline', 'owner', 'declined'],
    ['requested', 'withdraw', 'renter', 'withdrawn'],
    ['countered', 'withdraw', 'renter', 'withdrawn'],
    ['countered', 'accept', 'renter', 'confirmed'],
    ['countered', 'change', 'renter', 'requested'],
    ['countered', 'decline', 'renter', 'declined'],
    ['requested', 'expire', 'system', 'expired'],
    ['countered', 'expire', 'system', 'expired'],
    ['requested', 'system_decline', 'system', 'declined'],
    ['countered', 'system_decline', 'system', 'declined'],
    ['requested', 'system_withdraw', 'system', 'withdrawn'],
    ['countered', 'system_withdraw', 'system', 'withdrawn'],
    ['requested', 'system_cancel', 'system', 'cancelled'],
    ['countered', 'system_cancel', 'system', 'cancelled'],
    ['confirmed', 'system_cancel', 'system', 'cancelled'],
    ['confirmed', 'on_site', 'renter', 'on_rent'],
    ['confirmed', 'on_site', 'owner', 'on_rent'],
    ['confirmed', 'cancel', 'renter', 'cancelled'],
    ['confirmed', 'cancel', 'owner', 'cancelled'],
    ['on_rent', 'return', 'owner', 'returned'],
    ['returned', 'confirm_return', 'renter', 'completed'],
    ['returned', 'auto_complete', 'system', 'completed'],
    ['on_rent', 'problem', 'renter', 'disputed'],
    ['on_rent', 'problem', 'owner', 'disputed'],
    ['returned', 'problem', 'renter', 'disputed'],
    ['returned', 'problem', 'owner', 'disputed'],
    ['disputed', 'resolve_completed', 'support', 'completed'],
    ['disputed', 'resolve_cancelled', 'support', 'cancelled'],
    ['requested', 'admin_cancel', 'admin', 'cancelled'],
    ['countered', 'admin_cancel', 'admin', 'cancelled'],
    ['confirmed', 'admin_cancel', 'admin', 'cancelled'],
  ];

  it.each(legal)('%s --%s (%s)--> %s', (from, action, side, to) => {
    expect(rentalBookingTransition(from, action, side)).toBe(to);
  });

  it.each<[RentalBookingStatus | null, RentalBookingAction, Side]>([
    ['requested', 'confirm', 'renter'],
    ['countered', 'accept', 'owner'],
    ['requested', 'on_site', 'owner'],
    ['on_rent', 'return', 'renter'],
    ['on_rent', 'admin_cancel', 'admin'],
    ['confirmed', 'change', 'owner'],
    ['confirmed', 'change', 'renter'],
    ['on_rent', 'cancel', 'renter'],
    [null, 'confirm', 'owner'],
    ['completed', 'problem', 'renter'],
  ])('refuses %s --%s (%s)', (from, action, side) => {
    expect(rentalBookingTransition(from, action, side)).toBeNull();
  });

  it('resume returns where the dispute started', () => {
    expect(rentalBookingTransition('disputed', 'resume', 'support', { disputedFrom: 'on_rent' })).toBe('on_rent');
    expect(rentalBookingTransition('disputed', 'resume', 'support', { disputedFrom: 'returned' })).toBe('returned');
    expect(rentalBookingTransition('disputed', 'resume', 'support', { disputedFrom: null })).toBeNull();
  });
});

describe('rentalEndDate (R1)', () => {
  it.each<[string, 'hour' | 'day' | 'week' | 'month', number, string]>([
    ['2026-11-21', 'day', 3, '2026-11-23'],
    ['2026-11-21', 'week', 2, '2026-12-04'],
    ['2026-11-21', 'month', 1, '2026-12-20'],
    ['2026-11-21', 'hour', 6, '2026-11-21'],
  ])('%s + %s × %d → %s', (start, period, count, end) => {
    expect(rentalEndDate(start, period, count)).toBe(end);
  });
});

describe('rentalEstimate (R2)', () => {
  const terms: RentalTermsSnapshot = {
    rateHourPaise: null,
    rateDayPaise: 960_000,
    rateWeekPaise: 5_000_000,
    rateMonthPaise: 18_000_000,
    shiftHours: 8,
    monthDays: 26,
    operator: 'optional',
    operatorRateDayPaise: 80_000,
    fuel: 'client',
    transport: 'either',
    transportChargePaise: 250_000,
    depositPaise: null,
    minDuration: null,
    minDurationPeriod: null,
    serviceRadiusKm: null,
  };

  it('adds rent, operator days and transport each way per machine', () => {
    expect(
      rentalEstimate(terms, { period: 'day', count: 3, machines: 2, withOperator: true, ownerDelivers: true }),
    ).toEqual({ days: 3, rentPaise: 5_760_000, operatorPaise: 480_000, transportPaise: 1_000_000, totalPaise: 7_240_000 });
  });

  it('counts 6 operator days a week and monthDays a month', () => {
    const week = rentalEstimate(terms, { period: 'week', count: 1, machines: 1, withOperator: true, ownerDelivers: false });
    expect(week?.days).toBe(6);
    expect(week?.operatorPaise).toBe(480_000);
    const month = rentalEstimate(terms, { period: 'month', count: 1, machines: 1, withOperator: true, ownerDelivers: false });
    expect(month?.days).toBe(26);
    expect(month?.operatorPaise).toBe(26 * 80_000);
  });

  it('is null for a period the listing does not price', () => {
    expect(rentalEstimate(terms, { period: 'hour', count: 4, machines: 1, withOperator: false, ownerDelivers: false })).toBeNull();
  });

  it('adds no operator money when the operator is included', () => {
    const e = rentalEstimate({ ...terms, operator: 'included' }, {
      period: 'day', count: 2, machines: 1, withOperator: true, ownerDelivers: false,
    });
    expect(e?.operatorPaise).toBe(0);
    expect(e?.totalPaise).toBe(1_920_000);
  });
});

describe('meetsRentalMinimum (§6.2)', () => {
  const hours = { minDuration: 4, minDurationPeriod: 'hour' as const };
  const days = { minDuration: 2, minDurationPeriod: 'day' as const };
  it('hour minimum', () => {
    expect(meetsRentalMinimum(hours, 'hour', 3)).toBe(false);
    expect(meetsRentalMinimum(hours, 'hour', 4)).toBe(true);
    expect(meetsRentalMinimum(hours, 'day', 1)).toBe(true);
  });
  it('day minimum', () => {
    expect(meetsRentalMinimum(days, 'hour', 24)).toBe(false);
    expect(meetsRentalMinimum(days, 'day', 1)).toBe(false);
    expect(meetsRentalMinimum(days, 'week', 1)).toBe(true);
  });
});

describe('rentalYourTurn (§6.6)', () => {
  const today = '2026-11-21';
  const b = (status: RentalBookingStatus, startDate = today, endDate = '2026-11-25') => ({
    status,
    startDate,
    endDate,
    turn: status === 'requested' ? ('owner' as const) : status === 'countered' ? ('renter' as const) : null,
  });
  it.each<[ReturnType<typeof b>, 'renter' | 'owner', boolean]>([
    [b('requested'), 'owner', true],
    [b('requested'), 'renter', false],
    [b('countered'), 'renter', true],
    [b('countered'), 'owner', false],
    [b('confirmed', today), 'owner', true],
    [b('confirmed', '2026-11-22'), 'owner', false],
    [b('confirmed', today), 'renter', false],
    [b('on_rent', '2026-11-18', today), 'owner', true],
    [b('on_rent', '2026-11-18', '2026-11-22'), 'owner', false],
    [b('returned'), 'renter', true],
    [b('returned'), 'owner', false],
    [b('completed'), 'renter', false],
  ])('%o for %s → %s', (booking, side, want) => {
    expect(rentalYourTurn(booking, side, today)).toBe(want);
  });
});

describe('notificationCategory (§11)', () => {
  it('rental_booking_* → rentals', () => {
    expect(notificationCategory('rental_booking_clash')).toBe('rentals');
    expect(notificationCategory('rental_booking_requested')).toBe('rentals');
  });
});

describe('listing transitions (§7.1)', () => {
  it('retires mark_rented / end_rental', () => {
    expect(listingTransition('live', 'mark_rented' as never, 'machine_rental')).toBeNull();
    expect(listingTransition('rented', 'end_rental' as never, 'machine_rental')).toBeNull();
    expect(sellerActions('live', 'machine_rental')).not.toContain('mark_rented');
  });
  it('lets the owner of a rented listing pause, renew and make it unavailable', () => {
    expect(listingTransition('rented', 'pause', 'machine_rental')?.to).toBe('paused');
    expect(listingTransition('rented', 'renew', 'machine_rental')?.to).toBe('gate');
    expect(listingTransition('rented', 'mark_unavailable', 'machine_rental')?.to).toBe('unavailable');
  });
  it('rent_out / rent_back are system transitions', () => {
    expect(listingTransition('live', 'rent_out', 'machine_rental', 'system')?.to).toBe('rented');
    expect(listingTransition('rented', 'rent_back', 'machine_rental', 'system')?.to).toBe('live');
  });
  it('refuses mark_sold on a rental', () => {
    expect(listingTransition('live', 'mark_sold', 'machine_rental')).toBeNull();
    expect(listingTransition('live', 'mark_sold', 'machine')?.to).toBe('sold');
  });
});

describe('validateSettings: M14 cross-check (§16)', () => {
  it('accepts the defaults and refuses unverified > verified', () => {
    expect(validateSettings(appSettingDefaults())).toBeNull();
    expect(
      validateSettings({ ...appSettingDefaults(), rental_open_limit_unverified: 16, rental_open_limit_verified: 15 })?.key,
    ).toBe('rental_open_limit_unverified');
  });
});
