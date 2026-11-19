import React, { useMemo } from 'react';
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';
import { useType } from '@/hooks/use-type';
import { radius, spacing, useTheme } from '@/lib/theme';

/** A live count beside a Browse row, a model or a suggestion (v2 `.tree-row em`): muted figure on the page fill. */
export default function CountPill({ count, style }: { count: number; style?: StyleProp<TextStyle> }) {
  const { colors } = useTheme();
  const type = useType();
  const s = useMemo(() => StyleSheet.create({
    pill: {
      ...type('caption'), color: colors.textMuted, backgroundColor: colors.background, borderRadius: radius.full,
      paddingHorizontal: spacing.sm, overflow: 'hidden', fontVariant: ['tabular-nums'],
    },
  }), [colors, type]);
  return <Text style={[s.pill, style]}>{count}</Text>;
}
