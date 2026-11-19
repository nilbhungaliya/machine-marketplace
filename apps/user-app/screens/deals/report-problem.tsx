import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import type { RootStackScreenProps } from '@/navigation/types';

// F6F7-STUB(L7): placeholder registered by C0-5 (F6 + F7 plan); L7 replaces it with the real screen.
export default function ReportProblemScreen(_props: RootStackScreenProps<'ReportProblem'>) {
  const { t } = useTranslation();
  return (
    <ScreenWrapper>
      <View testID="Report-problem-screen">
        <Header title={t('common.comingSoon')} />
      </View>
    </ScreenWrapper>
  );
}
