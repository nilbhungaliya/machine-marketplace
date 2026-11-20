import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import ScreenWrapper from '@/components/ScreenWrapper';
import Button from '@/components/Button';
import EmptyState from '@/components/EmptyState';
import GridCard from '@/components/GridCard';
import IconButton from '@/components/IconButton';
import LocationChip from '@/components/LocationChip';
import LocationSheet from '@/components/LocationSheet';
import MiniCard from '@/components/MiniCard';
import Skeleton from '@/components/Skeleton';
import { useBadges, useMember } from '@/hooks/use-badges';
import { useCards, useHome } from '@/hooks/use-discover';
import { useDiscoveryOrigin } from '@/hooks/use-discovery-origin';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { HOME_EVENTS } from '@/lib/analytics-events';
import { homeEmpty, homeTiles, searchBarTarget, seeAllTarget, tileTarget, type HomeTarget, type HomeTile } from '@/lib/home-view';
import { BellRing, CalendarClock, CATEGORY_ICON_COMPONENTS, Factory, Package, Search, TriangleAlert, User, type LucideIcon } from '@/lib/icons';
import { badgeText } from '@/lib/notification-links';
import { loadRecentlyViewed } from '@/lib/recently-viewed';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { TabScreenProps } from '@/navigation/types';
import ListingCardItem from '@/screens/listing/listing-card-item';
import HomeBuyerStrip from '@/components/part-requests/HomeBuyerStrip';
import HomeSellerStrip from '@/components/part-requests/HomeSellerStrip';
import { usePartRequestHome } from '@/hooks/use-part-request-home';

const KIND_ICONS: Record<string, LucideIcon> = {
  part: CATEGORY_ICON_COMPONENTS.cog,
  machine: Factory,
  machine_rental: CalendarClock,
};

function tileIcon(tile: HomeTile): LucideIcon {
  if (tile.type === 'kind') return KIND_ICONS[tile.kind] ?? Package;
  return (tile.icon && CATEGORY_ICON_COMPONENTS[tile.icon]) || Package;
}

/**
 * Home (F4 + F5 spec §8.3; mockup "Home"): location chip (opens the location sheet) · search bar (the Search tab,
 * focused) · tiles (Spare parts, Machinery, For rent, then the root categories, R15) · Top items near you (grid, See all)
 * · Machines for rent nearby · Recently viewed (hidden when empty). The first focus asks for the location permission
 * (`refreshOnFocus`, §8.2). The bell with the unread count (F6 + F7 §11.6, signed in only; live through
 * `notification:new`) opens Notifications. No side-match strip until F8.
 */
export default function HomeScreen({ navigation }: TabScreenProps<'Home'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const tabInset = useTabBarInset();
  const origin = useDiscoveryOrigin();
  const { refreshOnFocus, reportEcho } = origin;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [recentIds, setRecentIds] = useState<string[]>([]);

  const member = useMember();
  const badges = useBadges();
  // F8 §13.4: the buyer's newest-response strip and the seller's "Buyers looking" strip (members only).
  const requestHome = usePartRequestHome();
  const unreadText = badgeText(badges?.notificationsUnread);
  const home = useHome(origin.origin, origin.radiusKm, origin.ready);
  const recent = useCards(recentIds, origin.origin, origin.ready);

  useFocusEffect(
    useCallback(() => {
      void refreshOnFocus();
      void loadRecentlyViewed().then((ids) => setRecentIds((prev) => (prev.join() === ids.join() ? prev : ids)));
    }, [refreshOnFocus]),
  );

  // The server's echo labels the chip; `out_of_range` switches the next request to the fallback (§6.3).
  useEffect(() => {
    if (home.data) reportEcho(home.data.origin);
  }, [home.data, reportEcho]);

  // One cast for a target chosen at run time; HomeTarget's params mirror RootStackParamList's SearchResults and
  // the Search tab's params (lib/home-view.ts).
  const go = (target: HomeTarget) => {
    (navigation.navigate as unknown as (name: string, params?: object) => void)(target.screen, target.params);
  };

  const openTile = (tile: HomeTile) => {
    track(HOME_EVENTS.tileOpened, { tile: tile.type });
    go(tileTarget(tile));
  };

  const s = useMemo(() => StyleSheet.create({
    content: { flexGrow: 1, gap: spacing.lg },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.md },
    location: { flex: 1 },
    bell: { position: 'relative' },
    badge: {
      position: 'absolute', top: -2, right: -2, minWidth: 20, height: 20, paddingHorizontal: spacing.xs, borderRadius: radius.full,
      backgroundColor: colors.sun, alignItems: 'center', justifyContent: 'center',
    },
    badgeText: { ...type('badge'), color: colors.onSun },
    // A searchbar is a card on the page: hairline, no shadow (spec §6).
    search: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.lg,
      paddingHorizontal: spacing.lg, height: 50, borderRadius: radius.full, backgroundColor: colors.surface,
      borderWidth: 1, borderColor: colors.hairline,
    },
    searchText: { flex: 1, ...type('body'), color: colors.textMuted },
    tiles: { paddingHorizontal: spacing.lg, gap: spacing.sm },
    tile: {
      width: 96, alignItems: 'center', gap: spacing.xs + 2, paddingTop: spacing.sm, paddingBottom: spacing.md,
      paddingHorizontal: spacing.xs, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1,
      borderColor: colors.hairline,
    },
    tileArt: {
      width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.photo, alignItems: 'center', justifyContent: 'center',
    },
    tileText: { ...type('label'), color: colors.text, textAlign: 'center' },
    section: { gap: spacing.md },
    sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, gap: spacing.md },
    sectionTitle: { ...type('section'), color: colors.text, paddingHorizontal: spacing.lg },
    sectionTitleInline: { ...type('section'), color: colors.text, flexShrink: 1 },
    seeAll: { minHeight: 44, justifyContent: 'center' },
    seeAllText: { ...type('bodyStrong'), color: colors.primaryInk },
    grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: spacing.sm, paddingHorizontal: spacing.md },
    gridItem: { width: '49%' },
    minis: { paddingHorizontal: spacing.lg, gap: spacing.sm },
    rows: { paddingHorizontal: spacing.lg, gap: spacing.md },
    skeletonGrid: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md },
    skeletonCard: { flex: 1, height: 220, borderRadius: radius.lg },
    empty: { minHeight: 280 },
    widen: { alignSelf: 'center' },
  }), [colors, type]);

  const view = home.data;
  const tiles = homeTiles(view);
  const empty = view ? homeEmpty(view) : null;
  const recentCards = recent.data ?? [];
  const locating = origin.mode === 'auto' && origin.permission === 'granted' && !origin.echo;

  let body: React.ReactNode;
  if (!view && (home.isLoading || !origin.ready)) {
    body = (
      <View style={s.skeletonGrid}>
        <Skeleton style={s.skeletonCard} />
        <Skeleton style={s.skeletonCard} />
      </View>
    );
  } else if (!view) {
    body = (
      <EmptyState
        icon={TriangleAlert}
        title={t('home.loadErrorTitle')}
        subtitle={t('home.loadErrorBody')}
        ctaTitle={t('common.retry')}
        ctaPhLabel="Home-retry"
        onCtaPress={() => void home.refetch()}
        style={s.empty}
      />
    );
  } else if (empty?.kind === 'radius') {
    const widenTo = empty.widenTo;
    body = (
      <View style={s.section}>
        <EmptyState
          icon={Package}
          title={t('home.emptyRadiusTitle', { km: empty.km })}
          subtitle={t('home.emptyRadiusSubtitle')}
          style={s.empty}
        />
        <Button
          title={widenTo === null ? t('home.widenAllIndia') : t('home.widenTo', { km: widenTo })}
          variant="outline"
          size="md"
          phLabel="Home-widen"
          onPress={() => origin.chooseRadius(widenTo)}
          style={s.widen}
        />
      </View>
    );
  } else if (empty?.kind === 'none') {
    body = (
      <EmptyState
        icon={Package}
        title={t('home.emptyTitle')}
        subtitle={t('home.emptySubtitle')}
        ctaTitle={t('home.sellCta')}
        ctaPhLabel="Sell-a-part"
        onCtaPress={() => navigation.navigate('Main', { screen: 'Post' })}
        style={s.empty}
      />
    );
  } else {
    body = (
      <>
        {view.topNearYou.length > 0 ? (
          <View style={s.section}>
            <View style={s.sectionHead}>
              <Text style={s.sectionTitleInline} numberOfLines={1}>{t('home.topTitle')}</Text>
              <Pressable style={s.seeAll} onPress={() => go(seeAllTarget())} testID="Home-see-all" accessibilityRole="button" hitSlop={8}>
                <Text style={s.seeAllText}>{t('home.seeAll')}</Text>
              </Pressable>
            </View>
            <View style={s.grid}>
              {view.topNearYou.map((card) => (
                <GridCard
                  key={card.id}
                  card={card}
                  onPress={() => navigation.navigate('Listing', { listingId: card.id })}
                  testID={`Home-top-${card.ref}`}
                  style={s.gridItem}
                />
              ))}
            </View>
          </View>
        ) : null}
        {view.rentNearby.length > 0 ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>{t('home.rentTitle')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.minis}>
              {view.rentNearby.map((card) => (
                <MiniCard
                  key={card.id}
                  card={card}
                  onPress={() => navigation.navigate('Listing', { listingId: card.id })}
                  testID={`Home-rent-${card.ref}`}
                />
              ))}
            </ScrollView>
          </View>
        ) : null}
      </>
    );
  }

  return (
    <ScreenWrapper edges={['top']}>
      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: tabInset }]}
        refreshControl={(
          <RefreshControl
            refreshing={home.isRefetching}
            onRefresh={() => {
              void home.refetch();
              if (recentIds.length > 0) void recent.refetch();
              if (member) void requestHome.refetch();
            }}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        )}
      >
        <View style={s.header}>
          <LocationChip
            label={view?.origin.label ?? origin.echo?.label ?? null}
            allIndia={!!view && view.origin.label === null}
            radiusKm={origin.radiusKm}
            locating={locating}
            onPress={() => setSheetOpen(true)}
            style={s.location}
          />
          {member ? (
            <View style={s.bell}>
              <IconButton
                icon={BellRing}
                onPress={() => navigation.navigate('Notifications')}
                accessibilityLabel={unreadText
                  ? t('notifications.bellUnread', { count: badges?.notificationsUnread ?? 0 })
                  : t('notifications.bell')}
                testID="Open-notifications"
              />
              {unreadText ? (
                <View style={s.badge} pointerEvents="none"><Text style={s.badgeText}>{unreadText}</Text></View>
              ) : null}
            </View>
          ) : null}
          <IconButton
            icon={User}
            onPress={() => navigation.navigate('Profile')}
            accessibilityLabel={t('profile.title')}
            testID="Open-profile"
          />
        </View>

        <Pressable style={s.search} onPress={() => go(searchBarTarget())} testID="Open-search" accessibilityRole="button">
          <Search size={20} color={colors.textMuted} />
          <Text style={s.searchText} numberOfLines={1}>{t('home.searchPlaceholder')}</Text>
        </Pressable>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tiles}>
          {tiles.map((tile) => {
            const Icon = tileIcon(tile);
            const name = tile.type === 'kind' ? t(`home.tiles.${tile.kind}`) : tile.name;
            const count = tile.type === 'kind' ? tile.count : null;
            return (
              <Pressable
                key={tile.type === 'kind' ? tile.kind : tile.id}
                style={s.tile}
                onPress={() => openTile(tile)}
                testID={tile.type === 'kind' ? `Home-tile-${tile.kind}` : `Home-tile-category-${tile.id}`}
                accessibilityRole="button"
                accessibilityLabel={count !== null ? t('home.tiles.a11y', { name, count }) : name}
              >
                <View style={s.tileArt}><Icon size={26} color={colors.textSecondary} /></View>
                <Text style={s.tileText} numberOfLines={2}>{name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {requestHome.data?.buyer ? <HomeBuyerStrip data={requestHome.data.buyer} /> : null}
        {requestHome.data?.seller ? <HomeSellerStrip data={requestHome.data.seller} /> : null}

        {body}

        {recentCards.length > 0 ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>{t('home.recentTitle')}</Text>
            <View style={s.rows}>
              {recentCards.map((card) => (
                <ListingCardItem
                  key={card.id}
                  card={card}
                  onPress={() => navigation.navigate('Listing', { listingId: card.id })}
                  testID={`Home-recent-${card.ref}`}
                />
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <LocationSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </ScreenWrapper>
  );
}
