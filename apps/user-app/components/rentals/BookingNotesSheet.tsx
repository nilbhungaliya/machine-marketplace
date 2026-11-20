import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { DEAL_PAYMENT_METHODS, RENTAL_LIMITS, type DealPaymentMethod, type RentalBookingView } from '@mpm/shared-types';
import BottomSheet from '@/components/BottomSheet';
import Button from '@/components/Button';
import Chip from '@/components/Chip';
import Field from '@/components/Field';
import Input from '@/components/Input';
import { useBookingWrite } from '@/hooks/use-rental-booking';
import { track } from '@/lib/analytics';
import { RENTAL_EVENTS } from '@/lib/analytics-events';
import { errorCode } from '@/lib/api-error';
import { toAsciiDigits } from '@/lib/digits';
import { m14ErrorMessage } from '@/lib/m14-errors';
import { parseRupees, rupeesInput } from '@/lib/money';
import { qk } from '@/lib/query-keys';
import { editBookingNotes, fetchRentalBooking, type RentalNotesPatch } from '@/lib/rentals-api';
import { spacing } from '@/lib/theme';

interface BookingNotesSheetProps {
  view: RentalBookingView;
  visible: boolean;
  onClose: () => void;
}

interface Form {
  paymentMethod: DealPaymentMethod | null;
  advance: string;
  deposit: string;
  depositReturned: boolean | null;
  time: string;
  text: string;
}

type Key = keyof Form;
const KEYS: Key[] = ['paymentMethod', 'advance', 'deposit', 'depositReturned', 'time', 'text'];

const formOf = (n: RentalBookingView['notes']): Form => ({
  paymentMethod: n.paymentMethod,
  advance: rupeesInput(n.advancePaise),
  deposit: rupeesInput(n.depositPaise),
  depositReturned: n.depositReturned,
  time: n.expectedOnSiteTime ?? '',
  text: n.text ?? '',
});

const same = (a: Form, b: Form, k: Key) => {
  const x = a[k];
  const y = b[k];
  return typeof x === 'string' && typeof y === 'string' ? x.trim() === y.trim() : x === y;
};

/** `HH:MM` (24 h; Hindi / Gujarati digits read), `''` for none, or null when it isn't a time. */
function timeOf(text: string): string | null {
  const clean = toAsciiDigits(text).trim().replace('.', ':');
  if (clean === '') return '';
  const m = /^(\d{1,2}):(\d{2})$/.exec(clean);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 23 && min <= 59 ? `${String(h).padStart(2, '0')}:${m[2]}` : null;
}

/**
 * The booking's shared notes (R10): payment method, advance paid, deposit paid and returned, the expected time on
 * site and a short text; recorded here, paid outside the app. Sends only what changed against the notes it opened on,
 * with their `version`; a stale edit (`409 RENTAL_BOOKING_STALE`) reloads the notes under the user's own edits.
 */
export default function BookingNotesSheet({ view, visible, onClose }: BookingNotesSheetProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const write = useBookingWrite(view.id);
  const [base, setBase] = useState(() => ({ version: view.notes.version, form: formOf(view.notes) }));
  const [form, setForm] = useState<Form>(base.form);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const snap = { version: view.notes.version, form: formOf(view.notes) };
    setBase(snap);
    setForm(snap.form);
    setTried(false);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = useMemo(() => StyleSheet.create({
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    two: { flexDirection: 'row', gap: spacing.md },
    half: { flex: 1 },
  }), []);

  const advance = form.advance.trim() === '' ? null : parseRupees(form.advance);
  const deposit = form.deposit.trim() === '' ? null : parseRupees(form.deposit);
  const time = timeOf(form.time);
  const advanceError = form.advance.trim() !== '' && advance == null ? t('rentals.notes.amountError') : undefined;
  const depositError = form.deposit.trim() !== '' && deposit == null ? t('rentals.notes.amountError') : undefined;
  const timeError = time === null ? t('rentals.notes.timeError') : undefined;
  const textError = form.text.trim().length > RENTAL_LIMITS.notesMax ? t('rentals.notes.textError', { max: RENTAL_LIMITS.notesMax }) : undefined;

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  const rebase = async () => {
    try {
      const fresh = await qc.fetchQuery({ queryKey: qk.rentals.booking(view.id), queryFn: () => fetchRentalBooking(view.id), staleTime: 0 });
      const changed = KEYS.filter((k) => !same(form, base.form, k));
      const next = formOf(fresh.notes);
      for (const k of changed) (next as Record<Key, unknown>)[k] = form[k];
      setBase({ version: fresh.notes.version, form: formOf(fresh.notes) });
      setForm(next);
    } catch {
      // The next save answers stale again.
    }
  };

  const save = () => {
    setTried(true);
    if (advanceError || depositError || timeError || textError) return;
    const changed = KEYS.filter((k) => !same(form, base.form, k));
    if (changed.length === 0) {
      onClose();
      return;
    }
    const body: RentalNotesPatch = { version: base.version };
    for (const k of changed) {
      if (k === 'paymentMethod') body.paymentMethod = form.paymentMethod;
      if (k === 'advance') body.advancePaise = advance;
      if (k === 'deposit') body.depositPaise = deposit;
      if (k === 'depositReturned') body.depositReturned = form.depositReturned;
      if (k === 'time') body.expectedOnSiteTime = time === '' ? null : time;
      if (k === 'text') body.text = form.text.trim() === '' ? null : form.text.trim();
    }
    write.mutate((key) => editBookingNotes(view.id, body, key), {
      onSuccess: () => {
        track(RENTAL_EVENTS.bookingAction, { bookingId: view.id, action: 'edit_notes', status: view.status });
        Toast.show({ type: 'success', text1: t('rentals.notes.saved') });
        onClose();
      },
      onError: (err) => {
        Toast.show({ type: 'error', text1: m14ErrorMessage(err) });
        if (errorCode(err) === 'RENTAL_BOOKING_STALE') void rebase();
      },
    });
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('rentals.notes.editTitle')} subtitle={t('rentals.money.outsideApp')} testID="Booking-notes-backdrop">
      <Field label={t('rentals.notes.payment')}>
        <View style={s.chips}>
          {DEAL_PAYMENT_METHODS.map((m) => (
            <Chip
              key={m}
              label={t(`deals.payment.${m}`)}
              selected={form.paymentMethod === m}
              onPress={() => set({ paymentMethod: form.paymentMethod === m ? null : m })}
              role="radio"
              testID={`Booking-notes-payment-${m}`}
            />
          ))}
        </View>
      </Field>
      <View style={s.two}>
        <View style={s.half}>
          <Input
            label={t('rentals.notes.advance')}
            prefix="₹"
            value={form.advance}
            onChangeText={(v) => set({ advance: v })}
            keyboardType="decimal-pad"
            error={tried || form.advance ? advanceError : undefined}
            testID="Booking-notes-advance"
          />
        </View>
        <View style={s.half}>
          <Input
            label={t('rentals.notes.deposit')}
            prefix="₹"
            value={form.deposit}
            onChangeText={(v) => set({ deposit: v })}
            keyboardType="decimal-pad"
            error={tried || form.deposit ? depositError : undefined}
            testID="Booking-notes-deposit"
          />
        </View>
      </View>
      <View style={s.chips}>
        <Chip
          label={t('rentals.notes.depositReturned')}
          selected={form.depositReturned === true}
          onPress={() => set({ depositReturned: form.depositReturned === true ? null : true })}
          testID="Booking-notes-deposit-returned"
        />
      </View>
      <Input
        label={t('rentals.notes.time')}
        value={form.time}
        onChangeText={(v) => set({ time: v })}
        placeholder={t('rentals.notes.timePlaceholder')}
        keyboardType="numbers-and-punctuation"
        mono
        error={tried ? timeError : undefined}
        testID="Booking-notes-time"
      />
      <Input
        label={t('rentals.notes.text')}
        value={form.text}
        onChangeText={(v) => set({ text: v })}
        multiline
        placeholder={t('rentals.notes.textHint')}
        error={textError}
        testID="Booking-notes-text"
      />
      <Button title={t('rentals.notes.save')} onPress={save} loading={write.isPending} phLabel="Booking-notes-save" />
    </BottomSheet>
  );
}
