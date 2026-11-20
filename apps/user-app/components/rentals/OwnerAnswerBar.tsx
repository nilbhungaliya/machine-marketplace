import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { RentalBookingView } from '@mpm/shared-types';
import { useType } from '@/hooks/use-type';
import { radius, spacing, useTheme } from '@/lib/theme';

export interface OwnerAnswerBarProps {
  /** The owner's view of a `requested` booking: Confirm / Propose change / Decline (by `view.actions`). */
  view: RentalBookingView;
  /** After any answer landed (the caller refetches or stores the fresh view). */
  onDone: () => void;
  style?: StyleProp<ViewStyle>;
}

// M14-STUB(B3): placeholder with the final props (plan C0-5); lane B3 builds the bar (confirm with the total, propose a
// change, decline; changes left and the reply deadline).
export default function OwnerAnswerBar({ style }: OwnerAnswerBarProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const s = useMemo(() => StyleSheet.create({
    box: {
      backgroundColor: colors.primaryWash, borderRadius: radius.lg, padding: spacing.lg,
      borderWidth: 1, borderColor: colors.hairline,
    },
    text: { ...type('body'), color: colors.textSecondary },
  }), [colors, type]);
  return (
    <View style={[s.box, style]} testID="OwnerAnswerBar">
      <Text style={s.text}>{t('common.comingSoon')}</Text>
    </View>
  );
}
