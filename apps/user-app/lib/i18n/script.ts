import type { Language } from '@/lib/i18n';

// Montserrat has no Gujarati or Devanagari, so the system font draws them, and
// its vowel signs above and below need a taller line than the design's.
export const usesIndicScript = (lang: Language) => lang !== 'en';

/** The designed line height in English; at least 1.45x the font size otherwise. */
export const scriptLineHeight = (lang: Language, fontSize: number, lineHeight: number) =>
  usesIndicScript(lang) ? Math.max(lineHeight, Math.round(fontSize * 1.45)) : lineHeight;

/** Negative tracking breaks the joined letters of Indic scripts. */
export const scriptTracking = (lang: Language, letterSpacing: number) =>
  usesIndicScript(lang) && letterSpacing < 0 ? 0 : letterSpacing;
