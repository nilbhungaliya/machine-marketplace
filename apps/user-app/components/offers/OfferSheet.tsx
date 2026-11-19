import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import type { ListingDetail, OfferView, ThreadDetail } from '@mpm/shared-types';
import BottomSheet from '@/components/BottomSheet';
import Button from '@/components/Button';
import Chip from '@/components/Chip';
import Field from '@/components/Field';
import Input from '@/components/Input';
import Notice from '@/components/Notice';
import PriceText from '@/components/PriceText';
import { useOffersOptions, useOfferWrite } from '@/hooks/use-offers';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { OFFER_EVENTS } from '@/lib/analytics-events';
import { errorCode, errorDetails } from '@/lib/api-error';
import { f6ErrorMessage } from '@/lib/f6-errors';
import { quantityText, unitPer } from '@/lib/listing-format';
import { TriangleAlert } from '@/lib/icons';
import { formatRupees } from '@/lib/money';
import {
  boundsHint, effectivePricePaise, formatPaiseText, hasOfferErrors, isNegotiableChain, offerFormState, offerRequestBody,
  offerTotals, ownLatestFor, roundLabel, validateOfferForm, validityParts, withOfferOptions, type OfferFormContext, type OfferFormErrors,
  type OfferFormValues, type OfferTermsBody, type SendOfferBody,
} from '@/lib/offer-form';
import { askPushOnce } from '@/lib/push-ask';
import { qk } from '@/lib/query-keys';
import { radius, spacing, useTheme } from '@/lib/theme';

/**
 * Make an offer / Buy at this price / Counter / Quote (F6 + F7 spec §15.1, mockup negotiate · "Make an offer"): one
 * sheet in four modes. `listing` for `offer` / `buy` from the listing page; `threadId` + `offer` for `counter`;
 * `threadId` for the seller's `quote`.
 */
export interface OfferSheetProps {
  mode: 'offer' | 'buy' | 'counter' | 'quote';
  listing?: ListingDetail;
  threadId?: string;
  offer?: OfferView;
  visible: boolean;
  onClose: () => void;
  onSent?: (r: { threadId: string }) => void;
}

type Unit = { key: string; label: string; decimals: number } | null;

/** What the rules know about the listing, per mode: the listing page's detail, or the thread's strip from the cache. */
function useSheetContext(props: OfferSheetProps): OfferFormContext & { unit: Unit; gstMode: ListingDetail['gstMode'] } {
  const qc = useQueryClient();
  const { mode, listing, offer } = props;
  const threadId = props.threadId ?? offer?.threadId ?? null;
  const strip = threadId ? qc.getQueryData<ThreadDetail>(qk.thread(threadId))?.listingStrip ?? null : null;
  if ((mode === 'offer' || mode === 'buy') && listing) {
    return {
      mode, askingPaise: listing.pricePaise, unit: listing.unit, unitDecimals: listing.unit?.decimals ?? 0,
      minOrderQty: listing.minOrderQty, available: listing.availableQuantity, gstMode: listing.gstMode,
    };
  }
  if (mode === 'counter' && offer) {
    return {
      mode, askingPaise: offer.askingPricePaise, unit: offer.unit, unitDecimals: offer.unit?.decimals ?? strip?.unit?.decimals ?? 3,
      minOrderQty: strip?.minOrderQty ?? null, available: strip?.availableQuantity ?? null, gstMode: offer.gstMode,
      bounds: offer.bounds, ownLatest: ownLatestFor(offer),
    };
  }
  return {
    mode, askingPaise: null, unit: strip?.unit ?? null, unitDecimals: strip?.unit?.decimals ?? 3,
    minOrderQty: strip?.minOrderQty ?? null, available: strip?.availableQuantity ?? null, gstMode: strip?.gstMode ?? null,
  };
}

export default function OfferSheet(props: OfferSheetProps) {
  const { mode, listing, offer, visible, onClose, onSent } = props;
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const options = useOffersOptions(visible);
  const write = useOfferWrite();
  const ctx = useSheetContext(props);
  const [values, setValues] = useState<OfferFormValues>(() => offerFormState({ mode }));
  const [tried, setTried] = useState(false);

  // A fresh form each time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    setValues(offerFormState({
      mode,
      listing: listing ?? null,
      offer: offer ?? null,
      options: options.data ?? null,
      strip: { minOrderQty: ctx.minOrderQty, availableQuantity: ctx.available },
    }));
    setTried(false);
  }, [visible, mode, listing?.id, offer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The validity choices arrived (or changed) while open: only the validity follows, what was typed stays.
  useEffect(() => {
    if (!visible || !options.data) return;
    const data = options.data;
    setValues((v) => withOfferOptions(v, data));
  }, [visible, options.data]);

  const s = useMemo(() => StyleSheet.create({
    asked: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md,
      backgroundColor: colors.field, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    },
    askedLabel: { ...type('caption'), color: colors.textSecondary },
    hint: { ...type('caption'), color: colors.textSecondary },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    total: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.md,
      borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.md,
    },
    totalLabel: { ...type('bodyStrong'), color: colors.text },
    totalRight: { alignItems: 'flex-end' },
    totalAmount: { ...type('price'), color: colors.text },
    totalNote: { ...type('caption'), color: colors.textSecondary },
    locked: { ...type('caption'), color: colors.textMuted },
    retry: { alignSelf: 'flex-start', marginTop: spacing.sm },
  }), [colors, type]);

  const errors: OfferFormErrors = validateOfferForm(values, ctx);
  const shown: OfferFormErrors = tried ? errors : {};
  const price = effectivePricePaise(values, ctx);
  const totals = offerTotals(
    { pricePaise: price, quantity: values.quantity, unitDecimals: ctx.unitDecimals },
    { gstMode: ctx.gstMode, askingPaise: ctx.askingPaise, negotiable: isNegotiableChain(mode, offer) },
  );
  const totalNote = [
    totals.gstLabelKey ? t(totals.gstLabelKey) : '',
    totals.percentBelow ? t('offers.sheet.percentBelow', { percent: totals.percentBelow }) : '',
  ].filter(Boolean).join(' · ');
  const hint = mode === 'counter' ? boundsHint(ctx.bounds) : null;
  const round = mode === 'counter' && offer ? roundLabel({ round: offer.round + 1 }) : null;
  const per = unitPer(ctx.unit);
  const qty = (q: string | null) => (q ? quantityText(q, ctx.unit) : '');

  const priceError = (): string | undefined => {
    switch (shown.price) {
      case undefined: return undefined;
      case 'counterOutOfBounds':
        return hint
          ? t('offers.error.counterOutOfBounds', { min: formatRupees(hint.minPaise), max: formatRupees(hint.maxPaise) })
          : t('errors.trade.counterOutOfBounds');
      case 'priceAboveAsking':
        return t('offers.error.priceAboveAsking', { price: formatRupees(ctx.askingPaise ?? 0) });
      default:
        return t(`offers.error.${shown.price}`);
    }
  };
  const quantityError = (): string | undefined => {
    switch (shown.quantity) {
      case undefined: return undefined;
      case 'quantityBelowMinimum': return t('offers.error.quantityBelowMinimum', { qty: qty(ctx.minOrderQty) });
      case 'quantityNotAvailable': return t('offers.error.quantityNotAvailable', { qty: qty(ctx.available) });
      case 'quantityDecimals': return t('offers.error.quantityDecimals', { count: ctx.unitDecimals });
      default: return t(`offers.error.${shown.quantity}`);
    }
  };

  const quantityHint = [
    ctx.available != null ? t('offers.sheet.available', { qty: qty(ctx.available) }) : '',
    ctx.minOrderQty ? t('offers.sheet.minOrder', { qty: qty(ctx.minOrderQty) }) : '',
  ].filter(Boolean).join(' · ');

  const title = t(`offers.sheet.title.${mode}`);
  const submitLabel = t(`offers.sheet.submit.${mode}`);

  const submit = () => {
    setTried(true);
    if (hasOfferErrors(errors)) return;
    const body = offerRequestBody(values, ctx);
    if (!body) return;
    const threadId = props.threadId ?? offer?.threadId ?? null;
    const w = mode === 'counter' && offer
      ? { type: 'counter' as const, offer, body: body as OfferTermsBody }
      : mode === 'quote' && threadId
        ? { type: 'quote' as const, threadId, body: body as OfferTermsBody }
        : listing
          ? { type: 'send' as const, listingId: listing.id, body: body as SendOfferBody }
          : null;
    if (!w) return;
    write.mutate(w, {
      onSuccess: (r) => {
        if (mode === 'counter') track(OFFER_EVENTS.offerCountered, { round: r.offer.round });
        else if (mode === 'quote') track(OFFER_EVENTS.quoteSent, { validityHours: values.validityHours });
        else track(OFFER_EVENTS.offerSent, { kind: mode === 'buy' ? 'buy_now' : 'offer', validityHours: values.validityHours });
        Toast.show({ type: 'success', text1: t(`offers.sheet.sent.${mode}`) });
        onClose();
        onSent?.({ threadId: r.threadId });
        void askPushOnce('offer'); // after any send: offer, buy, quote or counter (once per install)
      },
      onError: (err) => {
        const code = errorCode(err);
        const details = errorDetails(err);
        if (code === 'QUANTITY_NOT_AVAILABLE' && typeof details.available === 'string') {
          Toast.show({ type: 'error', text1: t('offers.error.quantityNotAvailable', { qty: qty(details.available) }) });
          return;
        }
        if (code === 'COUNTER_OUT_OF_BOUNDS' && typeof details.min === 'number' && typeof details.max === 'number') {
          Toast.show({ type: 'error', text1: t('offers.error.counterOutOfBounds', { min: formatRupees(details.min), max: formatRupees(details.max) }) });
          return;
        }
        Toast.show({ type: 'error', text1: f6ErrorMessage(err) });
      },
    });
  };

  const set = (patch: Partial<OfferFormValues>) => setValues((v) => ({ ...v, ...patch }));
  const choices = options.data?.validityHours ?? [];

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title} subtitle={round ? t(round.key, round.values) : undefined} testID="Offer-sheet-backdrop">
      {ctx.askingPaise != null && mode !== 'quote' ? (
        <View style={s.asked}>
          <Text style={s.askedLabel}>{t('offers.sheet.asks')}</Text>
          <PriceText paise={ctx.askingPaise} suffix={per} />
        </View>
      ) : null}
      {mode === 'counter' && offer ? (
        <View style={s.asked}>
          <Text style={s.askedLabel}>{t(offer.senderSide === 'buyer' ? 'offers.sheet.theirOffer' : 'offers.sheet.theirPrice')}</Text>
          <PriceText paise={offer.pricePerUnitPaise} suffix={per} />
        </View>
      ) : null}

      {mode === 'buy' ? (
        <Text style={s.locked}>{t('offers.sheet.buyLocked')}</Text>
      ) : (
        <Input
          label={t(mode === 'quote' ? 'offers.sheet.quotePrice' : 'offers.sheet.yourPrice')}
          prefix="₹"
          value={values.price}
          onChangeText={(price) => set({ price })}
          keyboardType="decimal-pad"
          error={priceError()}
          placeholder={hint ? t('offers.sheet.bounds', { min: formatRupees(hint.minPaise), max: formatRupees(hint.maxPaise) }) : undefined}
          testID="Offer-price"
        />
      )}
      {hint && !shown.price ? (
        <Text style={s.hint}>{t('offers.sheet.bounds', { min: formatRupees(hint.minPaise), max: formatRupees(hint.maxPaise) })}</Text>
      ) : null}

      <Input
        label={ctx.unit ? t('offers.sheet.quantityIn', { unit: ctx.unit.label }) : t('offers.sheet.quantity')}
        value={values.quantity}
        onChangeText={(quantity) => set({ quantity })}
        keyboardType={ctx.unitDecimals > 0 ? 'decimal-pad' : 'number-pad'}
        error={quantityError()}
        testID="Offer-quantity"
      />
      {quantityHint && !shown.quantity ? <Text style={s.hint}>{quantityHint}</Text> : null}

      <Field label={t('offers.sheet.validity')}>
        {options.isError && !options.data ? (
          <Notice tone="warning" icon={TriangleAlert} text={t('offers.sheet.optionsError')}>
            <Button
              title={t('common.retry')}
              onPress={() => void options.refetch()}
              variant="outline"
              size="sm"
              phLabel="Offer-options-retry"
              style={s.retry}
            />
          </Notice>
        ) : null}
        <View style={s.chips}>
          {choices.map((h) => {
            const v = validityParts(h);
            return (
              <Chip
                key={h}
                label={t(`offers.validity.${v.unit}`, { count: v.count })}
                selected={values.validityHours === h}
                onPress={() => set({ validityHours: h })}
                role="radio"
                testID={`Offer-validity-${h}`}
              />
            );
          })}
        </View>
      </Field>

      <Input
        label={t('offers.sheet.note')}
        value={values.note}
        onChangeText={(note) => set({ note })}
        multiline
        placeholder={t('offers.sheet.noteHint')}
        error={shown.note ? t('offers.error.noteTooLong') : undefined}
        testID="Offer-note"
      />

      <View style={s.total}>
        <Text style={s.totalLabel}>{t('offers.sheet.total')}</Text>
        <View style={s.totalRight}>
          <Text style={s.totalAmount} testID="Offer-total">{totals.totalPaise ? formatPaiseText(totals.totalPaise) : '–'}</Text>
          {totalNote ? <Text style={s.totalNote}>{totalNote}</Text> : null}
        </View>
      </View>

      <Button
        title={submitLabel}
        onPress={submit}
        loading={write.isPending || options.isLoading}
        disabled={values.validityHours == null}
        phLabel={`Offer-submit-${mode}`}
      />
    </BottomSheet>
  );
}
