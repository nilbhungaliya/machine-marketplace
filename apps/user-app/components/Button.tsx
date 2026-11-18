import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';
import type { LucideIcon } from '@/lib/icons';
import { radius, spacing, useTheme } from '@/lib/theme';
import { useType } from '@/hooks/use-type';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const PRESS_SPRING = { damping: 18, stiffness: 320, mass: 0.6 };

export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'lg' | 'md' | 'sm';

interface ButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** `outline` is the mockup's `.btn.ghost`; `ghost` is a text link; `danger` a solid destructive button. */
  variant?: ButtonVariant;
  /** `lg` 52 (standalone, default), `md` 48 (inside FooterBar), `sm` 36 (auto width). */
  size?: ButtonSize;
  /** Optional leading icon. */
  icon?: LucideIcon;
  style?: StyleProp<ViewStyle>;
  /** Analytics / test label: English, hyphenated, stays English when the title is translated. */
  phLabel?: string;
}

/** Minimum heights: a long label (Hindi, Gujarati, a large font scale) wraps to a second line and the pill grows. */
const MIN_HEIGHT: Record<ButtonSize, number> = { lg: 52, md: 48, sm: 36 };

/** Periwinkle v2 pill button (spec §7.1). Full width at `lg` / `md` unless placed in a row; `sm` sizes to its label. */
export default function Button({
  title, onPress, loading = false, disabled = false, variant = 'primary', size = 'lg', icon: Icon, style, phLabel,
}: ButtonProps) {
  const { colors } = useTheme();
  const type = useType();
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const inactive = disabled || loading;
  const small = size === 'sm';

  const s = useMemo(() => StyleSheet.create({
    base: {
      minHeight: MIN_HEIGHT[size],
      borderRadius: radius.full,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingHorizontal: small ? 14 : spacing.xl,
      paddingVertical: small ? spacing.xs : spacing.sm,
      ...(small ? { alignSelf: 'flex-start' as const } : { width: '100%' as const }),
    },
    primary: { backgroundColor: colors.primary },
    outline: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border },
    ghost: { backgroundColor: 'transparent' },
    danger: { backgroundColor: colors.danger },
    disabled: { opacity: 0.45 },
    text: { ...type(small ? 'buttonSm' : 'button'), textAlign: 'center', flexShrink: 1 },
  }), [colors, type, size, small]);

  const labelColor = {
    primary: colors.onPrimary,
    outline: colors.text,
    ghost: colors.primaryInk,
    danger: colors.onDanger,
  }[variant];

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      testID={phLabel}
      onPress={onPress}
      disabled={inactive}
      hitSlop={small ? 4 : undefined}
      onPressIn={() => { if (!inactive && !reduced) scale.value = withSpring(0.97, PRESS_SPRING); }}
      onPressOut={() => { if (!reduced) scale.value = withSpring(1, PRESS_SPRING); }}
      style={[
        s.base,
        s[variant],
        inactive && s.disabled,
        style,
        pressStyle,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={labelColor} />
      ) : (
        <>
          {Icon ? <Icon size={small ? 16 : 18} color={labelColor} /> : null}
          <Text style={[s.text, { color: labelColor }]} numberOfLines={2}>{title}</Text>
        </>
      )}
    </AnimatedPressable>
  );
}
