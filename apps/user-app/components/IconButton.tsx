import React, { useMemo } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import type { LucideIcon } from '@/lib/icons';
import { radius, useTheme } from '@/lib/theme';

interface IconButtonProps {
  icon: LucideIcon;
  onPress: () => void;
  /** Already translated: the button has no visible text. */
  accessibilityLabel: string;
  /** English, hyphenated: the analytics label and e2e selector. */
  testID: string;
  /** `raised` (default): white with a soft shadow; `outline`: hairline on the background; `primary`: violet. */
  variant?: 'raised' | 'outline' | 'primary';
  /** Icon size; 20 by default (the header's back arrow is 22). */
  iconSize?: number;
  style?: StyleProp<ViewStyle>;
}

/** A 44 round icon button (Periwinkle v2 `.iconbtn`, spec §7.3). */
export default function IconButton({
  icon: Icon, onPress, accessibilityLabel, testID, variant = 'raised', iconSize = 20, style,
}: IconButtonProps) {
  const { colors, shadows } = useTheme();
  const s = useMemo(() => StyleSheet.create({
    base: { width: 44, height: 44, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
    raised: { backgroundColor: colors.surface, ...shadows.raised },
    outline: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.hairline },
    primary: { backgroundColor: colors.primary },
  }), [colors, shadows]);

  return (
    <Pressable
      style={({ pressed }) => [s.base, s[variant], pressed && { opacity: 0.7 }, style]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      ph-label={testID}
      hitSlop={4}
    >
      <Icon size={iconSize} color={variant === 'primary' ? colors.onPrimary : colors.text} />
    </Pressable>
  );
}
