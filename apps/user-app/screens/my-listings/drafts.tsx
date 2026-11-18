import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import Toast from 'react-native-toast-message';
import type { MyListingCard } from '@mpm/shared-types';
import Button from '@/components/Button';
import EmptyState from '@/components/EmptyState';
import Header from '@/components/Header';
import ListingCard from '@/components/ListingCard';
import ScreenWrapper from '@/components/ScreenWrapper';
import Skeleton from '@/components/Skeleton';
import { useConfirm } from '@/components/ConfirmSheet';
import { catalogKeys, listingKeys } from '@/hooks/use-listing';
import { useDrafts } from '@/hooks/use-my-listings';
import { useDeleteDraft } from '@/hooks/use-sell-draft';
import { ClipboardList, TriangleAlert } from '@/lib/icons';
import { fetchCategoryTree, fetchOwnerListing } from '@/lib/listing-api';
import { listingErrorMessage } from '@/lib/listing-errors';
import { updatedAgo } from '@/lib/listing-format';
import { queryClient } from '@/lib/queryClient';
import { hasSidesFor } from '@/lib/sell-category';
import { firstIncompleteStep } from '@/lib/sell-wizard';
import { radius, spacing } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';

/**
 * Drafts (F2 spec §5.3, §10, R27): the business's unpublished listings, newest first. Continue opens the first step
 * with something missing (`firstIncompleteStep`, or Preview when nothing is); Delete removes the draft and its photos
 * for good, after a confirm. Reached from the Post tab's "Drafts (n)".
 */
export default function MyDraftsScreen({ navigation }: RootStackScreenProps<'MyDrafts'>) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const drafts = useDrafts();
  const remove = useDeleteDraft();
  const [opening, setOpening] = useState<string | null>(null);

  useFocusEffect(React.useCallback(() => { void drafts.refetch(); }, [])); // eslint-disable-line react-hooks/exhaustive-deps

  const s = useMemo(() => StyleSheet.create({
    list: { padding: spacing.lg, gap: spacing.md },
    actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
    action: { flex: 1 },
    loading: { padding: spacing.lg, gap: spacing.md },
  }), []);

  const open = async (d: MyListingCard) => {
    setOpening(d.id);
    try {
      const [listing, tree] = await Promise.all([
        queryClient.fetchQuery({ queryKey: listingKeys.owner(d.id), queryFn: () => fetchOwnerListing(d.id), staleTime: 0 }),
        queryClient.fetchQuery({ queryKey: catalogKeys.tree, queryFn: fetchCategoryTree, staleTime: 30 * 60 * 1000 }),
      ]);
      navigation.navigate('Sell', { listingId: d.id, step: firstIncompleteStep(listing, hasSidesFor(tree, listing)), mode: 'create' });
    } catch (err) {
      Toast.show({ type: 'error', text1: listingErrorMessage(err) });
    } finally {
      setOpening(null);
    }
  };

  const del = async (d: MyListingCard) => {
    const ok = await confirm({
      title: t('sell.drafts.deleteTitle'),
      message: t('sell.drafts.deleteMessage'),
      confirmLabel: t('sell.drafts.delete'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(d.id);
      Toast.show({ type: 'success', text1: t('sell.drafts.deleted') });
    } catch (err) {
      Toast.show({ type: 'error', text1: listingErrorMessage(err) });
    }
  };

  const items = drafts.data?.items ?? [];
  return (
    <ScreenWrapper>
      <Header title={t('sell.drafts.title')} />
      {drafts.isLoading ? (
        <View style={s.loading}>
          {[0, 1, 2].map((i) => <Skeleton key={i} style={{ height: 120, borderRadius: radius.xl }} />)}
        </View>
      ) : drafts.isError ? (
        <EmptyState
          icon={TriangleAlert}
          title={t('sell.loadError')}
          subtitle={listingErrorMessage(drafts.error)}
          ctaTitle={t('common.retry')}
          ctaPhLabel="Drafts-retry"
          onCtaPress={() => void drafts.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState icon={ClipboardList} title={t('sell.drafts.emptyTitle')} subtitle={t('sell.drafts.emptySubtitle')} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(d) => d.id}
          contentContainerStyle={s.list}
          renderItem={({ item: d }) => (
            <ListingCard
              title={d.title.trim() || t('sell.drafts.untitled')}
              thumbUrl={d.thumbUrl}
              tag={t(`listing.kind.${d.kind}`)}
              subtitle={updatedAgo(d.updatedAt)}
              testID="Draft-card"
            >
              <View style={s.actions}>
                <Button
                  title={t('common.continue')}
                  phLabel="Draft-continue"
                  size="sm"
                  loading={opening === d.id}
                  disabled={opening !== null}
                  onPress={() => void open(d)}
                  style={s.action}
                />
                <Button
                  title={t('sell.drafts.delete')}
                  phLabel="Draft-delete"
                  size="sm"
                  variant="outline"
                  disabled={remove.isPending}
                  onPress={() => void del(d)}
                  style={s.action}
                />
              </View>
            </ListingCard>
          )}
        />
      )}
    </ScreenWrapper>
  );
}
