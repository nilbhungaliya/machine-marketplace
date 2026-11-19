import { describe, expect, it } from 'vitest';
import {
  ADMIN_LISTING_ACTIONS,
  APP_SETTINGS,
  EDITABLE_LISTING_STATUSES,
  LISTING_STATUSES,
  LISTING_TRANSITIONS,
  OPEN_LISTING_STATUSES,
  PUBLIC_LISTING_STATUSES,
  SELLER_LISTING_ACTIONS,
  SYSTEM_LISTING_ACTIONS,
  VIDEO_FTYP_BRANDS,
  appSettingDefaults,
  checkFit,
  listingScore,
  listingTransition,
  normalizePartName,
  normalizePartNumber,
  partNumberBase,
  rentalDayEquivalent,
  sanityFlags,
  sellerActions,
  adminActions,
  validateSettings,
  type Fitment,
  type ListingKind,
  type ListingStatus,
  type ScoreInput,
  type SanityInput,
} from '@mpm/shared-types';

// The shared-types package has no test runner, so its listing helpers (spec 2026-11-18-f2-f3 §4.3, §5.4, §7.2, §8.3,
// §9.1, §12) are tested here.

describe('normalizePartNumber / partNumberBase (§4.3)', () => {
  it('upper-cases and removes every character outside A-Z 0-9', () => {
    expect(normalizePartNumber(' tp-200 L ')).toBe('TP200L');
    expect(normalizePartNumber('ab.12/x')).toBe('AB12X');
  });

  it('strips only the suffix that agrees with the listing side, longest first', () => {
    expect(partNumberBase('TP200L', 'left')).toBe('TP200');
    expect(partNumberBase('TP200R', 'right')).toBe('TP200');
    expect(partNumberBase('TP200L', 'right')).toBe('TP200L');
    expect(partNumberBase('AB12LH', 'left')).toBe('AB12');
    expect(partNumberBase('AB12RH', 'right')).toBe('AB12');
    expect(partNumberBase('AB12LEFT', 'left')).toBe('AB12');
    expect(partNumberBase('AB12RIGHT', 'right')).toBe('AB12');
    expect(partNumberBase('X1', 'pair')).toBe('X1');
    expect(partNumberBase('X1L', 'not_applicable')).toBe('X1L');
  });
});

describe('normalizePartName (§9.1)', () => {
  it('lower-cases, turns punctuation into spaces and removes English side words', () => {
    expect(normalizePartName('Temple Roller – Left (LH)')).toBe('temple roller');
    expect(normalizePartName('Temple roller R/H')).toBe('temple roller');
    expect(normalizePartName('Temple  roller, right-side')).toBe('temple roller side');
    expect(normalizePartName('Gear L H')).toBe('gear');
  });

  it('removes Hindi and Gujarati side words', () => {
    expect(normalizePartName('टेम्पल रोलर बायाँ')).toBe('टेम्पल रोलर');
    expect(normalizePartName('टेम्पल रोलर दायाँ')).toBe('टेम्पल रोलर');
    expect(normalizePartName('ટેમ્પલ રોલર ડાબું')).toBe('ટેમ્પલ રોલર');
    expect(normalizePartName('ટેમ્પલ રોલર જમણું')).toBe('ટેમ્પલ રોલર');
  });
});

describe('rentalDayEquivalent (§5.4)', () => {
  const none = { rateHourPaise: null, rateDayPaise: null, rateWeekPaise: null, rateMonthPaise: null, shiftHours: 8, monthDays: 26 };

  it('takes the day rate first', () => {
    expect(rentalDayEquivalent({ ...none, rateDayPaise: 300_000, rateHourPaise: 10_000 })).toBe(300_000);
  });

  it('then the hour rate times the shift hours', () => {
    expect(rentalDayEquivalent({ ...none, rateHourPaise: 10_000, shiftHours: 10 })).toBe(100_000);
  });

  it('then the week rate divided by 6', () => {
    expect(rentalDayEquivalent({ ...none, rateWeekPaise: 60_000, rateMonthPaise: 1 })).toBe(10_000);
  });

  it('then the month rate divided by month_days', () => {
    expect(rentalDayEquivalent({ ...none, rateMonthPaise: 260_000, monthDays: 26 })).toBe(10_000);
  });

  it('is null without any rate', () => {
    expect(rentalDayEquivalent(none)).toBeNull();
  });
});

describe('sanityFlags (§5.4)', () => {
  const part: SanityInput = { kind: 'part', priceModel: 'fixed', pricePaise: 1_000, quantity: '10', unitIsMachineUnit: false };

  it('flags a part priced under ₹5 and passes one at ₹10', () => {
    expect(sanityFlags({ ...part, pricePaise: 400 })).toEqual(['price_check']);
    expect(sanityFlags({ ...part, pricePaise: 1_000 })).toEqual([]);
  });

  it('does not check the price of a price-on-request listing', () => {
    expect(sanityFlags({ ...part, priceModel: 'on_request', pricePaise: null })).toEqual([]);
  });

  it('flags a machine priced under ₹10 000', () => {
    expect(sanityFlags({ kind: 'machine', priceModel: 'fixed', pricePaise: 900_000, quantity: '1' })).toEqual(['price_check']);
    expect(sanityFlags({ kind: 'machine', priceModel: 'fixed', pricePaise: 1_000_000, quantity: '1' })).toEqual([]);
  });

  it('checks a week-only rental on its day-equivalent rate', () => {
    const rental = { rateHourPaise: null, rateDayPaise: null, rateWeekPaise: 60_000, rateMonthPaise: null, shiftHours: 8, monthDays: 26 };
    expect(sanityFlags({ kind: 'machine_rental', quantity: '1', rental })).toEqual(['price_check']);
    expect(sanityFlags({ kind: 'machine_rental', quantity: '1', rental: { ...rental, rateWeekPaise: 600_000 } })).toEqual([]);
  });

  it('flags a part in a machine unit', () => {
    expect(sanityFlags({ ...part, unitIsMachineUnit: true })).toEqual(['unit_check']);
  });

  it('flags more than 50 machines and more than 100 000 parts', () => {
    expect(sanityFlags({ kind: 'machine', priceModel: 'on_request', quantity: '51' })).toEqual(['quantity_check']);
    expect(sanityFlags({ kind: 'machine', priceModel: 'on_request', quantity: '50' })).toEqual([]);
    expect(sanityFlags({ ...part, quantity: '100001' })).toEqual(['quantity_check']);
    expect(sanityFlags({ ...part, quantity: '100000' })).toEqual([]);
  });

  it('lists several flags in LISTING_FLAGS order', () => {
    expect(sanityFlags({ ...part, pricePaise: 100, unitIsMachineUnit: true, quantity: '200000' })).toEqual([
      'price_check', 'unit_check', 'quantity_check',
    ]);
  });
});

describe('listingScore (§5.4)', () => {
  const fullPart: ScoreInput = {
    kind: 'part',
    photoCount: 3,
    videoCount: 1,
    partNumber: 'TP-200L',
    fitmentCount: 1,
    year: null,
    hoursRun: null,
    specs: { temple_type: 'ring', note: 'x' },
    optionalSpecKeys: ['temple_type', 'note'],
    description: 'A temple roller in good condition, ready to fit.',
  };

  it('gives a complete part 100', () => {
    expect(listingScore(fullPart)).toEqual({ score: 100, missing: [] });
  });

  it('lists the missing items in table order', () => {
    const r = listingScore({ ...fullPart, photoCount: 1, videoCount: 0, partNumber: null, fitmentCount: 0, specs: {}, description: 'short' });
    expect(r.score).toBe(0);
    expect(r.missing).toEqual(['photos', 'video', 'part_number', 'fitment', 'optional_specs', 'description']);
  });

  it('scores machines on year, hours and a 20-point video and description', () => {
    const machine: ScoreInput = {
      kind: 'machine', photoCount: 3, videoCount: 0, partNumber: null, fitmentCount: 0, year: 2015, hoursRun: null,
      specs: {}, optionalSpecKeys: [], description: '',
    };
    expect(listingScore(machine)).toEqual({ score: 50, missing: ['video', 'hours_run', 'description'] });
  });
});

describe('checkFit (§8.3)', () => {
  const row = (r: Partial<Fitment>): Fitment => ({
    brandId: 'b1', modelId: null, modelOther: null, yearFrom: null, yearTo: null, note: null, ...r,
  });

  it('fits on a brand row with all models', () => {
    expect(checkFit([row({})], { brandId: 'b1', modelId: 'm9', year: 2020 })).toBe('fits');
  });

  it('fits the same model and not another one', () => {
    expect(checkFit([row({ modelId: 'm1' })], { brandId: 'b1', modelId: 'm1', year: null })).toBe('fits');
    expect(checkFit([row({ modelId: 'm1' })], { brandId: 'b1', modelId: 'm2', year: null })).toBe('not_listed');
    expect(checkFit([row({ modelId: 'm1' })], { brandId: 'b2', modelId: 'm1', year: null })).toBe('not_listed');
  });

  it('is not listed when the year is outside the range', () => {
    const fits = [row({ modelId: 'm1', yearFrom: 2012, yearTo: 2020 })];
    expect(checkFit(fits, { brandId: 'b1', modelId: 'm1', year: 2021 })).toBe('not_listed');
    expect(checkFit(fits, { brandId: 'b1', modelId: 'm1', year: 2011 })).toBe('not_listed');
    expect(checkFit(fits, { brandId: 'b1', modelId: 'm1', year: 2016 })).toBe('fits');
  });

  it('treats open ends as unbounded', () => {
    expect(checkFit([row({ yearFrom: 2012 })], { brandId: 'b1', modelId: null, year: 2030 })).toBe('fits');
    expect(checkFit([row({ yearTo: 2012 })], { brandId: 'b1', modelId: null, year: 1990 })).toBe('fits');
    expect(checkFit([row({ yearTo: 2012 })], { brandId: 'b1', modelId: null, year: 2013 })).toBe('not_listed');
  });

  it('does not count an "Other" model text as a catalogue model', () => {
    expect(checkFit([row({ modelOther: 'ZW 999' })], { brandId: 'b1', modelId: 'm1', year: null })).toBe('not_listed');
  });
});

describe('status lists (§7.1, §7.3, R36)', () => {
  it('adds hidden and expired', () => {
    expect(LISTING_STATUSES).toContain('hidden');
    expect(LISTING_STATUSES).toContain('expired');
  });

  it('defines public, editable and open statuses', () => {
    expect([...PUBLIC_LISTING_STATUSES]).toEqual(['live', 'reserved', 'rented']);
    expect([...EDITABLE_LISTING_STATUSES].sort()).toEqual(
      ['draft', 'pending_review', 'rejected', 'live', 'paused', 'reserved', 'expired', 'unavailable', 'sold', 'rented'].sort(),
    );
    expect([...OPEN_LISTING_STATUSES].sort()).toEqual(
      LISTING_STATUSES.filter((s) => !['draft', 'sold', 'removed'].includes(s)).sort(),
    );
  });

  it('keeps the ftyp brands as 4-character strings', () => {
    expect(VIDEO_FTYP_BRANDS).toContain('qt  ');
    expect(VIDEO_FTYP_BRANDS).toContain('M4V ');
    for (const b of VIDEO_FTYP_BRANDS) expect(b).toHaveLength(4);
  });
});

describe('LISTING_TRANSITIONS (§7.2)', () => {
  // [from, action, kind, expected to]
  const cases: Array<[ListingStatus, string, ListingKind, string]> = [
    ['draft', 'publish', 'part', 'gate'],
    ['rejected', 'publish', 'part', 'gate'],
    ['pending_review', 'approve', 'part', 'return_status'],
    ['pending_review', 'ask_for_changes', 'part', 'rejected'],
    ['pending_review', 'reject', 'part', 'rejected'],
    ['live', 'pause', 'part', 'paused'],
    ['paused', 'resume', 'part', 'gate'],
    ['live', 'renew', 'part', 'gate'],
    ['expired', 'renew', 'part', 'gate'],
    ['live', 'mark_sold', 'part', 'sold'],
    ['paused', 'mark_sold', 'part', 'sold'],
    ['expired', 'mark_sold', 'part', 'sold'],
    ['unavailable', 'mark_sold', 'part', 'sold'],
    ['live', 'mark_unavailable', 'part', 'unavailable'],
    ['paused', 'mark_unavailable', 'part', 'unavailable'],
    ['expired', 'mark_unavailable', 'part', 'unavailable'],
    ['sold', 'relist', 'part', 'gate'],
    ['unavailable', 'relist', 'part', 'gate'],
    ['live', 'mark_rented', 'machine_rental', 'rented'],
    ['rented', 'end_rental', 'machine_rental', 'gate'],
    ['live', 'remove', 'part', 'removed'],
    ['hidden', 'remove', 'part', 'removed'],
    ['pending_review', 'remove', 'part', 'removed'],
    ['live', 'expire', 'part', 'expired'],
    ['rented', 'expire', 'machine_rental', 'expired'],
    ['live', 'back_to_review', 'part', 'pending_review'],
    ['rented', 'back_to_review', 'machine_rental', 'pending_review'],
    ['live', 'hide', 'part', 'hidden'],
    ['sold', 'hide', 'part', 'hidden'],
    ['rented', 'hide', 'machine_rental', 'hidden'],
    ['hidden', 'unhide', 'part', 'return_status'],
    ['live', 'photos_removed', 'part', 'rejected'],
    ['sold', 'photos_removed', 'part', 'rejected'],
    ['live', 'reserve', 'part', 'reserved'],
    ['reserved', 'unreserve', 'part', 'live'],
    // F6 + F7 §8.3: what `reserved` gained, and the system sell-out.
    ['reserved', 'pause', 'part', 'paused'],
    ['reserved', 'mark_unavailable', 'part', 'unavailable'],
    ['reserved', 'hide', 'part', 'hidden'],
    ['reserved', 'photos_removed', 'part', 'rejected'],
    ['reserved', 'back_to_review', 'part', 'pending_review'],
    ['live', 'sell_out', 'part', 'sold'],
    ['reserved', 'sell_out', 'part', 'sold'],
    ['paused', 'sell_out', 'part', 'sold'],
    ['unavailable', 'sell_out', 'part', 'sold'],
    ['expired', 'sell_out', 'machine', 'sold'],
  ];

  it.each(cases)('%s --%s (%s)--> %s', (from, action, kind, to) => {
    expect(listingTransition(from, action as never, kind)?.to).toBe(to);
  });

  it('refuses what the table does not allow', () => {
    expect(listingTransition('hidden', 'resume', 'part')).toBeNull();
    expect(listingTransition('rented', 'mark_rented', 'machine_rental')).toBeNull();
    expect(listingTransition('live', 'mark_rented', 'part')).toBeNull();
    expect(listingTransition('live', 'mark_rented', 'machine')).toBeNull();
    expect(listingTransition('draft', 'remove', 'part')).toBeNull();
    expect(listingTransition('removed', 'remove', 'part')).toBeNull();
    expect(listingTransition('draft', 'hide', 'part')).toBeNull();
    expect(listingTransition('paused', 'expire', 'part')).toBeNull();
    // F6 + F7 §8.2, §8.3: a reserved listing doesn't expire; sell-out on hidden / in review / rejected only sets
    // return_status; a seller can't mark a reserved listing sold (its stock is held in deals).
    expect(listingTransition('reserved', 'expire', 'part')).toBeNull();
    for (const from of ['hidden', 'pending_review', 'rejected', 'removed', 'sold'] as const) {
      expect(listingTransition(from, 'sell_out', 'part')).toBeNull();
    }
    expect(listingTransition('reserved', 'mark_sold', 'part')).toBeNull();
  });

  it('tells seller and admin remove apart by actor', () => {
    expect(listingTransition('live', 'remove', 'part', 'seller')?.actor).toBe('seller');
    expect(listingTransition('live', 'remove', 'part', 'admin')?.actor).toBe('admin');
  });

  it('gives the seller only remove on a hidden listing', () => {
    expect(sellerActions('hidden', 'part')).toEqual(['remove']);
  });

  it('offers mark_rented on a live rental only', () => {
    expect(sellerActions('live', 'machine_rental')).toContain('mark_rented');
    expect(sellerActions('live', 'machine')).not.toContain('mark_rented');
    expect(sellerActions('live', 'part')).toEqual(['pause', 'renew', 'mark_sold', 'mark_unavailable', 'remove']);
    expect(sellerActions('draft', 'part')).toEqual([]);
  });

  it('gives a moderator the actions of the status (admin action bar, §11.3)', () => {
    expect(adminActions('pending_review', 'part')).toEqual(['approve', 'ask_for_changes', 'reject', 'remove']);
    expect(adminActions('live', 'part')).toEqual(['hide', 'remove']);
    expect(adminActions('hidden', 'machine')).toEqual(['unhide', 'remove']);
    expect(adminActions('removed', 'part')).toEqual([]);
    expect(adminActions('draft', 'part')).toEqual([]);
  });

  it('has no duplicate action anywhere (decision 8)', () => {
    const all = [
      ...SELLER_LISTING_ACTIONS, ...ADMIN_LISTING_ACTIONS, ...SYSTEM_LISTING_ACTIONS,
      ...LISTING_TRANSITIONS.map((t) => t.action),
    ] as string[];
    expect(all).not.toContain('duplicate');
  });
});

describe('APP_SETTINGS / validateSettings (§12)', () => {
  it('has the four F2 settings with their defaults', () => {
    expect(appSettingDefaults()).toMatchObject({
      listing_expiry_days: 60,
      listing_expiry_reminder_days: 7,
      listing_review_first_n: 3,
      unverified_listing_cap: 3,
    });
    // + the 15 F6 + F7 settings (spec §17).
    expect(APP_SETTINGS.map((s) => s.key)).toHaveLength(19);
  });

  it('accepts the defaults', () => {
    expect(validateSettings(appSettingDefaults())).toBeNull();
  });

  it('refuses a reminder that is not shorter than the expiry', () => {
    const err = validateSettings({ ...appSettingDefaults(), listing_expiry_days: 10, listing_expiry_reminder_days: 10 });
    expect(err?.key).toBe('listing_expiry_reminder_days');
  });

  it('refuses out-of-range and non-integer values', () => {
    expect(validateSettings({ ...appSettingDefaults(), listing_expiry_days: 6 })?.key).toBe('listing_expiry_days');
    expect(validateSettings({ ...appSettingDefaults(), unverified_listing_cap: 0 })?.key).toBe('unverified_listing_cap');
    expect(validateSettings({ ...appSettingDefaults(), listing_review_first_n: 2.5 })?.key).toBe('listing_review_first_n');
  });
});
