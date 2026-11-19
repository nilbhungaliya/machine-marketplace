import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useOnce } from '@/hooks/use-loop';
import { EASE } from '@/lib/motion-track';
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

/**
 * Progress through a short flow (Periwinkle v2 `.steps`, spec §7.2): a segmented bar over the step text. The current
 * step's segment racks in on mount (onboarding motion `rack`: six clicks over 0.9 s after 0.35 s; full under reduce
 * motion).
 */
export default function Steps({ current, total, label, style }: StepsProps) {
  const { colors } = useTheme();
  const type = useType();
  const s = useMemo(() => StyleSheet.create({
    bar: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm },
    segment: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
    done: { backgroundColor: colors.primary },
    fill: { ...StyleSheet.absoluteFillObject, borderRadius: 3, backgroundColor: colors.primary, transformOrigin: 'left' },
    label: { ...type('caption'), fontFamily: fonts.bold, color: colors.textMuted },
  }), [colors, type]);
  return (
    <View style={style} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: current }}>
      <View style={s.bar}>
        {Array.from({ length: total }, (_, i) => (
          <View key={i} style={[s.segment, i < current - 1 && s.done]}>
            {i === current - 1 ? <RackFill style={s.fill} /> : null}
          </View>
        ))}
      </View>
      <Text style={s.label}>{label}</Text>
    </View>
  );
}

function RackFill({ style }: { style: StyleProp<ViewStyle> }) {
  const p = useOnce(900, 350);
  const rack = useAnimatedStyle(() => ({ transform: [{ scaleX: EASE.ratchet(p.value) }] }));
  return <Animated.View style={[style, rack]} />;
}
