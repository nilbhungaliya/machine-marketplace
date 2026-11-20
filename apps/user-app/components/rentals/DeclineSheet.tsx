import React from 'react';
import { useTranslation } from 'react-i18next';
import type { RentalBookingView } from '@mpm/shared-types';
import BottomSheet from '@/components/BottomSheet';
import Notice from '@/components/Notice';

export interface DeclineSheetProps {
  bookingId: string;
  /** The open version being answered (`409 RENTAL_BOOKING_STALE` when another one came in). */
  versionSeq: number;
  visible: boolean;
  onClose: () => void;
  /** The fresh view after `POST /rental-bookings/:id/decline`. */
  onDone: (view: RentalBookingView) => void;
}

// M14-STUB(B3): placeholder with the final props (plan C0-5); lane B3 builds it. A reason from RENTAL_DECLINE_REASONS (owner on `requested`, renter on `countered`).
export default function DeclineSheet({ visible, onClose }: DeclineSheetProps) {
  const { t } = useTranslation();
  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('rentalsOwner.decline.title')} testID="DeclineBooking-backdrop">
      <Notice tone="info" text={t('common.comingSoon')} />
    </BottomSheet>
  );
}
