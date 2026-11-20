import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import {
  RENTAL_CANCEL_REASONS_OWNER, RENTAL_CANCEL_REASONS_RENTER, RENTAL_LIMITS, type RentalBookingView, type RentalCancelReason,
} from '@mpm/shared-types';
import ActionSheet from '@/components/ActionSheet';
import Button from '@/components/Button';
import Input from '@/components/Input';
import { useBookingWrite } from '@/hooks/use-rental-booking';
import { track } from '@/lib/analytics';
import { RENTAL_EVENTS } from '@/lib/analytics-events';
import { errorCode } from '@/lib/api-error';
import { m14ErrorMessage } from '@/lib/m14-errors';
import { cancelBooking } from '@/lib/rentals-api';

interface CancelBookingSheetProps {
  view: RentalBookingView;
  visible: boolean;
  onClose: () => void;
}

/**
 * Cancel a confirmed booking (§6.5): either side alone, before the machine is on site; a reason from the reader's
 * side's list and an optional note (≤ 300). After on site there is no cancel (return, or report a problem).
 */
export default function CancelBookingSheet({ view, visible, onClose }: CancelBookingSheetProps) {
  const { t } = useTranslation();
  const write = useBookingWrite(view.id);
  const [reason, setReason] = useState<RentalCancelReason | null>(null);
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setReason(null);
    setNote('');
    setTried(false);
  }, [visible]);

  const reasons: readonly RentalCancelReason[] = view.side === 'owner' ? RENTAL_CANCEL_REASONS_OWNER : RENTAL_CANCEL_REASONS_RENTER;
  const trimmed = note.trim();
  const tooLong = trimmed.length > RENTAL_LIMITS.shortNoteMax;

  const submit = () => {
    setTried(true);
    if (!reason) {
      Toast.show({ type: 'error', text1: t('rentals.cancel.reasonRequired') });
      return;
    }
    if (tooLong) return;
    write.mutate((key) => cancelBooking(view.id, { reason, ...(trimmed ? { note: trimmed } : {}) }, key), {
      onSuccess: (next) => {
        track(RENTAL_EVENTS.bookingAction, { bookingId: view.id, action: 'cancel', status: next.status });
        Toast.show({ type: 'success', text1: t('rentals.cancel.done') });
        onClose();
      },
      onError: (err) => {
        track(RENTAL_EVENTS.bookingActionFailed, { bookingId: view.id, action: 'cancel', reason: errorCode(err) });
        Toast.show({ type: 'error', text1: m14ErrorMessage(err) });
      },
    });
  };

  return (
    <ActionSheet
      visible={visible}
      title={t('rentals.cancel.title')}
      subtitle={t('rentals.cancel.body')}
      items={reasons.map((r) => ({
        key: r,
        label: t(`rentals.cancelReason.${r}`),
        selected: reason === r,
        testID: `Booking-cancel-reason-${r}`,
      }))}
      onSelect={(k) => setReason(k as RentalCancelReason)}
      onClose={onClose}
    >
      <Input
        label={t('rentals.cancel.note')}
        value={note}
        onChangeText={setNote}
        multiline
        error={tried && tooLong ? t('rentals.cancel.noteError', { max: RENTAL_LIMITS.shortNoteMax }) : undefined}
        testID="Booking-cancel-note"
      />
      <Button
        title={t('rentals.cancel.confirm')}
        onPress={submit}
        variant="danger"
        loading={write.isPending}
        phLabel="Booking-cancel-confirm"
      />
    </ActionSheet>
  );
}
