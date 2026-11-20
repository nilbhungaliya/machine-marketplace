import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import EmptyState from '@/components/EmptyState';
import Skeleton from '@/components/Skeleton';
import { usePartRequest } from '@/hooks/use-part-request';
import { errorCode } from '@/lib/api-error';
import { ClipboardList, TriangleAlert } from '@/lib/icons';
import { radius, spacing } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';
import RequirementBuyer from './requirement-buyer';
import RequirementSeller from './requirement-seller';

/**
 * One part request (F8 spec §13.1): `GET /part-requests/:id` answers the buyer's view or an eligible seller's, and this
 * screen renders `RequirementBuyer` or `RequirementSeller` by its `role`. A request that is gone, or that this business
 * may not see, is a 404: "no longer open" (never a hint that it exists).
 */
export default function RequirementScreen({ route }: RootStackScreenProps<'Requirement'>) {
  const { t } = useTranslation();
  const { partRequestId, tab } = route.params;
  const query = usePartRequest(partRequestId);

  const s = useMemo(() => StyleSheet.create({
    loading: { padding: spacing.lg, gap: spacing.md },
    skeleton: { height: 96, borderRadius: radius.xl },
  }), []);

  const request = query.data;
  if (request?.role === 'buyer') return <ScreenWrapper><RequirementBuyer request={request} tab={tab} /></ScreenWrapper>;
  if (request?.role === 'seller') return <ScreenWrapper><RequirementSeller request={request} /></ScreenWrapper>;

  const gone = query.isError && errorCode(query.error) === 'PART_REQUEST_NOT_FOUND';
  return (
    <ScreenWrapper>
      <Header title={t('requirements.title')} />
      {query.isLoading ? (
        <View style={s.loading} testID="Requirement-loading">
          <Skeleton style={s.skeleton} />
          <Skeleton style={s.skeleton} />
          <Skeleton style={s.skeleton} />
        </View>
      ) : gone ? (
        <EmptyState icon={ClipboardList} title={t('requirements.goneTitle')} subtitle={t('requirements.goneBody')} />
      ) : (
        <EmptyState
          icon={TriangleAlert}
          title={t('requirements.loadErrorTitle')}
          subtitle={t('requirements.loadErrorBody')}
          ctaTitle={t('common.retry')}
          ctaPhLabel="Requirement-retry"
          onCtaPress={() => void query.refetch()}
        />
      )}
    </ScreenWrapper>
  );
}
