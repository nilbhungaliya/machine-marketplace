import React from 'react';
import { useTranslation } from 'react-i18next';
import type { RentalBookingView } from '@mpm/shared-types';
import BottomSheet from '@/components/BottomSheet';
import Notice from '@/components/Notice';

export interface ReturnSheetProps {
  /** The owner's view of an `on_rent` booking (spec §6.4). */
  view: RentalBookingView;
  visible: boolean;
  onClose: () => void;
  /** The fresh view after `POST /rental-bookings/:id/returned`. */
  onDone: (view: RentalBookingView) => void;
}

// M14-STUB(B3): placeholder with the final props (plan C0-5); lane B3 builds it. Closing hour meter, final amount (prefilled with the agreed total) with a reason when it differs, note, damage note, up to 3 photos.
export default function ReturnSheet({ visible, onClose }: ReturnSheetProps) {
  const { t } = useTranslation();
  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('rentalsOwner.return.title')} testID="ReturnBooking-backdrop">
      <Notice tone="info" text={t('common.comingSoon')} />
    </BottomSheet>
  );
}
