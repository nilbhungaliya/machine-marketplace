import React, { useEffect, useMemo, useRef } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import type { OtherSideCard } from '@mpm/shared-types';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import SideToken from '@/components/SideToken';
import Skeleton from '@/components/Skeleton';
import { useListing, useOtherSide } from '@/hooks/use-listing';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { LISTING_EVENTS } from '@/lib/analytics-events';
import { ArrowLeftRight, Package, TriangleAlert } from '@/lib/icons';
import { hasOtherSide } from '@/lib/listing-page';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';
import ListingCardItem from './listing-card-item';

/**
 * Other side (F2 spec §9.2, mockup "Complementary side"): the pairing header (this side's photo + the needed side as a
 * SideToken `need`) and the matches, ranked by the API (part number, then name and fit, then "possibly"); tier-3 cards
 * carry the "Possibly the other side" tag. From the seller's own listing (`from: 'mine'`) the line reads "You have the
 * left side. These sellers have the right one." Tracks `listing_other_side_opened { from, count }`.
 */
export default function OtherSideScreen({ navigation, route }: RootStackScreenProps<'OtherSide'>) {
  const { listingId, from } = route.params;
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const listing = useListing(listingId);
  const l = listing.data;
  const sided = !!l && hasOtherSide(l);
  const matches = useOtherSide(listingId, sided);
  const want = l?.side === 'left' ? 'right' : 'left';

  const tracked = useRef(false);
  useEffect(() => {
    if (tracked.current || !matches.data) return;
    tracked.current = true;
    track(LISTING_EVENTS.otherSideOpened, { from, count: matches.data.items.length });
  }, [matches.data, from]);

  const s = useMemo(() => StyleSheet.create({
    list: { padding: spacing.lg, gap: spacing.md },
    pairing: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    thumb: {
      width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.photo, overflow: 'hidden',
      alignItems: 'center', justifyContent: 'center',
    },
    image: { width: '100%', height: '100%' },
    plus: { ...type('title'), color: colors.textMuted },
    pairingText: { ...type('body'), color: colors.text, flex: 1 },
    title: { ...type('caption'), color: colors.textSecondary },
    head: { gap: spacing.sm, marginBottom: spacing.xs },
    skeleton: { height: 112, borderRadius: radius.lg },
  }), [colors, type]);

  const header = l && sided ? (
    <View style={s.head}>
      <Card>
        <View style={s.pairing}>
          <View style={s.thumb}>
            {l.thumbUrl ? (
              <Image source={{ uri: l.thumbUrl }} style={s.image} contentFit="cover" accessibilityIgnoresInvertColors />
            ) : (
              <Package size={28} color={colors.textMuted} />
            )}
          </View>
          <Text style={s.plus}>+</Text>
          <SideToken kind={want === 'right' ? 'want-right' : 'want-left'} size="xl" />
          <Text style={s.pairingText}>{from === 'mine' ? t(`listing.otherSide.fromMine_${want}`) : l.title}</Text>
        </View>
      </Card>
      {from === 'mine' ? <Text style={s.title} numberOfLines={2}>{l.title}</Text> : null}
    </View>
  ) : null;

  let empty: React.ReactElement;
  if (listing.isLoading || (sided && matches.isLoading)) {
    empty = <View style={{ gap: spacing.md }}>{[0, 1, 2].map((i) => <Skeleton key={i} style={s.skeleton} />)}</View>;
  } else if (listing.isError || matches.isError) {
    empty = (
      <EmptyState
        icon={TriangleAlert}
        title={t('listing.page.loadErrorTitle')}
        subtitle={t('listing.page.loadErrorBody')}
        ctaTitle={t('common.retry')}
        ctaPhLabel="Other-side-retry"
        onCtaPress={() => { void listing.refetch(); void matches.refetch(); }}
      />
    );
  } else if (!sided) {
    empty = <EmptyState icon={ArrowLeftRight} title={t('listing.otherSide.title')} subtitle={t('listing.otherSide.noSide')} />;
  } else {
    empty = <EmptyState icon={ArrowLeftRight} title={t(`listing.otherSide.none_${want}`)} subtitle={t('listing.otherSide.emptyBody')} />;
  }

  return (
    <ScreenWrapper>
      <Header title={sided ? t(`listing.otherSide.screenTitle_${want}`) : t('listing.otherSide.title')} />
      <FlatList<OtherSideCard>
        data={sided ? matches.data?.items ?? [] : []}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => (
          <ListingCardItem
            card={item}
            tag={item.possible ? t('listing.otherSide.possibleTag') : undefined}
            onPress={() => navigation.push('Listing', { listingId: item.id })}
            testID={`Other-side-${item.ref}`}
          />
        )}
        contentContainerStyle={s.list}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
      />
    </ScreenWrapper>
  );
}
