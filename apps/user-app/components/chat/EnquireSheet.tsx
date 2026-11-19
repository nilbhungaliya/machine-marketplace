import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { CHAT_LIMITS, type ListingDetail, type QuickEnquiry } from '@mpm/shared-types';
import BottomSheet from '@/components/BottomSheet';
import Button from '@/components/Button';
import Chip from '@/components/Chip';
import Input from '@/components/Input';
import { useSendEnquiry } from '@/hooks/use-chat';
import { useType } from '@/hooks/use-type';
import { enquiryBody, enquiryDefaults, enquiryProblem, nextClientMessageId, quickOptionsFor, takesQuantity, type EnquiryForm } from '@/lib/chat-composer';
import { f6ErrorMessage } from '@/lib/f6-errors';
import { FIT_CHOICE_STORAGE_KEY, parseFitChoice, type FitChoice } from '@/lib/listing-page';
import { askPushOnce } from '@/lib/push-ask';
import { spacing, useTheme } from '@/lib/theme';
import type { RootStackParamList } from '@/navigation/types';

/**
 * The Enquire sheet (F6 + F7 spec §15.1, mockup negotiate · "Enquire"): quick options, quantity for Best price, a
 * note, the machine line from Check my machine; `preset: 'ask_price'` opens it as "Price please".
 */
export interface EnquireSheetProps {
  listing: ListingDetail;
  visible: boolean;
  preset?: 'ask_price';
  onClose: () => void;
  /** After the send; the sheet itself opens the thread, so don't navigate here. */
  onSent?: (threadId: string) => void;
}

/**
 * Quick questions (chips, several at once), the quantity when Best price / Price please is picked, an optional note
 * (≤ 500), and "Send my machine" when Compatibility is picked and Check my machine has a choice (§6.1, §6.3). One
 * Idempotency-Key per opening, so a retry after a lost reply opens the same thread. On success the thread opens with
 * the card in it and push is asked once.
 */
export default function EnquireSheet({ listing, visible, preset, onClose, onSent }: EnquireSheetProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const send = useSendEnquiry(listing.id);
  const [form, setForm] = useState<EnquiryForm>(() => enquiryDefaults(listing, preset));
  const [machine, setMachine] = useState<FitChoice | null>(null);
  const [tried, setTried] = useState(false);
  const key = useRef(nextClientMessageId());

  const unit = listing.unit;
  const decimals = unit?.decimals ?? 0;
  const options = quickOptionsFor(listing);

  useEffect(() => {
    if (!visible) return;
    setForm(enquiryDefaults(listing, preset));
    setTried(false);
    key.current = nextClientMessageId();
    let alive = true;
    AsyncStorage.getItem(FIT_CHOICE_STORAGE_KEY)
      .then((raw) => { if (alive) setMachine(parseFitChoice(raw)); })
      .catch(() => { if (alive) setMachine(null); });
    return () => { alive = false; };
    // Reset only when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // A changed form is a new enquiry: a retry keeps the key only for the very same body.
  useEffect(() => {
    key.current = nextClientMessageId();
  }, [form, machine]);

  const s = useMemo(() => StyleSheet.create({
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    error: { ...type('caption'), color: colors.danger },
  }), [colors, type]);

  const problem = enquiryProblem(form, decimals);
  const showQuantity = form.quick.some(takesQuantity);
  const showMachine = machine !== null && form.quick.includes('compatibility');

  const toggle = (q: QuickEnquiry) =>
    setForm((f) => ({ ...f, quick: f.quick.includes(q) ? f.quick.filter((x) => x !== q) : [...f.quick, q] }));

  let quantityError: string | undefined;
  if (tried && problem && typeof problem === 'object') quantityError = t(`chats.enquire.quantityProblem.${problem.quantity}`);
  const noteError = problem === 'noteTooLong' ? t('chats.enquire.noteTooLong') : undefined;

  const submit = () => {
    setTried(true);
    if (problem) return;
    send.mutate(
      { body: enquiryBody(form, decimals, machine), idempotencyKey: key.current },
      {
        onSuccess: (r) => {
          onClose();
          Toast.show({ type: 'success', text1: t('chats.enquire.sent') });
          void askPushOnce('enquiry');
          onSent?.(r.threadId);
          navigation.navigate('Thread', { threadId: r.threadId });
        },
        onError: (err) => Toast.show({ type: 'error', text1: f6ErrorMessage(err) }),
      },
    );
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t(preset === 'ask_price' ? 'chats.enquire.askPriceTitle' : 'chats.enquire.title')}
      subtitle={listing.title}
      testID="Enquire-backdrop"
    >
      <View style={s.chips}>
        {options.map((q) => (
          <Chip
            key={q}
            label={t(`chats.quick.${q}`)}
            selected={form.quick.includes(q)}
            onPress={() => toggle(q)}
            role="checkbox"
            testID={`Enquire-quick-${q}`}
          />
        ))}
      </View>
      {showQuantity ? (
        <Input
          label={unit ? t('chats.enquire.quantityUnit', { unit: unit.label }) : t('chats.enquire.quantity')}
          value={form.quantityText}
          onChangeText={(quantityText) => setForm((f) => ({ ...f, quantityText }))}
          keyboardType={decimals > 0 ? 'decimal-pad' : 'number-pad'}
          error={quantityError}
          testID="Enquire-quantity"
        />
      ) : null}
      <Input
        label={t('chats.enquire.note')}
        value={form.note}
        onChangeText={(note) => setForm((f) => ({ ...f, note }))}
        placeholder={t('chats.enquire.notePlaceholder')}
        multiline
        maxLength={CHAT_LIMITS.noteMax + 50}
        error={noteError}
        testID="Enquire-note"
      />
      {showMachine ? (
        <Chip
          label={t('chats.enquire.machine', { machine: t('chats.enquire.machineSaved') })}
          selected={form.sendMachine}
          onPress={() => setForm((f) => ({ ...f, sendMachine: !f.sendMachine }))}
          role="checkbox"
          testID="Enquire-send-machine"
        />
      ) : null}
      {tried && problem === 'empty' ? <Text style={s.error}>{t('chats.enquire.empty')}</Text> : null}
      <Button title={t('chats.enquire.send')} onPress={submit} loading={send.isPending} phLabel="Enquire-send" />
    </BottomSheet>
  );
}
