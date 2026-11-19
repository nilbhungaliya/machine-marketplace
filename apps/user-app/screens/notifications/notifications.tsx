import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import type { RootStackScreenProps } from '@/navigation/types';

// F6F7-STUB(L8): placeholder registered by C0-5 (F6 + F7 plan); L8 replaces it with the real screen.
export default function NotificationsScreen(_props: RootStackScreenProps<'Notifications'>) {
  const { t } = useTranslation();
  return (
    <ScreenWrapper>
      <View testID="Notifications-screen">
        <Header title={t('common.comingSoon')} />
      </View>
    </ScreenWrapper>
  );
}
