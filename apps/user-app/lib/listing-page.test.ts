import { describe, expect, it } from 'vitest';
import type { OtherSideCard, OtherSideResult } from '@mpm/shared-types';
import { cardFixture } from './listing-fixtures.test-helper';
import {
  REPORT_DETAILS_MAX, arrivalAction, availabilityLine, contactActions, contactButtons, hasOtherSide, pendingContactOf, signInReasonOf, isListingGone, otherSideBlock, parseFitChoice, parseFitYear, reportBody,
  reportProblem, serializeFitChoice,
} from './listing-page';

const match = (over: Partial<OtherSideCard> = {}): OtherSideCard => ({
  ...cardFixture({ id: 'm1', side: 'right' }), tier: 1, possible: false, ...over,
});

const result = (over: Partial<OtherSideResult> = {}): OtherSideResult => ({
  complement: 'right', best: { right: null, pair: null }, counts: { right: 0, pair: 0 }, items: [], ...over,
});

describe('contactActions (F6 + F7 §7.1)', () => {
  it('each kind × price model', () => {
    expect(contactActions({ kind: 'part', priceModel: 'negotiable' })).toEqual(['enquire', 'make_offer']);
    expect(contactActions({ kind: 'machine', priceModel: 'negotiable' })).toEqual(['enquire', 'make_offer']);
    expect(contactActions({ kind: 'part', priceModel: 'fixed' })).toEqual(['enquire', 'buy']);
    expect(contactActions({ kind: 'machine', priceModel: 'fixed' })).toEqual(['enquire', 'buy']);
    expect(contactActions({ kind: 'part', priceModel: 'on_request' })).toEqual(['ask_price']);
    expect(contactActions({ kind: 'machine', priceModel: 'on_request' })).toEqual(['ask_price']);
    for (const priceModel of ['fixed', 'negotiable', 'on_request', null] as const) {
      expect(contactActions({ kind: 'machine_rental', priceModel })).toEqual(['enquire']);
    }
    expect(contactActions({ kind: 'part', priceModel: null })).toEqual(['enquire']);
  });
});

describe('contactButtons (§7.1, §15.2)', () => {
  const base = {
    kind: 'part' as const, priceModel: 'negotiable' as const, availableQuantity: '3', isOwner: false, myThreadId: null,
    openNegotiation: null,
  };
  const actions = (c: ReturnType<typeof contactButtons>) => c.buttons.map((b) => `${b.action}${b.disabled ? ':off' : ''}`);
  it('a buyer (or guest) gets the price model buttons', () => {
    expect(actions(contactButtons(base))).toEqual(['enquire', 'make_offer']);
    expect(actions(contactButtons({ ...base, priceModel: 'fixed' }))).toEqual(['enquire', 'buy']);
    expect(actions(contactButtons({ ...base, priceModel: 'on_request' }))).toEqual(['ask_price']);
  });
  it('nothing on the viewer own listing', () => {
    expect(contactButtons({ ...base, isOwner: true })).toEqual({ buttons: [], allOnHold: false });
  });
  it('Make offer / Buy are disabled when everything is on hold; Enquire stays', () => {
    const c = contactButtons({ ...base, availableQuantity: '0' });
    expect(c.allOnHold).toBe(true);
    expect(actions(c)).toEqual(['enquire', 'make_offer:off']);
    expect(actions(contactButtons({ ...base, priceModel: 'fixed', availableQuantity: '0.000' }))).toEqual(['enquire', 'buy:off']);
    expect(contactButtons({ ...base, availableQuantity: null }).allOnHold).toBe(false);
  });
  it('an existing thread turns Enquire / Ask price into Open chat; an open negotiation keeps offers in the chat', () => {
    expect(actions(contactButtons({ ...base, myThreadId: 't1' }))).toEqual(['open_chat', 'make_offer']);
    expect(actions(contactButtons({ ...base, priceModel: 'on_request', myThreadId: 't1' }))).toEqual(['open_chat']);
    expect(actions(contactButtons({ ...base, myThreadId: 't1', openNegotiation: { offerId: 'o' } }))).toEqual(['open_chat']);
  });
  it('guest taps: sign-in reason and pending action per button', () => {
    expect(signInReasonOf('enquire')).toBe('enquire');
    expect(signInReasonOf('ask_price')).toBe('enquire');
    expect(signInReasonOf('make_offer')).toBe('offer');
    expect(signInReasonOf('buy')).toBe('offer');
    expect(pendingContactOf('make_offer', 'l1')).toEqual({ type: 'offer', listingId: 'l1' });
    expect(pendingContactOf('ask_price', 'l1')).toEqual({ type: 'ask_price', listingId: 'l1' });
  });
  it('arrival with a sheet: opens it only when its button is there and enabled', () => {
    expect(arrivalAction('offer', contactButtons(base))).toEqual({ type: 'sheet', sheet: 'offer' });
    expect(arrivalAction('offer', contactButtons({ ...base, availableQuantity: '0' }))).toBeNull();
    expect(arrivalAction('buy', contactButtons(base))).toBeNull();
    expect(arrivalAction('offer', contactButtons({ ...base, isOwner: true }))).toBeNull();
    expect(arrivalAction('enquire', contactButtons({ ...base, myThreadId: 't1' }))).toEqual({ type: 'thread' });
    expect(arrivalAction(undefined, contactButtons(base))).toBeNull();
  });
  it('availability line', () => {
    expect(availabilityLine({ quantity: '3', availableQuantity: '2' })).toEqual({ kind: 'partial', available: '2', quantity: '3' });
    expect(availabilityLine({ quantity: '3', availableQuantity: '0' })).toEqual({ kind: 'none' });
    expect(availabilityLine({ quantity: '3', availableQuantity: '3' })).toBeNull();
  });
});

describe('hasOtherSide', () => {
  it('only left / right parts', () => {
    expect(hasOtherSide({ kind: 'part', side: 'left' })).toBe(true);
    expect(hasOtherSide({ kind: 'part', side: 'right' })).toBe(true);
    expect(hasOtherSide({ kind: 'part', side: 'pair' })).toBe(false);
    expect(hasOtherSide({ kind: 'part', side: 'not_applicable' })).toBe(false);
    expect(hasOtherSide({ kind: 'machine', side: 'left' })).toBe(false);
  });
});

describe('otherSideBlock (§8.1 item 5)', () => {
  it('null for a listing without a left / right side', () => {
    expect(otherSideBlock('pair', result())).toBeNull();
    expect(otherSideBlock(null, result())).toBeNull();
  });
  it('wants the complementary side; no match → no lead', () => {
    const b = otherSideBlock('left', result())!;
    expect(b.want).toBe('right');
    expect(b.wantBest).toBeNull();
    expect(b.pairBest).toBeNull();
    expect(b.lead).toBeNull();
    expect(b.wantCount).toBe(0);
  });
  it('without a result yet (loading) it still names the wanted side', () => {
    const b = otherSideBlock('right', undefined)!;
    expect(b.want).toBe('left');
    expect(b.lead).toBeNull();
  });
  it('reads best and counts per side', () => {
    const r = match({ id: 'r' });
    const p = match({ id: 'p', side: 'pair' });
    const b = otherSideBlock('left', result({ best: { right: r, pair: p }, counts: { right: 3, pair: 1 } }))!;
    expect(b.wantBest?.id).toBe('r');
    expect(b.pairBest?.id).toBe('p');
    expect(b.wantCount).toBe(3);
    expect(b.pairCount).toBe(1);
  });
  it('the lead is the exact side within a tier, else the better tier', () => {
    const exact = match({ id: 'exact', tier: 2 });
    const pair = match({ id: 'pair', side: 'pair', tier: 2 });
    expect(otherSideBlock('left', result({ best: { right: exact, pair } }))!.lead?.id).toBe('exact');
    const possible = match({ id: 'possible', tier: 3, possible: true });
    const pair1 = match({ id: 'pair1', side: 'pair', tier: 1 });
    expect(otherSideBlock('left', result({ best: { right: possible, pair: pair1 } }))!.lead?.id).toBe('pair1');
    expect(otherSideBlock('left', result({ best: { right: null, pair: pair1 } }))!.lead?.id).toBe('pair1');
  });
});

describe('reportProblem (§8.4)', () => {
  it('needs a reason', () => {
    expect(reportProblem(null, '')).toBe('reason');
  });
  it('details are optional, except for Something else', () => {
    expect(reportProblem('stock_photos', '')).toBeNull();
    expect(reportProblem('something_else', '   ')).toBe('detailsRequired');
    expect(reportProblem('something_else', 'Wrong photos')).toBeNull();
  });
  it('details up to 500 characters', () => {
    expect(reportProblem('already_sold', 'x'.repeat(REPORT_DETAILS_MAX))).toBeNull();
    expect(reportProblem('already_sold', 'x'.repeat(REPORT_DETAILS_MAX + 1))).toBe('detailsTooLong');
  });
  it('the body trims details and drops empty ones', () => {
    expect(reportBody('already_sold', '  ')).toEqual({ reason: 'already_sold', details: null });
    expect(reportBody('advance_payment', ' asked 50% ')).toEqual({ reason: 'advance_payment', details: 'asked 50%' });
  });
});

describe('Check my machine: the remembered choice (§8.3)', () => {
  it('round-trips', () => {
    const c = { brandId: 'b1', modelId: 'm1', year: 2015 };
    expect(parseFitChoice(serializeFitChoice(c))).toEqual(c);
    expect(parseFitChoice(serializeFitChoice({ brandId: 'b1', modelId: null, year: null }))).toEqual({ brandId: 'b1', modelId: null, year: null });
  });
  it('anything else is no choice', () => {
    expect(parseFitChoice(null)).toBeNull();
    expect(parseFitChoice('not json')).toBeNull();
    expect(parseFitChoice('{"modelId":"m1"}')).toBeNull();
    expect(parseFitChoice('{"brandId":"b1","modelId":5,"year":"x"}')).toEqual({ brandId: 'b1', modelId: null, year: null });
  });
});

describe('parseFitYear', () => {
  const now = Date.parse('2026-11-18T00:00:00Z');
  it('empty is no year', () => {
    expect(parseFitYear('  ', now)).toEqual({ ok: true, year: null });
  });
  it('1950 … next year, Hindi and Gujarati digits too', () => {
    expect(parseFitYear('2015', now)).toEqual({ ok: true, year: 2015 });
    expect(parseFitYear('२०१५', now)).toEqual({ ok: true, year: 2015 });
    expect(parseFitYear('૨૦૨૭', now)).toEqual({ ok: true, year: 2027 });
    expect(parseFitYear('1949', now)).toEqual({ ok: false });
    expect(parseFitYear('2028', now)).toEqual({ ok: false });
    expect(parseFitYear('20.15', now)).toEqual({ ok: false });
  });
});

describe('isListingGone', () => {
  const err = (status: number, code: string) => ({ response: { status, data: { code } } });
  it('a 404 LISTING_NOT_FOUND refetch means the page is gone, even with old data cached', () => {
    expect(isListingGone(true, err(404, 'LISTING_NOT_FOUND'))).toBe(true);
    expect(isListingGone(false, null)).toBe(false);
    expect(isListingGone(true, { code: 'ERR_NETWORK' })).toBe(false);
  });
});
