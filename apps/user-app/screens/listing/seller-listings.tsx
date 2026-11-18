import React, { useMemo } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ListingCard, ListingDetail } from '@mpm/shared-types';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import EmptyState from '@/components/EmptyState';
import Skeleton from '@/components/Skeleton';
import { listingKeys, useSellerListings } from '@/hooks/use-listing';
import { Inbox, TriangleAlert } from '@/lib/icons';
import { radius, spacing } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';
import ListingCardItem from './listing-card-item';

/** The API's maximum for one seller's listings (`GET /businesses/:id/listings?limit=`, ≤ 50). */
const SELLER_LIMIT = 50;

/**
 * A seller's public listings (F2 spec §8.1 item 8, "View all listings"), newest first. The title is the seller's
 * display name when a listing page of theirs is in the cache (it opens from one), else "Seller's listings".
 */
export default function SellerListingsScreen({ navigation, route }: RootStackScreenProps<'SellerListings'>) {
  const { businessId } = route.params;
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listings = useSellerListings(businessId, { limit: SELLER_LIMIT });

  const name = useMemo(() => {
    const cached = qc.getQueriesData<ListingDetail>({ queryKey: [...listingKeys.all, 'detail'] });
    return cached.map(([, d]) => d).find((d) => d?.seller.businessId === businessId)?.seller.displayName ?? null;
  }, [qc, businessId]);

  const s = useMemo(() => StyleSheet.create({
    list: { padding: spacing.lg, gap: spacing.md },
    skeleton: { height: 112, borderRadius: radius.lg },
  }), []);

  let empty: React.ReactElement;
  if (listings.isLoading) {
    empty = <View style={{ gap: spacing.md }}>{[0, 1, 2].map((i) => <Skeleton key={i} style={s.skeleton} />)}</View>;
  } else if (listings.isError) {
    empty = (
      <EmptyState
        icon={TriangleAlert}
        title={t('listing.page.loadErrorTitle')}
        subtitle={t('listing.page.loadErrorBody')}
        ctaTitle={t('common.retry')}
        ctaPhLabel="Seller-listings-retry"
        onCtaPress={() => void listings.refetch()}
      />
    );
  } else {
    empty = <EmptyState icon={Inbox} title={t('listing.seller.emptyTitle')} subtitle={t('listing.seller.emptyBody')} />;
  }

  return (
    <ScreenWrapper>
      <Header title={name ?? t('listing.seller.title')} />
      <FlatList<ListingCard>
        data={listings.data ?? []}
        keyExtractor={(l) => l.id}
        renderItem={({ item }) => (
          <ListingCardItem
            card={item}
            onPress={() => navigation.push('Listing', { listingId: item.id })}
            testID={`Seller-listing-${item.ref}`}
          />
        )}
        contentContainerStyle={s.list}
        ListEmptyComponent={empty}
        refreshing={listings.isRefetching}
        onRefresh={() => void listings.refetch()}
      />
    </ScreenWrapper>
  );
}
