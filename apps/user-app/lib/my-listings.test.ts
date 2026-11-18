import { describe, expect, it } from 'vitest';
import { LISTING_STATUSES } from '@mpm/shared-types';
import { i18n } from '@/lib/i18n';
import { MY_LISTINGS_SEGMENTS, statusChip, statusGroup } from './my-listings';

describe('statusGroup', () => {
  it('hidden sits under Paused', () => {
    expect(statusGroup('hidden')).toBe('paused');
  });
  it('maps every status to the §10 groups', () => {
    expect(statusGroup('live')).toBe('live');
    expect(statusGroup('reserved')).toBe('live');
    expect(statusGroup('rented')).toBe('live');
    expect(statusGroup('pending_review')).toBe('review');
    expect(statusGroup('rejected')).toBe('review');
    expect(statusGroup('expired')).toBe('paused');
    expect(statusGroup('unavailable')).toBe('paused');
    expect(statusGroup('sold')).toBe('sold');
    expect(statusGroup('draft')).toBe('drafts');
    expect(statusGroup('removed')).toBe('removed_by_team');
  });
  it('segments are the four of the control', () => {
    expect(MY_LISTINGS_SEGMENTS).toEqual(['live', 'review', 'paused', 'sold']);
  });
});

describe('statusChip', () => {
  it('every status has an en label', () => {
    for (const s of LISTING_STATUSES) expect(i18n.exists(statusChip(s).key), s).toBe(true);
  });
  it('tones', () => {
    expect(statusChip('live').tone).toBe('ok');
    expect(statusChip('rejected').tone).toBe('danger');
    expect(statusChip('expired').tone).toBe('warn');
  });
});
