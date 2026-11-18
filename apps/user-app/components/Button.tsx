import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';
import { fonts, radius, useTheme } from '@/lib/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const PRESS_SPRING = { damping: 18, stiffness: 320, mass: 0.6 };

interface ButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'outline' | 'ghost';
  style?: StyleProp<ViewStyle>;
  /** Analytics / test label: English, hyphenated, stays English when the title is translated. */
  phLabel?: string;
}

export default function Button({
  title, onPress, loading = false, disabled = false, variant = 'primary', style, phLabel,
}: ButtonProps) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const inactive = disabled || loading;

  const s = useMemo(() => StyleSheet.create({
    base: {
      height: 52,
      borderRadius: radius.full,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
      width: '100%',
    },
    primary: { backgroundColor: colors.primary },
    outline: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border },
    ghost: { backgroundColor: 'transparent' },
    disabled: { opacity: 0.45 },
    text: { fontFamily: fonts.bold, fontSize: 16, letterSpacing: 0.2 },
    primaryText: { color: colors.onPrimary },
    outlineText: { color: colors.text },
    ghostText: { color: colors.primary },
  }), [colors]);

  const labelColor = variant === 'primary' ? colors.onPrimary : variant === 'ghost' ? colors.primary : colors.text;

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      testID={phLabel}
      onPress={onPress}
      disabled={inactive}
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
        <Text style={[s.text, s[`${variant}Text`]]}>{title}</Text>
      )}
    </AnimatedPressable>
  );
}
