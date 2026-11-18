// The Periwinkle v2 palette (spec §4.1, §4.3): the only place colour values live in the app. Pure (no react-native
// import) so Vitest checks it against the mockup's CSS variables (`palette.test.ts`). Components read these through
// `useTheme().colors` / `useTheme().shadows`.

export interface ThemeColors {
  /** Screen background, header, steps (`--canvas`). */
  background: string;
  /** Cards, sheets, tab bar, footer bar, icon buttons, toasts, a focused field (`--surface`). */
  surface: string;
  /** Product-shot sweep, avatar and thumb placeholders, the side token's "off" half (`--photo`). */
  photo: string;
  /** Filled inputs, idle chips, segmented track, skeletons, mono tag (`--field`). */
  field: string;
  /** Body and titles (`--ink`). */
  text: string;
  /** Leads, field labels, idle chip labels (`--ink-2`). */
  textSecondary: string;
  /** Hints, meta, placeholders, inactive tab icons (`--ink-3`). */
  textMuted: string;
  /** 1.5 dp control borders, steps track, sheet grab (`--line`). */
  border: string;
  /** Row separators inside cards; neutral status chip fill (`--line-2`). */
  divider: string;
  /** 1 dp card borders (`--hair`). */
  hairline: string;
  /** Primary buttons, selection, focus ring, filled side half (`--primary`). */
  primary: string;
  /** Violet text and icons on light fills: links, selected chip, active tab (`--primary-ink`). */
  primaryInk: string;
  /** Text on primary (`--on-primary`). */
  onPrimary: string;
  /** Selected chip fill, callout border (`--soft`). */
  primarySoft: string;
  /** Callouts, active tab well, selected row or choice (`--soft2`). */
  primaryWash: string;
  /** Yellow badges only (`--sun`). */
  sun: string;
  /** Text on sun (`--on-sun`). */
  onSun: string;
  ok: string;
  okSoft: string;
  warn: string;
  warnSoft: string;
  danger: string;
  dangerSoft: string;
  /** Text on a solid danger button. Derived: the mockup has no solid danger button. */
  onDanger: string;
  /** Ratings (`--star`). */
  star: string;
  /** Welcome glow (`--tile-a`). */
  heroGlow: string;
  /** Sheet backdrop; carries its own alpha (`--scrim`). */
  scrim: string;
}

export const lightColors: ThemeColors = {
  background: '#F5F4FA',
  surface: '#FFFFFF',
  photo: '#ECEBF1',
  field: '#F0EFF5',
  text: '#1C1A27',
  textSecondary: '#5E5B6E',
  textMuted: '#8E8B9E',
  border: '#E7E5EF',
  divider: '#F0EEF6',
  hairline: '#E6E4EE',
  primary: '#5B41E6',
  primaryInk: '#4A31D4',
  onPrimary: '#FFFFFF',
  primarySoft: '#E1DBFF',
  primaryWash: '#F1EEFF',
  sun: '#FFD52E',
  onSun: '#1C1A27',
  ok: '#14915F',
  okSoft: '#DFF4EA',
  warn: '#B26F00',
  warnSoft: '#FFF1D2',
  danger: '#D93A44',
  dangerSoft: '#FDE6E7',
  onDanger: '#FFFFFF',
  star: '#F0A812',
  heroGlow: '#DAD4FB',
  scrim: 'rgba(28,20,70,0.45)',
};

export const darkColors: ThemeColors = {
  background: '#110F1F',
  surface: '#1B1830',
  photo: '#26223F',
  field: '#232038',
  text: '#F1EFFA',
  textSecondary: '#B8B4CC',
  textMuted: '#8A86A0',
  border: '#2C2846',
  divider: '#221F3A',
  hairline: '#2A2643',
  primary: '#8B78FF',
  primaryInk: '#B3A6FF',
  onPrimary: '#0E0B22',
  primarySoft: '#2D2660',
  primaryWash: '#221D45',
  sun: '#FFD84A',
  onSun: '#1C1A27',
  ok: '#4CCB93',
  okSoft: '#123326',
  warn: '#F0B44C',
  warnSoft: '#3A2B10',
  danger: '#FF7A80',
  dangerSoft: '#3D1A1E',
  onDanger: '#1C0B0D',
  star: '#FFC44D',
  heroGlow: '#2B2463',
  scrim: 'rgba(0,0,0,0.6)',
};

/** Token → mockup CSS variable (without `--`). Every token except the derived `onDanger`. */
export const TOKEN_SOURCE: Partial<Record<keyof ThemeColors, string>> = {
  background: 'canvas',
  surface: 'surface',
  photo: 'photo',
  field: 'field',
  text: 'ink',
  textSecondary: 'ink-2',
  textMuted: 'ink-3',
  border: 'line',
  divider: 'line-2',
  hairline: 'hair',
  primary: 'primary',
  primaryInk: 'primary-ink',
  onPrimary: 'on-primary',
  primarySoft: 'soft',
  primaryWash: 'soft2',
  sun: 'sun',
  onSun: 'on-sun',
  ok: 'ok',
  okSoft: 'ok-soft',
  warn: 'warn',
  warnSoft: 'warn-soft',
  danger: 'danger',
  dangerSoft: 'danger-soft',
  star: 'star',
  heroGlow: 'tile-a',
  scrim: 'scrim',
};

/**
 * Mockup variables deliberately not ported: page and phone-frame chrome, an unused line colour, the two font stacks
 * (spec §5) and `shadow` (consumed by `shadowValues`, not a colour token).
 */
export const NOT_PORTED = ['page', 'tile-b', 'tile-c', 'tile-ink', 'bezel', 'frame', 'part-line', 'f', 'mono', 'shadow'];

/** `boxShadow` strings for the things that float (spec §4.3); cards use hairline borders instead. */
export function shadowValues(isDark: boolean): { raised: string; float: string; segment: string } {
  const shadow = isDark ? 'rgba(0,0,0,0.45)' : 'rgba(52,36,140,0.13)';
  const segmentShadow = isDark ? 'rgba(0,0,0,0.5)' : 'rgba(28,20,70,0.14)';
  return {
    raised: `0 2px 8px ${shadow}`,
    float: `0 8px 22px ${shadow}`,
    segment: `0 1px 3px ${segmentShadow}`,
  };
}
