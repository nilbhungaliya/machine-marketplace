import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFormik } from 'formik';
import {
  RENTAL_FUEL_OPTIONS, RENTAL_OPERATOR_OPTIONS, RENTAL_PERIODS, RENTAL_TRANSPORT_OPTIONS,
} from '@mpm/shared-types';
import Chip from '@/components/Chip';
import Field, { FieldError } from '@/components/Field';
import Input from '@/components/Input';
import { istDateKey } from '@/lib/ist-date';
import {
  AVAILABILITY_NOTE_MAX, operatorHasRate, ratesInitial, ratesPatch, translateErrors, validateRates, type RatesValues,
} from '@/lib/sell-form';
import { spacing } from '@/lib/theme';
import StepFrame, { type StepProps } from './step-frame';
import { formCheck } from './form-check';

type Errors = Partial<Record<keyof RatesValues | 'rates', string>>;

/**
 * Rates and terms for a machine for rent (F2 spec §4.5, M14, R25): rates per hour / day / week / month (at least one),
 * the day and month definitions, overtime, minimum hire, operator, fuel, transport, deposit and availability.
 */
export default function StepRates({ ctx }: StepProps) {
  const { t } = useTranslation();
  const { listing } = ctx;
  const ratesCtx = { today: istDateKey(), previousAvailableFrom: listing.rental?.availableFrom ?? null };

  const form = useFormik<RatesValues>({
    initialValues: ratesInitial(listing.rental),
    validate: (v) => translateErrors(validateRates(v, ratesCtx), t),
    onSubmit: () => undefined,
  });
  const v = form.values;
  const errors = form.errors as Errors;
  const err = (k: keyof RatesValues | 'rates') => (form.submitCount > 0 || (k !== 'rates' && form.touched[k]) ? errors[k] : undefined);

  const s = useMemo(() => StyleSheet.create({
    row: { flexDirection: 'row', gap: spacing.md },
    half: { flex: 1 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  }), []);

  const money = (k: keyof RatesValues, label: string, { testID }: { testID: string }) => (
    <Input
      label={label}
      prefix="₹"
      placeholder={t('sell.optional')}
      value={v[k] as string}
      onChangeText={form.handleChange(k)}
      onBlur={form.handleBlur(k)}
      keyboardType="decimal-pad"
      maxLength={16}
      error={err(k)}
      testID={testID}
    />
  );
  const whole = (k: keyof RatesValues, label: string, { testID, max }: { testID: string; max: number }) => (
    <Input
      label={label}
      value={v[k] as string}
      onChangeText={form.handleChange(k)}
      onBlur={form.handleBlur(k)}
      keyboardType="number-pad"
      maxLength={max}
      error={err(k)}
      testID={testID}
    />
  );

  return (
    <StepFrame
      ctx={ctx}
      patch={() => ratesPatch(v)}
      validate={({ loose }) => (loose ? Object.keys(validateRates(v, ratesCtx)).filter((k) => k !== 'rates').length === 0 : formCheck(form))}
    >
      <Field label={t('sell.rates.title')} hint={t('sell.rates.atLeastOne')}>
        <View style={{ gap: spacing.sm }}>
          <View style={s.row}>
            <View style={s.half}>{money('hour', t('listing.periodName.hour'), { testID: 'Sell-rate-hour' })}</View>
            <View style={s.half}>{money('day', t('listing.periodName.day'), { testID: 'Sell-rate-day' })}</View>
          </View>
          <View style={s.row}>
            <View style={s.half}>{money('week', t('listing.periodName.week'), { testID: 'Sell-rate-week' })}</View>
            <View style={s.half}>{money('month', t('listing.periodName.month'), { testID: 'Sell-rate-month' })}</View>
          </View>
        </View>
      </Field>
      {err('rates') ? <FieldError>{err('rates')!}</FieldError> : null}
      <View style={s.row}>
        <View style={s.half}>{whole('shiftHours', t('sell.rates.shiftHours'), { testID: 'Sell-shift-hours', max: 2 })}</View>
        <View style={s.half}>{whole('monthDays', t('sell.rates.monthDays'), { testID: 'Sell-month-days', max: 2 })}</View>
      </View>
      {money('overtime', t('sell.rates.overtime'), { testID: 'Sell-overtime' })}
      {whole('minDuration', t('sell.rates.minDuration'), { testID: 'Sell-min-duration', max: 3 })}
      {v.minDuration.trim() !== '' ? (
        <Field label={t('sell.rates.minDurationPeriod')} error={err('minDurationPeriod')}>
          <View style={s.chips}>
            {RENTAL_PERIODS.map((p) => (
              <Chip
                key={p}
                label={t(`sell.rates.period.${p}`)}
                role="radio"
                selected={v.minDurationPeriod === p}
                onPress={() => void form.setFieldValue('minDurationPeriod', p)}
                testID={`Sell-min-period-${p}`}
              />
            ))}
          </View>
        </Field>
      ) : null}
      <Field label={t('sell.rates.operator')}>
        <View style={s.chips}>
          {RENTAL_OPERATOR_OPTIONS.map((o) => (
            <Chip
              key={o}
              label={t(`listing.rental.operator.${o}`)}
              role="radio"
              selected={v.operator === o}
              onPress={() => void form.setFieldValue('operator', v.operator === o ? null : o)}
              testID={`Sell-operator-${o}`}
            />
          ))}
        </View>
      </Field>
      {operatorHasRate(v.operator) ? money('operatorRate', t('sell.rates.operatorRate'), { testID: 'Sell-operator-rate' }) : null}
      <Field label={t('sell.rates.fuel')}>
        <View style={s.chips}>
          {RENTAL_FUEL_OPTIONS.map((f) => (
            <Chip
              key={f}
              label={t(`listing.rental.fuel.${f}`)}
              role="radio"
              selected={v.fuel === f}
              onPress={() => void form.setFieldValue('fuel', f)}
              testID={`Sell-fuel-${f}`}
            />
          ))}
        </View>
      </Field>
      <Field label={t('sell.rates.transport')}>
        <View style={s.chips}>
          {RENTAL_TRANSPORT_OPTIONS.map((o) => (
            <Chip
              key={o}
              label={t(`listing.rental.transport.${o}`)}
              role="radio"
              selected={v.transport === o}
              onPress={() => void form.setFieldValue('transport', v.transport === o ? null : o)}
              testID={`Sell-transport-${o}`}
            />
          ))}
        </View>
      </Field>
      {money('transportCharge', t('sell.rates.transportCharge'), { testID: 'Sell-transport-charge' })}
      {money('deposit', t('sell.rates.deposit'), { testID: 'Sell-deposit' })}
      <Input
        label={t('sell.rates.availableFrom')}
        placeholder={t('sell.spec.datePlaceholder')}
        value={v.availableFrom}
        onChangeText={form.handleChange('availableFrom')}
        onBlur={form.handleBlur('availableFrom')}
        keyboardType="numbers-and-punctuation"
        maxLength={10}
        error={err('availableFrom') ?? undefined}
        testID="Sell-available-from"
      />
      <Input
        label={t('sell.rates.availabilityNote')}
        placeholder={t('sell.optional')}
        value={v.availabilityNote}
        onChangeText={form.handleChange('availabilityNote')}
        maxLength={AVAILABILITY_NOTE_MAX}
        error={err('availabilityNote')}
        testID="Sell-availability-note"
      />
    </StepFrame>
  );
}
