import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { RENTAL_DECLINE_REASONS, type RentalBookingView, type RentalDeclineReason } from '@mpm/shared-types';
import BottomSheet from '@/components/BottomSheet';
import Button from '@/components/Button';
import Chip from '@/components/Chip';
import { isStaleBookingError, useBookingWrite } from '@/hooks/use-rental-booking';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { RENTAL_EVENTS } from '@/lib/analytics-events';
import { errorCode } from '@/lib/api-error';
import { m14ErrorMessage } from '@/lib/m14-errors';
import { qk } from '@/lib/query-keys';
import { declineBooking } from '@/lib/rentals-api';
import { spacing, useTheme } from '@/lib/theme';

export interface DeclineSheetProps {
  bookingId: string;
  /** The open version being answered (`409 RENTAL_BOOKING_STALE` when another one came in). */
  versionSeq: number;
  visible: boolean;
  onClose: () => void;
  /** The fresh view after `POST /rental-bookings/:id/decline`. */
  onDone: (view: RentalBookingView) => void;
}

/**
 * Decline (§6.1, §6.5): the owner's answer to a request, or the renter's to the owner's change; one reason from
 * `RENTAL_DECLINE_REASONS`, told to the other side. The title follows the reader's side when the booking is cached.
 */
export default function DeclineSheet({ bookingId, versionSeq, visible, onClose, onDone }: DeclineSheetProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const qc = useQueryClient();
  const write = useBookingWrite(bookingId);
  const [reason, setReason] = useState<RentalDeclineReason | null>(null);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setReason(null);
    setTried(false);
  }, [visible]);

  const s = useMemo(() => StyleSheet.create({
    body: { ...type('body'), color: colors.textSecondary },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    error: { ...type('caption'), color: colors.danger },
  }), [colors, type]);

  const side = qc.getQueryData<RentalBookingView>(qk.rentals.booking(bookingId))?.side ?? 'owner';

  const submit = () => {
    setTried(true);
    if (!reason) return;
    write.mutate((key) => declineBooking(bookingId, { versionSeq, reason }, key), {
      onSuccess: (fresh) => {
        track(RENTAL_EVENTS.bookingAction, { bookingId, action: 'decline', status: fresh.status });
        Toast.show({ type: 'success', text1: t('rentalsOwner.decline.done') });
        onDone(fresh);
        onClose();
      },
      onError: (err) => {
        track(RENTAL_EVENTS.bookingActionFailed, { bookingId, action: 'decline', reason: errorCode(err) });
        Toast.show({ type: 'error', text1: m14ErrorMessage(err) });
        if (isStaleBookingError(err)) onClose();
      },
    });
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t(side === 'owner' ? 'rentalsOwner.decline.title' : 'rentalsOwner.decline.titleChange')}
      testID="DeclineBooking-backdrop"
    >
      <Text style={s.body}>{t(side === 'owner' ? 'rentalsOwner.decline.body' : 'rentalsOwner.decline.bodyChange')}</Text>
      <View style={s.chips} accessibilityRole="radiogroup">
        {RENTAL_DECLINE_REASONS.map((r) => (
          <Chip
            key={r}
            label={t(`rentalsOwner.declineReason.${r}`)}
            selected={reason === r}
            onPress={() => setReason(r)}
            role="radio"
            testID={`Decline-reason-${r}`}
          />
        ))}
      </View>
      {tried && !reason ? <Text style={s.error}>{t('rentalsOwner.decline.pickReason')}</Text> : null}
      <Button
        title={t('rentalsOwner.decline.submit')}
        variant="danger"
        onPress={submit}
        loading={write.isPending}
        phLabel="Decline-confirm"
      />
    </BottomSheet>
  );
}
