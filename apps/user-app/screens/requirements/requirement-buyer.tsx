import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { PartRequestBuyerView } from '@mpm/shared-types';
import Header from '@/components/Header';

export interface RequirementBuyerProps {
  request: PartRequestBuyerView;
  /** The tab a notification asked for (`replies` / `matches`); the buyer view only. */
  tab?: 'replies' | 'matches';
}

// F8-STUB(B2): placeholder body rendered by `requirement.tsx` for role `buyer`; lane B2 builds it (F8 spec §13).
export default function RequirementBuyer(_props: RequirementBuyerProps) {
  const { t } = useTranslation();
  return (
    <View testID="RequirementBuyer">
      <Header title={t('common.comingSoon')} />
    </View>
  );
}
