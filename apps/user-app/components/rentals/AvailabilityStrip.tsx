import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { RentalAvailabilityDay } from '@mpm/shared-types';
import Button from '@/components/Button';
import Card from '@/components/Card';
import Skeleton from '@/components/Skeleton';
import { useType } from '@/hooks/use-type';
import { weekdayShortNames } from '@/lib/format-date';
import { radius, spacing, useTheme } from '@/lib/theme';

interface AvailabilityStripProps {
  /** `GET /listings/:id/availability` (30 days from today). */
  days: RentalAvailabilityDay[] | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * The rental listing's 30-day availability (R13; mockup rental · "Rental listing" `.avail .days`): one pill per day,
 * seven a row, lavender when free, outlined when partly booked, struck through on the canvas when full. Never who or
 * how many. "Indicative until the owner confirms".
 */
export default function AvailabilityStrip({ days, loading, error, onRetry, style }: AvailabilityStripProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const s = useMemo(() => StyleSheet.create({
    card: { gap: spacing.sm },
    title: { ...type('section'), color: colors.text },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
    // Seven per row: (100% − 6 gaps) / 7.
    cell: {
      width: '13.4%', height: 40, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.primaryWash,
    },
    partial: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.primarySoft },
    full: { backgroundColor: colors.background },
    dayName: { ...type('badge'), color: colors.primaryInk },
    dayNum: { ...type('caption'), color: colors.primaryInk },
    fullText: { color: colors.textMuted, textDecorationLine: 'line-through' },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    swatch: { width: 14, height: 14, borderRadius: radius.full },
    legendText: { ...type('caption'), color: colors.textSecondary },
    note: { ...type('caption'), color: colors.textMuted },
    skeleton: { height: 132, borderRadius: radius.md },
  }), [colors, type]);

  const names = weekdayShortNames();
  return (
    <Card style={[s.card, style]}>
      <Text style={s.title}>{t('rentals.availability.title')}</Text>
      {loading ? (
        <Skeleton style={s.skeleton} />
      ) : error || !days ? (
        <Button title={t('rentals.availability.retry')} onPress={onRetry} variant="outline" size="sm" phLabel="Listing-availability-retry" style={{ alignSelf: 'flex-start' }} />
      ) : (
        <>
          <View style={s.grid} accessibilityRole="summary">
            {days.map((d) => {
              const weekday = new Date(`${d.date}T00:00:00Z`).getUTCDay();
              const full = d.state === 'full';
              return (
                <View
                  key={d.date}
                  style={[s.cell, d.state === 'partial' && s.partial, full && s.full]}
                  accessibilityLabel={t(`rentals.availability.a11y.${d.state}`, { day: Number(d.date.slice(8)) })}
                >
                  <Text style={[s.dayName, full && s.fullText]}>{names[weekday]}</Text>
                  <Text style={[s.dayNum, full && s.fullText]}>{Number(d.date.slice(8))}</Text>
                </View>
              );
            })}
          </View>
          <View style={s.legend}>
            <View style={s.legendItem}>
              <View style={[s.swatch, { backgroundColor: colors.primaryWash }]} />
              <Text style={s.legendText}>{t('rentals.availability.free')}</Text>
            </View>
            <View style={s.legendItem}>
              <View style={[s.swatch, s.partial]} />
              <Text style={s.legendText}>{t('rentals.availability.partial')}</Text>
            </View>
            <View style={s.legendItem}>
              <View style={[s.swatch, s.full, { borderWidth: 1, borderColor: colors.hairline }]} />
              <Text style={s.legendText}>{t('rentals.availability.full')}</Text>
            </View>
          </View>
          <Text style={s.note}>{t('rentals.availability.note')}</Text>
        </>
      )}
    </Card>
  );
}
