import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import type { RootStackScreenProps } from '@/navigation/types';

// M14-STUB(B3): placeholder registered by C0-5; lane B3 replaces it (M14 spec §7.3, §14.1 "Owner calendar").
export default function RentalCalendarScreen(_props: RootStackScreenProps<'RentalCalendar'>) {
  const { t } = useTranslation();
  return (
    <ScreenWrapper>
      <View testID="RentalCalendar-screen">
        <Header title={t('rentalsOwner.calendar.title')} />
      </View>
    </ScreenWrapper>
  );
}
