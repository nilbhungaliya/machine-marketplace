import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import type { SellerPartRequestRow, SellerPartRequestTab } from '@mpm/shared-types';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import EmptyState from '@/components/EmptyState';
import Header from '@/components/Header';
import ListRow from '@/components/ListRow';
import ScreenWrapper from '@/components/ScreenWrapper';
import SegmentedControl from '@/components/SegmentedControl';
import Skeleton from '@/components/Skeleton';
import SellerRequestRow from '@/components/part-requests/SellerRequestRow';
import { useSellerPartRequests } from '@/hooks/use-seller-part-requests';
import { useType } from '@/hooks/use-type';
import { ClipboardList, Factory, ShieldCheck, Tag, TriangleAlert, X } from '@/lib/icons';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';

const TABS: { value: SellerPartRequestTab; key: 'forYou' | 'all' | 'replied' }[] = [
  { value: 'matched', key: 'forYou' },
  { value: 'all', key: 'all' },
  { value: 'replied', key: 'replied' },
];

/**
 * Buyers looking for your parts (F8 spec §12.3, §13.1; mockup requirements · "Seller sees a requirement"): "Matched to
 * your categories and stock.", segments For you / All / Replied with counts, rows with Reply, infinite scroll and pull
 * to refresh, refetched on focus. `forListing` (Published's "See their requirements") lists the requests one of the
 * business's listings could answer; "Show all" clears it. The empty state explains who sees requirements.
 */
export default function BuyersLookingScreen({ navigation, route }: RootStackScreenProps<'BuyersLooking'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const forListing = route.params?.forListing ?? null;
  const [tab, setTab] = useState<SellerPartRequestTab>('matched');
  // A listing's demand is one list: every eligible request it could answer, whatever the tab.
  const effectiveTab: SellerPartRequestTab = forListing ? 'all' : tab;
  const list = useSellerPartRequests(effectiveTab, forListing);

  useFocusEffect(useCallback(() => { void list.refetch(); }, [effectiveTab, forListing])); // eslint-disable-line react-hooks/exhaustive-deps

  const s = useMemo(() => StyleSheet.create({
    controls: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.md },
    lead: { ...type('lead'), color: colors.textSecondary },
    filter: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
    filterText: { ...type('label'), color: colors.text, flexShrink: 1 },
    list: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxxl },
    skeleton: { height: 168, borderRadius: radius.xl },
    explain: { gap: spacing.sm, marginTop: spacing.md },
    explainTitle: { ...type('label'), color: colors.textSecondary },
  }), [colors, type]);

  const pages = list.data?.pages ?? [];
  const counts = pages[0]?.counts;
  const items: SellerPartRequestRow[] = pages.flatMap((p) => p.items);

  const options = TABS.map(({ value, key }) => {
    const n = counts ? counts[key] : 0;
    return {
      value,
      label: n > 0 ? t(`buyers.tabs.${key}Count`, { count: n }) : t(`buyers.tabs.${key}`),
      testID: `BuyersLooking-tab-${key}`,
    };
  });

  const explainer = (
    <View style={s.explain}>
      <Text style={s.explainTitle}>{t('buyers.empty.explainTitle')}</Text>
      <Card flush>
        <ListRow icon={Tag} label={t('buyers.empty.sell')} />
        <ListRow icon={Factory} label={t('buyers.empty.categories')} />
        <ListRow icon={ShieldCheck} label={t('buyers.empty.verified')} last />
      </Card>
    </View>
  );

  const empty = list.isLoading ? (
    <View style={{ gap: spacing.sm }}>
      <Skeleton style={s.skeleton} />
      <Skeleton style={s.skeleton} />
      <Skeleton style={s.skeleton} />
    </View>
  ) : list.isError ? (
    <EmptyState
      icon={TriangleAlert}
      title={t('buyers.loadErrorTitle')}
      subtitle={t('buyers.loadErrorBody')}
      ctaTitle={t('common.retry')}
      ctaPhLabel="BuyersLooking-retry"
      onCtaPress={() => void list.refetch()}
    />
  ) : effectiveTab === 'replied' ? (
    <EmptyState icon={ClipboardList} title={t('buyers.empty.repliedTitle')} subtitle={t('buyers.empty.repliedBody')} />
  ) : (
    <View>
      <EmptyState icon={ClipboardList} title={t('buyers.empty.title')} subtitle={t('buyers.empty.body')} />
      {explainer}
    </View>
  );

  return (
    <ScreenWrapper>
      <Header title={t('buyers.title')} />
      <View style={s.controls}>
        <Text style={s.lead}>{t('buyers.lead')}</Text>
        {forListing ? (
          <View style={s.filter}>
            <Text style={s.filterText}>{t('buyers.forListing')}</Text>
            <Chip
              label={t('buyers.showAll')}
              icon={X}
              selected
              onPress={() => navigation.setParams({ forListing: undefined })}
              testID="BuyersLooking-show-all"
            />
          </View>
        ) : (
          <SegmentedControl options={options} value={tab} onChange={setTab} accessibilityLabel={t('buyers.title')} />
        )}
      </View>
      <FlatList
        data={items}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => (
          <SellerRequestRow
            row={item}
            onPress={() => navigation.navigate('Requirement', { partRequestId: item.id })}
            onReply={() => navigation.navigate('ReplyWithListing', { partRequestId: item.id })}
            testID={`BuyersLooking-row-${item.id}`}
          />
        )}
        contentContainerStyle={s.list}
        ListEmptyComponent={empty}
        onEndReached={() => { if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage(); }}
        onEndReachedThreshold={0.4}
        refreshControl={<RefreshControl refreshing={list.isRefetching && !list.isFetchingNextPage} onRefresh={() => void list.refetch()} colors={[colors.primary]} />}
        testID="BuyersLooking-list"
      />
    </ScreenWrapper>
  );
}
