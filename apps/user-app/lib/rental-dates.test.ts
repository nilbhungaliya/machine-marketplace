import { describe, expect, it } from 'vitest';
import { busyDates, rangeFromStart, rangeHasFullDay } from './rental-dates';

describe('rangeHasFullDay (R5: a request on full dates is refused)', () => {
  const busy = busyDates([
    { date: '2026-11-22', state: 'full' },
    { date: '2026-11-23', state: 'partial' },
    { date: '2026-11-25', state: 'free' },
  ]);

  it('only full days are busy', () => {
    expect([...busy]).toEqual(['2026-11-22']);
  });

  it('true when a full day is inside the range, including its ends', () => {
    expect(rangeHasFullDay('2026-11-21', '2026-11-23', busy)).toBe(true);
    expect(rangeHasFullDay('2026-11-22', '2026-11-22', busy)).toBe(true);
    expect(rangeHasFullDay('2026-11-20', '2026-11-22', busy)).toBe(true);
  });

  it('false at the edge just outside', () => {
    expect(rangeHasFullDay('2026-11-23', '2026-11-25', busy)).toBe(false);
    expect(rangeHasFullDay('2026-11-19', '2026-11-21', busy)).toBe(false);
  });
});

describe('rangeFromStart (R1)', () => {
  it('ends by the period: hour on the day, days n − 1, weeks 7n − 1, months 30n − 1, across a month end', () => {
    expect(rangeFromStart('2026-11-21', 'hour', 6).end).toBe('2026-11-21');
    expect(rangeFromStart('2026-11-21', 'day', 3).end).toBe('2026-11-23');
    expect(rangeFromStart('2026-11-28', 'week', 1).end).toBe('2026-12-04');
    expect(rangeFromStart('2026-12-15', 'month', 1).end).toBe('2027-01-13');
  });
});
