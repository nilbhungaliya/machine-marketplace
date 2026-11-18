import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFormik } from 'formik';
import { GST_PRICE_MODES, PRICE_MODELS, type PriceModel } from '@mpm/shared-types';
import Chip from '@/components/Chip';
import Field from '@/components/Field';
import Input from '@/components/Input';
import SegmentedControl from '@/components/SegmentedControl';
import { useType } from '@/hooks/use-type';
import { unitPer } from '@/lib/listing-format';
import { pricePatch, priceInitial, translateErrors, validatePrice, type PriceValues } from '@/lib/sell-form';
import { spacing, useTheme } from '@/lib/theme';
import StepFrame, { type StepProps } from './step-frame';
import { formCheck } from './form-check';

/**
 * Price (F2 spec §4.6, §5.2) for parts and machines for sale: the price model, the price per unit in rupees
 * (`parseRupees`, Hindi / Gujarati digits), GST included or extra, and (parts) a minimum order. "Price on request"
 * hides the price and GST.
 */
export default function StepPrice({ ctx }: StepProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const { listing } = ctx;
  const part = listing.kind === 'part';
  const decimals = listing.unit?.decimals ?? 0;

  const form = useFormik<PriceValues>({
    initialValues: priceInitial(listing),
    validate: (v) => translateErrors(validatePrice(v, { kind: listing.kind, decimals, quantity: listing.quantity }), t),
    onSubmit: () => undefined,
  });
  const v = form.values;
  const err = (k: keyof PriceValues) => (form.submitCount > 0 || form.touched[k] ? form.errors[k] : undefined);
  const onRequest = v.priceModel === 'on_request';
  const per = unitPer(listing.unit);

  const s = useMemo(() => StyleSheet.create({
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    fine: { ...type('caption'), color: colors.textSecondary },
  }), [colors, type]);

  return (
    <StepFrame
      ctx={ctx}
      patch={() => pricePatch(v, listing.kind)}
      validate={({ loose }) => (loose ? Object.keys(validatePrice(v, { kind: listing.kind, decimals, quantity: listing.quantity })).length === 0 : formCheck(form))}
    >
      <Field label={t('sell.price.model')} error={err('priceModel')}>
        <SegmentedControl<PriceModel | ''>
          options={PRICE_MODELS.map((m) => ({ value: m, label: t(`sell.price.modelShort.${m}`), testID: `Sell-price-model-${m}` }))}
          value={v.priceModel ?? ''}
          onChange={(m) => void form.setFieldValue('priceModel', m || null)}
          accessibilityLabel={t('sell.price.model')}
        />
      </Field>
      {!onRequest ? (
        <>
          <Input
            label={per ? t('sell.price.amountPer', { per }) : t('sell.price.amount')}
            prefix="₹"
            value={v.price}
            onChangeText={form.handleChange('price')}
            onBlur={form.handleBlur('price')}
            keyboardType="decimal-pad"
            maxLength={16}
            error={err('price')}
            testID="Sell-price"
          />
          <Field label={t('sell.price.gst')} error={err('gstMode')}>
            <View style={s.chips}>
              {GST_PRICE_MODES.map((g) => (
                <Chip
                  key={g}
                  label={t(`listing.price.gst.${g}`)}
                  role="radio"
                  selected={v.gstMode === g}
                  onPress={() => void form.setFieldValue('gstMode', g)}
                  testID={`Sell-gst-${g}`}
                />
              ))}
            </View>
          </Field>
        </>
      ) : null}
      {part ? (
        <Input
          label={t('sell.price.minOrder')}
          placeholder={t('sell.optional')}
          value={v.minOrder}
          onChangeText={form.handleChange('minOrder')}
          onBlur={form.handleBlur('minOrder')}
          keyboardType={decimals > 0 ? 'decimal-pad' : 'number-pad'}
          maxLength={12}
          error={err('minOrder')}
          testID="Sell-min-order"
        />
      ) : null}
      <Text style={s.fine}>{t('sell.price.modelHelp')}</Text>
    </StepFrame>
  );
}
