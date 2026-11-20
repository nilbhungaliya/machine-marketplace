import { describe, expect, it } from 'vitest';
import { addDays, istDateOf, istToday } from './ist.js';

// M14 plan D11: the one IST calendar-date helper (Review focus 5: a booking day is the IST date, never the UTC one).

describe('istToday / istDateOf', () => {
  it('rolls over at IST midnight (18:30 UTC)', () => {
    expect(istToday(new Date('2026-11-20T19:00:00Z'))).toBe('2026-11-21');
    expect(istToday(new Date('2026-11-20T18:29:00Z'))).toBe('2026-11-20');
    expect(istDateOf(new Date('2026-11-20T18:30:00Z'))).toBe('2026-11-21');
  });
});

describe('addDays', () => {
  it('crosses months and years', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-12-01', -1)).toBe('2026-11-30');
  });
});
