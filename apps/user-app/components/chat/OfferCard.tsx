import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import type { OfferAction, OfferView, ThreadDetail } from '@mpm/shared-types';
import Button from '@/components/Button';
import Notice from '@/components/Notice';
import StatusChip from '@/components/StatusChip';
import { useConfirm } from '@/components/ConfirmSheet';
import OfferSheet from '@/components/offers/OfferSheet';
import RejectOfferSheet from '@/components/offers/RejectOfferSheet';
import { useOfferWrite } from '@/hooks/use-offers';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { OFFER_EVENTS } from '@/lib/analytics-events';
import { errorCode, errorDetails } from '@/lib/api-error';
import { f6ErrorMessage } from '@/lib/f6-errors';
import { TriangleAlert } from '@/lib/icons';
import { quantityText, unitPer } from '@/lib/listing-format';
import { formatRupees } from '@/lib/money';
import { formatPaiseText, gstLabelKey, offerCardState, roundLabel, validityParts } from '@/lib/offer-form';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackParamList } from '@/navigation/types';

/** An offer in the thread (F6 + F7 spec §15.1): buttons only for the side whose turn it is; backup and reconfirm states. */
export interface OfferCardProps {
  offer: OfferView;
  thread: ThreadDetail;
  style?: StyleProp<ViewStyle>;
}

/**
 * The offer card (mockup negotiate · "Offer received (seller)", "Counteroffer"): who sent it, its status, price (and %
 * below asking on negotiable chains), quantity, total with the GST label, the note, and only the actions the server
 * offers this reader (`offer.actions`). Counter opens the offer sheet; reject asks for an optional reason; accept,
 * withdraw and reconfirm confirm first.
 */
export default function OfferCard({ offer, thread, style }: OfferCardProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const confirm = useConfirm();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const write = useOfferWrite();
  const [sheet, setSheet] = useState<'counter' | 'reject' | null>(null);

  const mine = offer.isMine;
  const s = useMemo(() => StyleSheet.create({
    card: {
      borderRadius: radius.xl, borderWidth: 1, padding: spacing.lg, gap: spacing.sm, maxWidth: '92%', width: 320,
      alignSelf: mine ? 'flex-end' : 'flex-start',
      backgroundColor: mine ? colors.primaryWash : colors.surface,
      borderColor: mine ? colors.primarySoft : colors.hairline,
    },
    head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
    title: { ...type('cardTitle'), color: colors.text, flexShrink: 1 },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.md },
    label: { ...type('caption'), color: colors.textSecondary },
    valueCol: { alignItems: 'flex-end', flexShrink: 1 },
    value: { ...type('bodyStrong'), color: colors.text },
    sub: { ...type('caption'), color: colors.ok },
    gst: { ...type('caption'), color: colors.textMuted },
    note: { ...type('body'), color: colors.text },
    foot: { ...type('caption'), color: colors.textMuted },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
    action: { flexGrow: 1 },
  }), [colors, type, mine]);

  const state = offerCardState(offer, thread.side, Date.now());
  const per = unitPer(offer.unit);
  const qty = quantityText(offer.quantity, offer.unit);
  const round = roundLabel(offer);
  const validity = validityParts(offer.validityHours);
  const gst = gstLabelKey(offer.gstMode);
  const busy = write.isPending;

  const fail = (err: unknown) => {
    if (errorCode(err) === 'QUANTITY_NOT_AVAILABLE') {
      const available = errorDetails(err).available;
      Toast.show({
        type: 'error',
        text1: t('offers.actions.notAvailable', { qty: typeof available === 'string' ? quantityText(available, offer.unit) : '' }),
      });
      return;
    }
    Toast.show({ type: 'error', text1: f6ErrorMessage(err) });
  };

  const accept = async () => {
    const ok = await confirm({
      title: t('offers.actions.acceptTitle'),
      message: t('offers.actions.acceptBody', {
        price: `${formatRupees(offer.pricePerUnitPaise)} ${per}`.trim(), qty, total: formatPaiseText(offer.totalPaise),
      }),
      confirmLabel: t('offers.card.accept'),
    });
    if (!ok) return;
    write.mutate({ type: 'accept', offer }, {
      onSuccess: (r) => {
        track(OFFER_EVENTS.offerAccepted, { kind: offer.kind, round: offer.round });
        Toast.show({ type: 'success', text1: t('offers.actions.accepted') });
        if (r.dealId) navigation.navigate('DealRecord', { dealId: r.dealId });
      },
      onError: fail,
    });
  };

  const withdraw = async () => {
    const ok = await confirm({
      title: t('offers.actions.withdrawTitle'),
      message: t(offer.status === 'backup' ? 'offers.actions.withdrawBackupBody' : 'offers.actions.withdrawBody'),
      confirmLabel: t('offers.card.withdraw'),
      destructive: true,
    });
    if (!ok) return;
    write.mutate({ type: 'withdraw', offer }, {
      onSuccess: () => {
        track(OFFER_EVENTS.offerWithdrawn, { kind: offer.kind });
        Toast.show({ type: 'success', text1: t('offers.actions.withdrawn') });
      },
      onError: fail,
    });
  };

  const reconfirm = async () => {
    const ok = await confirm({
      title: t('offers.actions.reconfirmTitle'),
      message: t('offers.actions.reconfirmBody'),
      confirmLabel: t('offers.card.reconfirm'),
    });
    if (!ok) return;
    write.mutate({ type: 'reconfirm', offer }, {
      onSuccess: () => Toast.show({ type: 'success', text1: t('offers.actions.reconfirmed') }),
      onError: fail,
    });
  };

  const reject = (note: string | null) => {
    write.mutate({ type: 'reject', offer, note }, {
      onSuccess: () => {
        setSheet(null);
        track(OFFER_EVENTS.offerRejected, { kind: offer.kind, hasNote: note !== null });
        Toast.show({ type: 'success', text1: t('offers.actions.rejected') });
      },
      onError: fail,
    });
  };

  const run: Record<OfferAction, () => void> = {
    accept: () => void accept(),
    reconfirm: () => void reconfirm(),
    counter: () => setSheet('counter'),
    reject: () => setSheet('reject'),
    withdraw: () => void withdraw(),
  };
  // Primary last (right), as the mockup's Reject · Counter · Accept.
  const order: OfferAction[] = ['withdraw', 'reject', 'counter', 'reconfirm', 'accept'];
  const actions = order.filter((a) => offer.actions.includes(a));
  const variant = (a: OfferAction) => (a === 'accept' || a === 'reconfirm' ? 'primary' : 'outline');

  const note = offer.note;

  return (
    <View style={[s.card, style]} testID={`Offer-card-${offer.id}`}>
      <View style={s.head}>
        <Text style={s.title}>{t(state.titleKey)}</Text>
        <StatusChip label={t(state.chip.key, state.chip.values)} tone={state.chip.tone} />
      </View>

      <View style={s.row}>
        <Text style={s.label}>{t('offers.card.price')}</Text>
        <View style={s.valueCol}>
          <Text style={s.value}>{`${formatRupees(offer.pricePerUnitPaise)} ${per}`.trim()}</Text>
          {offer.percentBelowAsking ? (
            <Text style={s.sub}>
              {t(thread.side === 'seller' ? 'offers.card.percentBelowYours' : 'offers.card.percentBelowAsking', { percent: offer.percentBelowAsking })}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={s.row}>
        <Text style={s.label}>{t('offers.card.quantity')}</Text>
        <Text style={s.value}>{qty}</Text>
      </View>
      <View style={s.row}>
        <Text style={s.label}>{t('offers.card.total')}</Text>
        <View style={s.valueCol}>
          <Text style={s.value}>{formatPaiseText(offer.totalPaise)}</Text>
          {gst ? <Text style={s.gst}>{t(gst)}</Text> : null}
        </View>
      </View>

      {note ? <Text style={s.note}>{t('offers.card.quoted', { note })}</Text> : null}
      {offer.scamWarning ? <Notice tone="danger" icon={TriangleAlert} text={t('offers.card.scam')} /> : null}
      {offer.status === 'rejected' && offer.rejectNote ? (
        <Text style={s.foot}>{t('offers.card.rejectNote', { note: offer.rejectNote })}</Text>
      ) : null}
      {state.notice ? <Notice tone={state.notice.tone} text={t(state.notice.key)} /> : null}

      <Text style={s.foot}>
        {[
          round ? t(round.key, round.values) : '',
          offer.status === 'pending' ? t('offers.card.validFor', { validity: t(`offers.validity.${validity.unit}`, { count: validity.count }) }) : '',
        ].filter(Boolean).join(' · ')}
      </Text>

      {actions.length > 0 ? (
        <View style={s.actions}>
          {actions.map((a) => (
            <Button
              key={a}
              title={t(`offers.card.${a}`)}
              onPress={run[a]}
              variant={variant(a)}
              size="sm"
              disabled={busy}
              loading={busy && (a === 'accept' || a === 'reconfirm')}
              phLabel={`Offer-${a}`}
              style={s.action}
            />
          ))}
        </View>
      ) : null}

      {/* Kept mounted while open: the counter's own `offer:updated` can drop `counter` from the actions before the
          mutation settles, and the sheet's success effects (toast, analytics, push ask) run in its callbacks. */}
      {offer.actions.includes('counter') || sheet === 'counter' ? (
        <OfferSheet mode="counter" offer={offer} threadId={offer.threadId} visible={sheet === 'counter'} onClose={() => setSheet(null)} />
      ) : null}
      {offer.actions.includes('reject') || sheet === 'reject' ? (
        <RejectOfferSheet visible={sheet === 'reject'} loading={busy} onClose={() => setSheet(null)} onReject={reject} />
      ) : null}
    </View>
  );
}
