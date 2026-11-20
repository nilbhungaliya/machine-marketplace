import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import type { RentalBookingListRow } from '@mpm/shared-types';
import PressableScale from '@/components/PressableScale';
import StatusChip from '@/components/StatusChip';
import { useType } from '@/hooks/use-type';
import { isLanguage } from '@/lib/i18n';
import { Package } from '@/lib/icons';
import { formatRupees } from '@/lib/money';
import { bookingStatusChip, dateRangeLabel } from '@/lib/rental-display';
import { radius, spacing, useTheme } from '@/lib/theme';

interface BookingRowProps {
  booking: RentalBookingListRow;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * A Rentals row of the Deals tab (mockup deals · "My deals" `.row`, "JCB 3DX, 3 days rental · Renting out, ₹28,800"):
 * thumb, listing title, dates and machines, Renting / Renting out and the total, the other business, status and
 * "Your turn".
 */
export default function BookingRow({ booking, onPress, style }: BookingRowProps) {
  const { t, i18n } = useTranslation();
  const lang = isLanguage(i18n.language) ? i18n.language : 'en';
  const { colors } = useTheme();
  const type = useType();
  const s = useMemo(() => StyleSheet.create({
    row: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, backgroundColor: colors.surface,
      borderRadius: radius.xl, borderWidth: 1, borderColor: colors.hairline,
    },
    thumb: {
      width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.photo, overflow: 'hidden',
      alignItems: 'center', justifyContent: 'center',
    },
    image: { width: '100%', height: '100%' },
    body: { flex: 1, gap: 2 },
    title: { ...type('cardTitle'), color: colors.text },
    meta: { ...type('caption'), color: colors.textSecondary },
    right: { alignItems: 'flex-end', gap: spacing.xs },
  }), [colors, type]);

  const chip = bookingStatusChip(booking.status, booking.side);
  const dates = [
    dateRangeLabel(booking.startDate, booking.endDate, lang),
    booking.machines > 1 ? t('rentals.machinesCount', { count: booking.machines }) : null,
  ].filter(Boolean).join(' · ');
  const money = booking.totalPaise != null ? formatRupees(booking.totalPaise) : '';
  return (
    <PressableScale onPress={onPress} style={[s.row, style]} testID={`Booking-row-${booking.ref}`} accessibilityRole="button">
      <View style={s.thumb}>
        {booking.thumbUrl ? (
          <Image source={{ uri: booking.thumbUrl }} style={s.image} contentFit="cover" accessibilityIgnoresInvertColors />
        ) : (
          <Package size={22} color={colors.textMuted} />
        )}
      </View>
      <View style={s.body}>
        <Text style={s.title} numberOfLines={1}>{booking.listingTitle}</Text>
        <Text style={s.meta} numberOfLines={1}>{dates}</Text>
        <Text style={s.meta} numberOfLines={1}>
          {t(booking.side === 'renter' ? 'rentals.row.renting' : 'rentals.row.rentingOut', { total: money, name: booking.counterpartName })}
        </Text>
      </View>
      <View style={s.right}>
        <StatusChip label={t(chip.key)} tone={chip.tone} />
        {booking.yourTurn ? <StatusChip label={t('deals.row.yourTurn')} tone="sun" /> : null}
      </View>
    </PressableScale>
  );
}
