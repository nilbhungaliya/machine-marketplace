import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { fonts, spacing, useTheme } from '@/lib/theme';
import { useType } from '@/hooks/use-type';

interface StepsProps {
  /** 1-based. */
  current: number;
  total: number;
  /** The already-translated step text (`onboarding.step`). */
  label: string;
  style?: StyleProp<ViewStyle>;
}

/** Progress through a short flow (Periwinkle v2 `.steps`, spec §7.2): a segmented bar over the step text. */
export default function Steps({ current, total, label, style }: StepsProps) {
  const { colors } = useTheme();
  const type = useType();
  const s = useMemo(() => StyleSheet.create({
    bar: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm },
    segment: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.border },
    done: { backgroundColor: colors.primary },
    label: { ...type('caption'), fontFamily: fonts.bold, color: colors.textMuted },
  }), [colors, type]);
  return (
    <View style={style} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: current }}>
      <View style={s.bar}>
        {Array.from({ length: total }, (_, i) => <View key={i} style={[s.segment, i < current && s.done]} />)}
      </View>
      <Text style={s.label}>{label}</Text>
    </View>
  );
}
