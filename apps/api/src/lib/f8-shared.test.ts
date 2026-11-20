import { describe, expect, it } from 'vitest';
import {
  appSettingDefaults,
  notificationCategory,
  partRequestDaysLeft,
  partRequestTransition,
  requestSideAccepts,
  validateSettings,
  type AppSettingsValues,
  type NotificationType,
  type PartRequestAction,
  type PartRequestStatus,
  type PartSide,
} from '@mpm/shared-types';

// F8 plan C0-1: the pure functions both the API and the app use (spec §5.11, §7.4, §9.1, §16).

describe('partRequestTransition (§9.1)', () => {
  const legal: Array<[PartRequestStatus | null, PartRequestAction, PartRequestStatus]> = [
    [null, 'post', 'active'],
    ['active', 'edit', 'active'],
    ['active', 'renew', 'active'],
    ['expired', 'renew', 'active'],
    ['active', 'fulfil', 'fulfilled'],
    ['active', 'close', 'closed'],
    ['active', 'expire', 'expired'],
    ['active', 'remove', 'removed'],
    ['fulfilled', 'remove', 'removed'],
    ['closed', 'remove', 'removed'],
    ['expired', 'remove', 'removed'],
  ];
  it.each(legal)('%s --%s--> %s', (from, action, to) => {
    expect(partRequestTransition(from, action)).toBe(to);
  });

  it.each<[PartRequestStatus | null, PartRequestAction]>([
    ['expired', 'fulfil'],
    ['closed', 'edit'],
    ['removed', 'remove'],
    ['active', 'restore'],
    ['active', 'post'],
    [null, 'edit'],
    ['fulfilled', 'renew'],
    ['expired', 'expire'],
  ])('%s --%s--> null', (from, action) => {
    expect(partRequestTransition(from, action)).toBeNull();
  });

  it('restore goes to the return status; an active return past expiry lands expired', () => {
    expect(partRequestTransition('removed', 'restore', { returnStatus: 'active', pastExpiry: false })).toBe('active');
    expect(partRequestTransition('removed', 'restore', { returnStatus: 'active', pastExpiry: true })).toBe('expired');
    expect(partRequestTransition('removed', 'restore', { returnStatus: 'fulfilled', pastExpiry: true })).toBe('fulfilled');
    expect(partRequestTransition('removed', 'restore', { returnStatus: 'closed' })).toBe('closed');
    expect(partRequestTransition('removed', 'restore', { returnStatus: null })).toBeNull();
  });
});

describe('requestSideAccepts (§7.4)', () => {
  const listingSides: Array<PartSide | null> = ['left', 'right', 'pair', null, 'not_applicable'];
  const table: Record<string, boolean[]> = {
    // listing:  left   right  pair   null   n/a
    left: [true, false, true, false, false],
    right: [false, true, true, false, false],
    pair: [false, false, true, false, false],
    null: [true, true, true, true, true],
  };
  for (const [req, row] of Object.entries(table)) {
    it.each(listingSides.map((s, i) => [s, row[i]] as const))(`request ${req} ← listing %s: %s`, (listing, want) => {
      expect(requestSideAccepts(req === 'null' ? null : (req as PartSide), listing)).toBe(want);
    });
  }
});

describe('partRequestDaysLeft', () => {
  const now = new Date('2026-11-20T10:00:00Z');
  it('rounds up, never below 0', () => {
    expect(partRequestDaysLeft(new Date(now.getTime() + 23 * 3600_000), now)).toBe(1);
    expect(partRequestDaysLeft(now, now)).toBe(0);
    expect(partRequestDaysLeft(new Date(now.getTime() - 3600_000).toISOString(), now)).toBe(0);
    expect(partRequestDaysLeft(new Date(now.getTime() + 15 * 86400_000).toISOString(), now)).toBe(15);
  });
});

describe('notificationCategory (F8 §5.11)', () => {
  it.each<NotificationType>([
    'part_request_new', 'part_request_reply', 'part_request_expiring', 'part_request_expired',
    'part_request_fulfil_prompt', 'part_request_removed', 'part_request_reply_dropped', 'part_match',
  ])('%s → requests', (type) => {
    expect(notificationCategory(type)).toBe('requests');
  });

  it('booking_update and listing_status stay deals', () => {
    expect(notificationCategory('booking_update')).toBe('deals');
    expect(notificationCategory('listing_status')).toBe('deals');
  });
});

describe('validateSettings: F8 cross-checks (§16)', () => {
  it('accepts the defaults', () => {
    expect(validateSettings(appSettingDefaults())).toBeNull();
  });

  it.each<[Partial<AppSettingsValues>, string]>([
    [{ part_request_validity_days_1: 15 }, 'part_request_validity_days_1'],
    [{ part_request_validity_days_2: 30 }, 'part_request_validity_days_2'],
    [{ part_request_validity_days_3: 60, part_request_max_days: 45 }, 'part_request_validity_days_3'],
    [{ part_request_expiring_notice_hours: 72, part_request_validity_days_1: 3 }, 'part_request_expiring_notice_hours'],
    [{ part_request_match_push_daily_cap: 5, part_request_match_push_total_cap: 4 }, 'part_request_match_push_daily_cap'],
  ])('refuses %o', (change, key) => {
    expect(validateSettings({ ...appSettingDefaults(), ...change })?.key).toBe(key);
  });
});
