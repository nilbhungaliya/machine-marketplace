import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { PartRequestSellerView } from '@mpm/shared-types';
import Header from '@/components/Header';

export interface RequirementSellerProps {
  request: PartRequestSellerView;
  /** The tab a notification asked for (`replies` / `matches`); the buyer view only. */
  tab?: 'replies' | 'matches';
}

// F8-STUB(B3): placeholder body rendered by `requirement.tsx` for role `seller`; lane B3 builds it (F8 spec §13).
export default function RequirementSeller(_props: RequirementSellerProps) {
  const { t } = useTranslation();
  return (
    <View testID="RequirementSeller">
      <Header title={t('common.comingSoon')} />
    </View>
  );
}
