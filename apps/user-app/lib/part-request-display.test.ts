import { describe, expect, it } from 'vitest';
import { PART_REQUEST_STATUSES } from '@mpm/shared-types';
import { daysLeftKey, matchedBadge, requestStatusKey, requestStatusTone, shouldMarkRequestRead, sideAcceptKeys } from './part-request-display';

describe('part request display (F8 §13.3)', () => {
  it.each(PART_REQUEST_STATUSES)('%s has a tone and a key', (status) => {
    expect(requestStatusTone(status)).toEqual(expect.any(String));
    expect(requestStatusKey(status)).toBe(`requirements.status.${status}`);
  });

  it('active is info, fulfilled ok, removed danger', () => {
    expect(requestStatusTone('active')).toBe('info');
    expect(requestStatusTone('fulfilled')).toBe('ok');
    expect(requestStatusTone('removed')).toBe('danger');
  });

  it('shows Matched for a delivered reply or a match only', () => {
    expect(matchedBadge({ deliveredReplyCount: 0, matchCount: 0 })).toBeNull();
    expect(matchedBadge({ deliveredReplyCount: 1, matchCount: 0 })).toBe('requirements.matched');
    expect(matchedBadge({ deliveredReplyCount: 0, matchCount: 2 })).toBe('requirements.matched');
  });

  it('days left, then expires today', () => {
    expect(daysLeftKey(3)).toEqual({ key: 'requirements.daysLeft', count: 3 });
    expect(daysLeftKey(0)).toEqual({ key: 'requirements.expiresToday' });
  });

  it('a side request accepts its side and Pair; Pair only Pair; none any', () => {
    expect(sideAcceptKeys('left')).toEqual(['listing.side.left', 'listing.side.pair']);
    expect(sideAcceptKeys('pair')).toEqual(['listing.side.pair']);
    expect(sideAcceptKeys(null)).toEqual([]);
    expect(sideAcceptKeys('not_applicable')).toEqual([]);
  });

  it('reads on open and on every later new count once read has zeroed the cache', () => {
    // open with 2 new → read; read zeroes the cache (2 → 0) → no read; a live update brings 2 again → read.
    const seen: boolean[] = [];
    let prev: number | null = null;
    for (const total of [2, 0, 2, 0, 1]) {
      seen.push(shouldMarkRequestRead(prev, total));
      prev = total;
    }
    expect(seen).toEqual([true, false, true, false, true]);
    expect(shouldMarkRequestRead(null, 0)).toBe(true);
  });
});
