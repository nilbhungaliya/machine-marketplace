import React, { useMemo } from 'react';
import {
  Pressable, StyleSheet, Text, View, type AccessibilityRole, type AccessibilityState, type StyleProp, type ViewStyle,
} from 'react-native';
import { Check, ChevronRight, type LucideIcon } from '@/lib/icons';
import { spacing, useTheme } from '@/lib/theme';
import { useType } from '@/hooks/use-type';

interface ListRowProps {
  label: string;
  hint?: string;
  icon?: LucideIcon;
  /** Right-hand content (a StatusChip, a value). */
  trailing?: React.ReactNode;
  chevron?: boolean;
  /** The chosen row in a single-choice list: lavender fill and a check. */
  selected?: boolean;
  /** The last row of a card: no divider below. */
  last?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  testID?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
  style?: StyleProp<ViewStyle>;
}

/** A row in a `Card flush` (Periwinkle v2 `.menu div`, spec §7.2). */
export default function ListRow({
  label, hint, icon: Icon, trailing, chevron = false, selected = false, last = false, onPress, disabled,
  testID, accessibilityRole, accessibilityState, style,
}: ListRowProps) {
  const { colors } = useTheme();
  const type = useType();
  const s = useMemo(() => StyleSheet.create({
    row: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56,
      paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
      borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    last: { borderBottomWidth: 0 },
    selected: { backgroundColor: colors.primaryWash },
    disabled: { opacity: 0.5 },
    text: { flex: 1 },
    label: { ...type('bodyStrong'), color: colors.text },
    labelSelected: { color: colors.primaryInk },
    hint: { ...type('caption'), color: colors.textMuted, marginTop: 2 },
  }), [colors, type]);

  const content = (
    <>
      {Icon ? <Icon size={20} color={colors.primaryInk} /> : null}
      <View style={s.text}>
        <Text style={[s.label, selected && s.labelSelected]}>{label}</Text>
        {hint ? <Text style={s.hint}>{hint}</Text> : null}
      </View>
      {trailing}
      {selected ? <Check size={18} color={colors.primary} /> : null}
      {chevron ? <ChevronRight size={18} color={colors.textMuted} /> : null}
    </>
  );
  const rowStyle = [s.row, selected && s.selected, last && s.last, disabled && s.disabled, style];

  if (!onPress) {
    return <View style={rowStyle} testID={testID} accessibilityRole={accessibilityRole} accessibilityState={accessibilityState}>{content}</View>;
  }
  return (
    <Pressable
      style={rowStyle}
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole={accessibilityRole ?? 'button'}
      accessibilityState={accessibilityState}
    >
      {content}
    </Pressable>
  );
}
