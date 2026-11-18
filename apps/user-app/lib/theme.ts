// Re-export the theme system
export { useTheme, darkColors, lightColors } from './ThemeContext';
export type { ThemeColors, ThemeMode, ThemeShadows } from './ThemeContext';

// ─── Fonts (static) — Manrope + JetBrains Mono (lib/fonts.ts; type scale in lib/typography.ts) ───
export { fonts } from './fonts';
export type { FontKey } from './fonts';

// ─── Spacing (static) ───
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

// ─── Radius (static, spec §3) ───
export const radius = {
  xs: 6, // mono tag
  sm: 10, // segment inside a segmented control
  md: 14, // fields, segmented track, skeleton blocks, small thumbs, icon wells
  lg: 18, // callouts, choice cards, toasts, map box
  xl: 24, // cards, menus, list cards
  sheet: 28, // bottom sheet top corners
  full: 999, // buttons, chips, pills, tab bar, avatars
};
