import React from 'react';
import { useTranslation } from 'react-i18next';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import { useBusiness } from '@/hooks/use-business';
import { useMember } from '@/hooks/use-badges';
import { useRequireSignIn } from '@/hooks/use-require-sign-in';
import { qk } from '@/lib/query-keys';
import { fetchSellerReviews } from '@/lib/reviews-api';
import type { RootStackScreenProps } from '@/navigation/types';
import ReviewsList from './reviews-list';

/**
 * Seller reviews (F6 + F7 spec §10.4; no mockup, in the v2 kit): public, guests too. The score (or "New seller"), facet
 * bars and the published buyer reviews with the seller's replies. Report asks a guest to sign in; on my own business
 * Reply replaces Report.
 */
export default function SellerReviewsScreen({ route }: RootStackScreenProps<'SellerReviews'>) {
  const { businessId } = route.params;
  const { t } = useTranslation();
  const member = useMember();
  const business = useBusiness(member);
  const { requireSignIn } = useRequireSignIn();
  const mine = !!business.data && business.data.id === businessId;

  return (
    <ScreenWrapper>
      <Header title={t('reviews.sellerTitle')} />
      <ReviewsList
        queryKey={qk.sellerReviews(businessId)}
        fetchPage={(cursor) => fetchSellerReviews(businessId, cursor)}
        canReply={mine}
        onReportPress={() => requireSignIn({ reason: 'report' })}
      />
    </ScreenWrapper>
  );
}
