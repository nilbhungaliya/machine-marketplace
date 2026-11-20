import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import type { RootStackScreenProps } from '@/navigation/types';

// M14-STUB(B2): placeholder registered by C0-5; lane B2 replaces it (M14 spec §14.1 "Request booking"). Params:
// `listingId`, `prefill?`, and `change?` (answers a booking's open version through `POST /rental-bookings/:id/change`).
export default function RequestBookingScreen(_props: RootStackScreenProps<'RequestBooking'>) {
  const { t } = useTranslation();
  return (
    <ScreenWrapper>
      <View testID="RequestBooking-screen">
        <Header title={t('rentals.request.title')} />
      </View>
    </ScreenWrapper>
  );
}
