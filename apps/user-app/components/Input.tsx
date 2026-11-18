import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, TextInputProps } from 'react-native';
import { fonts, radius, spacing, useTheme } from '@/lib/theme';
import { useType } from '@/hooks/use-type';
import { FieldError, FieldLabel } from '@/components/Field';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  /** Fixed text before the value (e.g. `+91`), set off by a hairline divider. */
  prefix?: string;
  /** `lg`: 60 high with the large `phone` type (the phone number field). */
  size?: 'md' | 'lg';
  /** JetBrains Mono with wide tracking, for identifiers people read character by character (GSTIN, PAN). */
  mono?: boolean;
  /** Must be `BottomSheetTextInput` inside a bottom sheet, or focus is invisible to it. */
  InputComponent?: React.ComponentType<TextInputProps>;
}

/**
 * A filled text field (Periwinkle v2 `.f-v`, spec §7.1): `field` fill, a white fill and a violet ring when focused,
 * a red ring on error. `style` still reaches the `TextInput` (text styles), as before.
 */
export default function Input({
  label,
  error,
  prefix,
  size = 'md',
  mono = false,
  style,
  onFocus,
  onBlur,
  InputComponent = TextInput,
  ...props
}: InputProps) {
  const { colors } = useTheme();
  const type = useType();
  const [focused, setFocused] = useState(false);
  const large = size === 'lg';

  const s = useMemo(() => StyleSheet.create({
    container: { width: '100%', marginTop: spacing.md },
    box: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: large ? 60 : 52,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.md,
      // Always 2 dp, in the fill colour when idle, so focus and error don't shift the layout.
      borderWidth: 2,
      borderColor: colors.field,
      backgroundColor: colors.field,
    },
    boxFocused: { backgroundColor: colors.surface, borderColor: colors.primary },
    boxError: { borderColor: colors.danger },
    prefix: { ...type(large ? 'phone' : 'fieldValue'), color: colors.textSecondary },
    divider: { width: 1, alignSelf: 'stretch', marginVertical: spacing.md, marginHorizontal: spacing.md, backgroundColor: colors.hairline },
    input: {
      flex: 1,
      ...type(large ? 'phone' : 'fieldValue'),
      // A TextInput's own line height clips Indic matras on Android; the box sets the height instead.
      lineHeight: undefined,
      paddingVertical: spacing.md,
      paddingHorizontal: 0,
      color: colors.text,
    },
    mono: { fontFamily: fonts.monoMedium, letterSpacing: 1 },
  }), [colors, type, large]);

  return (
    <View style={s.container}>
      {label ? <FieldLabel>{label}</FieldLabel> : null}
      <View style={[s.box, focused && s.boxFocused, error ? s.boxError : null]}>
        {prefix ? (
          <>
            <Text style={s.prefix}>{prefix}</Text>
            <View style={s.divider} />
          </>
        ) : null}
        <InputComponent
          style={[s.input, mono && s.mono, style]}
          placeholderTextColor={colors.textMuted}
          onFocus={(e) => { setFocused(true); onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); onBlur?.(e); }}
          {...props}
        />
      </View>
      {error ? <FieldError>{error}</FieldError> : null}
    </View>
  );
}
