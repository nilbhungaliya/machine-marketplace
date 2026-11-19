import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import {
  DEAL_FULFILMENT, DEAL_LIMITS, DEAL_PAYMENT_METHODS, type DealView,
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
import { advanceFits, balanceOf, parseDayInput } from '@/lib/deal-display';
import { notesFormOf, notesPatchBody, rebaseNotesForm, type NotesForm, type NotesSnapshot } from '@/lib/deal-notes-form';
import { fetchDeal } from '@/lib/deals-api';
import { f6ErrorMessage } from '@/lib/f6-errors';
import { parseRupees } from '@/lib/money';
import { formatPaiseText } from '@/lib/offer-form';
import { qk } from '@/lib/query-keys';
import { spacing, useTheme } from '@/lib/theme';

interface NotesSheetProps {
  deal: DealView;
  visible: boolean;
  onClose: () => void;
}

type Form = NotesForm;

const snapshotOf = (d: DealView): NotesSnapshot => ({ version: d.version, form: notesFormOf(d.notes) });

/**
 * Edit the deal's shared notes (§9.1): one record for both sides, last write wins with `version`. The sheet snapshots
 * the notes it opened on and sends only what changed against that snapshot; a stale edit (`409 DEAL_STALE`) refetches
 * the record and rebases the form onto it (untouched fields take the new values, edits stay) for the user to check.
 */
export default function NotesSheet({ deal, visible, onClose }: NotesSheetProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const qc = useQueryClient();
  const write = useDealWrite(deal.id);
  const [base, setBase] = useState<NotesSnapshot>(() => snapshotOf(deal));
  const [form, setForm] = useState<Form>(() => base.form);
  const [tried, setTried] = useState(false);
  const [rebasing, setRebasing] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const snap = snapshotOf(deal);
    setBase(snap);
    setForm(snap.form);
    setTried(false);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // DEAL_STALE: fetch the record now, rebase the user's edits onto it and keep the sheet open.
  const rebase = async () => {
    setRebasing(true);
    try {
      const fresh = await qc.fetchQuery({ queryKey: qk.deal(deal.id), queryFn: () => fetchDeal(deal.id), staleTime: 0 });
      const next = rebaseNotesForm(form, base, snapshotOf(fresh));
      setBase(next.base);
      setForm(next.form);
    } catch {
      // The record stays as it was; the next save answers DEAL_STALE again.
    } finally {
      setRebasing(false);
    }
  };

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
    // Only what changed against the snapshot goes out, with the snapshot's version.
    const body = notesPatchBody(form, base);
    if (!body) {
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
        if (errorCode(err) === 'DEAL_STALE') {
          Toast.show({ type: 'error', text1: t('errors.trade.dealStale') });
          void rebase();
          return;
        }
        Toast.show({ type: 'error', text1: f6ErrorMessage(err) });
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
      <Button title={t('deals.notes.save')} onPress={save} loading={write.isPending || rebasing} phLabel="Deal-notes-save" />
    </BottomSheet>
  );
}
