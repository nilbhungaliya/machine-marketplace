import React from 'react';
import { useTranslation } from 'react-i18next';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import { qk } from '@/lib/query-keys';
import { fetchMyReviews } from '@/lib/reviews-api';
import type { RootStackScreenProps } from '@/navigation/types';
import ReviewsList from './reviews-list';

/**
 * Profile › Reviews (F6 + F7 spec §10.4, §10.5): my seller score and the reviews my business received, each with Reply
 * (once, public, ≤ 300) until it has one. A review our team hid shows "Hidden by our team".
 */
export default function MyReviewsScreen(_props: RootStackScreenProps<'MyReviews'>) {
  const { t } = useTranslation();
  return (
    <ScreenWrapper>
      <Header title={t('reviews.title')} />
      <ReviewsList
        queryKey={qk.myReviews()}
        fetchPage={fetchMyReviews}
        canReply
        onReportPress={() => true}
        scoreTitle={t('reviews.myScore')}
      />
    </ScreenWrapper>
  );
}
