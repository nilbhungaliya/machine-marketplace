import { i18n, isLanguage } from '@/lib/i18n';
import { IST_OFFSET_MIN, istDateKey } from '@/lib/ist-date';

// Explicit names, not Intl: Hermes ships different locale data on Android and iOS.
const NAMES = {
  en: {
    monthsShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    monthsLong: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    daysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  },
  gu: {
    monthsShort: ['જાન્યુ', 'ફેબ્રુ', 'માર્ચ', 'એપ્રિલ', 'મે', 'જૂન', 'જુલાઈ', 'ઑગસ્ટ', 'સપ્ટે', 'ઑક્ટો', 'નવે', 'ડિસે'],
    monthsLong: ['જાન્યુઆરી', 'ફેબ્રુઆરી', 'માર્ચ', 'એપ્રિલ', 'મે', 'જૂન', 'જુલાઈ', 'ઑગસ્ટ', 'સપ્ટેમ્બર', 'ઑક્ટોબર', 'નવેમ્બર', 'ડિસેમ્બર'],
    daysShort: ['રવિ', 'સોમ', 'મંગળ', 'બુધ', 'ગુરુ', 'શુક્ર', 'શનિ'],
  },
  hi: {
    monthsShort: ['जन', 'फ़र', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुल', 'अग', 'सित', 'अक्टू', 'नव', 'दिस'],
    monthsLong: ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'],
    daysShort: ['रवि', 'सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि'],
  },
} as const;

const names = () => NAMES[isLanguage(i18n.language) ? i18n.language : 'en'];
// Shifted so its UTC parts read as the IST wall clock, whatever the device zone.
const ist = (ms: number) => new Date(ms + IST_OFFSET_MIN * 60 * 1000);

export const monthShortNames = (): readonly string[] => names().monthsShort;
export const weekdayShortNames = (): readonly string[] => names().daysShort;

export function formatDayMonth(ms: number): string {
  const d = ist(ms);
  return `${d.getUTCDate()} ${names().monthsShort[d.getUTCMonth()]}`;
}

export function formatDate(ms: number): string {
  return `${formatDayMonth(ms)} ${ist(ms).getUTCFullYear()}`;
}

export function formatWeekdayShort(ms: number): string {
  return names().daysShort[ist(ms).getUTCDay()];
}

export function formatDateWithWeekday(ms: number): string {
  return `${formatWeekdayShort(ms)}, ${formatDate(ms)}`;
}

export function formatMonthYear(ms: number): string {
  const d = ist(ms);
  return `${names().monthsLong[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function formatTime(ms: number): string {
  const d = ist(ms);
  const h = d.getUTCHours();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const suffix = i18n.t(h < 12 ? 'common.am' : 'common.pm');
  return `${hour12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${suffix}`;
}

/** Chat day separator: Today / Yesterday / "21 Aug 2026". India has no DST. */
export function istDayLabel(ms: number, nowMs: number = Date.now()): string {
  const key = istDateKey(ms);
  if (key === istDateKey(nowMs)) return i18n.t('common.today');
  if (key === istDateKey(nowMs - 86400000)) return i18n.t('common.yesterday');
  return formatDate(ms);
}
export const istTime = formatTime;
