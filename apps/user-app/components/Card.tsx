import React, { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { radius, spacing, useTheme } from '@/lib/theme';

interface CardProps {
  children: React.ReactNode;
  /** Inner padding; 16 by default. */
  padding?: number;
  /** No padding and clipped corners, for a list of `ListRow`s. */
  flush?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** A Periwinkle v2 card (spec §7.2): `surface` with a hairline border and no shadow. */
export default function Card({ children, padding = spacing.lg, flush = false, style }: CardProps) {
  const { colors } = useTheme();
  const s = useMemo(() => StyleSheet.create({
    card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, borderRadius: radius.xl },
  }), [colors]);
  return (
    <View style={[s.card, flush ? { padding: 0, overflow: 'hidden' } : { padding }, style]}>{children}</View>
  );
}
