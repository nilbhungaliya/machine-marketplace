import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/lib/theme';
import { useType } from '@/hooks/use-type';

// Label, hint and error for a form control (spec §7.1). `Input` uses the same label and error, so a chip group or a
// list in a `Field` lines up with the text fields around it.

/** Space between a label and its control, and between a control and its hint or error. */
export const FIELD_GAP = 6;

function useFieldText() {
  const { colors } = useTheme();
  const type = useType();
  return useMemo(() => StyleSheet.create({
    label: { ...type('label'), color: colors.textSecondary, marginBottom: FIELD_GAP },
    hint: { ...type('caption'), color: colors.textMuted, marginTop: FIELD_GAP },
    error: { ...type('caption'), color: colors.danger, marginTop: FIELD_GAP },
  }), [colors, type]);
}

export function FieldLabel({ children }: { children: string }) {
  const s = useFieldText();
  return <Text style={s.label}>{children}</Text>;
}

export function FieldHint({ children }: { children: string }) {
  const s = useFieldText();
  return <Text style={s.hint}>{children}</Text>;
}

export function FieldError({ children }: { children: string }) {
  const s = useFieldText();
  return <Text style={s.error} accessibilityLiveRegion="polite">{children}</Text>;
}

interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** A labelled group for anything that isn't a text input: chip groups, lists, pickers. */
export default function Field({ label, hint, error, children, style }: FieldProps) {
  return (
    <View style={style}>
      {label ? <FieldLabel>{label}</FieldLabel> : null}
      {children}
      {hint ? <FieldHint>{hint}</FieldHint> : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </View>
  );
}
