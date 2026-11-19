import React, { createContext, useContext } from 'react';
import { lightColors, shadowValues, type ThemeColors } from './palette';

// The palette lives in `palette.ts` (Periwinkle v2, spec §4); re-exported so existing imports keep working.
// The app is light only (owner's call, 2026-11-19): there is no dark theme and no theme setting.
export { lightColors };
export type { ThemeColors };

/** Shadows for things that float (spec §4.3), as `boxShadow` style objects. Cards use hairline borders instead. */
export interface ThemeShadows {
  raised: { boxShadow: string };
  float: { boxShadow: string };
  segment: { boxShadow: string };
}

interface ThemeContextValue {
  colors: ThemeColors;
  shadows: ThemeShadows;
}

const SHADOWS: ThemeShadows = (() => {
  const v = shadowValues();
  return { raised: { boxShadow: v.raised }, float: { boxShadow: v.float }, segment: { boxShadow: v.segment } };
})();

const VALUE: ThemeContextValue = { colors: lightColors, shadows: SHADOWS };

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <ThemeContext.Provider value={VALUE}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
