import { describe, it, expect } from 'vitest';
import { istDateKey, IST_OFFSET_MIN } from './ist-date';

/**
 * Audit #15 — `home.tsx` and `job-detail.tsx` both derived "today" with
 * `new Date().toISOString().slice(0, 10)`. `toISOString()` is always UTC, no
 * matter what the phone's timezone is set to, so between 00:00 and 05:29 IST the
 * washer's app was a full day behind:
 *
 *   - today's jobs were labelled "Tomorrow" on Home
 *   - "I'm on my way" was disabled on a job scheduled for that very day, with
 *     the note "Available on <today's date>"
 *
 * A washer starting an early shift is exactly the person this hits.
 *
 * The API already solved this class of bug (istDate / IST_OFFSET_MIN); the
 * responder app never received it and had no shared date helper at all, which is
 * why the same wrong line appeared twice.
 *
 * Note `upcoming-jobs.ts` is NOT the bug and is left alone: it takes `todayKey`
 * as a parameter and derives "tomorrow" from it at UTC midnight, which is
 * timezone-stable. Its own test passes the key explicitly, so that test could
 * never have caught this — the defect was always in the callers.
 *
 * Reference instant: 2026-08-06T19:30:00Z is 01:00 IST on the *7th*.
 */

const IST_0100_ON_7TH = Date.parse('2026-08-06T19:30:00Z');

describe('IST_OFFSET_MIN', () => {
  it('is +5:30 in minutes, matching the API', () => {
    expect(IST_OFFSET_MIN).toBe(330);
  });
});

describe('istDateKey', () => {
  it('returns the IST date, not the UTC one, after IST midnight', () => {
    expect(istDateKey(IST_0100_ON_7TH)).toBe('2026-08-07');
    // What the old line produced, for contrast.
    expect(new Date(IST_0100_ON_7TH).toISOString().slice(0, 10)).toBe('2026-08-06');
  });

  it('flips exactly at IST midnight', () => {
    expect(istDateKey(Date.parse('2026-08-06T18:29:59Z'))).toBe('2026-08-06'); // 23:59:59 IST
    expect(istDateKey(Date.parse('2026-08-06T18:30:00Z'))).toBe('2026-08-07'); // 00:00:00 IST
  });

  it('agrees with UTC once past 05:30 IST, where the old code happened to be right', () => {
    // 06:00 IST on the 7th — both readings say the 7th, which is why this bug
    // is invisible during normal working hours.
    const ms = Date.parse('2026-08-07T00:30:00Z');
    expect(istDateKey(ms)).toBe('2026-08-07');
    expect(new Date(ms).toISOString().slice(0, 10)).toBe('2026-08-07');
  });

  /**
   * The two user-visible consequences, asserted as the screens compute them.
   */
  it("labels a job scheduled for the IST day as today, not tomorrow", () => {
    const todayKey = istDateKey(IST_0100_ON_7TH);
    const jobScheduledToday = '2026-08-07';
    expect(jobScheduledToday === todayKey).toBe(true);

    // Old behaviour: the key was the 6th, so the job looked like a future day.
    const oldKey = new Date(IST_0100_ON_7TH).toISOString().slice(0, 10);
    expect(jobScheduledToday === oldKey).toBe(false);
  });

  it('does not block "I\'m on my way" on a job scheduled for the IST day', () => {
    // job-detail: beforeScheduledDate = b.scheduledDate > today
    const scheduledDate = '2026-08-07';
    expect(scheduledDate > istDateKey(IST_0100_ON_7TH)).toBe(false); // enabled

    const oldToday = new Date(IST_0100_ON_7TH).toISOString().slice(0, 10);
    expect(scheduledDate > oldToday).toBe(true); // disabled — the bug
  });

  it('defaults to now when no timestamp is given', () => {
    expect(istDateKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
