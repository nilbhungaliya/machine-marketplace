import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import type { DealListRow } from '@mpm/shared-types';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import Chip from '@/components/Chip';
import EmptyState from '@/components/EmptyState';
import SegmentedControl from '@/components/SegmentedControl';
import Skeleton from '@/components/Skeleton';
import { useOnReconnect } from '@/components/SocketProvider';
import DealRow from '@/components/deals/DealRow';
import { useDeals } from '@/hooks/use-deals';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { TAB_ICONS, TriangleAlert } from '@/lib/icons';
import type { DealsSide, DealsTab } from '@/lib/query-keys';
import { radius, spacing } from '@/lib/theme';
import type { TabScreenProps } from '@/navigation/types';

const TABS: DealsTab[] = ['active', 'completed', 'cancelled'];
const SIDES: DealsSide[] = ['all', 'buying', 'selling'];

/**
 * The Deals tab (F6 + F7 spec §15.1, mockup deals · "My deals"): segments Active / Completed / Cancelled with counts,
 * an All / Buying / Selling filter, rows with status and "Your turn", infinite scroll and pull to refresh. Refetched on
 * focus and after a socket reconnect; `deal:updated` patches it live (`lib/socket-deals.ts`). No rental rows (M14).
 */
export default function DealsScreen({ navigation }: TabScreenProps<'Deals'>) {
  const { t } = useTranslation();
  const tabInset = useTabBarInset();
  const [tab, setTab] = useState<DealsTab>('active');
  const [side, setSide] = useState<DealsSide>('all');
  const deals = useDeals(tab, side);

  useFocusEffect(useCallback(() => { void deals.refetch(); }, [tab, side])); // eslint-disable-line react-hooks/exhaustive-deps
  useOnReconnect(() => { void deals.refetch(); });

  const s = useMemo(() => StyleSheet.create({
    controls: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.md },
    sides: { flexDirection: 'row', gap: spacing.sm },
    list: { paddingHorizontal: spacing.lg, gap: spacing.sm },
    skeleton: { height: 82, borderRadius: radius.xl },
  }), []);

  const pages = deals.data?.pages ?? [];
  const counts = pages[0]?.counts;
  const items: DealListRow[] = pages.flatMap((p) => p.items);

  const options = TABS.map((value) => ({
    value,
    label: counts && counts[value] > 0 ? t(`deals.tabs.${value}Count`, { count: counts[value] }) : t(`deals.tabs.${value}`),
    testID: `Deals-tab-${value}`,
  }));

  const empty = deals.isLoading ? (
    <View style={{ gap: spacing.sm }}>
      <Skeleton style={s.skeleton} />
      <Skeleton style={s.skeleton} />
      <Skeleton style={s.skeleton} />
    </View>
  ) : deals.isError ? (
    <EmptyState
      icon={TriangleAlert}
      title={t('deals.list.errorTitle')}
      subtitle={t('deals.list.errorBody')}
      ctaTitle={t('common.retry')}
      ctaPhLabel="Deals-retry"
      onCtaPress={() => void deals.refetch()}
    />
  ) : (
    <EmptyState icon={TAB_ICONS.deals} title={t(`deals.list.empty.${tab}`)} subtitle={t('deals.emptySubtitle')} />
  );

  return (
    <ScreenWrapper edges={['top']}>
      <Header title={t('deals.title')} showBack={false} />
      <View style={s.controls}>
        <SegmentedControl options={options} value={tab} onChange={setTab} accessibilityLabel={t('deals.title')} />
        <View style={s.sides}>
          {SIDES.map((v) => (
            <Chip
              key={v}
              label={t(`deals.sides.${v}`)}
              selected={side === v}
              onPress={() => setSide(v)}
              role="radio"
              testID={`Deals-side-${v}`}
            />
          ))}
        </View>
      </View>
      <FlatList
        data={items}
        keyExtractor={(d) => d.id}
        renderItem={({ item }) => (
          <DealRow deal={item} onPress={() => navigation.navigate('DealRecord', { dealId: item.id })} />
        )}
        contentContainerStyle={[s.list, { paddingBottom: tabInset }]}
        ListEmptyComponent={empty}
        onEndReached={() => { if (deals.hasNextPage && !deals.isFetchingNextPage) void deals.fetchNextPage(); }}
        onEndReachedThreshold={0.4}
        refreshControl={<RefreshControl refreshing={deals.isRefetching && !deals.isFetchingNextPage} onRefresh={() => void deals.refetch()} />}
        testID="Deals-list"
      />
    </ScreenWrapper>
  );
}
