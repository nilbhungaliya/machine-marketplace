import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { RENTAL_FINAL_REASONS, RENTAL_LIMITS, type RentalBookingView, type RentalFinalReason } from '@mpm/shared-types';
import BottomSheet from '@/components/BottomSheet';
import Button from '@/components/Button';
import Chip from '@/components/Chip';
import Field from '@/components/Field';
import Input from '@/components/Input';
import StepPhotos, { photoUploadMessage, useStepPhotos } from '@/components/rentals/StepPhotos';
import { isStaleBookingError, useBookingWrite } from '@/hooks/use-rental-booking';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { RENTAL_EVENTS } from '@/lib/analytics-events';
import { errorCode } from '@/lib/api-error';
import { m14ErrorMessage } from '@/lib/m14-errors';
import { formatRupees, parseRupees, rupeesInput } from '@/lib/money';
import { hasFormErrors, parseHourMeter, returnFormErrors } from '@/lib/rental-return';
import { markBookingReturned } from '@/lib/rentals-api';
import { radius, spacing, useTheme } from '@/lib/theme';

export interface ReturnSheetProps {
  /** The owner's view of an `on_rent` booking (spec §6.4). */
  view: RentalBookingView;
  visible: boolean;
  onClose: () => void;
  /** The fresh view after `POST /rental-bookings/:id/returned`. */
  onDone: (view: RentalBookingView) => void;
}

/**
 * Machine returned (§6.4, owner only, also early or late): closing hour meter (not below the opening one), the final
 * amount prefilled with the agreed total (a different amount needs a reason and may carry a note), a damage note and up
 * to three photos. The renter then confirms or reports a problem; the booking completes on its own after the window.
 */
export default function ReturnSheet({ view, visible, onClose, onDone }: ReturnSheetProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const write = useBookingWrite(view.id);
  const photos = useStepPhotos(view.id);
  const agreed = view.agreedTotalPaise ?? view.current.totalPaise;
  const opening = view.onSite?.hourMeter ?? null;
  const [meter, setMeter] = useState('');
  const [amount, setAmount] = useState(() => rupeesInput(agreed));
  const [reason, setReason] = useState<RentalFinalReason | null>(null);
  const [finalNote, setFinalNote] = useState('');
  const [damage, setDamage] = useState('');
  const [tried, setTried] = useState(false);
  const { reset } = photos;

  useEffect(() => {
    if (!visible) return;
    setMeter('');
    setAmount(rupeesInput(agreed));
    setReason(null);
    setFinalNote('');
    setDamage('');
    setTried(false);
    reset();
  }, [visible, agreed, reset]);

  const s = useMemo(() => StyleSheet.create({
    agreed: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md,
      backgroundColor: colors.field, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    },
    agreedLabel: { ...type('caption'), color: colors.textSecondary },
    agreedValue: { ...type('bodyStrong'), color: colors.text },
    opening: { ...type('caption'), color: colors.textSecondary },
    openingValue: { ...type('mono'), color: colors.text },
    diff: { ...type('caption'), color: colors.text },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  }), [colors, type]);

  const hour = parseHourMeter(meter);
  const finalPaise = parseRupees(amount);
  const differs = finalPaise != null && finalPaise !== agreed;
  const errors = returnFormErrors({
    finalPaise, agreedPaise: agreed, reason, hourStart: opening, hourEnd: hour.value, hourEndInvalid: hour.invalid,
    // The amount note shows (and is sent) only when the amount differs.
    finalNote: differs ? finalNote : '', damageNote: damage,
  });
  const shown = tried ? errors : {};
  const busy = photos.uploading || write.isPending;

  const submit = async () => {
    setTried(true);
    if (hasFormErrors(errors) || finalPaise == null) return;
    let photoKeys: string[] = [];
    try {
      photoKeys = await photos.upload();
    } catch (err) {
      Toast.show({ type: 'error', text1: photoUploadMessage(err) });
      return;
    }
    const note = finalNote.trim();
    const damageNote = damage.trim();
    write.mutate(
      (key) => markBookingReturned(view.id, {
        finalAmountPaise: finalPaise,
        ...(hour.value != null ? { hourMeter: hour.value } : {}),
        ...(differs && reason ? { finalReason: reason } : {}),
        ...(differs && note ? { finalNote: note } : {}),
        ...(damageNote ? { damageNote } : {}),
        ...(photoKeys.length > 0 ? { photoKeys } : {}),
      }, key),
      {
        onSuccess: (fresh) => {
          track(RENTAL_EVENTS.bookingAction, { bookingId: view.id, action: 'return', status: fresh.status });
          Toast.show({ type: 'success', text1: t('rentalsOwner.return.done') });
          onDone(fresh);
          onClose();
        },
        onError: (err) => {
          track(RENTAL_EVENTS.bookingActionFailed, { bookingId: view.id, action: 'return', reason: errorCode(err) });
          Toast.show({ type: 'error', text1: m14ErrorMessage(err) });
          if (isStaleBookingError(err)) onClose();
        },
      },
    );
  };

  const amountError = shown.final === 'required'
    ? t('rentalsOwner.return.amountRequired')
    : shown.final === 'tooHigh' ? t('rentalsOwner.change.totalInvalid') : undefined;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('rentalsOwner.return.title')}
      subtitle={t('rentalsOwner.return.subtitle', { ref: view.ref, name: view.counterpart.tradeName })}
      testID="ReturnBooking-backdrop"
    >
      <View style={s.agreed}>
        <Text style={s.agreedLabel}>{t('rentalsOwner.return.agreed')}</Text>
        <Text style={s.agreedValue}>{formatRupees(agreed)}</Text>
      </View>

      <Input
        label={t('rentalsOwner.meter.closing')}
        value={meter}
        onChangeText={setMeter}
        keyboardType="number-pad"
        mono
        placeholder={t('rentalsOwner.meter.placeholder')}
        error={shown.hourEnd === 'belowStart'
          ? t('rentalsOwner.meter.belowStart', { start: opening ?? 0 })
          : shown.hourEnd === 'invalid' ? t('rentalsOwner.meter.invalid') : undefined}
        testID="Return-meter"
      />
      {opening != null && !shown.hourEnd ? (
        <Text style={s.opening}>
          {t('rentalsOwner.meter.openingWas')} <Text style={s.openingValue}>{opening}</Text>
        </Text>
      ) : null}

      <Input
        label={t('rentalsOwner.return.amount')}
        prefix="₹"
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        error={amountError}
        testID="Return-amount"
      />
      {differs && finalPaise != null ? (
        <Text style={s.diff}>
          {t(finalPaise > agreed ? 'rentalsOwner.return.more' : 'rentalsOwner.return.less', {
            amount: formatRupees(Math.abs(finalPaise - agreed)),
          })}
        </Text>
      ) : null}

      {differs ? (
        <>
          <Field label={t('rentalsOwner.return.reason')} error={shown.reason ? t('rentals.errors.finalReasonRequired') : undefined}>
            <View style={s.chips}>
              {RENTAL_FINAL_REASONS.map((r) => (
                <Chip
                  key={r}
                  label={t(`rentalsOwner.finalReason.${r}`)}
                  selected={reason === r}
                  onPress={() => setReason(r)}
                  role="radio"
                  testID={`Return-reason-${r}`}
                />
              ))}
            </View>
          </Field>
          <Input
            label={t('rentalsOwner.return.finalNote')}
            value={finalNote}
            onChangeText={setFinalNote}
            multiline
            error={shown.finalNote ? t('rentalsOwner.tooLong', { max: RENTAL_LIMITS.shortNoteMax }) : undefined}
            testID="Return-final-note"
          />
        </>
      ) : null}

      <Input
        label={t('rentalsOwner.return.damage')}
        value={damage}
        onChangeText={setDamage}
        multiline
        placeholder={t('rentalsOwner.return.damageHint')}
        error={shown.damageNote ? t('rentalsOwner.tooLong', { max: RENTAL_LIMITS.damageNoteMax }) : undefined}
        testID="Return-damage"
      />
      <StepPhotos photos={photos.photos} onChange={photos.setPhotos} testID="Return" />
      <Button
        title={t('rentalsOwner.return.submit')}
        onPress={() => void submit()}
        loading={busy}
        phLabel="Return-confirm"
      />
    </BottomSheet>
  );
}
