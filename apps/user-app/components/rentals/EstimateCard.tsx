import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { RentalEstimateResult, RentalPeriod, RentalTermsSnapshot } from '@mpm/shared-types';
import Card from '@/components/Card';
import Notice from '@/components/Notice';
import Skeleton from '@/components/Skeleton';
import { useType } from '@/hooks/use-type';
import { Info, TriangleAlert } from '@/lib/icons';
import { formatRupees } from '@/lib/money';
import { estimateLines } from '@/lib/rental-display';
import { radius, spacing, useTheme } from '@/lib/theme';

interface EstimateCardProps {
  /** The server's estimate for the form as it is (`POST /rentals/estimate`); null before a start date. */
  estimate: RentalEstimateResult | null | undefined;
  period: RentalPeriod;
  count: number;
  machines: number;
  terms: RentalTermsSnapshot;
  loading: boolean;
  /** The estimate call failed (the request can still be sent: the server computes the money again). */
  error: boolean;
  /** The total shown is for an earlier form (debouncing, or the previous answer kept while the new one loads). */
  stale?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * The live estimate (M14 spec §14.1, R2; mockup rental · "Booking request" `.total`): rent, operator and transport
 * lines, the total under a dashed rule beside "3 days", the terms the total leaves out (diesel, deposit), and the
 * server's warnings: dates full, beyond the owner's working area, below the minimum. "Paid outside the app".
 */
export default function EstimateCard({ estimate, period, count, machines, terms, loading, error, stale = false, style }: EstimateCardProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const s = useMemo(() => StyleSheet.create({
    card: { gap: spacing.sm },
    title: { ...type('section'), color: colors.text },
    row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
    label: { ...type('body'), color: colors.textSecondary, flex: 1 },
    value: { ...type('bodyStrong'), color: colors.text },
    total: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: spacing.sm,
      borderTopWidth: 1, borderTopColor: colors.border, borderStyle: 'dashed',
    },
    duration: { ...type('body'), color: colors.textSecondary },
    totalValue: { ...type('price'), color: colors.text },
    term: { ...type('caption'), color: colors.textMuted },
    skeleton: { height: 96, borderRadius: radius.md },
    dim: { opacity: 0.45 },
  }), [colors, type]);

  const duration = [
    t(`rentals.duration.${period}`, { count }),
    machines > 1 ? t('rentals.machinesCount', { count: machines }) : null,
  ].filter(Boolean).join(' · ');

  const lines = estimate ? estimateLines(estimate).filter((l) => l.key !== 'rentals.money.total') : [];
  const terms2: string[] = [];
  if (terms.fuel) terms2.push(t('rentals.estimate.fuel', { fuel: t(`listing.rental.fuel.${terms.fuel}`) }));
  if (terms.depositPaise != null) terms2.push(t('rentals.estimate.deposit', { amount: formatRupees(terms.depositPaise) }));

  return (
    <Card style={[s.card, style]}>
      <Text style={s.title}>{t('rentals.estimate.title')}</Text>
      {!estimate && loading ? (
        <Skeleton style={s.skeleton} />
      ) : !estimate ? (
        <Text style={s.term}>{t(error ? 'rentals.estimate.failed' : 'rentals.estimate.pickDate')}</Text>
      ) : (
        <>
          {lines.map((l) => (
            <View key={l.key} style={[s.row, stale && s.dim]}>
              <Text style={s.label}>{t(l.key)}</Text>
              <Text style={s.value}>{formatRupees(l.paise)}</Text>
            </View>
          ))}
          <View style={[s.total, stale && s.dim]} accessibilityState={{ busy: stale }}>
            <Text style={s.duration}>{duration}</Text>
            <Text style={s.totalValue} testID="Estimate-total">{formatRupees(estimate.totalPaise)}</Text>
          </View>
          {terms2.map((x) => <Text key={x} style={s.term}>{x}</Text>)}
          <Text style={s.term}>{t('rentals.estimate.outsideApp')}</Text>
          {!estimate.free ? <Notice tone="danger" icon={TriangleAlert} text={t('rentals.estimate.datesFull')} /> : null}
          {!estimate.minimumMet ? <Notice tone="warning" icon={TriangleAlert} text={t('rentals.estimate.belowMinimum')} /> : null}
          {estimate.beyondServiceRadius ? (
            <Notice
              tone="warning"
              icon={Info}
              text={terms.serviceRadiusKm != null
                ? t('rentals.estimate.beyondRadiusKm', { km: terms.serviceRadiusKm })
                : t('rentals.estimate.beyondRadius')}
            />
          ) : null}
        </>
      )}
    </Card>
  );
}
