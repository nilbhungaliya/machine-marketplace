import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import type { RootStackScreenProps } from '@/navigation/types';

// F8-STUB(B2): placeholder registered by C0-5; lane B2 replaces it (F8 spec §13).
export default function RequirementPostedScreen(_props: RootStackScreenProps<'RequirementPosted'>) {
  const { t } = useTranslation();
  return (
    <ScreenWrapper>
      <View testID="RequirementPosted-screen">
        <Header title={t('common.comingSoon')} />
      </View>
    </ScreenWrapper>
  );
}
