import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import type { LucideIcon } from '@/lib/icons';
import { fonts, radius, spacing, useTheme } from '@/lib/theme';

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

/** A selectable pill (Periwinkle v2 chips): filled when idle, the primary tint and border when selected. */
export default function Chip({ label, selected = false, onPress, icon: Icon, disabled = false, role = 'checkbox', testID, style }: ChipProps) {
  const { colors } = useTheme();
  const s = useMemo(() => StyleSheet.create({
    chip: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 40, paddingHorizontal: spacing.md,
      borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.elevated, backgroundColor: colors.elevated,
    },
    selected: { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
    disabled: { opacity: 0.5 },
    label: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
    labelSelected: { color: colors.primary, fontFamily: fonts.semiBold },
  }), [colors]);

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
      {Icon ? <Icon size={16} color={selected ? colors.primary : colors.textSecondary} /> : null}
      <Text style={[s.label, selected && s.labelSelected]}>{label}</Text>
    </Pressable>
  );
}
