import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import type { RentalBookingCardView, ThreadDetail } from '@mpm/shared-types';
import PressableScale from '@/components/PressableScale';
import StatusChip from '@/components/StatusChip';
import { useType } from '@/hooks/use-type';
import { isLanguage } from '@/lib/i18n';
import { CalendarClock, ChevronRight } from '@/lib/icons';
import { formatRupees } from '@/lib/money';
import { bookingStatusChip, dateRangeLabel } from '@/lib/rental-display';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackParamList } from '@/navigation/types';

export interface BookingCardProps {
  booking: RentalBookingCardView;
  thread: ThreadDetail;
  style?: StyleProp<ViewStyle>;
}

/**
 * A booking card in the thread (M14 §8, as the offer and deal cards): "Booking #700012", the open version's dates,
 * length, machines and total, its status read for this side (the renter is the thread's buyer), and a tap to the
 * Booking record, where the answers are. The thread's own row (`thread.bookings`) has the newest status.
 */
export default function BookingCard({ booking, thread, style }: BookingCardProps) {
  const { t, i18n } = useTranslation();
  const lang = isLanguage(i18n.language) ? i18n.language : 'en';
  const { colors } = useTheme();
  const type = useType();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const s = useMemo(() => StyleSheet.create({
    card: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.xl,
      backgroundColor: colors.primaryWash, borderWidth: 1, borderColor: colors.hairline, alignSelf: 'stretch',
    },
    icon: {
      width: 40, height: 40, borderRadius: radius.full, backgroundColor: colors.surface, alignItems: 'center',
      justifyContent: 'center',
    },
    body: { flex: 1, gap: 2 },
    title: { ...type('cardTitle'), color: colors.text },
    terms: { ...type('caption'), color: colors.textSecondary },
    right: { alignItems: 'flex-end', gap: spacing.xs },
  }), [colors, type]);

  const side = thread.side === 'seller' ? 'owner' : 'renter';
  const status = thread.bookings.find((b) => b.id === booking.id)?.status ?? booking.status;
  const chip = bookingStatusChip(status, side);
  const c = booking.current;
  const terms = [
    dateRangeLabel(c.startDate, c.endDate, lang),
    t(`rentals.duration.${c.period}`, { count: c.count }),
    c.machines > 1 ? t('rentals.machinesCount', { count: c.machines }) : null,
    formatRupees(c.totalPaise),
  ].filter(Boolean).join(' · ');

  return (
    <PressableScale
      onPress={() => navigation.navigate('BookingRecord', { bookingId: booking.id })}
      style={[s.card, style]}
      accessibilityRole="button"
      testID={`Booking-card-${booking.ref}`}
    >
      <View style={s.icon}><CalendarClock size={20} color={colors.primaryInk} /></View>
      <View style={s.body}>
        <Text style={s.title}>{t('rentals.card.title', { ref: booking.ref })}</Text>
        <Text style={s.terms} numberOfLines={2}>{terms}</Text>
      </View>
      <View style={s.right}>
        <StatusChip label={t(chip.key)} tone={chip.tone} />
      </View>
      <ChevronRight size={18} color={colors.textMuted} />
    </PressableScale>
  );
}
