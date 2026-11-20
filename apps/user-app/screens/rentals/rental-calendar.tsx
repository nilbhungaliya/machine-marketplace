import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ListingOwnerView, RentalBlockView } from '@mpm/shared-types';
import Button from '@/components/Button';
import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import FooterBar from '@/components/FooterBar';
import Header from '@/components/Header';
import ListRow from '@/components/ListRow';
import ScreenWrapper from '@/components/ScreenWrapper';
import Skeleton from '@/components/Skeleton';
import StatusChip from '@/components/StatusChip';
import BlockSheet from '@/components/rentals/BlockSheet';
import CalendarMonth from '@/components/rentals/CalendarMonth';
import { listingKeys } from '@/hooks/use-listing';
import { useRentalCalendar } from '@/hooks/use-rental-calendar';
import { useType } from '@/hooks/use-type';
import { formatDateWithWeekday } from '@/lib/format-date';
import { useLanguage } from '@/lib/i18n/language';
import { CalendarClock, Plus, TriangleAlert, Wrench } from '@/lib/icons';
import { istDateKey } from '@/lib/ist-date';
import { m14ErrorMessage } from '@/lib/m14-errors';
import { dayItems, gridRange, monthOf, shiftMonth } from '@/lib/rental-calendar';
import { bookingStatusChip, dateRangeLabel } from '@/lib/rental-display';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';

/** A calendar date's noon in IST, as epoch ms, for the date formatters (they read the IST wall clock). */
const dateMs = (date: string): number => Date.parse(`${date}T12:00:00+05:30`);

/**
 * The owner calendar (M14 spec §7.3, §14.1): a month per listing with machines out / free per day, the bookings
 * (agreed ones and open requests, which hold nothing) and blocks on the day picked, and Add block. Opened from My
 * listings' manage sheet and the listing page. A `viewer` member (`memberRole` from the API) reads it only: no Add
 * block, and block rows don't open the sheet (the API refuses their writes anyway, `403 VIEWER_READ_ONLY`).
 */
export default function RentalCalendarScreen({ navigation, route }: RootStackScreenProps<'RentalCalendar'>) {
  const { listingId } = route.params;
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const lang = useLanguage();
  const qc = useQueryClient();
  const today = istDateKey();
  const [ym, setYm] = useState(() => monthOf(today));
  const [selected, setSelected] = useState<string>(today);
  const [sheet, setSheet] = useState<{ block: RentalBlockView | null } | null>(null);
  const range = useMemo(() => gridRange(ym.year, ym.month), [ym]);
  const cal = useRentalCalendar(listingId, range);

  // Bookings and blocks change from other screens and other members: read again when the screen comes back.
  const focused = useRef(false);
  const { refetch } = cal;
  useFocusEffect(useCallback(() => {
    if (focused.current) void refetch();
    focused.current = true;
  }, [refetch]));

  const s = useMemo(() => StyleSheet.create({
    body: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 120 },
    title: { ...type('caption'), color: colors.textSecondary },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    swatch: { width: 12, height: 12, borderRadius: 3, borderWidth: 1, borderColor: colors.hairline },
    swatchFree: { backgroundColor: colors.surface },
    swatchPartial: { backgroundColor: colors.warnSoft },
    swatchFull: { backgroundColor: colors.dangerSoft },
    legendText: { ...type('caption'), color: colors.textSecondary },
    dayHead: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm, gap: spacing.xs },
    dayTitle: { ...type('cardTitle'), color: colors.text },
    dayCount: { ...type('body'), color: colors.textSecondary },
    empty: { ...type('body'), color: colors.textSecondary, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
    skeleton: { height: 320, borderRadius: radius.xl },
    footer: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  }), [colors, type]);

  const ownerView = qc.getQueryData<ListingOwnerView>(listingKeys.owner(listingId));
  const data = cal.data;
  const quantity = data?.quantity ?? 0;
  const canEdit = !!data && data.memberRole !== 'viewer';
  const day = data?.days.find((d) => d.date === selected) ?? null;
  const items = data ? dayItems(data, selected) : { bookings: [], blocks: [] };

  // A new month selects today when it is in it, else its 1st, so the day panel always shows a day on screen.
  const goMonth = (delta: number) => {
    const next = shiftMonth(ym.year, ym.month, delta);
    const now = monthOf(today);
    setYm(next);
    setSelected(next.year === now.year && next.month === now.month
      ? today
      : `${next.year}-${String(next.month).padStart(2, '0')}-01`);
  };

  let content: React.ReactNode;
  if (cal.isLoading) {
    content = <Skeleton style={s.skeleton} />;
  } else if (cal.isError && !data) {
    content = (
      <EmptyState
        icon={TriangleAlert}
        title={m14ErrorMessage(cal.error)}
        subtitle={t('rentalsOwner.calendar.loadError')}
        ctaTitle={t('common.retry')}
        ctaPhLabel="Calendar-retry"
        onCtaPress={() => void cal.refetch()}
      />
    );
  } else {
    const rows = items.bookings.length + items.blocks.length;
    content = (
      <>
        <CalendarMonth
          year={ym.year}
          month={ym.month}
          days={data?.days ?? []}
          quantity={quantity}
          today={today}
          selected={selected}
          onSelect={setSelected}
          onPrev={() => goMonth(-1)}
          onNext={() => goMonth(1)}
        />
        <View style={s.legend}>
          {([['free', s.swatchFree], ['partial', s.swatchPartial], ['full', s.swatchFull]] as const).map(([k, sw]) => (
            <View key={k} style={s.legendItem}>
              <View style={[s.swatch, sw]} />
              <Text style={s.legendText}>{t(`rentalsOwner.calendar.legend.${k}`)}</Text>
            </View>
          ))}
        </View>
        <Card flush>
          <View style={s.dayHead}>
            <Text style={s.dayTitle} accessibilityRole="header">{formatDateWithWeekday(dateMs(selected))}</Text>
            {day ? (
              <Text style={s.dayCount} testID="Calendar-day-count">
                {t('rentalsOwner.calendar.dayCount', { out: day.out, q: quantity, free: day.free })}
              </Text>
            ) : null}
          </View>
          {rows === 0 ? <Text style={s.empty}>{t('rentalsOwner.calendar.dayEmpty')}</Text> : null}
          {items.bookings.map((b, i) => {
            const chip = bookingStatusChip(b.status, 'owner');
            return (
              <ListRow
                key={b.id}
                icon={CalendarClock}
                label={b.renterName}
                hint={t('rentalsOwner.calendar.bookingHint', {
                  ref: b.ref, dates: dateRangeLabel(b.startDate, b.endDate, lang), count: b.machines,
                })}
                trailing={<StatusChip label={t(chip.key)} tone={chip.tone} />}
                last={i === rows - 1}
                onPress={() => navigation.navigate('BookingRecord', { bookingId: b.id })}
                accessibilityRole="button"
                testID={`Calendar-booking-${b.ref}`}
              />
            );
          })}
          {items.blocks.map((b, i) => (
            <ListRow
              key={b.id}
              icon={Wrench}
              label={t(`rentalsOwner.blockReason.${b.reason}`)}
              hint={[
                t('rentalsOwner.calendar.blockHint', { dates: dateRangeLabel(b.startDate, b.endDate, lang), count: b.machines }),
                b.note ?? '',
              ].filter(Boolean).join('\n')}
              chevron={canEdit}
              last={items.bookings.length + i === rows - 1}
              onPress={canEdit ? () => setSheet({ block: b }) : undefined}
              accessibilityRole={canEdit ? 'button' : undefined}
              testID={`Calendar-block-${b.id}`}
            />
          ))}
        </Card>
      </>
    );
  }

  return (
    <ScreenWrapper>
      <View testID="RentalCalendar-screen" style={{ flex: 1 }}>
        <Header title={t('rentalsOwner.calendar.title')} />
        <ScrollView contentContainerStyle={s.body}>
          {ownerView?.title ? <Text style={s.title} numberOfLines={1}>{ownerView.title}</Text> : null}
          {content}
        </ScrollView>
        {canEdit ? (
          <FooterBar style={s.footer}>
            <Button
              title={t('rentalsOwner.calendar.addBlock')}
              icon={Plus}
              onPress={() => setSheet({ block: null })}
              size="md"
              phLabel="Calendar-add-block"
            />
          </FooterBar>
        ) : null}
      </View>
      <BlockSheet
        listingId={listingId}
        quantity={quantity}
        block={sheet?.block ?? null}
        initialDate={selected}
        visible={sheet != null}
        onClose={() => setSheet(null)}
      />
    </ScreenWrapper>
  );
}
