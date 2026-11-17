import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, TextInputProps } from 'react-native';
import { useTheme, fonts } from '@/lib/theme';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  /** Must be `BottomSheetTextInput` inside a bottom sheet, or focus is invisible to it. */
  InputComponent?: React.ComponentType<TextInputProps>;
}

export default function Input({
  label,
  error,
  style,
  onFocus,
  onBlur,
  InputComponent = TextInput,
  ...props
}: InputProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);

  const s = useMemo(() => StyleSheet.create({
    container: { width: '100%', marginTop: 10 },
    label: {
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.textSecondary,
      marginBottom: 2,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    input: {
      backgroundColor: colors.surface,
      borderWidth: 1.5,
      borderColor: colors.border,
      borderRadius: 16,
      paddingHorizontal: 16,
      paddingVertical: 14,
      fontFamily: fonts.regular,
      fontSize: 15,
      color: colors.text,
    },
    inputFocused: { borderColor: colors.text, backgroundColor: colors.focusFill },
    inputError: { borderColor: colors.red },
    error: {
      fontFamily: fonts.regular,
      fontSize: 12,
      color: colors.red,
      marginTop: 6,
      marginBottom: 10,
    },
  }), [colors]);

  return (
    <View style={s.container}>
      {label && <Text style={s.label}>{label}</Text>}
      <InputComponent
        style={[s.input, focused && s.inputFocused, error && s.inputError, style]}
        placeholderTextColor={colors.textMuted}
        onFocus={(e) => { setFocused(true); onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); onBlur?.(e); }}
        {...props}
      />
      {error && <Text style={s.error}>{error}</Text>}
    </View>
  );
}
