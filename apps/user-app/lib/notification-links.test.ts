import { describe, expect, it } from 'vitest';
import { NOTIFICATION_TYPES, type NotificationType } from '@mpm/shared-types';
import { badgeText, isPushForOpenThread, notificationLink, parsePushData, tabBadgeCount } from './notification-links';

type Ids = Partial<{ threadId: string; dealId: string; reviewId: string; offerId: string; partRequestId: string }>;
const row = (type: NotificationType, ids: Ids = {}) => ({
  type,
  threadId: ids.threadId ?? null,
  dealId: ids.dealId ?? null,
  reviewId: ids.reviewId ?? null,
  offerId: ids.offerId ?? null,
  partRequestId: ids.partRequestId ?? null,
});

describe('notificationLink (§11.3)', () => {
  const ids = { threadId: 't1', dealId: 'd1', reviewId: 'r1', offerId: 'o1' };

  it.each([
    'enquiry_new', 'message_new', 'offer_new', 'offer_quote', 'offer_countered', 'offer_rejected', 'offer_expiring',
    'offer_backup', 'offer_revived',
  ] as const)('%s opens the thread', (type) => {
    expect(notificationLink(row(type, ids))).toEqual({ name: 'Thread', params: { threadId: 't1' } });
  });

  it.each([
    'offer_accepted', 'deal_handed_over', 'deal_cancel_requested', 'deal_cancelled', 'deal_completed', 'deal_problem',
    'deal_dispute_resolved', 'deal_agreed_reminder',
  ] as const)('%s opens the Deal record', (type) => {
    expect(notificationLink(row(type, ids))).toEqual({ name: 'DealRecord', params: { dealId: 'd1' } });
  });

  it('review_received opens Profile › Reviews; review_waiting the review form', () => {
    expect(notificationLink(row('review_received', ids))).toEqual({ name: 'MyReviews', params: undefined });
    expect(notificationLink(row('review_waiting', ids))).toEqual({ name: 'ReviewDeal', params: { dealId: 'd1' } });
    expect(notificationLink(row('review_waiting'))).toBeNull();
  });

  it.each([
    ['part_request_reply', 'replies'], ['part_match', 'matches'], ['part_request_new', undefined],
    ['part_request_expiring', undefined], ['part_request_expired', undefined], ['part_request_fulfil_prompt', undefined],
    ['part_request_removed', undefined], ['part_request_reply_dropped', undefined],
  ] as const)('%s opens the requirement (tab %s)', (type, tab) => {
    const params = tab ? { partRequestId: 'p1', tab } : { partRequestId: 'p1' };
    expect(notificationLink(row(type, { partRequestId: 'p1' }))).toEqual({ name: 'Requirement', params });
  });

  it('falls back to the id the row has', () => {
    expect(notificationLink(row('offer_accepted', { threadId: 't1' }))).toEqual({ name: 'Thread', params: { threadId: 't1' } });
    expect(notificationLink(row('message_new', { dealId: 'd1' }))).toEqual({ name: 'DealRecord', params: { dealId: 'd1' } });
    expect(notificationLink(row('message_new'))).toBeNull();
  });

  it('has an answer for every type with ids', () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(notificationLink(row(type, ids)), type).not.toBeNull();
    }
  });
});

describe('parsePushData (§11.5)', () => {
  it('reads id-only data', () => {
    expect(parsePushData({ notificationId: 'n1', type: 'message_new', deliveryKey: 'n1:2', threadId: 't1', tag: 'thread:t1' })).toEqual({
      notificationId: 'n1', type: 'message_new', deliveryKey: 'n1:2', threadId: 't1', dealId: null, reviewId: null, offerId: null,
      partRequestId: null,
    });
    expect(parsePushData({ notificationId: 'n2', type: 'part_match', deliveryKey: 'n2:1', partRequestId: 'p1' })?.partRequestId).toBe('p1');
  });

  it("refuses data that isn't ours", () => {
    expect(parsePushData(null)).toBeNull();
    expect(parsePushData({ notificationId: 'n1', type: 'message_new' })).toBeNull();
    expect(parsePushData({ notificationId: 'n1', type: 'something', deliveryKey: 'n1:1' })).toBeNull();
  });

  it('knows a push for the thread on screen', () => {
    const push = parsePushData({ notificationId: 'n1', type: 'message_new', deliveryKey: 'n1:1', threadId: 't1' })!;
    expect(isPushForOpenThread(push, { name: 'Thread', params: { threadId: 't1' } })).toBe(true);
    expect(isPushForOpenThread(push, { name: 'Thread', params: { threadId: 't2' } })).toBe(false);
    expect(isPushForOpenThread(push, { name: 'Main' })).toBe(false);
  });
});

describe('badges (§15.2)', () => {
  const badges = { unreadThreads: 3, dealsYourTurn: 120, notificationsUnread: 5, requestsForYou: 0 };

  it('Chats shows unread threads, Deals the deals waiting on you', () => {
    expect(tabBadgeCount('Chats', badges)).toBe(3);
    expect(tabBadgeCount('Deals', badges)).toBe(120);
    expect(tabBadgeCount('Home', badges)).toBe(0);
    expect(tabBadgeCount('Chats', null)).toBe(0);
  });

  it('hides 0 and caps at 99+', () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(undefined)).toBeNull();
    expect(badgeText(7)).toBe('7');
    expect(badgeText(120)).toBe('99+');
  });
});
