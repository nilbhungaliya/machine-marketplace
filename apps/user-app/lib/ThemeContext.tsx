import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { darkColors, lightColors, shadowValues, type ThemeColors } from './palette';

// The palette lives in `palette.ts` (Periwinkle v2, spec §4); re-exported so existing imports keep working.
export { darkColors, lightColors };
export type { ThemeColors };

/** Shadows for things that float (spec §4.3), as `boxShadow` style objects. Cards use hairline borders instead. */
export interface ThemeShadows {
  raised: { boxShadow: string };
  float: { boxShadow: string };
  segment: { boxShadow: string };
}

// ─── Context ───
export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  colors: ThemeColors;
  isDark: boolean;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  shadows: ThemeShadows;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = '@mpm_theme_mode';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored === 'light' || stored === 'dark' || stored === 'system') setModeState(stored);
      })
      .catch(() => {})
      .finally(() => setIsLoaded(true));
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const isDark = mode === 'dark' || (mode === 'system' && systemScheme === 'dark');
  const colors = isDark ? darkColors : lightColors;
  const shadows = useMemo<ThemeShadows>(() => {
    const v = shadowValues(isDark);
    return { raised: { boxShadow: v.raised }, float: { boxShadow: v.float }, segment: { boxShadow: v.segment } };
  }, [isDark]);

  const value = useMemo(
    () => ({ colors, isDark, mode, setMode, shadows }),
    [colors, isDark, mode, setMode, shadows],
  );

  if (!isLoaded) return null;

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
