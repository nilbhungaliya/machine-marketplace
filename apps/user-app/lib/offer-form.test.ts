import { describe, expect, it } from 'vitest';
import { counterBounds } from '@mpm/shared-types';
import {
  boundsHint, counterLimitReached, formatPaiseText, defaultOfferQuantity, isNegotiableChain, offerFormState, offerRequestBody, offerTotals,
  ownLatestFor, roundLabel, validateOfferForm, type OfferFormContext, type OfferFormValues,
} from './offer-form';

const values = (over: Partial<OfferFormValues> = {}): OfferFormValues => ({
  price: '340', quantity: '2', validityHours: 48, note: '', ...over,
});
const ctx = (over: Partial<OfferFormContext> = {}): OfferFormContext => ({
  mode: 'offer', askingPaise: 38_500, unitDecimals: 0, minOrderQty: null, available: '5', ...over,
});

describe('offerTotals (§7.2)', () => {
  it('totals 2.5 units half up from thousandths, as the server', () => {
    // ₹10.01 × 2.5 = 2502.5 paise → 2503
    const r = offerTotals({ pricePaise: 1001, quantity: '2.5', unitDecimals: 1 }, { gstMode: 'extra', askingPaise: null, negotiable: false });
    expect(r.totalPaise).toBe('2503');
    expect(r.gstLabelKey).toBe('offers.gst.extra');
  });
  it('labels incl. GST and nothing without a GST mode', () => {
    expect(offerTotals({ pricePaise: 100, quantity: '1', unitDecimals: 0 }, { gstMode: 'included', askingPaise: null, negotiable: false }).gstLabelKey)
      .toBe('offers.gst.included');
    expect(offerTotals({ pricePaise: 100, quantity: '1', unitDecimals: 0 }, { gstMode: null, askingPaise: null, negotiable: false }).gstLabelKey)
      .toBeNull();
  });
  it('no total until price and quantity are readable', () => {
    expect(offerTotals({ pricePaise: null, quantity: '2', unitDecimals: 0 }, { gstMode: null, askingPaise: null, negotiable: true }).totalPaise).toBeNull();
    expect(offerTotals({ pricePaise: 100, quantity: 'x', unitDecimals: 0 }, { gstMode: null, askingPaise: null, negotiable: true }).totalPaise).toBeNull();
  });
  it('% below asking only on negotiable chains, rounded down', () => {
    const neg = offerTotals({ pricePaise: 34_000, quantity: '2', unitDecimals: 0 }, { gstMode: null, askingPaise: 38_500, negotiable: true });
    expect(neg.percentBelow).toBe(11); // 11.68 → 11
    const fixed = offerTotals({ pricePaise: 34_000, quantity: '2', unitDecimals: 0 }, { gstMode: null, askingPaise: 38_500, negotiable: false });
    expect(fixed.percentBelow).toBeNull();
    expect(isNegotiableChain('offer')).toBe(true);
    expect(isNegotiableChain('buy')).toBe(false);
    expect(isNegotiableChain('quote')).toBe(false);
    expect(isNegotiableChain('counter', { kind: 'offer', askingPricePaise: 100 })).toBe(true);
    expect(isNegotiableChain('counter', { kind: 'quote', askingPricePaise: null })).toBe(false);
  });
});

describe('validateOfferForm (§7.2, §7.4)', () => {
  it('a valid offer has no errors', () => {
    expect(validateOfferForm(values(), ctx())).toEqual({});
  });
  it('price required, above zero, at most asking for an offer', () => {
    expect(validateOfferForm(values({ price: '' }), ctx()).price).toBe('priceRequired');
    expect(validateOfferForm(values({ price: '0' }), ctx()).price).toBe('priceInvalid');
    expect(validateOfferForm(values({ price: 'abc' }), ctx()).price).toBe('priceInvalid');
    expect(validateOfferForm(values({ price: '385.01' }), ctx()).price).toBe('priceAboveAsking');
    expect(validateOfferForm(values({ price: '385' }), ctx()).price).toBeUndefined();
    // A quote has no asking price to stay under.
    expect(validateOfferForm(values({ price: '999' }), ctx({ mode: 'quote', askingPaise: null })).price).toBeUndefined();
  });
  it('accepts Hindi and Gujarati digits', () => {
    expect(validateOfferForm(values({ price: '३४०', quantity: '૨' }), ctx())).toEqual({});
  });
  it('buy mode ignores a typed price', () => {
    expect(validateOfferForm(values({ price: '' }), ctx({ mode: 'buy' }))).toEqual({});
    expect(validateOfferForm(values({ price: '999999' }), ctx({ mode: 'buy' }))).toEqual({});
    const body = offerRequestBody(values({ price: '1' }), { mode: 'buy', unitDecimals: 0, askingPaise: 38_500 });
    expect(body).toEqual({ kind: 'buy_now', quantity: '2', validityHours: 48 });
  });
  it('quantity: required, unit decimals, minimum, available', () => {
    expect(validateOfferForm(values({ quantity: '' }), ctx()).quantity).toBe('quantityRequired');
    expect(validateOfferForm(values({ quantity: '1.5' }), ctx()).quantity).toBe('quantityDecimals');
    expect(validateOfferForm(values({ quantity: '1.5' }), ctx({ unitDecimals: 1 })).quantity).toBeUndefined();
    expect(validateOfferForm(values({ quantity: '0' }), ctx()).quantity).toBe('quantityInvalid');
    expect(validateOfferForm(values({ quantity: '1' }), ctx({ minOrderQty: '2' })).quantity).toBe('quantityBelowMinimum');
    expect(validateOfferForm(values({ quantity: '6' }), ctx()).quantity).toBe('quantityNotAvailable');
    expect(validateOfferForm(values({ quantity: '5' }), ctx()).quantity).toBeUndefined();
  });
  it('the whole remainder below the minimum is allowed, anything less is not', () => {
    const c = ctx({ minOrderQty: '10', available: '3' });
    expect(validateOfferForm(values({ quantity: '3' }), c).quantity).toBeUndefined();
    expect(validateOfferForm(values({ quantity: '2' }), c).quantity).toBe('quantityBelowMinimum');
  });
  it('a counter stays inside the server range (counterBounds)', () => {
    const bounds = counterBounds({ by: 'seller', buyerLatestPaise: 3_400_000, sellerLatestPaise: 3_850_000 });
    const c = ctx({ mode: 'counter', askingPaise: 3_850_000, bounds });
    expect(boundsHint(bounds)).toEqual({ minPaise: 3_400_001, maxPaise: 3_850_000 });
    expect(validateOfferForm(values({ price: '34000' }), c).price).toBe('counterOutOfBounds');
    expect(validateOfferForm(values({ price: '34000.01' }), c).price).toBeUndefined();
    expect(validateOfferForm(values({ price: '38500' }), c).price).toBeUndefined();
    expect(validateOfferForm(values({ price: '38500.01' }), c).price).toBe('counterOutOfBounds');
    const buyer = counterBounds({ by: 'buyer', buyerLatestPaise: null, sellerLatestPaise: 5000 });
    expect(boundsHint(buyer)).toEqual({ minPaise: 1, maxPaise: 4999 });
    expect(boundsHint({ minPaise: 10, maxPaise: 9 })).toBeNull();
  });
  it('a counter that changes neither price nor quantity is refused', () => {
    const own = ownLatestFor({ round: 0, senderSide: 'buyer', kind: 'offer', askingPricePaise: 3_850_000, quantity: '2' });
    expect(own).toEqual({ pricePaise: 3_850_000, quantity: '2' });
    const c = ctx({ mode: 'counter', bounds: { minPaise: 3_400_001, maxPaise: 3_850_000 }, ownLatest: own });
    expect(validateOfferForm(values({ price: '38500', quantity: '2' }), c).price).toBe('counterUnchanged');
    expect(validateOfferForm(values({ price: '38500', quantity: '3' }), c).price).toBeUndefined();
    expect(ownLatestFor({ round: 1, senderSide: 'buyer', kind: 'offer', askingPricePaise: 1, quantity: '2' })).toBeNull();
  });
  it('note at most 500 characters', () => {
    expect(validateOfferForm(values({ note: 'x'.repeat(501) }), ctx()).note).toBe('noteTooLong');
    expect(validateOfferForm(values({ note: 'x'.repeat(500) }), ctx()).note).toBeUndefined();
  });
});

describe('defaults and labels', () => {
  it('quantity defaults to the minimum, else 1, never above what is available', () => {
    expect(defaultOfferQuantity(null, '5')).toBe('1');
    expect(defaultOfferQuantity('2', '5')).toBe('2');
    expect(defaultOfferQuantity('10', '3')).toBe('3');
    expect(offerFormState({ mode: 'offer', listing: { minOrderQty: '2', availableQuantity: '5' }, options: { defaultValidityHours: 48 } }))
      .toEqual({ price: '', quantity: '2', validityHours: 48, note: '' });
    expect(offerFormState({ mode: 'counter', offer: { quantity: '4' }, options: { defaultValidityHours: 24 } }).quantity).toBe('4');
  });
  it('round label and the limit after the fifth counter', () => {
    expect(roundLabel({ round: 0 })).toBeNull();
    expect(roundLabel({ round: 2 })).toEqual({ key: 'offers.card.round', values: { round: 2, max: 5 } });
    expect(counterLimitReached({ status: 'pending', roundsLeft: 0, kind: 'offer' })).toBe(true);
    expect(counterLimitReached({ status: 'pending', roundsLeft: 1, kind: 'offer' })).toBe(false);
  });
  it('request bodies per mode', () => {
    expect(offerRequestBody(values({ note: ' hi ' }), { mode: 'offer', unitDecimals: 0, askingPaise: 1 }))
      .toEqual({ kind: 'offer', pricePerUnitPaise: 34_000, quantity: '2', validityHours: 48, note: 'hi' });
    expect(offerRequestBody(values(), { mode: 'counter', unitDecimals: 0, askingPaise: 1 }))
      .toEqual({ pricePerUnitPaise: 34_000, quantity: '2', validityHours: 48 });
  });
});

describe('formatPaiseText (P4: totals as strings)', () => {
  it('groups in the Indian way without floats', () => {
    expect(formatPaiseText('7300000')).toBe('₹73,000');
    expect(formatPaiseText('900719925474099350')).toBe('₹9,00,71,99,25,47,40,993.50');
    expect(formatPaiseText(null)).toBe('');
  });
});
