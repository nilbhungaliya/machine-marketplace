import React from 'react';
import { useTranslation } from 'react-i18next';
import type { RentalBookingView } from '@mpm/shared-types';
import BottomSheet from '@/components/BottomSheet';
import Notice from '@/components/Notice';

export interface OnSiteSheetProps {
  /** A `confirmed` booking, either side, from `startDate − 1` (spec §6.4). */
  view: RentalBookingView;
  visible: boolean;
  onClose: () => void;
  /** The fresh view after `POST /rental-bookings/:id/on-site`. */
  onDone: (view: RentalBookingView) => void;
}

// M14-STUB(B3): placeholder with the final props (plan C0-5); lane B3 builds it. Opening hour meter (mono) and up to 3 photos.
export default function OnSiteSheet({ visible, onClose }: OnSiteSheetProps) {
  const { t } = useTranslation();
  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('rentalsOwner.onSite.title')} testID="OnSite-backdrop">
      <Notice tone="info" text={t('common.comingSoon')} />
    </BottomSheet>
  );
}
