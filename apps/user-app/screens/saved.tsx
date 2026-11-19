import React, { useMemo } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import Button from '@/components/Button';
import EmptyState from '@/components/EmptyState';
import Skeleton from '@/components/Skeleton';
import { useSavedListings, useSaveToggle } from '@/hooks/use-saved';
import { useType } from '@/hooks/use-type';
import { Heart, Package, Trash, TriangleAlert } from '@/lib/icons';
import { savedCount, savedRows, type SavedRow } from '@/lib/saved-view';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';
import ListingCardItem from '@/screens/listing/listing-card-item';

/**
 * Saved listings (F4 + F5 spec §8.5; mockup "Saved", without the enquire-all bar, which waits for the P2 enquiry
 * basket): newest saved first, keyset pages. A listing still public is its card (the heart removes it); one no longer
 * public shows "No longer available" with Remove, never a card. Signed-in only (registered in the signed-in group).
 */
export default function SavedScreen({ navigation }: RootStackScreenProps<'Saved'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const saved = useSavedListings();
  const toggle = useSaveToggle();
  const rows = useMemo(() => savedRows(saved.data?.pages), [saved.data]);
  const count = savedCount(saved.data?.pages[0]);

  const s = useMemo(() => StyleSheet.create({
    list: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
    count: { ...type('caption'), color: colors.textMuted },
    skeleton: { height: 112, borderRadius: radius.lg },
    gone: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.sm, borderRadius: radius.lg + 2,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline,
    },
    goneThumb: {
      width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.field, alignItems: 'center', justifyContent: 'center',
    },
    goneBody: { flex: 1, minWidth: 0, gap: 2 },
    goneTitle: { ...type('cardTitle'), color: colors.textSecondary },
    goneText: { ...type('caption'), color: colors.textMuted },
    footer: { paddingVertical: spacing.lg },
  }), [colors, type]);

  const renderRow = ({ item, index }: { item: SavedRow; index: number }) => {
    if (item.type === 'card') {
      return (
        <ListingCardItem
          card={item.card}
          onPress={() => navigation.navigate('Listing', { listingId: item.listingId })}
          testID={`Saved-listing-${item.card.ref}`}
        />
      );
    }
    return (
      <View style={s.gone} testID={`Saved-unavailable-${index}`}>
        <View style={s.goneThumb}><Package size={28} color={colors.textMuted} /></View>
        <View style={s.goneBody}>
          <Text style={s.goneTitle} numberOfLines={1}>{t('saved.unavailableTitle')}</Text>
          <Text style={s.goneText} numberOfLines={2}>{t('saved.unavailableBody')}</Text>
        </View>
        <Button
          title={t('saved.remove')}
          icon={Trash}
          variant="outline"
          size="sm"
          phLabel={`Saved-remove-${index}`}
          onPress={() => void toggle(item.listingId, true)}
        />
      </View>
    );
  };

  let empty: React.ReactElement;
  if (saved.isLoading) {
    empty = <View style={{ gap: spacing.md }}>{[0, 1, 2].map((i) => <Skeleton key={i} style={s.skeleton} />)}</View>;
  } else if (saved.isError) {
    empty = (
      <EmptyState
        icon={TriangleAlert}
        title={t('saved.loadErrorTitle')}
        subtitle={t('saved.loadErrorBody')}
        ctaTitle={t('common.retry')}
        ctaPhLabel="Saved-retry"
        onCtaPress={() => void saved.refetch()}
      />
    );
  } else {
    empty = (
      <EmptyState
        icon={Heart}
        title={t('saved.emptyTitle')}
        subtitle={t('saved.emptySubtitle')}
        ctaTitle={t('saved.browseCta')}
        ctaPhLabel="Saved-browse"
        onCtaPress={() => navigation.navigate('Main', { screen: 'Home' })}
      />
    );
  }

  const header = count && rows.length > 0 ? (
    <Text style={s.count}>
      {count.more ? t('saved.subtitleMore', { n: count.n }) : t('saved.subtitle', { count: count.n })}
    </Text>
  ) : null;

  return (
    <ScreenWrapper>
      <Header title={t('saved.title')} />
      <FlatList<SavedRow>
        data={rows}
        keyExtractor={(r) => r.listingId}
        renderItem={renderRow}
        contentContainerStyle={s.list}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={saved.isFetchingNextPage ? <ActivityIndicator style={s.footer} color={colors.primary} /> : null}
        onEndReached={() => {
          if (saved.hasNextPage && !saved.isFetchingNextPage) void saved.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        refreshing={saved.isRefetching && !saved.isFetchingNextPage}
        onRefresh={() => void saved.refetch()}
      />
    </ScreenWrapper>
  );
}
