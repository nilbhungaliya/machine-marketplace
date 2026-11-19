import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useType } from '@/hooks/use-type';
import { Lock } from '@/lib/icons';
import { spacing, useTheme } from '@/lib/theme';

/** The quiet line at the bottom of a thread while numbers are hidden (§6.5): masked until both share after a deal. */
export default function MaskedNumberNotice({ style }: { style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const s = useMemo(() => StyleSheet.create({
    row: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs + 2,
      paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    },
    text: { ...type('caption'), color: colors.textMuted, textAlign: 'center', flexShrink: 1 },
  }), [colors, type]);
  return (
    <View style={[s.row, style]} testID="Thread-masked-notice">
      <Lock size={13} color={colors.textMuted} />
      <Text style={s.text}>{t('chats.thread.masked')}</Text>
    </View>
  );
}
