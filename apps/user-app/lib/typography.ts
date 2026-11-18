import { fonts, type FontKey } from './fonts';
import type { Language } from './i18n';
import { scriptLineHeight, scriptTracking, usesIndicScript } from './i18n/script';

// The app's type scale (spec §5.4): the mockup's sizes × 1.15 (R1), line heights at the mockup's ratio. Pure: read it
// through `useType()` in components; `typeStyle` applies the Hindi / Gujarati rules (spec §5.3).

export type TypeToken =
  | 'display' | 'title' | 'sheetTitle' | 'appBar' | 'section' | 'cardTitle' | 'lead' | 'body' | 'bodyStrong'
  | 'fieldValue' | 'label' | 'caption' | 'button' | 'buttonSm' | 'chip' | 'badge' | 'price' | 'otp' | 'phone' | 'mono';

export interface TypeEntry {
  family: FontKey;
  size: number;
  lineHeight: number;
  tracking: number;
  tabular?: boolean;
}

export const TYPE_SCALE: Record<TypeToken, TypeEntry> = {
  display: { family: 'extraBold', size: 34, lineHeight: 38, tracking: -1.0 },
  title: { family: 'bold', size: 26, lineHeight: 30, tracking: -0.8 },
  sheetTitle: { family: 'bold', size: 22, lineHeight: 27, tracking: -0.4 },
  appBar: { family: 'bold', size: 20, lineHeight: 24, tracking: -0.2 },
  section: { family: 'bold', size: 18, lineHeight: 24, tracking: -0.2 },
  cardTitle: { family: 'bold', size: 16, lineHeight: 21, tracking: 0 },
  lead: { family: 'medium', size: 16, lineHeight: 23, tracking: 0 },
  body: { family: 'regular', size: 15, lineHeight: 22, tracking: 0 },
  bodyStrong: { family: 'semiBold', size: 16, lineHeight: 22, tracking: 0 },
  fieldValue: { family: 'semiBold', size: 16, lineHeight: 22, tracking: 0 },
  label: { family: 'bold', size: 13, lineHeight: 18, tracking: 0 },
  caption: { family: 'regular', size: 13, lineHeight: 18, tracking: 0 },
  button: { family: 'bold', size: 16, lineHeight: 20, tracking: -0.1 },
  buttonSm: { family: 'bold', size: 14, lineHeight: 18, tracking: 0 },
  chip: { family: 'bold', size: 14, lineHeight: 18, tracking: 0 },
  badge: { family: 'extraBold', size: 12, lineHeight: 16, tracking: 0 },
  price: { family: 'extraBold', size: 20, lineHeight: 24, tracking: -0.6, tabular: true },
  otp: { family: 'extraBold', size: 24, lineHeight: 30, tracking: 0, tabular: true },
  phone: { family: 'bold', size: 24, lineHeight: 30, tracking: 1, tabular: true },
  mono: { family: 'monoMedium', size: 14, lineHeight: 20, tracking: 0.2 },
};

export interface TypeStyle {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  fontVariant?: ['tabular-nums'];
}

const MONO: readonly FontKey[] = ['mono', 'monoMedium'];

/**
 * The style for a type token in a language. In Hindi and Gujarati: line height at least 1.45 × the size, no negative
 * tracking, and 800 drops to 700 so heavy Indic headings don't clot. Mono families never change by script.
 */
export function typeStyle(token: TypeToken, lang: Language): TypeStyle {
  const e = TYPE_SCALE[token];
  const indic = usesIndicScript(lang) && !MONO.includes(e.family);
  const family: FontKey = indic && e.family === 'extraBold' ? 'bold' : e.family;
  const style: TypeStyle = {
    fontFamily: fonts[family],
    fontSize: e.size,
    lineHeight: indic ? scriptLineHeight(lang, e.size, e.lineHeight) : e.lineHeight,
    letterSpacing: indic ? scriptTracking(lang, e.tracking) : e.tracking,
  };
  if (e.tabular) style.fontVariant = ['tabular-nums'];
  return style;
}
