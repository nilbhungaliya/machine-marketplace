import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import type { RootStackScreenProps } from '@/navigation/types';

// F6F7-STUB(L6): placeholder registered by C0-5 (F6 + F7 plan); L6 replaces it with the real screen.
export default function ThreadScreen(_props: RootStackScreenProps<'Thread'>) {
  const { t } = useTranslation();
  return (
    <ScreenWrapper>
      <View testID="Thread-screen">
        <Header title={t('common.comingSoon')} />
      </View>
    </ScreenWrapper>
  );
}
