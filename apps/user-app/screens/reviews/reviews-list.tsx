import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { PublicReview, SellerReviewsPage } from '@mpm/shared-types';
import Button from '@/components/Button';
import EmptyState from '@/components/EmptyState';
import Skeleton from '@/components/Skeleton';
import { f6ErrorMessage } from '@/lib/f6-errors';
import { Star, TriangleAlert } from '@/lib/icons';
import { radius, spacing } from '@/lib/theme';
import { ReplySheet, ReportReviewSheet, ReviewItem, ScoreCard } from './review-parts';

interface ReviewsListProps {
  queryKey: readonly unknown[];
  fetchPage: (cursor: string | null) => Promise<SellerReviewsPage>;
  /** The reviewed seller is the reader's business: Reply on reviews without one (once, §10.5). */
  canReply: boolean;
  /** Report a review (§10.6), the reviewed seller too; returns false when the reader must sign in first. */
  onReportPress?: () => boolean;
  scoreTitle?: string;
}

/**
 * A seller's reviews (F6 + F7 spec §10.4): the score card (stars, count, facet bars, or "New seller"), then the
 * published reviews newest first with replies, 20 a page. Used by Seller reviews (public) and Profile › Reviews.
 */
export default function ReviewsList({ queryKey, fetchPage, canReply, onReportPress, scoreTitle }: ReviewsListProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [replying, setReplying] = useState<PublicReview | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const pages = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last: SellerReviewsPage) => last.nextCursor,
    staleTime: 30_000,
  });

  const s = useMemo(() => StyleSheet.create({
    list: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
    skeleton: { height: 140, borderRadius: radius.xl },
    head: { marginBottom: spacing.xs },
  }), []);

  const first = pages.data?.pages[0];
  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];

  let empty: React.ReactElement | null;
  if (pages.isLoading) {
    empty = <View style={{ gap: spacing.md }}>{[0, 1].map((i) => <Skeleton key={i} style={s.skeleton} />)}</View>;
  } else if (pages.isError) {
    empty = (
      <EmptyState
        icon={TriangleAlert}
        title={t('reviews.loadError')}
        subtitle={f6ErrorMessage(pages.error)}
        ctaTitle={t('common.retry')}
        ctaPhLabel="Reviews-retry"
        onCtaPress={() => void pages.refetch()}
      />
    );
  } else {
    empty = <EmptyState icon={Star} title={t('reviews.emptyTitle')} subtitle={t('reviews.emptyBody')} />;
  }

  return (
    <>
      <FlatList
        data={items}
        keyExtractor={(r) => r.id}
        contentContainerStyle={s.list}
        ListHeaderComponent={first ? <ScoreCard page={first} title={scoreTitle} style={s.head} /> : null}
        ListEmptyComponent={empty}
        renderItem={({ item }) => (
          <ReviewItem
            review={item}
            onReply={canReply && !item.reply && !item.hidden ? () => setReplying(item) : undefined}
            onReport={onReportPress ? () => { if (onReportPress()) setReporting(item.id); } : undefined}
          />
        )}
        ListFooterComponent={pages.hasNextPage ? (
          <Button
            title={t('reviews.loadMore')}
            onPress={() => void pages.fetchNextPage()}
            loading={pages.isFetchingNextPage}
            variant="outline"
            phLabel="Reviews-more"
          />
        ) : null}
        refreshing={pages.isRefetching && !pages.isFetchingNextPage}
        onRefresh={() => void pages.refetch()}
      />
      <ReplySheet
        review={replying}
        onClose={() => setReplying(null)}
        onDone={() => {
          setReplying(null);
          void qc.invalidateQueries({ queryKey: [...queryKey] });
        }}
      />
      <ReportReviewSheet reviewId={reporting} onClose={() => setReporting(null)} />
    </>
  );
}
