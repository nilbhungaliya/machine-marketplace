import { afterEach, describe, expect, it } from 'vitest';
import type { RentalTerms, TemplateField } from '@mpm/shared-types';
import { i18n } from '@/lib/i18n';
import {
  availabilityText, conditionLabel, distanceText, galleryOrder, headlinePrice, hoursRunText, rentalRateCards, rentalTermRows, expiresText, fitLine, placeText, priceLine, priceNote, priceText, quantityText,
  rateText, sideLabel, sideTokenKind, specRows, unitLabel, unitPer, updatedAgo, yearRange,
} from './listing-format';
import { cardFixture } from './listing-fixtures.test-helper';

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('master-data labels', () => {
  it('condition label by key, falling back to the server label for an unknown key', () => {
    expect(conditionLabel({ key: 'unused', label: 'x' })).toBe('Unused');
    expect(conditionLabel({ key: 'refurbished', label: 'Refurbished' })).toBe('Refurbished');
    expect(conditionLabel(null)).toBe('');
  });
  it('condition label follows the language', async () => {
    await i18n.changeLanguage('gu');
    expect(conditionLabel({ key: 'new', label: 'New' })).toBe('નવું');
  });
  it('unit label, per and count, with fallbacks', () => {
    expect(unitLabel({ key: 'pcs', label: 'x' })).toBe('Pieces');
    expect(unitLabel({ key: 'bundles', label: 'Bundles' })).toBe('Bundles');
    expect(unitPer({ key: 'pcs', label: 'x' })).toBe('/pc');
    expect(unitPer({ key: 'bundles', label: 'Bundles' })).toBe('/ Bundles');
    expect(quantityText('14', { key: 'pcs', label: 'x' })).toBe('14 pcs');
    expect(quantityText('1', { key: 'pcs', label: 'x' })).toBe('1 pc');
    expect(quantityText('2.5', { key: 'kg', label: 'x' })).toBe('2.5 kg');
    expect(quantityText('1200', { key: 'bundles', label: 'Bundles' })).toBe('1,200 Bundles');
    expect(quantityText(null, { key: 'pcs', label: 'x' })).toBe('');
  });
});

describe('prices', () => {
  it('part price per unit with model and GST', () => {
    const card = cardFixture();
    expect(priceText(card)).toBe('₹420 /pc');
    expect(priceNote(card)).toBe('Negotiable · GST extra');
    expect(priceLine(card)).toBe('₹420 /pc · Negotiable · GST extra');
  });
  it('machines have no per-unit suffix; on request has no note', () => {
    expect(priceText(cardFixture({ kind: 'machine', pricePaise: 150_000_000, unit: { key: 'machines', label: 'x', decimals: 0 } }))).toBe('₹15,00,000');
    const onRequest = cardFixture({ priceModel: 'on_request', pricePaise: null });
    expect(priceLine(onRequest)).toBe('Price on request');
  });
  it('rentals show their headline rate', () => {
    const rental = cardFixture({ kind: 'machine_rental', priceModel: null, pricePaise: null, rate: { period: 'day', paise: 250_000 } });
    expect(priceText(rental)).toBe('₹2,500 /day');
    expect(priceLine(rental)).toBe('₹2,500 /day');
    expect(rateText(null)).toBe('');
  });
});

describe('fits', () => {
  it('model and years', () => {
    expect(fitLine({ brandName: 'Tsudakoma', modelName: 'ZW 408', modelOther: null, yearFrom: 2012, yearTo: 2020, note: null }))
      .toBe('Tsudakoma ZW 408 · 2012–2020');
  });
  it('all models, an Other model, open ranges and a note', () => {
    expect(fitLine({ brandName: 'Toyota', modelName: null, modelOther: null, yearFrom: null, yearTo: null, note: null })).toBe('Toyota · all models');
    expect(fitLine({ brandName: 'Toyota', modelName: null, modelOther: 'JAT 610', yearFrom: 2015, yearTo: null, note: 'with tensioner' }))
      .toBe('Toyota JAT 610 · 2015 on · with tensioner');
    expect(yearRange(null, 2020)).toBe('up to 2020');
    expect(yearRange(2018, 2018)).toBe('2018');
  });
});

describe('time, distance, place, side', () => {
  const now = Date.parse('2026-11-18T10:00:00.000Z');
  it('updated ago', () => {
    expect(updatedAgo('2026-11-18T01:00:00.000Z', now)).toBe('Updated today');
    expect(updatedAgo('2026-11-17T09:00:00.000Z', now)).toBe('Updated 1 day ago');
    expect(updatedAgo('2026-11-15T09:00:00.000Z', now)).toBe('Updated 3 days ago');
    expect(updatedAgo('2026-09-01T09:00:00.000Z', now)).toBe('Updated 1 Sep 2026');
    expect(updatedAgo(null, now)).toBe('');
  });
  it('expires', () => {
    expect(expiresText('2026-11-23T11:00:00.000Z', now)).toBe('Expires in 5 days');
    expect(expiresText('2026-11-18T20:00:00.000Z', now)).toBe('Expires today');
    expect(expiresText('2026-11-17T20:00:00.000Z', now)).toBe('Expired');
  });
  it('distance and place', () => {
    expect(distanceText(0.4)).toBe('Less than 1 km away');
    expect(distanceText(18)).toBe('18 km away');
    expect(distanceText(null)).toBe('');
    expect(placeText({ industrialAreaName: 'Aji GIDC', city: 'Rajkot' })).toBe('Aji GIDC, Rajkot');
    expect(placeText({ industrialAreaName: null, city: 'Rajkot' })).toBe('Rajkot');
  });
  it('side', () => {
    expect(sideLabel('pair')).toBe('Pair (both sides)');
    expect(sideTokenKind('not_applicable')).toBe('none');
    expect(sideTokenKind('left')).toBe('left');
  });
});

describe('specRows', () => {
  const field = (over: Partial<TemplateField>): TemplateField => ({
    id: 'f', categoryId: 'c', key: 'k', label: 'L', helpText: null, type: 'text', appliesTo: 'both', unit: null, min: null,
    max: null, required: false, filterable: false, highlightRank: null, sortOrder: 0, status: 'active', options: [], ...over,
  });
  it('labels, option labels, units and template order; empties skipped', () => {
    const fields = [
      field({ key: 'width', label: 'Reed width', type: 'number', unit: 'cm' }),
      field({
        key: 'shed', label: 'Shedding', type: 'single_select',
        options: [{ id: 'o1', key: 'dobby', label: 'Dobby', sortOrder: 0, status: 'active' }],
      }),
      field({
        key: 'feeds', label: 'Feeds', type: 'multi_select',
        options: [
          { id: 'o2', key: 'a', label: 'Alpha', sortOrder: 0, status: 'active' },
          { id: 'o3', key: 'b', label: 'Beta', sortOrder: 1, status: 'active' },
        ],
      }),
      field({ key: 'made', label: 'Made on', type: 'date' }),
      field({ key: 'note', label: 'Note' }),
    ];
    expect(specRows(fields, { shed: 'dobby', width: 190, feeds: ['a', 'b'], made: '2020-03-05', note: '', extra: 'x' })).toEqual([
      { key: 'width', label: 'Reed width', value: '190 cm' },
      { key: 'shed', label: 'Shedding', value: 'Dobby' },
      { key: 'feeds', label: 'Feeds', value: 'Alpha, Beta' },
      { key: 'made', label: 'Made on', value: '5 Mar 2020' },
    ]);
  });
});

describe('rentals', () => {
  const terms: RentalTerms = {
    rateHourPaise: null, rateDayPaise: 250_000, rateWeekPaise: null, rateMonthPaise: 5_000_000, shiftHours: 8, monthDays: 26,
    overtimeRateHourPaise: 40_000, minDuration: 4, minDurationPeriod: 'hour', operator: 'optional', operatorRateDayPaise: 80_000,
    fuel: 'client', transport: 'owner_delivers', transportChargePaise: 200_000, serviceRadiusKm: 50, depositPaise: 1_000_000,
    availableFrom: '2026-12-05', availabilityNote: null,
  };
  it('rate cards in period order', () => {
    expect(rentalRateCards(terms)).toEqual([
      { period: 'day', label: 'Per day', amount: '₹2,500' },
      { period: 'month', label: 'Per month', amount: '₹50,000' },
    ]);
  });
  it('term rows', () => {
    expect(rentalTermRows(terms).map((r) => `${r.label}: ${r.value}`)).toEqual([
      'Operator: Operator on request · ₹800 /day',
      'Fuel: You supply the diesel',
      'Transport: Owner delivers · ₹2,000 each way',
      'Minimum hire: 4 hours',
      'Overtime: ₹400 /hr',
      'Security deposit: ₹10,000',
    ]);
  });
  it('availability', () => {
    const now = Date.parse('2026-11-18T10:00:00.000Z');
    expect(availabilityText('2026-12-05', now)).toBe('Available from 5 Dec 2026');
    expect(availabilityText('2026-11-01', now)).toBe('Available now');
    expect(availabilityText(null, now)).toBe('Available now');
  });
});

describe('galleryOrder', () => {
  it('photos by sort order (cover first), then videos', () => {
    const m = (id: string, type: 'photo' | 'video', sortOrder: number) => ({ id, type, sortOrder });
    expect(galleryOrder([m('v', 'video', 0), m('p2', 'photo', 3), m('p1', 'photo', 1)]).map((x) => x.id)).toEqual(['p1', 'p2', 'v']);
  });
});

describe('listing page price and hours', () => {
  it('headlinePrice: an amount, Price on request, or nothing for a draft without a price model or price', () => {
    expect(headlinePrice({ kind: 'part', priceModel: 'fixed', pricePaise: 42_000 })).toEqual({ type: 'amount', paise: 42_000 });
    expect(headlinePrice({ kind: 'part', priceModel: 'on_request', pricePaise: null })).toEqual({ type: 'on_request' });
    expect(headlinePrice({ kind: 'part', priceModel: null, pricePaise: null })).toBeNull();
    expect(headlinePrice({ kind: 'machine', priceModel: 'negotiable', pricePaise: null })).toBeNull();
    expect(headlinePrice({ kind: 'machine_rental', priceModel: null, pricePaise: null })).toBeNull();
  });
  it('hoursRunText: Indian grouping and a counted unit', () => {
    expect(hoursRunText(12_000)).toBe('12,000 hours');
    expect(hoursRunText(1)).toBe('1 hour');
    expect(hoursRunText(1_25_000)).toBe('1,25,000 hours');
  });
});
