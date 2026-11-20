import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { RentalBookingView } from '@mpm/shared-types';
import Card from '@/components/Card';
import StatusChip from '@/components/StatusChip';
import { useType } from '@/hooks/use-type';
import { formatRupees } from '@/lib/money';
import { estimateLines, moneySteps } from '@/lib/rental-display';
import { spacing, useTheme } from '@/lib/theme';

interface BookingMoneyProps {
  view: RentalBookingView;
  style?: StyleProp<ViewStyle>;
}

/**
 * The Booking record's money (R2, §14.1): the current version's lines (rent, operator, transport), then estimate →
 * agreed (from confirmation) → final (the owner's amount at return, with the reason when it differs). Integer paise,
 * Indian grouping; "Recorded here, paid outside the app".
 */
export default function BookingMoney({ view, style }: BookingMoneyProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const s = useMemo(() => StyleSheet.create({
    card: { gap: spacing.xs },
    title: { ...type('section'), color: colors.text, marginBottom: spacing.xs },
    row: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md,
      paddingVertical: spacing.xs + 2,
    },
    divider: { borderTopWidth: 1, borderTopColor: colors.divider, marginTop: spacing.xs },
    label: { ...type('body'), color: colors.textSecondary, flex: 1 },
    value: { ...type('bodyStrong'), color: colors.text },
    big: { ...type('price'), color: colors.text },
    pending: { ...type('body'), color: colors.textMuted },
    reason: { ...type('caption'), color: colors.textSecondary },
    note: { ...type('caption'), color: colors.textMuted },
  }), [colors, type]);

  const steps = moneySteps(view);
  // Parts of the current version, from the booking's own terms (the server's rule); the total is shown below.
  const lines = estimateLines(view.current, view.terms).filter((l) => l.key !== 'rentals.money.total' && l.key !== 'rentals.money.estimate');
  const proposedByOwner = view.current.proposedBy === 'owner' && view.current.totalPaise !== view.current.estimatePaise;

  return (
    <Card style={[s.card, style]}>
      <Text style={s.title}>{t('rentals.money.title')}</Text>
      {lines.map((l) => (
        <View key={l.key} style={s.row}>
          <Text style={s.label}>{t(l.key)}</Text>
          <Text style={s.value}>{formatRupees(l.paise)}</Text>
        </View>
      ))}
      <View style={[s.row, s.divider]}>
        <Text style={s.label}>{t('rentals.money.estimate')}</Text>
        <Text style={s.value}>{formatRupees(steps.estimate)}</Text>
      </View>
      {proposedByOwner && steps.agreed == null ? (
        <View style={s.row}>
          <Text style={s.label}>{t('rentals.money.ownerTotal')}</Text>
          <Text style={s.value}>{formatRupees(view.current.totalPaise)}</Text>
        </View>
      ) : null}
      <View style={s.row}>
        <Text style={s.label}>{t('rentals.money.agreed')}</Text>
        {steps.agreed != null ? (
          <Text style={steps.final == null ? s.big : s.value} testID="Booking-agreed">{formatRupees(steps.agreed)}</Text>
        ) : (
          <Text style={s.pending}>{t('rentals.money.whenConfirmed')}</Text>
        )}
      </View>
      {steps.agreed != null ? (
        <View style={s.row}>
          <Text style={s.label}>{t('rentals.money.final')}</Text>
          {steps.final != null ? (
            <View style={{ alignItems: 'flex-end', gap: spacing.xs }}>
              <Text style={s.big} testID="Booking-final">{formatRupees(steps.final)}</Text>
              {steps.changed ? <StatusChip label={t('rentals.money.changed')} tone="warn" /> : null}
            </View>
          ) : (
            <Text style={s.pending}>{t('rentals.money.atReturn')}</Text>
          )}
        </View>
      ) : null}
      {steps.changed && view.finalAmountReason ? (
        <Text style={s.reason}>{t('rentals.money.reason', { reason: t(`rentals.finalReason.${view.finalAmountReason}`) })}</Text>
      ) : null}
      {steps.changed && view.finalAmountNote ? <Text style={s.reason}>{view.finalAmountNote}</Text> : null}
      <Text style={s.note}>{t('rentals.money.outsideApp')}</Text>
    </Card>
  );
}
