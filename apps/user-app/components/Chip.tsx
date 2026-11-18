import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import type { LucideIcon } from '@/lib/icons';
import { radius, spacing, useTheme } from '@/lib/theme';
import { useType } from '@/hooks/use-type';

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: LucideIcon;
  disabled?: boolean;
  /** `checkbox` for multi-select groups, `radio` for single-select. */
  role?: 'checkbox' | 'radio';
  /** English, hyphenated: the analytics label and e2e selector. */
  testID: string;
  style?: StyleProp<ViewStyle>;
}

/** A selectable pill (Periwinkle v2 `.chip`, spec §7.1): a quiet grey fill when idle, lavender when selected. */
export default function Chip({ label, selected = false, onPress, icon: Icon, disabled = false, role = 'checkbox', testID, style }: ChipProps) {
  const { colors } = useTheme();
  const type = useType();
  const s = useMemo(() => StyleSheet.create({
    chip: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 40, paddingHorizontal: 14,
      borderRadius: radius.full, backgroundColor: colors.field,
    },
    selected: { backgroundColor: colors.primarySoft },
    disabled: { opacity: 0.5 },
    label: { ...type('chip'), color: colors.textSecondary },
    labelSelected: { color: colors.primaryInk },
  }), [colors, type]);

  return (
    <Pressable
      style={[s.chip, selected && s.selected, disabled && s.disabled, style]}
      onPress={onPress}
      disabled={disabled || !onPress}
      testID={testID}
      accessibilityRole={role}
      accessibilityState={{ checked: selected, disabled }}
      hitSlop={4}
    >
      {Icon ? <Icon size={16} color={selected ? colors.primaryInk : colors.textSecondary} /> : null}
      <Text style={[s.label, selected && s.labelSelected]}>{label}</Text>
    </Pressable>
  );
}
