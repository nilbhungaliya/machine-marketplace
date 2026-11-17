import { describe, it, expect, afterEach } from 'vitest';
import { i18n } from '@/lib/i18n';
import {
  formatDayMonth, formatDate, formatDateWithWeekday, formatMonthYear, formatTime, formatWeekdayShort,
  istTime, istDayLabel, monthShortNames, weekdayShortNames,
} from './format-date';

// 2026-10-14 07:56 UTC = 13:26 IST, a Wednesday.
const T = Date.UTC(2026, 9, 14, 7, 56);
// 2026-10-14 19:00 UTC = 2026-10-15 00:30 IST: the IST date has already rolled over.
const MIDNIGHT = Date.UTC(2026, 9, 14, 19, 0);

afterEach(async () => { await i18n.changeLanguage('en'); });

describe('format-date (en)', () => {
  it('formats in IST', () => {
    expect(formatDayMonth(T)).toBe('14 Oct');
    expect(formatDate(T)).toBe('14 Oct 2026');
    expect(formatDateWithWeekday(T)).toBe('Wed, 14 Oct 2026');
    expect(formatMonthYear(T)).toBe('October 2026');
    expect(formatTime(T)).toBe('1:26 pm');
    expect(formatWeekdayShort(T)).toBe('Wed');
  });
  it('uses the IST day across UTC midnight', () => {
    expect(formatDate(MIDNIGHT)).toBe('15 Oct 2026');
    expect(formatTime(MIDNIGHT)).toBe('12:30 am');
  });
});

describe('format-date (gu)', () => {
  it('uses Gujarati names and keeps 0-9 digits', async () => {
    await i18n.changeLanguage('gu');
    expect(formatDayMonth(T)).toBe('14 ઑક્ટો');
    expect(formatDate(T)).toBe('14 ઑક્ટો 2026');
    expect(formatDateWithWeekday(T)).toBe('બુધ, 14 ઑક્ટો 2026');
    expect(formatMonthYear(T)).toBe('ઑક્ટોબર 2026');
    expect(formatTime(T)).toBe('1:26 PM');
    expect(formatWeekdayShort(T)).toBe('બુધ');
    expect(formatDate(T)).toMatch(/^[0-9]+ \S+ [0-9]{4}$/);
  });
});

describe('format-date (hi)', () => {
  it('uses Hindi names and keeps 0-9 digits', async () => {
    await i18n.changeLanguage('hi');
    expect(formatDayMonth(T)).toBe('14 अक्टू');
    expect(formatDate(T)).toBe('14 अक्टू 2026');
    expect(formatDateWithWeekday(T)).toBe('बुध, 14 अक्टू 2026');
    expect(formatMonthYear(T)).toBe('अक्टूबर 2026');
    expect(formatTime(T)).toBe('1:26 PM');
    expect(formatWeekdayShort(T)).toBe('बुध');
    expect(formatDate(T)).toMatch(/^[0-9]+ \S+ [0-9]{4}$/);
  });
  it('has twelve months and seven days, all distinct', async () => {
    await i18n.changeLanguage('hi');
    expect(new Set(monthShortNames()).size).toBe(12);
    expect(new Set(weekdayShortNames()).size).toBe(7);
    expect(weekdayShortNames()).toEqual(['रवि', 'सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि']);
    expect(monthShortNames()).toEqual(['जन', 'फ़र', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुल', 'अग', 'सित', 'अक्टू', 'नव', 'दिस']);
    const longs = ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'];
    // The 15th of each month, mid-day UTC: always the same IST date.
    expect(longs.map((_, m) => formatMonthYear(Date.UTC(2026, m, 15, 6)))).toEqual(longs.map((l) => `${l} 2026`));
    // 2026-10-11 is a Sunday; one day at a time through Saturday.
    expect([0, 1, 2, 3, 4, 5, 6].map((d) => formatWeekdayShort(Date.UTC(2026, 9, 11 + d, 6)))).toEqual(weekdayShortNames());
  });
  it('labels today and yesterday in Hindi', async () => {
    await i18n.changeLanguage('hi');
    const now = Date.parse('2026-08-21T12:00:00Z');
    expect(istDayLabel(Date.parse('2026-08-21T09:00:00Z'), now)).toBe('आज');
    expect(istDayLabel(Date.parse('2026-08-20T09:00:00Z'), now)).toBe('कल');
    expect(istDayLabel(Date.parse('2026-08-09T09:00:00Z'), now)).toBe('9 अग 2026');
  });
});

describe('istTime', () => {
  it('reads the IST wall clock, not the device timezone', () => {
    // 19:00 UTC is 00:30 the NEXT day in India — the window that has bitten
    // this repo before.
    expect(istTime(Date.parse('2026-08-20T19:00:00Z'))).toBe('12:30 am');
    expect(istTime(Date.parse('2026-08-21T07:56:00Z'))).toBe('1:26 pm');
  });

  it('shows noon and midnight as 12, not 0', () => {
    expect(istTime(Date.parse('2026-08-21T06:30:00Z'))).toBe('12:00 pm');
    expect(istTime(Date.parse('2026-08-20T18:30:00Z'))).toBe('12:00 am');
  });
});

describe('istDayLabel', () => {
  const now = Date.parse('2026-08-21T12:00:00Z');

  it('names today and yesterday', () => {
    expect(istDayLabel(Date.parse('2026-08-21T09:00:00Z'), now)).toBe('Today');
    expect(istDayLabel(Date.parse('2026-08-20T09:00:00Z'), now)).toBe('Yesterday');
  });

  it('dates anything older', () => {
    expect(istDayLabel(Date.parse('2026-08-09T09:00:00Z'), now)).toBe('9 Aug 2026');
  });

  it('groups by the Indian day, so late-evening UTC is already tomorrow', () => {
    expect(istDayLabel(Date.parse('2026-08-20T19:00:00Z'), now)).toBe('Today');
  });
});
