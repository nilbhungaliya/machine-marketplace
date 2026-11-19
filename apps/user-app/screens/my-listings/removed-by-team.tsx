import React, { useMemo } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { MyListingCard } from '@mpm/shared-types';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import Button from '@/components/Button';
import EmptyState from '@/components/EmptyState';
import Notice from '@/components/Notice';
import Skeleton from '@/components/Skeleton';
import { useMyListingsPages } from '@/hooks/use-my-listings';
import { formatDate } from '@/lib/format-date';
import { Info, Inbox, TriangleAlert } from '@/lib/icons';
import { statusChip } from '@/lib/my-listings';
import { radius, spacing } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';
import ListingCardItem from '@/screens/listing/listing-card-item';

/**
 * Removed by our team (F2 spec §10, R50, M19): listings an admin removed in the last 30 days, each with the reason.
 * Read-only: no manage sheet, no link to the (removed) listing page.
 */
export default function RemovedByTeamScreen(_props: RootStackScreenProps<'RemovedByTeam'>) {
  const { t } = useTranslation();
  const pages = useMyListingsPages('removed_by_team');
  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];

  const s = useMemo(() => StyleSheet.create({
    list: { padding: spacing.lg, gap: spacing.md },
    skeleton: { height: 112, borderRadius: radius.lg },
  }), []);

  const renderItem = ({ item }: { item: MyListingCard }) => {
    const chip = statusChip(item.status);
    const at = Date.parse(item.updatedAt);
    return (
      <ListingCardItem
        card={item}
        save={false}
        status={{ label: t(chip.key), tone: chip.tone }}
        subtitle={Number.isNaN(at) ? undefined : t('listing.removed.on', { date: formatDate(at) })}
        nudge={item.statusReason ? t('listing.removed.reason', { reason: item.statusReason }) : t('listing.removed.noReason')}
        testID={`Removed-listing-${item.ref}`}
      />
    );
  };

  let empty: React.ReactElement;
  if (pages.isLoading) {
    empty = <View style={{ gap: spacing.md }}>{[0, 1].map((i) => <Skeleton key={i} style={s.skeleton} />)}</View>;
  } else if (pages.isError) {
    empty = (
      <EmptyState
        icon={TriangleAlert}
        title={t('listing.mine.loadError')}
        subtitle={t('listing.page.loadErrorBody')}
        ctaTitle={t('common.retry')}
        ctaPhLabel="Removed-retry"
        onCtaPress={() => void pages.refetch()}
      />
    );
  } else {
    empty = <EmptyState icon={Inbox} title={t('listing.removed.emptyTitle')} subtitle={t('listing.removed.emptyBody')} />;
  }

  return (
    <ScreenWrapper>
      <Header title={t('listing.group.removed_by_team')} />
      <FlatList
        data={items}
        keyExtractor={(l) => l.id}
        renderItem={renderItem}
        contentContainerStyle={s.list}
        ListHeaderComponent={<Notice tone="info" icon={Info} text={t('listing.removed.intro')} />}
        ListEmptyComponent={empty}
        ListFooterComponent={pages.hasNextPage ? (
          <Button
            title={t('listing.mine.loadMore')}
            onPress={() => void pages.fetchNextPage()}
            loading={pages.isFetchingNextPage}
            variant="outline"
            phLabel="Removed-more"
          />
        ) : null}
      />
    </ScreenWrapper>
  );
}
