import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Type Definition ───
// Both palettes share these token names. Components read them off useTheme().colors
// and never import a hex literal.
export interface ThemeColors {
  // Backgrounds
  background: string;
  surface: string;
  elevated: string;
  card: string;

  // Borders
  border: string;
  borderLight: string;

  // Primary — Indigo (shared with apps/admin tailwind `brand`)
  primary: string;
  primaryLight: string;
  primaryMuted: string;
  primaryDark: string;
  onPrimary: string;

  // Text
  text: string;
  textSecondary: string;
  textMuted: string;

  // Fixed
  white: string;
  black: string;
  focusFill: string;

  // Status
  green: string;
  greenMuted: string;
  red: string;
  redMuted: string;
  blue: string;
  blueMuted: string;
  orange: string;
  orangeMuted: string;
}

// ─── Light Palette ───
export const lightColors: ThemeColors = {
  background: '#F7F7FB',
  surface: '#FFFFFF',
  elevated: '#F1F1F7',
  card: '#FFFFFF',

  border: '#E3E3EC',
  borderLight: '#EDEDF3',

  primary: '#4F46E5',
  primaryLight: '#818CF8',
  primaryMuted: 'rgba(79,70,229,0.10)',
  primaryDark: '#3730A3',
  onPrimary: '#FFFFFF',

  text: '#16161D',
  textSecondary: '#5B5B6B',
  textMuted: '#9A9AAB',

  white: '#FFFFFF',
  black: '#000000',
  focusFill: '#F5F5FF',

  green: '#15803D',
  greenMuted: 'rgba(21,128,61,0.10)',
  red: '#B91C1C',
  redMuted: 'rgba(185,28,28,0.10)',
  blue: '#2563EB',
  blueMuted: 'rgba(37,99,235,0.10)',
  orange: '#C2410C',
  orangeMuted: 'rgba(194,65,12,0.10)',
};

// ─── Dark Palette ───
export const darkColors: ThemeColors = {
  background: '#0E0E14',
  surface: '#17171F',
  elevated: '#1F1F29',
  card: '#1A1A23',

  border: '#2C2C38',
  borderLight: '#24242F',

  primary: '#818CF8',
  primaryLight: '#A5B4FC',
  primaryMuted: 'rgba(129,140,248,0.16)',
  primaryDark: '#6366F1',
  onPrimary: '#0E0E14',

  text: '#EDEDF3',
  textSecondary: '#A3A3B5',
  textMuted: '#6B6B7E',

  white: '#FFFFFF',
  black: '#000000',
  focusFill: '#1C1C2A',

  green: '#4ADE80',
  greenMuted: 'rgba(74,222,128,0.14)',
  red: '#F87171',
  redMuted: 'rgba(248,113,113,0.14)',
  blue: '#60A5FA',
  blueMuted: 'rgba(96,165,250,0.14)',
  orange: '#FB923C',
  orangeMuted: 'rgba(251,146,60,0.14)',
};

// ─── Shadow helpers ─── never hand-roll a shadowOffset in a component.
export function getCardShadow(isDark: boolean) {
  return isDark
    ? { shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 3 }
    : { shadowColor: '#1E1B4B', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 3 };
}

export function getPrimaryGlow(isDark: boolean) {
  return {
    shadowColor: isDark ? '#818CF8' : '#4F46E5',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: isDark ? 0.35 : 0.3,
    shadowRadius: 14,
    elevation: 6,
  };
}

// ─── Context ───
export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  colors: ThemeColors;
  isDark: boolean;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  cardShadow: ReturnType<typeof getCardShadow>;
  primaryGlow: ReturnType<typeof getPrimaryGlow>;
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
  const cardShadow = useMemo(() => getCardShadow(isDark), [isDark]);
  const primaryGlow = useMemo(() => getPrimaryGlow(isDark), [isDark]);

  const value = useMemo(
    () => ({ colors, isDark, mode, setMode, cardShadow, primaryGlow }),
    [colors, isDark, mode, setMode, cardShadow, primaryGlow],
  );

  if (!isLoaded) return null;

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
