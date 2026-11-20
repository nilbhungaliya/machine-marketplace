import React from 'react';
import { useTranslation } from 'react-i18next';
import BottomSheet from '@/components/BottomSheet';
import Notice from '@/components/Notice';

/** A picked start date, and the end date in range mode (IST calendar dates `YYYY-MM-DD`). */
export interface DateRangeValue {
  start: string;
  end?: string;
}

export interface DateRangeSheetProps {
  visible: boolean;
  /** `single`: Request booking's start date; `range`: search results' "Free on" dates. */
  mode: 'single' | 'range';
  value: DateRangeValue | null;
  /** Dates drawn greyed and not pickable (full days from `GET /listings/:id/availability`). */
  busy?: Set<string>;
  onClose: () => void;
  onPick: (v: DateRangeValue) => void;
}

// M14-STUB(B2): placeholder with the final props (plan C0-5); lane B2 builds the calendar sheet (B3's change sheet
// imports it too).
export default function DateRangeSheet({ visible, mode, onClose }: DateRangeSheetProps) {
  const { t } = useTranslation();
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t(mode === 'single' ? 'rentals.dates.pickStart' : 'rentals.dates.pickRange')}
      testID="DateRange-backdrop"
    >
      <Notice tone="info" text={t('common.comingSoon')} />
    </BottomSheet>
  );
}
