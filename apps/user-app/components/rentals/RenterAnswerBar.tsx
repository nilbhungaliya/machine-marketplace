import React, { useMemo, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import type { RentalBookingView } from '@mpm/shared-types';
import Button from '@/components/Button';
import { useConfirm } from '@/components/ConfirmSheet';
import DeclineSheet from '@/components/rentals/DeclineSheet';
import { invalidateAfterBooking, useBookingWrite } from '@/hooks/use-rental-booking';
import { useQueryClient } from '@tanstack/react-query';
import { track } from '@/lib/analytics';
import { RENTAL_EVENTS } from '@/lib/analytics-events';
import { errorCode } from '@/lib/api-error';
import { m14ErrorMessage } from '@/lib/m14-errors';
import { formatRupees } from '@/lib/money';
import { qk } from '@/lib/query-keys';
import { acceptBookingChange, withdrawBooking } from '@/lib/rentals-api';
import { spacing } from '@/lib/theme';
import type { RootStackParamList } from '@/navigation/types';

interface RenterAnswerBarProps {
  /** The renter's view of an open booking (`requested`: Withdraw; `countered`: Accept / Change / Decline / Withdraw). */
  view: RentalBookingView;
  style?: StyleProp<ViewStyle>;
}

/**
 * The renter's answers on an open booking (§6.1, R3), by the server's `actions`: on the owner's change, **Accept**
 * (capacity checked; the owner's total becomes the agreed one), **Change** (Request booking in change mode, prefilled
 * with the owner's version), **Decline** (a reason, B3's sheet); **Withdraw** while it waits for either side.
 */
export default function RenterAnswerBar({ view, style }: RenterAnswerBarProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const write = useBookingWrite(view.id);
  const [declining, setDeclining] = useState(false);
  const s = useMemo(() => StyleSheet.create({
    row: { flexDirection: 'row', gap: spacing.sm },
    grow: { flex: 1 },
    links: { flexDirection: 'row', justifyContent: 'center', gap: spacing.md, flexWrap: 'wrap' },
  }), []);

  const can = (a: string) => view.actions.includes(a as never);
  const fail = (action: string) => (err: unknown) => {
    track(RENTAL_EVENTS.bookingActionFailed, { bookingId: view.id, action, reason: errorCode(err) });
    Toast.show({ type: 'error', text1: m14ErrorMessage(err) });
  };
  const done = (action: string, text: string) => (next: RentalBookingView) => {
    track(RENTAL_EVENTS.bookingAction, { bookingId: view.id, action, status: next.status });
    Toast.show({ type: 'success', text1: text });
  };

  const accept = async () => {
    const ok = await confirm({
      title: t('rentals.answer.acceptTitle'),
      message: t('rentals.answer.acceptBody', { total: formatRupees(view.current.totalPaise) }),
      confirmLabel: t('rentals.answer.accept'),
    });
    if (!ok) return;
    const seq = view.current.seq;
    write.mutate((key) => acceptBookingChange(view.id, { versionSeq: seq }, key), {
      onSuccess: done('accept', t('rentals.answer.accepted')),
      onError: fail('accept'),
    });
  };

  const withdraw = async () => {
    const ok = await confirm({
      title: t('rentals.answer.withdrawTitle'),
      message: t('rentals.answer.withdrawBody'),
      confirmLabel: t('rentals.answer.withdraw'),
      destructive: true,
    });
    if (!ok) return;
    write.mutate((key) => withdrawBooking(view.id, key), {
      onSuccess: done('withdraw', t('rentals.answer.withdrawn')),
      onError: fail('withdraw'),
    });
  };

  const change = () => {
    const c = view.current;
    navigation.navigate('RequestBooking', {
      listingId: view.listing.id,
      change: { bookingId: view.id, versionSeq: c.seq },
      prefill: {
        startDate: c.startDate, period: c.period, count: c.count, machines: c.machines,
        withOperator: c.withOperator, ownerDelivers: c.ownerDelivers,
      },
    });
  };

  if (!can('accept') && !can('change') && !can('decline') && !can('withdraw')) return null;
  const busy = write.isPending;

  return (
    <View style={[{ gap: spacing.sm }, style]}>
      {can('accept') || can('change') ? (
        <View style={s.row}>
          {can('change') ? (
            <Button title={t('rentals.answer.change')} onPress={change} variant="outline" size="md" disabled={busy} phLabel="Booking-change" style={s.grow} />
          ) : null}
          {can('accept') ? (
            <Button title={t('rentals.answer.accept')} onPress={() => void accept()} size="md" loading={busy} disabled={busy} phLabel="Booking-accept" style={s.grow} />
          ) : null}
        </View>
      ) : null}
      <View style={s.links}>
        {can('decline') ? (
          <Button title={t('rentals.answer.decline')} onPress={() => setDeclining(true)} variant="ghost" size="sm" disabled={busy} phLabel="Booking-decline" />
        ) : null}
        {can('withdraw') ? (
          <Button title={t('rentals.answer.withdraw')} onPress={() => void withdraw()} variant="ghost" size="sm" disabled={busy} phLabel="Booking-withdraw" />
        ) : null}
      </View>
      {can('decline') ? (
        <DeclineSheet
          bookingId={view.id}
          versionSeq={view.current.seq}
          visible={declining}
          onClose={() => setDeclining(false)}
          onDone={(next) => {
            qc.setQueryData(qk.rentals.booking(view.id), next);
            invalidateAfterBooking(qc, next);
            setDeclining(false);
          }}
        />
      ) : null}
    </View>
  );
}
