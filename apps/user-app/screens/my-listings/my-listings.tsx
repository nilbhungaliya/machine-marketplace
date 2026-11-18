import React, { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import type { MyListingCard, MyListingsGroup } from '@mpm/shared-types';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import Button from '@/components/Button';
import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import ListRow from '@/components/ListRow';
import SegmentedControl from '@/components/SegmentedControl';
import Skeleton from '@/components/Skeleton';
import { useMyListingsPages } from '@/hooks/use-my-listings';
import { useType } from '@/hooks/use-type';
import { ClipboardList, Inbox, ShieldAlert, TriangleAlert } from '@/lib/icons';
import {
  MY_LISTINGS_SEGMENTS, myCardChip, myCardNudge, myCardSubtitle, showRenew,
} from '@/lib/my-listings';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';
import ListingCardItem from '@/screens/listing/listing-card-item';
import ManageSheet, { useRunListingAction } from './manage-sheet';

type Segment = (typeof MY_LISTINGS_SEGMENTS)[number];

const isSegment = (g: MyListingsGroup | undefined): g is Segment =>
  !!g && (MY_LISTINGS_SEGMENTS as readonly string[]).includes(g);

/**
 * My listings (F2 spec §10, mockup "My listings"): Drafts and "Removed by our team" rows, the four groups with counts
 * (Live · In review · Paused · Sold), and the seller's cards with status, expiry, the moderator's message, nudges and
 * the "Still available?" Renew. A card opens the manage sheet. Refetched on focus (no push until F9).
 */
export default function MyListingsScreen({ navigation, route }: RootStackScreenProps<'MyListings'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const initial = route.params?.group;
  const [group, setGroup] = useState<Segment>(isSegment(initial) ? initial : 'live');
  const pages = useMyListingsPages(group);
  const [manage, setManage] = useState<MyListingCard | null>(null);
  const { run, pending } = useRunListingAction();

  // An admin's decision has no push yet: refetch whenever the screen comes back into view (not on the first focus,
  // which the query's mount already fetches).
  const focused = useRef(false);
  const { refetch } = pages;
  useFocusEffect(useCallback(() => {
    if (focused.current) void refetch();
    focused.current = true;
  }, [refetch]));

  const s = useMemo(() => StyleSheet.create({
    list: { padding: spacing.lg, gap: spacing.md },
    head: { gap: spacing.md, marginBottom: spacing.xs },
    skeleton: { height: 112, borderRadius: radius.lg },
    banner: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm,
      backgroundColor: colors.warnSoft, borderRadius: radius.md, paddingLeft: spacing.md, paddingVertical: spacing.xs,
    },
    bannerText: { ...type('label'), color: colors.text, flexShrink: 1 },
    continueText: { ...type('label'), color: colors.primaryInk },
  }), [colors, type]);

  const first = pages.data?.pages[0];
  const counts = first?.counts;
  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];

  const header = (
    <View style={s.head}>
      <Card flush>
        <ListRow
          icon={ClipboardList}
          label={t('listing.mine.drafts')}
          hint={counts ? t('common.listingCount', { count: counts.drafts }) : undefined}
          trailing={<Text style={s.continueText}>{t('listing.mine.continue')}</Text>}
          last={!counts || counts.removed_by_team === 0}
          onPress={() => navigation.navigate('MyDrafts')}
          testID="My-listings-drafts"
          accessibilityRole="button"
        />
        {counts && counts.removed_by_team > 0 ? (
          <ListRow
            icon={ShieldAlert}
            label={t('listing.group.removed_by_team')}
            hint={t('common.listingCount', { count: counts.removed_by_team })}
            chevron
            last
            onPress={() => navigation.navigate('RemovedByTeam')}
            testID="My-listings-removed"
            accessibilityRole="button"
          />
        ) : null}
      </Card>
      <SegmentedControl
        options={MY_LISTINGS_SEGMENTS.map((g) => ({
          value: g,
          label: counts ? t('listing.mine.segment', { label: t(`listing.group.${g}`), count: counts[g] }) : t(`listing.group.${g}`),
          testID: `My-listings-${g}`,
        }))}
        value={group}
        onChange={setGroup}
        accessibilityLabel={t('listing.mine.title')}
      />
    </View>
  );

  const renderItem = ({ item }: { item: MyListingCard }) => {
    const chip = myCardChip(item);
    const nudge = myCardNudge(item);
    const renew = showRenew(item);
    return (
      <ListingCardItem
        card={item}
        subtitle={myCardSubtitle(item)}
        status={{ label: t(chip.key), tone: chip.tone }}
        nudge={nudge ? t(nudge.key, nudge.values) : undefined}
        onPress={() => setManage(item)}
        testID={`My-listing-${item.ref}`}
      >
        {renew ? (
          <View style={s.banner}>
            <Text style={s.bannerText}>{t('listing.mine.stillAvailable')}</Text>
            <Button
              title={t('listing.mine.renew')}
              onPress={() => void run(item, 'renew')}
              disabled={pending}
              size="sm"
              phLabel={`My-listing-renew-${item.ref}`}
            />
          </View>
        ) : null}
      </ListingCardItem>
    );
  };

  let empty: React.ReactElement | null = null;
  if (pages.isLoading) {
    empty = <View style={{ gap: spacing.md }}>{[0, 1, 2].map((i) => <Skeleton key={i} style={s.skeleton} />)}</View>;
  } else if (pages.isError) {
    empty = (
      <EmptyState
        icon={TriangleAlert}
        title={t('listing.mine.loadError')}
        subtitle={t('listing.page.loadErrorBody')}
        ctaTitle={t('common.retry')}
        ctaPhLabel="My-listings-retry"
        onCtaPress={() => void pages.refetch()}
      />
    );
  } else {
    empty = <EmptyState icon={Inbox} title={t(`listing.mine.emptyTitle.${group}`)} subtitle={t('listing.mine.emptyBody')} />;
  }

  return (
    <ScreenWrapper>
      <Header
        title={t('listing.mine.title')}
        rightIcon={(
          <Button
            title={t('listing.mine.sell')}
            onPress={() => navigation.navigate('Main', { screen: 'Post' })}
            variant="ghost"
            size="sm"
            phLabel="My-listings-sell"
          />
        )}
      />
      <FlatList
        data={items}
        keyExtractor={(l) => l.id}
        renderItem={renderItem}
        contentContainerStyle={s.list}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={pages.hasNextPage ? (
          <Button
            title={t('listing.mine.loadMore')}
            onPress={() => void pages.fetchNextPage()}
            loading={pages.isFetchingNextPage}
            variant="outline"
            phLabel="My-listings-more"
          />
        ) : null}
        refreshing={pages.isRefetching && !pages.isFetchingNextPage}
        onRefresh={() => void pages.refetch()}
      />
      <ManageSheet listing={manage} showView onClose={() => setManage(null)} />
    </ScreenWrapper>
  );
}
