import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { sideHalves, type HalfState, type SideKind } from '@/lib/side-token';
import { radius, useTheme, type ThemeColors } from '@/lib/theme';
import { useType } from '@/hooks/use-type';

const HALF: Record<'md' | 'lg' | 'xl', { box: number; letter: number }> = {
  md: { box: 20, letter: 11 },
  lg: { box: 28, letter: 11 },
  xl: { box: 40, letter: 17 },
};

function halfColours(state: HalfState, c: ThemeColors): { bg: string; fg: string; dashed: boolean } {
  switch (state) {
    case 'on': return { bg: c.primary, fg: c.onPrimary, dashed: false };
    case 'off': return { bg: c.photo, fg: c.textMuted, dashed: false };
    case 'have': return { bg: c.textMuted, fg: c.surface, dashed: false };
    // RN has no hatch pattern: the needed half is lavender with a dashed violet border (Ruling R7).
    case 'need': return { bg: c.primaryWash, fg: c.primaryInk, dashed: true };
  }
}

interface SideTokenProps {
  kind: SideKind;
  size?: 'md' | 'lg' | 'xl';
  style?: StyleProp<ViewStyle>;
}

/**
 * The L | R side token (Periwinkle v2 `.side .tok`, spec §7.4): two halves, the filled one is the part's side; for a
 * buyer's need, the side they have is grey and the side they want is dashed. No text label in this build.
 */
export default function SideToken({ kind, size = 'md', style }: SideTokenProps) {
  const { colors } = useTheme();
  const type = useType();
  const { box, letter } = HALF[size];
  const halves = sideHalves(kind);

  const s = useMemo(() => StyleSheet.create({
    tok: { flexDirection: 'row', gap: 2 },
    half: { width: box, height: box, alignItems: 'center', justifyContent: 'center' },
    left: { borderTopLeftRadius: radius.full, borderBottomLeftRadius: radius.full, borderTopRightRadius: 4, borderBottomRightRadius: 4 },
    right: { borderTopRightRadius: radius.full, borderBottomRightRadius: radius.full, borderTopLeftRadius: 4, borderBottomLeftRadius: 4 },
    dashed: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.primary },
    letter: { ...type('badge'), fontSize: letter, lineHeight: Math.round(letter * 1.2), letterSpacing: 0 },
  }), [colors, type, box, letter]);

  const half = (state: HalfState, side: 'left' | 'right', char: string) => {
    const { bg, fg, dashed } = halfColours(state, colors);
    return (
      <View style={[s.half, s[side], { backgroundColor: bg }, dashed && s.dashed]}>
        <Text style={[s.letter, { color: fg }]}>{char}</Text>
      </View>
    );
  };

  // The letters mean nothing without the label that comes with listings, so screen readers skip the token for now.
  return (
    <View style={[s.tok, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {half(halves.left, 'left', 'L')}
      {half(halves.right, 'right', 'R')}
    </View>
  );
}
