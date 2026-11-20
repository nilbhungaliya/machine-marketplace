import React from 'react';
import { useTranslation } from 'react-i18next';
import type { RentalBookingView } from '@mpm/shared-types';
import BottomSheet from '@/components/BottomSheet';
import Notice from '@/components/Notice';

export interface ProposeChangeSheetProps {
  /** The owner's view of a `requested` booking: its open version prefills the form. */
  view: RentalBookingView;
  visible: boolean;
  onClose: () => void;
  /** The fresh view after `POST /rental-bookings/:id/change` (status `countered`). */
  onSent: (view: RentalBookingView) => void;
}

// M14-STUB(B3): placeholder with the final props (plan C0-5); lane B3 builds it. The owner's change: dates, period, count, machines, options, total with "% vs estimate", message (spec §6.3).
export default function ProposeChangeSheet({ visible, onClose }: ProposeChangeSheetProps) {
  const { t } = useTranslation();
  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('rentalsOwner.change.title')} testID="ProposeChange-backdrop">
      <Notice tone="info" text={t('common.comingSoon')} />
    </BottomSheet>
  );
}
