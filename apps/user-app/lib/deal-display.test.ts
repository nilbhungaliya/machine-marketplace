import { afterEach, describe, expect, it } from 'vitest';
import type { DealAction, DealView } from '@mpm/shared-types';
import { i18n } from '@/lib/i18n';
import {
  advanceFits, balanceOf, cancelReasonsFor, dayInputText, dealActionButtons, deadlineCopy, parseDayInput, reviewCardState,
  timelineRows,
} from './deal-display';

afterEach(async () => { await i18n.changeLanguage('en'); });

// What the API's `dealActions` offers each side (services/deals/deal-actions.ts), so the placing is tested on real sets.
const ACTIONS: Record<string, DealAction[]> = {
  agreedSeller: ['hand_over', 'cancel', 'edit_notes'],
  agreedBuyer: ['cancel', 'edit_notes'],
  handedBuyer: ['confirm_received', 'report_problem', 'edit_notes', 'request_cancel'],
  handedBuyerLate: ['confirm_received', 'edit_notes', 'request_cancel'],
  handedSeller: ['report_problem', 'edit_notes', 'request_cancel'],
  requesterSide: ['report_problem', 'edit_notes', 'clear_cancel_request'],
  otherSide: ['confirm_received', 'report_problem', 'edit_notes', 'accept_cancel_request', 'clear_cancel_request'],
  viewer: [],
};

describe('dealActionButtons (§9.2, §9.5)', () => {
  it('agreed: the seller hands over or cancels, the buyer cancels', () => {
    expect(dealActionButtons({ actions: ACTIONS.agreedSeller! })).toMatchObject({
      primary: 'hand_over', secondary: 'cancel', requestCancel: false, editNotes: true,
    });
    expect(dealActionButtons({ actions: ACTIONS.agreedBuyer! })).toMatchObject({ primary: null, secondary: 'cancel' });
  });
  it('handed over: the buyer confirms or reports; after the window only confirms; the seller reports', () => {
    expect(dealActionButtons({ actions: ACTIONS.handedBuyer! })).toMatchObject({
      primary: 'confirm_received', secondary: 'report_problem', requestCancel: true,
    });
    expect(dealActionButtons({ actions: ACTIONS.handedBuyerLate! })).toMatchObject({ primary: 'confirm_received', secondary: null });
    expect(dealActionButtons({ actions: ACTIONS.handedSeller! })).toMatchObject({ primary: null, secondary: 'report_problem' });
  });
  it('a pending cancel request: the requester only withdraws, the other side accepts or declines', () => {
    const requester = dealActionButtons({ actions: ACTIONS.requesterSide! });
    expect(requester.cancelRequest).toEqual({ accept: false, clear: true });
    expect(requester.requestCancel).toBe(false);
    const other = dealActionButtons({ actions: ACTIONS.otherSide! });
    expect(other.cancelRequest).toEqual({ accept: true, clear: true });
    expect(other.primary).toBe('confirm_received');
  });
  it('a viewer, or a final deal, gets no buttons at all', () => {
    expect(dealActionButtons({ actions: ACTIONS.viewer! })).toEqual({
      primary: null, secondary: null, cancelRequest: { accept: false, clear: false }, requestCancel: false,
      editNotes: false, shareContact: false, review: false,
    });
  });
  it('share and review only when the server offers them', () => {
    const b = dealActionButtons({ actions: ['share_contact', 'review'] });
    expect(b.shareContact).toBe(true);
    expect(b.review).toBe(true);
  });
});

describe('deadlines in IST (§9.3)', () => {
  it('reads the IST wall clock across UTC midnight', () => {
    // 2026-11-20 19:10 UTC = Sat 21 Nov 00:40 IST; report window 2026-11-19 19:10 UTC = Fri 20 Nov 00:40 IST.
    const deal = { status: 'handed_over' as const, autoCompleteAt: '2026-11-20T19:10:00.000Z', problemDeadlineAt: '2026-11-19T19:10:00.000Z' };
    const now = Date.parse('2026-11-18T10:00:00.000Z');
    expect(deadlineCopy(deal, now)).toEqual({ completesOn: 'Sat 21 Nov, 12:40 am', reportUntil: 'Fri 20 Nov, 12:40 am' });
  });
  it('drops the report window once it has passed; nothing outside handed over', () => {
    const deal = { status: 'handed_over' as const, autoCompleteAt: '2026-11-21T11:10:00.000Z', problemDeadlineAt: '2026-11-20T11:10:00.000Z' };
    expect(deadlineCopy(deal, Date.parse('2026-11-20T12:00:00.000Z'))).toEqual({ completesOn: 'Sat 21 Nov, 4:40 pm', reportUntil: null });
    expect(deadlineCopy({ ...deal, status: 'agreed' }, 0)).toBeNull();
  });
});

describe('money and reasons', () => {
  it('balance = total − advance, as strings (no floats)', () => {
    expect(balanceOf('7300000', '2000000')).toBe('5300000');
    expect(balanceOf('900719925474099350', '1')).toBe('900719925474099349');
    expect(balanceOf('7300000', null)).toBeNull();
    expect(balanceOf('7300000', '12.5')).toBeNull();
  });
  it('cancel reasons per side', () => {
    expect(cancelReasonsFor('buyer')).toEqual(['no_longer_needed', 'found_elsewhere', 'seller_not_responding', 'other']);
    expect(cancelReasonsFor('seller')).toEqual(['buyer_not_responding', 'payment_not_received', 'stock_problem', 'other']);
  });
});

describe('timeline and review card', () => {
  it('past events in order, then the next open step', () => {
    const rows = timelineRows(
      [{ code: 'agreed', actorSide: 'seller', values: {}, at: '2026-11-18T06:35:00.000Z' }],
      { status: 'agreed', autoCompleteAt: null },
    );
    expect(rows.map((r) => [r.labelKey, r.done])).toEqual([['deals.timeline.agreed', true], ['deals.timeline.next.handOver', false]]);
    expect(rows[0]!.when).toBe('18 Nov, 12:05 pm');
    expect(timelineRows([], { status: 'cancelled', autoCompleteAt: null })).toEqual([]);
  });
  it('review card: rate while offered, then waiting / published', () => {
    const review = (over: Partial<NonNullable<DealView['review']>> = {}): NonNullable<DealView['review']> => ({
      dealId: 'd', mySide: 'buyer', eligible: true, reason: null, windowEndsAt: null, mine: null, theirsSubmitted: false,
      publishDueAt: null, ...over,
    });
    expect(reviewCardState({ status: 'completed', actions: ['review'], review: review() })).toEqual({ kind: 'rate' });
    const mine = { id: 'r', ratings: {}, text: null, submittedAt: 'x', publishedAt: null, hidden: false };
    expect(reviewCardState({ status: 'completed', actions: [], review: review({ eligible: false, mine }) })).toEqual({ kind: 'waiting' });
    expect(reviewCardState({ status: 'completed', actions: [], review: review({ eligible: false, mine: { ...mine, publishedAt: 'y' } }) }))
      .toEqual({ kind: 'published' });
    expect(reviewCardState({ status: 'agreed', actions: [], review: null })).toBeNull();
  });
});

describe('notes fields', () => {
  it('expected date: typed day → YYYY-MM-DD, empty clears, nonsense refused', () => {
    expect(parseDayInput('21-11-2026')).toBe('2026-11-21');
    expect(parseDayInput('१/२/२०२७')).toBe('2027-02-01');
    expect(parseDayInput('')).toBe('');
    expect(parseDayInput('31-02-2026')).toBeNull();
    expect(dayInputText('2026-11-21')).toBe('21-11-2026');
  });
  it('advance at most the total', () => {
    expect(advanceFits('7300000', '7300000')).toBe(true);
    expect(advanceFits('7300001', '7300000')).toBe(false);
  });
});
