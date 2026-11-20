import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { MyListingCard } from '@mpm/shared-types';
import Button from '@/components/Button';
import { useType } from '@/hooks/use-type';
import { rentalLine } from '@/lib/my-listings';
import { radius, spacing, useTheme } from '@/lib/theme';

interface RentalLineProps {
  card: Pick<MyListingCard, 'kind' | 'ref' | 'rentalLine'>;
  onCalendar: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * A rental's line on its My listings card (M14 §14.1): "On rent" / "3 of 5 out today", with a Calendar link. Nothing
 * for other kinds, or when no machine is out today.
 */
export default function RentalLine({ card, onCalendar, style }: RentalLineProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const s = useMemo(() => StyleSheet.create({
    row: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm,
      backgroundColor: colors.primaryWash, borderRadius: radius.md, paddingLeft: spacing.md, paddingVertical: spacing.xs,
    },
    text: { ...type('label'), color: colors.text, flexShrink: 1 },
  }), [colors, type]);

  if (card.kind !== 'machine_rental') return null;
  const line = rentalLine(card.rentalLine);
  if (!line) return null;
  return (
    <View style={[s.row, style]} testID={`My-listing-rental-${card.ref}`}>
      <Text style={s.text}>{t(line.key, line.values)}</Text>
      <Button
        title={t('rentalsOwner.manage.calendar')}
        onPress={onCalendar}
        variant="ghost"
        size="sm"
        phLabel={`My-listing-calendar-${card.ref}`}
      />
    </View>
  );
}
