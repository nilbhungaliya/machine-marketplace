import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import {
  DEAL_FULFILMENT, DEAL_LIMITS, DEAL_PAYMENT_METHODS, type DealFulfilment, type DealPaymentMethod, type DealView,
} from '@mpm/shared-types';
import BottomSheet from '@/components/BottomSheet';
import Button from '@/components/Button';
import Chip from '@/components/Chip';
import Field from '@/components/Field';
import Input from '@/components/Input';
import { useDealWrite } from '@/hooks/use-deals';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { DEAL_EVENTS } from '@/lib/analytics-events';
import { errorCode } from '@/lib/api-error';
import { advanceFits, balanceOf, dayInputText, parseDayInput, rupeesInputText } from '@/lib/deal-display';
import type { DealNotesPatch } from '@/lib/deals-api';
import { f6ErrorMessage } from '@/lib/f6-errors';
import { parseRupees } from '@/lib/money';
import { formatPaiseText } from '@/lib/offer-form';
import { spacing, useTheme } from '@/lib/theme';

interface NotesSheetProps {
  deal: DealView;
  visible: boolean;
  onClose: () => void;
}

interface Form {
  paymentMethod: DealPaymentMethod | null;
  advance: string;
  fulfilment: DealFulfilment | null;
  expectedOn: string;
  text: string;
}

const formOf = (d: DealView): Form => ({
  paymentMethod: d.notes.paymentMethod,
  advance: rupeesInputText(d.notes.advancePaise),
  fulfilment: d.notes.fulfilment,
  expectedOn: dayInputText(d.notes.expectedOn),
  text: d.notes.text ?? '',
});

/**
 * Edit the deal's shared notes (§9.1): one record for both sides, last write wins with `version`; a stale edit answers
 * `409 DEAL_STALE`, the record refetches (the next save carries the new version) and the user checks it again.
 */
export default function NotesSheet({ deal, visible, onClose }: NotesSheetProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const write = useDealWrite(deal.id);
  const [form, setForm] = useState<Form>(() => formOf(deal));
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setForm(formOf(deal));
    setTried(false);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = useMemo(() => StyleSheet.create({
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    hint: { ...type('caption'), color: colors.textSecondary },
  }), [colors, type]);

  const advancePaise = form.advance.trim() === '' ? null : parseRupees(form.advance);
  const advanceText = advancePaise == null ? null : String(advancePaise);
  const advanceError = form.advance.trim() !== '' && (advancePaise == null || !advanceFits(String(advancePaise), deal.totalPaise))
    ? t('deals.notes.advanceError', { total: formatPaiseText(deal.totalPaise) })
    : undefined;
  const day = parseDayInput(form.expectedOn);
  const dayError = day === null ? t('deals.notes.dateError') : undefined;
  const textError = [...form.text.trim()].length > DEAL_LIMITS.dealNotesMax ? t('deals.notes.textError', { max: DEAL_LIMITS.dealNotesMax }) : undefined;
  const balance = advanceText && !advanceError ? balanceOf(deal.totalPaise, advanceText) : null;

  const save = () => {
    setTried(true);
    if (advanceError || dayError || textError) return;
    // Only what changed goes out, with the version the form was opened on (or refetched to).
    const before = formOf(deal);
    const body: DealNotesPatch = { version: deal.version };
    if (form.paymentMethod !== before.paymentMethod) body.paymentMethod = form.paymentMethod;
    if (form.advance.trim() !== before.advance) body.advancePaise = advanceText;
    if (form.fulfilment !== before.fulfilment) body.fulfilment = form.fulfilment;
    if (form.expectedOn.trim() !== before.expectedOn) body.expectedOn = day === '' ? null : day;
    if (form.text.trim() !== before.text.trim()) body.text = form.text.trim() === '' ? null : form.text.trim();
    if (Object.keys(body).length === 1) {
      onClose();
      return;
    }
    write.mutate({ action: 'notes', body }, {
      onSuccess: () => {
        track(DEAL_EVENTS.notesSaved, { fields: Object.keys(body).length - 1 });
        Toast.show({ type: 'success', text1: t('deals.notes.saved') });
        onClose();
      },
      onError: (err) => {
        Toast.show({ type: 'error', text1: errorCode(err) === 'DEAL_STALE' ? t('errors.trade.dealStale') : f6ErrorMessage(err) });
      },
    });
  };

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('deals.notes.editTitle')} subtitle={t('deals.record.outsideApp')} testID="Deal-notes-backdrop">
      <Field label={t('deals.notes.payment')}>
        <View style={s.chips}>
          {DEAL_PAYMENT_METHODS.map((m) => (
            <Chip
              key={m}
              label={t(`deals.payment.${m}`)}
              selected={form.paymentMethod === m}
              onPress={() => set({ paymentMethod: form.paymentMethod === m ? null : m })}
              role="radio"
              testID={`Deal-notes-payment-${m}`}
            />
          ))}
        </View>
      </Field>
      <Input
        label={t('deals.notes.advance')}
        prefix="₹"
        value={form.advance}
        onChangeText={(advance) => set({ advance })}
        keyboardType="decimal-pad"
        error={tried || form.advance ? advanceError : undefined}
        testID="Deal-notes-advance"
      />
      {balance ? <Text style={s.hint}>{t('deals.notes.balanceHint', { balance: formatPaiseText(balance) })}</Text> : null}
      <Field label={t('deals.notes.fulfilment')}>
        <View style={s.chips}>
          {DEAL_FULFILMENT.map((f) => (
            <Chip
              key={f}
              label={t(`deals.fulfilment.${f}`)}
              selected={form.fulfilment === f}
              onPress={() => set({ fulfilment: form.fulfilment === f ? null : f })}
              role="radio"
              testID={`Deal-notes-fulfilment-${f}`}
            />
          ))}
        </View>
      </Field>
      <Input
        label={t('deals.notes.expectedOn')}
        value={form.expectedOn}
        onChangeText={(expectedOn) => set({ expectedOn })}
        placeholder={t('deals.notes.datePlaceholder')}
        keyboardType="numbers-and-punctuation"
        error={tried ? dayError : undefined}
        testID="Deal-notes-date"
      />
      <Input
        label={t('deals.notes.text')}
        value={form.text}
        onChangeText={(text) => set({ text })}
        multiline
        placeholder={t('deals.notes.textHint')}
        error={textError}
        testID="Deal-notes-text"
      />
      <Button title={t('deals.notes.save')} onPress={save} loading={write.isPending} phLabel="Deal-notes-save" />
    </BottomSheet>
  );
}
