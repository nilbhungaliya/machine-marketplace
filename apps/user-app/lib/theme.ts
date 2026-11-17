// Re-export the theme system
export { useTheme, darkColors, lightColors } from './ThemeContext';
export type { ThemeColors, ThemeMode } from './ThemeContext';

// ─── Fonts (static) — Montserrat display + Inter body ───
export const fonts = {
  // Display — Montserrat
  display: 'Montserrat_700Bold',
  displaySemi: 'Montserrat_600SemiBold',
  displayHeavy: 'Montserrat_800ExtraBold',

  // Body / UI — Inter
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semiBold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
};

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

// ─── Radius (static) ───
export const radius = {
  sm: 8, // chips, inline pills
  md: 12, // inputs, secondary buttons
  lg: 16, // cards
  xl: 20, // large cards / hero panels
  full: 999, // avatars, segmented pills, primary Button
};
