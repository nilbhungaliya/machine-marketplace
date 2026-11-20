import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { RENTAL_LIMITS, rentalCountLimits, type RentalBookingView, type RentalChangeInput, type RentalPeriod } from '@mpm/shared-types';
import BottomSheet from '@/components/BottomSheet';
import Button from '@/components/Button';
import Chip from '@/components/Chip';
import Field from '@/components/Field';
import Input from '@/components/Input';
import Notice from '@/components/Notice';
import SegmentedControl from '@/components/SegmentedControl';
import DateRangeSheet from '@/components/rentals/DateRangeSheet';
import { isStaleBookingError, useRentalBookingWrite } from '@/hooks/use-rental-calendar';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { RENTAL_EVENTS } from '@/lib/analytics-events';
import { errorCode } from '@/lib/api-error';
import { useLanguage } from '@/lib/i18n/language';
import { CalendarClock, TriangleAlert } from '@/lib/icons';
import { istDateKey } from '@/lib/ist-date';
import { m14ErrorMessage } from '@/lib/m14-errors';
import { formatRupees, rupeesInput } from '@/lib/money';
import { dateRangeLabel, periodLabelKey } from '@/lib/rental-display';
import { changeFormFrom, hasFormErrors, offeredPeriods, percentVsEstimate, readChangeForm, type ChangeFormValues } from '@/lib/rental-return';
import { proposeBookingChange } from '@/lib/rentals-api';
import { radius, spacing, useTheme } from '@/lib/theme';

export interface ProposeChangeSheetProps {
  /** The owner's view of a `requested` booking: its open version prefills the form. */
  view: RentalBookingView;
  visible: boolean;
  onClose: () => void;
  /** The fresh view after `POST /rental-bookings/:id/change` (status `countered`). */
  onSent: (view: RentalBookingView) => void;
}

/**
 * Propose a change (§6.3, owner on `requested`): start date, charged by, count, machines and the options the listing
 * leaves open, then the owner's own total, prefilled with the estimate for the new terms (`rentalEstimate` on the
 * booking's terms snapshot, the server's rule) and shown as "% vs estimate"; an optional message. The renter accepts,
 * changes or declines it. A full date range comes back as `409 RENTAL_DATES_TAKEN`, shown in the sheet.
 */
export default function ProposeChangeSheet({ view, visible, onClose, onSent }: ProposeChangeSheetProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const lang = useLanguage();
  const write = useRentalBookingWrite(view.id);
  const [values, setValues] = useState<ChangeFormValues>(() => changeFormFrom(view.current));
  const [totalEdited, setTotalEdited] = useState(false);
  const [tried, setTried] = useState(false);
  const [picking, setPicking] = useState(false);
  const [taken, setTaken] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setValues(changeFormFrom(view.current));
    setTotalEdited(false);
    setTried(false);
    setTaken(false);
    // Only a new open version resets what was typed (a refetch of the same booking doesn't).
  }, [visible, view.id, view.current.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = useMemo(() => StyleSheet.create({
    dateField: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52,
      backgroundColor: colors.field, borderRadius: radius.md, paddingHorizontal: spacing.lg,
    },
    dateValue: { ...type('fieldValue'), color: colors.text, flex: 1 },
    dateEnd: { ...type('caption'), color: colors.textSecondary },
    two: { flexDirection: 'row', gap: spacing.md },
    half: { flex: 1 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    money: {
      backgroundColor: colors.primaryWash, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm,
      borderWidth: 1, borderColor: colors.hairline,
    },
    moneyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.md },
    moneyLabel: { ...type('caption'), color: colors.textSecondary },
    moneyValue: { ...type('bodyStrong'), color: colors.text },
    pct: { ...type('caption'), color: colors.text },
    left: { ...type('caption'), color: colors.textSecondary },
  }), [colors, type]);

  const terms = view.terms;
  const periods = offeredPeriods(terms);
  const form = readChangeForm({ ...values, total: totalEdited ? values.total : '' }, terms);
  const shown = tried ? form.errors : {};
  const set = (patch: Partial<ChangeFormValues>) => {
    setTaken(false);
    setValues((v) => ({ ...v, ...patch }));
  };
  const limits = rentalCountLimits[values.period];
  const totalText = totalEdited ? values.total : rupeesInput(form.estimatePaise);
  const pct = form.totalPaise != null && form.estimatePaise != null ? percentVsEstimate(form.totalPaise, form.estimatePaise) : 0;
  const changesAfter = Math.max(0, view.changesLeft - 1);

  const submit = () => {
    setTried(true);
    if (hasFormErrors(form.errors) || form.count == null || form.machines == null || form.totalPaise == null) return;
    const message = values.message.trim();
    const body: RentalChangeInput = {
      versionSeq: view.current.seq,
      startDate: values.startDate,
      period: values.period,
      count: form.count,
      machines: form.machines,
      ...(terms.operator === 'optional' ? { withOperator: values.withOperator } : {}),
      ...(terms.transport === 'either' ? { ownerDelivers: values.ownerDelivers } : {}),
      totalPaise: form.totalPaise,
      ...(message ? { message } : {}),
    };
    write.mutate((key) => proposeBookingChange(view.id, body, key), {
      onSuccess: (fresh) => {
        track(RENTAL_EVENTS.bookingAction, { bookingId: view.id, action: 'change', status: fresh.status });
        Toast.show({ type: 'success', text1: t('rentalsOwner.change.sent') });
        onSent(fresh);
        onClose();
      },
      onError: (err) => {
        const code = errorCode(err);
        track(RENTAL_EVENTS.bookingActionFailed, { bookingId: view.id, action: 'change', reason: code });
        if (code === 'RENTAL_DATES_TAKEN') {
          setTaken(true);
          return;
        }
        Toast.show({ type: 'error', text1: m14ErrorMessage(err) });
        if (isStaleBookingError(err)) onClose();
      },
    });
  };

  const countError = shown.count === 'belowMinimum'
    ? t('rentals.errors.belowMinimum')
    : shown.count === 'invalid' ? t('rentalsOwner.change.countInvalid', { min: limits.min, max: limits.max }) : undefined;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('rentalsOwner.change.title')}
      subtitle={t('rentalsOwner.change.subtitle', { ref: view.ref, name: view.counterpart.tradeName })}
      testID="ProposeChange-backdrop"
    >
      <Field label={t('rentalsOwner.change.start')}>
        <Pressable
          style={s.dateField}
          onPress={() => setPicking(true)}
          accessibilityRole="button"
          testID="ProposeChange-start"
        >
          <CalendarClock size={20} color={colors.primaryInk} />
          <Text style={s.dateValue}>{dateRangeLabel(values.startDate, values.startDate, lang)}</Text>
          {form.endDate && form.endDate !== values.startDate ? (
            <Text style={s.dateEnd}>{t('rentalsOwner.change.ends', { date: dateRangeLabel(form.endDate, form.endDate, lang) })}</Text>
          ) : null}
        </Pressable>
      </Field>

      {periods.length > 1 ? (
        <Field label={t('rentalsOwner.change.chargedBy')}>
          <SegmentedControl<RentalPeriod>
            options={periods.map((p) => ({ value: p, label: t(periodLabelKey(p)), testID: `ProposeChange-period-${p}` }))}
            value={values.period}
            onChange={(period) => set({ period })}
            accessibilityLabel={t('rentalsOwner.change.chargedBy')}
          />
        </Field>
      ) : null}

      <View style={s.two}>
        <View style={s.half}>
        <Input
          label={t(`rentalsOwner.change.count.${values.period}`)}
          value={values.count}
          onChangeText={(count) => set({ count })}
          keyboardType="number-pad"
          error={countError}
          testID="ProposeChange-count"
        />
        </View>
        <View style={s.half}>
        <Input
          label={t('rentalsOwner.change.machines')}
          value={values.machines}
          onChangeText={(machines) => set({ machines })}
          keyboardType="number-pad"
          error={shown.machines ? t('rentals.errors.rentalMachinesInvalid') : undefined}
          testID="ProposeChange-machines"
        />
        </View>
      </View>

      {terms.operator === 'optional' ? (
        <Field label={t('rentalsOwner.change.operator')}>
          <View style={s.chips}>
            <Chip label={t('rentalsOwner.change.withOperator')} selected={values.withOperator} onPress={() => set({ withOperator: true })} role="radio" testID="ProposeChange-operator-with" />
            <Chip label={t('rentalsOwner.change.withoutOperator')} selected={!values.withOperator} onPress={() => set({ withOperator: false })} role="radio" testID="ProposeChange-operator-without" />
          </View>
        </Field>
      ) : null}
      {terms.transport === 'either' ? (
        <Field label={t('rentalsOwner.change.transport')}>
          <View style={s.chips}>
            <Chip label={t('rentalsOwner.change.ownerDelivers')} selected={values.ownerDelivers} onPress={() => set({ ownerDelivers: true })} role="radio" testID="ProposeChange-transport-owner" />
            <Chip label={t('rentalsOwner.change.renterPicksUp')} selected={!values.ownerDelivers} onPress={() => set({ ownerDelivers: false })} role="radio" testID="ProposeChange-transport-renter" />
          </View>
        </Field>
      ) : null}

      <View style={s.money}>
        <View style={s.moneyRow}>
          <Text style={s.moneyLabel}>{t('rentalsOwner.change.estimate')}</Text>
          <Text style={s.moneyValue} testID="ProposeChange-estimate">
            {form.estimatePaise != null ? formatRupees(form.estimatePaise) : '–'}
          </Text>
        </View>
        <Input
          label={t('rentalsOwner.change.total')}
          prefix="₹"
          value={totalText}
          onChangeText={(total) => {
            // Clearing the field goes back to the estimate for these terms.
            setTotalEdited(total.trim() !== '');
            set({ total });
          }}
          keyboardType="decimal-pad"
          error={shown.total ? t('rentalsOwner.change.totalInvalid') : undefined}
          testID="ProposeChange-total"
        />
        {form.totalPaise != null && form.estimatePaise != null ? (
          <Text style={s.pct} testID="ProposeChange-percent">
            {pct === 0
              ? t('rentalsOwner.change.sameAsEstimate')
              : t(pct < 0 ? 'rentalsOwner.change.belowEstimate' : 'rentalsOwner.change.aboveEstimate', { percent: Math.abs(pct) })}
          </Text>
        ) : null}
      </View>

      <Input
        label={t('rentalsOwner.change.message')}
        value={values.message}
        onChangeText={(message) => set({ message })}
        multiline
        placeholder={t('rentalsOwner.change.messageHint')}
        error={shown.message ? t('rentalsOwner.tooLong', { max: RENTAL_LIMITS.messageMax }) : undefined}
        testID="ProposeChange-message"
      />

      {taken ? (
        <Notice tone="danger" icon={TriangleAlert} text={t('rentals.errors.rentalDatesTaken')} />
      ) : null}
      <Text style={s.left}>{t('rentalsOwner.change.changesAfter', { count: changesAfter })}</Text>
      <Button
        title={t('rentalsOwner.change.submit')}
        onPress={submit}
        loading={write.isPending}
        phLabel="ProposeChange-submit"
      />

      <DateRangeSheet
        visible={picking}
        mode="single"
        value={{ start: values.startDate }}
        onClose={() => setPicking(false)}
        onPick={(v) => {
          setPicking(false);
          if (v.start >= istDateKey()) set({ startDate: v.start });
        }}
      />
    </BottomSheet>
  );
}
