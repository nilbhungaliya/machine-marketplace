import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import type { RootStackScreenProps } from '@/navigation/types';

// M14-STUB(B2): placeholder registered by C0-5; lane B2 replaces it (M14 spec §14.1 "Booking record").
export default function BookingRecordScreen(_props: RootStackScreenProps<'BookingRecord'>) {
  const { t } = useTranslation();
  return (
    <ScreenWrapper>
      <View testID="BookingRecord-screen">
        <Header title={t('rentals.record.title')} />
      </View>
    </ScreenWrapper>
  );
}
