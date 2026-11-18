import { describe, expect, it } from 'vitest';
import type { RentalTerms } from '@mpm/shared-types';
import { ownerFixture } from './listing-fixtures.test-helper';
import {
  editFlags, editSaveToastKey, fitRowPatch, specErrorsFromApi, locationInitial, locationPatch, machineInitial, machinePatch, partDetailsPatch, previewFlags, priceInitial,
  pricePatch, quantityInitial, quantityPatch, ratesInitial, ratesPatch, translateErrors, validateFitRow, validateLocation,
  validateMachine, validatePartDetails, validatePrice, validateQuantity, validateRates, type FitRowValues,
  type LocationValues, type MachineValues, type RatesValues,
} from './sell-form';

const keys = (errs: Record<string, { key: string } | undefined>) =>
  Object.fromEntries(Object.entries(errs).filter(([, v]) => v).map(([k, v]) => [k, v!.key]));

describe('part details', () => {
  it('checks title length, part number characters and description length', () => {
    expect(keys(validatePartDetails({ title: ' ab ', partNumber: '', description: '' }))).toEqual({ title: 'sell.validation.titleLength' });
    expect(keys(validatePartDetails({ title: 'Temple roller', partNumber: 'TP#200', description: '' })))
      .toEqual({ partNumber: 'sell.details.partNumberInvalid' });
    expect(keys(validatePartDetails({ title: 'Temple roller', partNumber: 'tp-200 L/2.5', description: 'x'.repeat(1501) })))
      .toEqual({ description: 'sell.validation.textMax' });
    expect(validatePartDetails({ title: 'Temple roller', partNumber: 'a'.repeat(41), description: '' }).partNumber?.key)
      .toBe('sell.details.partNumberInvalid');
  });

  it('trims and sends empties as null', () => {
    expect(partDetailsPatch({ title: '  Temple roller ', partNumber: ' ', description: '' }, { width: 5 }))
      .toEqual({ title: 'Temple roller', partNumber: null, description: null, specs: { width: 5 } });
  });
});

describe('quantity and condition', () => {
  it('parses parts with the unit decimals and asks for unit and condition', () => {
    const v = { quantity: '1.5', unitId: '', conditionId: '', conditionNote: '' };
    expect(keys(validateQuantity(v, { kind: 'part', decimals: 0 })))
      .toEqual({ quantity: 'sell.quantity.decimals', unitId: 'sell.validation.pickOne', conditionId: 'sell.validation.pickOne' });
    expect(validateQuantity({ ...v, unitId: 'u', conditionId: 'c' }, { kind: 'part', decimals: 1 })).toEqual({});
  });

  it('takes whole machines 1–1000 and no unit', () => {
    expect(keys(validateQuantity({ quantity: '1001', unitId: '', conditionId: 'c', conditionNote: '' }, { kind: 'machine', decimals: 0 })))
      .toEqual({ quantity: 'sell.quantity.tooLarge' });
    expect(quantityPatch({ quantity: '२', unitId: 'ignored', conditionId: 'c', conditionNote: ' ' }, 'machine'))
      .toEqual({ quantity: '2', conditionId: 'c', conditionNote: null });
  });

  it('round-trips a part', () => {
    const l = ownerFixture({ quantity: '14', unitId: 'u1', conditionId: 'c1', conditionNote: 'rust' });
    const v = quantityInitial(l);
    expect(v).toEqual({ quantity: '14', unitId: 'u1', conditionId: 'c1', conditionNote: 'rust' });
    expect(quantityPatch(v, 'part')).toEqual({ quantity: '14', unitId: 'u1', conditionId: 'c1', conditionNote: 'rust' });
  });
});

const machineValues = (over: Partial<MachineValues> = {}): MachineValues => ({
  ...machineInitial(ownerFixture({ kind: 'machine' })),
  title: 'Rapier loom, Picanol OptiMax',
  brandId: 'b1',
  ...over,
});

describe('machine', () => {
  it('needs a make from the list or typed under Other', () => {
    expect(validateMachine(machineValues({ brandId: null }), { kind: 'machine', thisYear: 2026 }).brandId?.key)
      .toBe('sell.machine.makeRequired');
    expect(validateMachine(machineValues({ brandId: null, brandIsOther: true, brandOther: 'X' }), { kind: 'machine', thisYear: 2026 }).brandOther?.key)
      .toBe('sell.machine.otherLength');
    expect(validateMachine(machineValues(), { kind: 'machine', thisYear: 2026 })).toEqual({});
  });

  it('checks year, hours and the rental machine count', () => {
    const errs = validateMachine(machineValues({ year: '2027', hoursRun: '1.5', count: '0' }), { kind: 'machine_rental', thisYear: 2026 });
    expect(keys(errs)).toEqual({ year: 'sell.validation.wholeRange', hoursRun: 'sell.validation.wholeRange', count: 'sell.quantity.zero' });
  });

  it('sends Other text instead of a catalogue id, and no reason for sale on a rental', () => {
    const v = machineValues({
      brandId: null, brandIsOther: true, brandOther: ' Local make ', modelIsOther: true, modelOther: 'Z1', year: '२०१८',
      hoursRun: '12000', serialNumber: ' SN-1 ', underPower: true, reasonForSale: 'Upgrading', count: '3',
    });
    expect(machinePatch(v, 'machine_rental', { rpm: 400 })).toEqual({
      title: 'Rapier loom, Picanol OptiMax', description: null, specs: { rpm: 400 }, quantity: '3',
      machine: {
        brandId: null, brandOther: 'Local make', modelId: null, modelOther: 'Z1', year: 2018, hoursRun: 12000,
        serialNumber: 'SN-1', underPower: true, inspectionByAppointment: false,
      },
    });
    expect(machinePatch(machineValues({ reasonForSale: ' Upgrading ' }), 'machine', {}).machine?.reasonForSale).toBe('Upgrading');
    expect(machinePatch(machineValues(), 'machine', {})).not.toHaveProperty('quantity');
  });

  it('starts from the stored machine', () => {
    const l = ownerFixture({
      kind: 'machine_rental', title: 'Loom', quantity: '2',
      machine: {
        brandId: null, brandName: null, brandOther: 'Local', modelId: 'm1', modelName: 'Z', modelOther: null, year: 2018,
        hoursRun: null, underPower: true, inspectionByAppointment: false, reasonForSale: null, serialNumber: 'S',
      },
    });
    const v = machineInitial(l);
    expect(v).toMatchObject({ brandIsOther: true, brandOther: 'Local', modelId: 'm1', year: '2018', hoursRun: '', count: '2', serialNumber: 'S' });
  });
});

const fitRow = (over: Partial<FitRowValues> = {}): FitRowValues => ({
  brandId: 'b1', modelMode: 'all', modelId: null, modelOther: '', yearFrom: '', yearTo: '', note: '', ...over,
});

describe('fit rows', () => {
  it('needs a brand, a model when one is chosen, years 1950 … next year in order', () => {
    expect(keys(validateFitRow(fitRow({ brandId: null }), 2026))).toEqual({ brandId: 'sell.validation.pickOne' });
    expect(keys(validateFitRow(fitRow({ modelMode: 'catalogue' }), 2026))).toEqual({ modelId: 'sell.validation.pickOne' });
    expect(keys(validateFitRow(fitRow({ modelMode: 'other', modelOther: ' ' }), 2026))).toEqual({ modelOther: 'sell.machine.otherLength' });
    expect(keys(validateFitRow(fitRow({ yearFrom: '1949', yearTo: '2028' }), 2026)))
      .toEqual({ yearFrom: 'sell.validation.wholeRange', yearTo: 'sell.validation.wholeRange' });
    expect(keys(validateFitRow(fitRow({ yearFrom: '2020', yearTo: '2012' }), 2026))).toEqual({ yearTo: 'sell.fit.yearOrder' });
    expect(validateFitRow(fitRow({ yearFrom: '2012', yearTo: '2027', note: 'x'.repeat(80) }), 2026)).toEqual({});
  });

  it('turns the form into a fitment row', () => {
    expect(fitRowPatch(fitRow({ modelMode: 'catalogue', modelId: 'm1', modelOther: 'stale', yearFrom: '2012', note: ' hyd ' })))
      .toEqual({ brandId: 'b1', modelId: 'm1', modelOther: null, yearFrom: 2012, yearTo: null, note: 'hyd' });
    expect(fitRowPatch(fitRow({ modelMode: 'other', modelId: 'stale', modelOther: 'ZW 9' })))
      .toEqual({ brandId: 'b1', modelId: null, modelOther: 'ZW 9', yearFrom: null, yearTo: null, note: null });
  });
});

describe('price', () => {
  const base = { priceModel: 'fixed' as const, price: '420', gstMode: 'extra' as const, minOrder: '' };

  it('needs an amount ₹1 … ₹100 crore and GST unless on request', () => {
    expect(validatePrice(base, { kind: 'part', decimals: 0, quantity: '14' })).toEqual({});
    expect(keys(validatePrice({ ...base, price: '0.5', gstMode: null }, { kind: 'part', decimals: 0, quantity: '14' })))
      .toEqual({ price: 'sell.price.range', gstMode: 'sell.validation.pickOne' });
    expect(keys(validatePrice({ ...base, price: '4.567' }, { kind: 'part', decimals: 0, quantity: '14' })))
      .toEqual({ price: 'sell.price.invalid' });
    expect(validatePrice({ priceModel: 'on_request', price: '', gstMode: null, minOrder: '' }, { kind: 'machine', decimals: 0, quantity: '1' }))
      .toEqual({});
    expect(keys(validatePrice({ ...base, priceModel: null }, { kind: 'part', decimals: 0, quantity: '1' })))
      .toEqual({ priceModel: 'sell.validation.pickOne' });
  });

  it('takes ₹1 and ₹100 crore, and refuses just outside them', () => {
    const ctx = { kind: 'machine' as const, decimals: 0, quantity: '1' };
    expect(validatePrice({ ...base, price: '1' }, ctx)).toEqual({});
    expect(validatePrice({ ...base, price: '1,00,00,00,000' }, ctx)).toEqual({});
    expect(keys(validatePrice({ ...base, price: '0.99' }, ctx))).toEqual({ price: 'sell.price.range' });
    expect(keys(validatePrice({ ...base, price: '1000000000.01' }, ctx))).toEqual({ price: 'sell.price.range' });
  });

  it('keeps the minimum order within the quantity and the unit decimals', () => {
    expect(keys(validatePrice({ ...base, minOrder: '20' }, { kind: 'part', decimals: 0, quantity: '14' })))
      .toEqual({ minOrder: 'listing.errors.minOrderAboveQuantity' });
    expect(keys(validatePrice({ ...base, minOrder: '2.5' }, { kind: 'part', decimals: 0, quantity: '14' })))
      .toEqual({ minOrder: 'sell.quantity.decimals' });
  });

  it('clears price and GST on request, and sends min order only for parts', () => {
    expect(pricePatch({ priceModel: 'on_request', price: '420', gstMode: 'extra', minOrder: '2' }, 'part'))
      .toEqual({ priceModel: 'on_request', pricePaise: null, gstMode: null, minOrderQty: '2' });
    expect(pricePatch({ ...base, price: '1,23,456.5' }, 'machine'))
      .toEqual({ priceModel: 'fixed', pricePaise: 12_345_650, gstMode: 'extra' });
    expect(priceInitial(ownerFixture({ priceModel: 'negotiable', pricePaise: 42_050, gstMode: 'included', minOrderQty: '2' })))
      .toEqual({ priceModel: 'negotiable', price: '420.50', gstMode: 'included', minOrder: '2' });
  });
});

const rental = (over: Partial<RentalTerms> = {}): RentalTerms => ({
  rateHourPaise: null, rateDayPaise: null, rateWeekPaise: null, rateMonthPaise: null, shiftHours: 8, monthDays: 26,
  overtimeRateHourPaise: null, minDuration: null, minDurationPeriod: null, operator: null, operatorRateDayPaise: null,
  fuel: 'client', transport: null, transportChargePaise: null, serviceRadiusKm: null, depositPaise: null,
  availableFrom: null, availabilityNote: null, ...over,
});

describe('rates and terms', () => {
  const v = (over: Partial<RatesValues> = {}): RatesValues => ({ ...ratesInitial(null), ...over });

  it('starts from the defaults (8-hour day, 26-day month, client fuel)', () => {
    expect(ratesInitial(null)).toMatchObject({ shiftHours: '8', monthDays: '26', fuel: 'client', day: '' });
    expect(ratesInitial(rental({ rateDayPaise: 250_000, availableFrom: '2026-12-01' }))).toMatchObject({ day: '2500', availableFrom: '2026-12-01' });
  });

  it('needs at least one rate, and valid terms', () => {
    const ctx = { today: '2026-11-18', previousAvailableFrom: null };
    expect(keys(validateRates(v(), ctx))).toEqual({ rates: 'listing.errors.rateRequired' });
    expect(keys(validateRates(v({ day: '2500', shiftHours: '25', monthDays: '0', minDuration: '4' }), ctx)))
      .toEqual({ shiftHours: 'sell.validation.wholeRange', monthDays: 'sell.validation.wholeRange', minDurationPeriod: 'sell.validation.pickOne' });
    expect(keys(validateRates(v({ hour: 'abc' }), ctx))).toEqual({ hour: 'sell.price.invalid' });
    expect(keys(validateRates(v({ day: '2500', availableFrom: '2026-11-01' }), ctx))).toEqual({ availableFrom: 'sell.rates.availableFromPast' });
    expect(validateRates(v({ day: '2500', availableFrom: '2026-11-01' }), { ...ctx, previousAvailableFrom: '2026-11-01' })).toEqual({});
    expect(keys(validateRates(v({ day: '2500', availableFrom: '2026-13-01' }), ctx))).toEqual({ availableFrom: 'sell.validation.date' });
  });

  it('caps rates and charges at ₹10 crore with their own message, the deposit at ₹100 crore', () => {
    const ctx = { today: '2026-11-18', previousAvailableFrom: null };
    expect(validateRates(v({ day: '0.01', overtime: '10,00,00,000', transportCharge: '10,00,00,000' }), ctx)).toEqual({});
    expect(keys(validateRates(v({ day: '100000000.01', overtime: '100000000.01', operator: 'optional', operatorRate: '100000000.01', transportCharge: '100000000.01' }), ctx)))
      .toEqual({ day: 'sell.rates.range', overtime: 'sell.rates.range', operatorRate: 'sell.rates.range', transportCharge: 'sell.rates.range' });
    expect(keys(validateRates(v({ day: '0.001' }), ctx))).toEqual({ day: 'sell.price.invalid' });
    expect(validateRates(v({ day: '1', deposit: '1,00,00,00,000' }), ctx)).toEqual({});
    expect(keys(validateRates(v({ day: '1', deposit: '1000000000.01' }), ctx))).toEqual({ deposit: 'sell.price.range' });
  });

  it('sends paise, whole numbers, and the operator rate only when there is an operator to pay', () => {
    const patch = ratesPatch(v({ day: '2,500', week: '', operator: 'not_available', operatorRate: '800', minDuration: '1', minDurationPeriod: 'day', deposit: '50000' }));
    expect(patch.rental).toMatchObject({
      rateDayPaise: 250_000, rateWeekPaise: null, operator: 'not_available', operatorRateDayPaise: null, minDuration: 1,
      minDurationPeriod: 'day', depositPaise: 5_000_000, shiftHours: 8, monthDays: 26, fuel: 'client', availableFrom: null,
    });
    expect(ratesPatch(v({ day: '1', operator: 'optional', operatorRate: '800' })).rental?.operatorRateDayPaise).toBe(80_000);
  });
});

describe('location', () => {
  const godown = (over: Partial<LocationValues> = {}): LocationValues => ({
    ...locationInitial(ownerFixture()), source: 'godown', pincode: '395010', city: 'Surat', state: 'Gujarat', delivery: ['pickup'], ...over,
  });

  it('needs a delivery option, and a full godown address', () => {
    expect(keys(validateLocation({ ...locationInitial(ownerFixture()), delivery: [] }, 'part'))).toEqual({ delivery: 'sell.location.deliveryRequired' });
    expect(keys(validateLocation(godown({ pincode: '0123', city: ' ' }), 'part')))
      .toEqual({ pincode: 'sell.location.pincode', city: 'sell.validation.required' });
    expect(keys(validateLocation(godown({ serviceRadius: '2001' }), 'machine_rental'))).toEqual({ serviceRadius: 'sell.validation.wholeRange' });
    expect(validateLocation(godown(), 'part')).toEqual({});
  });

  it('sends the business source alone, or the godown with its area and pin', () => {
    expect(locationPatch({ ...godown(), source: 'business' }, null, 'part')).toEqual({ location: { source: 'business' }, delivery: ['pickup'] });
    expect(locationPatch(godown({ industrialAreaOther: ' Udhna ', otherOpen: true, addressLine: ' Shed 4 ', serviceRadius: '50' }), { lat: 21.1, lng: 72.8 }, 'machine_rental'))
      .toEqual({
        location: {
          source: 'godown', pincode: '395010', city: 'Surat', state: 'Gujarat', industrialAreaId: null, industrialAreaOther: 'Udhna',
          addressLine: 'Shed 4', lat: 21.1, lng: 72.8,
        },
        delivery: ['pickup'],
        rental: { serviceRadiusKm: 50 },
      });
  });

  it('starts from the stored location (a fresh draft: the business address, pick up)', () => {
    expect(locationInitial(ownerFixture())).toMatchObject({ source: 'business', delivery: ['pickup'] });
    const l = ownerFixture({ delivery: ['ship'] });
    l.location = { ...l.location, source: 'godown', pincode: '395010', industrialAreaOther: 'Udhna' };
    expect(locationInitial(l)).toMatchObject({ source: 'godown', pincode: '395010', otherOpen: true, delivery: ['ship'] });
  });
});

describe('preview flags and translation', () => {
  it('flags a ₹4 part and a part in the machine unit', () => {
    const l = ownerFixture({ priceModel: 'fixed', pricePaise: 400, quantity: '2', unitId: 'mu' });
    expect(previewFlags(l, [{ id: 'mu', isMachineUnit: true }])).toEqual(['price_check', 'unit_check']);
    expect(previewFlags({ ...l, pricePaise: 42_000 }, [])).toEqual([]);
  });

  it('edit mode: the flags a save would add, leaving out ones already accepted and drafts', () => {
    const live = ownerFixture({ status: 'live', priceModel: 'fixed', pricePaise: 42_000, quantity: '2' });
    expect(editFlags(live, { pricePaise: 400 }, [])).toEqual(['price_check']);
    expect(editFlags(live, { quantity: '5000000' }, [])).toEqual(['quantity_check']);
    expect(editFlags(live, { pricePaise: 50_000 }, [])).toEqual([]);
    expect(editFlags({ ...live, acceptedFlags: ['price_check'] }, { pricePaise: 400 }, [])).toEqual([]);
    expect(editFlags({ ...live, status: 'draft' }, { pricePaise: 400 }, [])).toEqual([]);
    expect(editFlags(live, { title: 'Temple roller' }, [])).toEqual([]);
  });

  it('edit mode: a save that sent a public listing to review says so', () => {
    expect(editSaveToastKey('live', 'pending_review')).toBe('listing.manage.sentForReview');
    expect(editSaveToastKey('rented', 'pending_review')).toBe('listing.manage.sentForReview');
    expect(editSaveToastKey('live', 'live')).toBe('sell.saved');
    expect(editSaveToastKey('pending_review', 'pending_review')).toBe('sell.saved');
    expect(editSaveToastKey('paused', 'paused')).toBe('sell.saved');
  });

  it('translates errors with their params', () => {
    const t = (k: string, o?: Record<string, unknown>) => `${k}${o ? JSON.stringify(o) : ''}`;
    expect(translateErrors({ title: { key: 'a', params: { min: 3 } }, x: undefined }, t)).toEqual({ title: 'a{"min":3}' });
  });
});

describe('SPECS_INVALID on the fields', () => {
  const apiError = (code: string, details?: Record<string, unknown>) => ({
    isAxiosError: true, response: { status: 400, data: { error: 'x', code, details } },
  });

  it('maps each field key to its message key, ignoring unknown codes and other errors', () => {
    expect(specErrorsFromApi(apiError('SPECS_INVALID', { width: 'above_max', ends: 'invalid_option', x: 42, y: 'nope' })))
      .toEqual({ width: { key: 'sell.specError.above_max' }, ends: { key: 'sell.specError.invalid_option' } });
    expect(specErrorsFromApi(apiError('SPECS_INVALID'))).toEqual({});
    expect(specErrorsFromApi(apiError('PRICE_REQUIRED', { width: 'required' }))).toEqual({});
  });
});
