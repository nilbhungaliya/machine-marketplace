import React, { useMemo } from 'react';
import { StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { otpCells } from '@/lib/otp-cells';
import { radius, spacing, useTheme } from '@/lib/theme';
import { useType } from '@/hooks/use-type';
import { FieldError } from '@/components/Field';

interface OtpCellsProps {
  value: string;
  onChangeText: (text: string) => void;
  length: number;
  /** The message under the cells; every cell turns red while it's set. */
  error?: string;
  onSubmitEditing?: () => void;
  autoFocus?: boolean;
  testID?: string;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The login code as `length` cells (Periwinkle v2 `.otp`, spec §7.1). One real `TextInput` lies over the row, almost
 * invisible, and keeps the raw text: SMS autofill (`sms-otp` / `oneTimeCode`), paste, Hindi / Gujarati digits and
 * backspace work exactly as on a plain field. The cells only draw `otpCells(value)`.
 */
export default function OtpCells({
  value, onChangeText, length, error, onSubmitEditing, autoFocus, testID, accessibilityLabel, style,
}: OtpCellsProps) {
  const { colors } = useTheme();
  const type = useType();
  const cells = otpCells(value, length);

  const s = useMemo(() => StyleSheet.create({
    row: { flexDirection: 'row', gap: spacing.sm },
    cell: {
      flex: 1, height: 58, borderRadius: radius.md + 2, alignItems: 'center', justifyContent: 'center',
      borderWidth: 2, borderColor: colors.field, backgroundColor: colors.field,
    },
    current: { backgroundColor: colors.surface, borderColor: colors.primary },
    error: { borderColor: colors.danger },
    digit: { ...type('otp'), color: colors.text },
    // Covers the row so a tap anywhere focuses it and a long press offers paste. Not opacity 0: some Android
    // versions skip autofill for a fully transparent field. A 1 dp font keeps the whole code in the first few pixels
    // at the left, so a tap on any cell lands after the last digit: the hidden caret stays at the end, and backspace
    // and typing always work on the end of the code (a controlled `selection` instead can point past the text when
    // a digit is deleted or a code is autofilled, which Android rejects).
    input: {
      ...StyleSheet.absoluteFillObject, opacity: 0.02, color: 'transparent', fontSize: 1, padding: 0, textAlign: 'left',
    },
  }), [colors, type]);

  return (
    <View style={style}>
      <View>
        {/* Drawn only: screen readers read the labelled input below, not six cells. */}
        <View style={s.row} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {cells.map((c, i) => (
            <View key={i} style={[s.cell, c.state === 'current' && s.current, error ? s.error : null]}>
              <Text style={s.digit}>{c.char}</Text>
            </View>
          ))}
        </View>
        <TextInput
          style={s.input}
          value={value}
          onChangeText={onChangeText}
          keyboardType="number-pad"
          autoComplete="sms-otp"
          textContentType="oneTimeCode"
          // Not `length`: a pasted or autofilled code can carry spaces ("4 8 1 9 3 6") or arrive inside the SMS text
          // ("Your code is 481936"), and the old field took either whole, so a tight cap would cut the code. The
          // cells and the screen use only the derived digits.
          maxLength={64}
          caretHidden
          onSubmitEditing={onSubmitEditing}
          autoFocus={autoFocus}
          testID={testID}
          accessibilityLabel={accessibilityLabel}
        />
      </View>
      {error ? <FieldError>{error}</FieldError> : null}
    </View>
  );
}
