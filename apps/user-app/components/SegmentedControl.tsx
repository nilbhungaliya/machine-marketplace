import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { radius, useTheme } from '@/lib/theme';
import { useType } from '@/hooks/use-type';

export interface SegmentOption<T extends string> {
  value: T;
  /** Already translated. */
  label: string;
  /** English, hyphenated: the analytics label and e2e selector. */
  testID: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** One choice from a few short options (Periwinkle v2 `.segmented.big`, spec §7.1): the selected segment is white. */
export default function SegmentedControl<T extends string>({
  options, value, onChange, accessibilityLabel, style,
}: SegmentedControlProps<T>) {
  const { colors, shadows } = useTheme();
  const type = useType();
  const s = useMemo(() => StyleSheet.create({
    track: { flexDirection: 'row', gap: 2, padding: 4, borderRadius: radius.md, backgroundColor: colors.field },
    segment: {
      flex: 1, minHeight: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8,
    },
    segmentOn: { backgroundColor: colors.surface, ...shadows.segment },
    label: { ...type('chip'), color: colors.textSecondary, textAlign: 'center' },
    labelOn: { color: colors.primaryInk },
  }), [colors, shadows, type]);

  return (
    <View style={[s.track, style]} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            style={[s.segment, on && s.segmentOn]}
            onPress={() => onChange(o.value)}
            testID={o.testID}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, checked: on }}
          >
            <Text style={[s.label, on && s.labelOn]} numberOfLines={1}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
