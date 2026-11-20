import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import type { RootStackScreenProps } from '@/navigation/types';

// F8-STUB(B2): placeholder registered by C0-5; lane B2 replaces it (F8 spec §13).
export default function PostRequirementScreen(_props: RootStackScreenProps<'PostRequirement'>) {
  const { t } = useTranslation();
  return (
    <ScreenWrapper>
      <View testID="PostRequirement-screen">
        <Header title={t('common.comingSoon')} />
      </View>
    </ScreenWrapper>
  );
}
