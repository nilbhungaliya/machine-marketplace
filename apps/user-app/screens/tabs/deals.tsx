import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import type { DealListRow, RentalBookingListRow, RentalBookingSideFilter } from '@mpm/shared-types';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import Chip from '@/components/Chip';
import EmptyState from '@/components/EmptyState';
import SegmentedControl from '@/components/SegmentedControl';
import Skeleton from '@/components/Skeleton';
import { useOnReconnect } from '@/components/SocketProvider';
import DealRow from '@/components/deals/DealRow';
import BookingRow from '@/components/rentals/BookingRow';
import { useDeals } from '@/hooks/use-deals';
import { useRentalBookings } from '@/hooks/use-rental-bookings';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { CalendarClock, TAB_ICONS, TriangleAlert } from '@/lib/icons';
import type { DealsSide, DealsTab } from '@/lib/query-keys';
import { radius, spacing } from '@/lib/theme';
import type { TabScreenProps } from '@/navigation/types';

const TABS: DealsTab[] = ['active', 'completed', 'cancelled'];
const SIDES: DealsSide[] = ['all', 'buying', 'selling'];
const RENTAL_SIDES: RentalBookingSideFilter[] = ['all', 'renter', 'owner'];

type Segment = 'deals' | 'rentals';

/**
 * The Deals tab (F6 + F7 spec §15.1, mockup deals · "My deals"; M14 plan D15): a top **Deals / Rentals** switch, then
 * segments Active / Completed / Cancelled with counts. Deals: All / Buying / Selling, `DealRow`s. Rentals: All /
 * Renting / Renting out, `BookingRow`s, and a removable "This listing" filter when opened from a listing's Bookings.
 * Rows carry status and "Your turn"; infinite scroll and pull to refresh; refetched on focus and after a reconnect;
 * `deal:` and `rental:` events refresh the lists live.
 */
export default function DealsScreen({ navigation, route }: TabScreenProps<'Deals'>) {
  const { t } = useTranslation();
  const tabInset = useTabBarInset();
  const [segment, setSegment] = useState<Segment>(route.params?.segment ?? 'deals');
  const [listingId, setListingId] = useState<string | null>(route.params?.listingId ?? null);
  const [tab, setTab] = useState<DealsTab>('active');
  const [side, setSide] = useState<DealsSide>('all');
  const [rentalSide, setRentalSide] = useState<RentalBookingSideFilter>('all');

  // Opened with params (a listing's Bookings, a notification): follow them, then clear them so the same link
  // tapped again applies again. The listing filter stays in local state.
  useEffect(() => {
    const p = route.params;
    if (!p || (p.segment === undefined && p.listingId === undefined)) return;
    if (p.segment) setSegment(p.segment);
    if (p.listingId !== undefined) setListingId(p.listingId ?? null);
    navigation.setParams({ segment: undefined, listingId: undefined });
  }, [route.params?.segment, route.params?.listingId]); // eslint-disable-line react-hooks/exhaustive-deps

  const rentals = segment === 'rentals';
  const deals = useDeals(tab, side);
  const bookings = useRentalBookings(tab, rentalSide, listingId, rentals);

  useFocusEffect(useCallback(() => {
    if (rentals) void bookings.refetch();
    else void deals.refetch();
  }, [rentals, tab, side, rentalSide, listingId])); // eslint-disable-line react-hooks/exhaustive-deps
  useOnReconnect(() => { if (rentals) void bookings.refetch(); else void deals.refetch(); });

  const s = useMemo(() => StyleSheet.create({
    controls: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.md },
    sides: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
    list: { paddingHorizontal: spacing.lg, gap: spacing.sm },
    skeleton: { height: 82, borderRadius: radius.xl },
  }), []);

  const active = rentals ? bookings : deals;
  const dealPages = deals.data?.pages ?? [];
  const rentalPages = bookings.data?.pages ?? [];
  const counts = rentals ? rentalPages[0]?.counts : dealPages[0]?.counts;
  const dealItems: DealListRow[] = dealPages.flatMap((p) => p.items);
  const rentalItems: RentalBookingListRow[] = rentalPages.flatMap((p) => p.items);

  const options = TABS.map((value) => ({
    value,
    label: counts && counts[value] > 0 ? t(`deals.tabs.${value}Count`, { count: counts[value] }) : t(`deals.tabs.${value}`),
    testID: `Deals-tab-${value}`,
  }));

  const empty = active.isLoading ? (
    <View style={{ gap: spacing.sm }}>
      <Skeleton style={s.skeleton} />
      <Skeleton style={s.skeleton} />
      <Skeleton style={s.skeleton} />
    </View>
  ) : active.isError ? (
    <EmptyState
      icon={TriangleAlert}
      title={t('deals.list.errorTitle')}
      subtitle={t('deals.list.errorBody')}
      ctaTitle={t('common.retry')}
      ctaPhLabel="Deals-retry"
      onCtaPress={() => void active.refetch()}
    />
  ) : rentals ? (
    <EmptyState icon={CalendarClock} title={t(`rentals.list.empty.${tab}`)} subtitle={t('rentals.list.emptySubtitle')} />
  ) : (
    <EmptyState icon={TAB_ICONS.deals} title={t(`deals.list.empty.${tab}`)} subtitle={t('deals.emptySubtitle')} />
  );

  const loadMore = () => {
    if (rentals) {
      if (bookings.hasNextPage && !bookings.isFetchingNextPage) void bookings.fetchNextPage();
    } else if (deals.hasNextPage && !deals.isFetchingNextPage) void deals.fetchNextPage();
  };
  const refreshing = active.isRefetching && !active.isFetchingNextPage;

  return (
    <ScreenWrapper edges={['top']}>
      <Header title={t('deals.title')} showBack={false} />
      <View style={s.controls}>
        <SegmentedControl
          options={[
            { value: 'deals', label: t('rentals.list.segmentDeals'), testID: 'Deals-segment-deals' },
            { value: 'rentals', label: t('rentals.list.segmentRentals'), testID: 'Deals-segment-rentals' },
          ]}
          value={segment}
          onChange={setSegment}
          accessibilityLabel={t('deals.title')}
        />
        <SegmentedControl options={options} value={tab} onChange={setTab} accessibilityLabel={t('deals.title')} />
        <View style={s.sides}>
          {rentals
            ? RENTAL_SIDES.map((v) => (
              <Chip
                key={v}
                label={t(`rentals.list.sides.${v}`)}
                selected={rentalSide === v}
                onPress={() => setRentalSide(v)}
                role="radio"
                testID={`Rentals-side-${v}`}
              />
            ))
            : SIDES.map((v) => (
              <Chip
                key={v}
                label={t(`deals.sides.${v}`)}
                selected={side === v}
                onPress={() => setSide(v)}
                role="radio"
                testID={`Deals-side-${v}`}
              />
            ))}
          {rentals && listingId ? (
            <Chip
              label={t('rentals.list.thisListing')}
              selected
              onPress={() => setListingId(null)}
              testID="Rentals-listing-filter"
            />
          ) : null}
        </View>
      </View>
      {rentals ? (
        <FlatList
          data={rentalItems}
          keyExtractor={(b) => b.id}
          renderItem={({ item }) => (
            <BookingRow booking={item} onPress={() => navigation.navigate('BookingRecord', { bookingId: item.id })} />
          )}
          contentContainerStyle={[s.list, { paddingBottom: tabInset }]}
          ListEmptyComponent={empty}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void bookings.refetch()} />}
          testID="Rentals-list"
        />
      ) : (
        <FlatList
          data={dealItems}
          keyExtractor={(d) => d.id}
          renderItem={({ item }) => (
            <DealRow deal={item} onPress={() => navigation.navigate('DealRecord', { dealId: item.id })} />
          )}
          contentContainerStyle={[s.list, { paddingBottom: tabInset }]}
          ListEmptyComponent={empty}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void deals.refetch()} />}
          testID="Deals-list"
        />
      )}
    </ScreenWrapper>
  );
}
