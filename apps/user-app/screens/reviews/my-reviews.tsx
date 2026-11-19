import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import type { RootStackScreenProps } from '@/navigation/types';

// F6F7-STUB(L8): placeholder registered by C0-5 (F6 + F7 plan); L8 replaces it with the real screen.
export default function MyReviewsScreen(_props: RootStackScreenProps<'MyReviews'>) {
  const { t } = useTranslation();
  return (
    <ScreenWrapper>
      <View testID="My-reviews-screen">
        <Header title={t('common.comingSoon')} />
      </View>
    </ScreenWrapper>
  );
}
