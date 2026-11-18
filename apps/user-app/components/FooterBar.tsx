import React, { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { radius, spacing, useTheme } from '@/lib/theme';

interface FooterBarProps {
  /** One or two `Button size="md"`; each gets an equal share of the bar. */
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** The floating pill that holds a screen's bottom action (Periwinkle v2 `.footbar`, spec §7.3). */
export default function FooterBar({ children, style }: FooterBarProps) {
  const { colors, shadows } = useTheme();
  const s = useMemo(() => StyleSheet.create({
    bar: {
      flexDirection: 'row', gap: spacing.sm, padding: 6, marginHorizontal: spacing.md, marginBottom: spacing.md,
      borderRadius: radius.full, backgroundColor: colors.surface, ...shadows.float,
    },
    slot: { flex: 1 },
  }), [colors, shadows]);
  return (
    <View style={[s.bar, style]}>
      {React.Children.map(children, (child) => (child == null || child === false ? null : <View style={s.slot}>{child}</View>))}
    </View>
  );
}
