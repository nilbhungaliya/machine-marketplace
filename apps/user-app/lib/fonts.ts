// Font family names (spec §5.1): Manrope for all text, JetBrains Mono for identifiers (GSTIN, PAN, part numbers).
// Loaded in `App.tsx`. Pure, so the type scale (`typography.ts`) and its test can use it; re-exported by `theme.ts`.
// The weight is picked by the family name: never `fontWeight` (Android ignores it for a custom family).
export const fonts = {
  regular: 'Manrope_400Regular',
  medium: 'Manrope_500Medium',
  semiBold: 'Manrope_600SemiBold',
  bold: 'Manrope_700Bold',
  extraBold: 'Manrope_800ExtraBold',
  mono: 'JetBrainsMono_400Regular',
  monoMedium: 'JetBrainsMono_500Medium',
};

export type FontKey = keyof typeof fonts;
