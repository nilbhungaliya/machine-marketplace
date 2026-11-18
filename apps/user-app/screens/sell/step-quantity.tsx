import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFormik } from 'formik';
import type { MasterData } from '@mpm/shared-types';
import Card from '@/components/Card';
import Field from '@/components/Field';
import Input from '@/components/Input';
import ListRow from '@/components/ListRow';
import { useMasterData } from '@/hooks/use-listing';
import { conditionLabel, unitLabel } from '@/lib/listing-format';
import {
  CONDITION_NOTE_MAX, quantityInitial, quantityPatch, translateErrors, validateQuantity, type QuantityValues,
} from '@/lib/sell-form';
import { spacing } from '@/lib/theme';
import StepFrame, { StepSkeleton, type StepProps } from './step-frame';
import { PickerField, PickerSheet } from './sell-sheet';
import { formCheck } from './form-check';

/**
 * Step 3 for parts and machines for sale, Quantity and condition (F2 spec §4.2): the quantity in the unit the seller
 * picks (parts; decimals as the unit allows), or a whole number of machines (the server sets the machine unit), the
 * condition and an optional note. Rentals don't have this step (their count is on the machine step, R25).
 */
export default function StepQuantity({ ctx }: StepProps) {
  const master = useMasterData();
  if (!master.data) {
    return (
      <StepFrame key="loading" ctx={ctx} patch={() => null} validate={() => false} nextDisabled>
        <StepSkeleton />
      </StepFrame>
    );
  }
  return <QuantityForm key="ready" ctx={ctx} master={master.data} />;
}

function QuantityForm({ ctx, master }: StepProps & { master: MasterData }) {
  const { t } = useTranslation();
  const { listing } = ctx;
  const part = listing.kind === 'part';
  const [unitSheet, setUnitSheet] = useState(false);

  // Active units, plus the stored one if an admin has since deactivated it (grandfathered, §7.3).
  const units = useMemo(() => {
    const list = master.units.filter((u) => u.isActive);
    if (listing.unitId && listing.unit && !list.some((u) => u.id === listing.unitId)) {
      // The owner view's unit has no flag: take it from master data (it may list inactive units), else not a machine unit.
      const isMachineUnit = master.units.find((u) => u.id === listing.unitId)?.isMachineUnit ?? false;
      list.push({ id: listing.unitId, key: listing.unit.key, label: listing.unit.label, decimals: listing.unit.decimals, sortOrder: 999, isActive: false, isMachineUnit });
    }
    return list;
  }, [master.units, listing.unitId, listing.unit]);
  const conditions = useMemo(() => {
    const list = master.conditions.filter((c) => c.isActive);
    if (listing.conditionId && listing.condition && !list.some((c) => c.id === listing.conditionId)) {
      list.push({ id: listing.conditionId, key: listing.condition.key, label: listing.condition.label, description: null, sortOrder: 999, isActive: false });
    }
    return list;
  }, [master.conditions, listing.conditionId, listing.condition]);

  const decimalsOf = (unitId: string) => units.find((u) => u.id === unitId)?.decimals ?? 0;
  const form = useFormik<QuantityValues>({
    initialValues: quantityInitial(listing),
    validate: (v) => translateErrors(validateQuantity(v, { kind: listing.kind, decimals: decimalsOf(v.unitId) }), t),
    onSubmit: () => undefined,
  });
  const v = form.values;
  const err = (k: keyof QuantityValues) => (form.submitCount > 0 || form.touched[k] ? form.errors[k] : undefined);
  const unit = units.find((u) => u.id === v.unitId) ?? null;

  const s = useMemo(() => StyleSheet.create({ row: { flexDirection: 'row', gap: spacing.md }, half: { flex: 1 } }), []);

  return (
    <StepFrame
      ctx={ctx}
      patch={() => quantityPatch(v, listing.kind)}
      validate={({ loose }) => (loose ? true : formCheck(form))}
    >
      {part ? (
        <View style={s.row}>
          <View style={s.half}>
            <Input
              label={t('sell.quantity.label')}
              value={v.quantity}
              onChangeText={form.handleChange('quantity')}
              onBlur={form.handleBlur('quantity')}
              keyboardType={unit && unit.decimals > 0 ? 'decimal-pad' : 'number-pad'}
              maxLength={12}
              error={err('quantity')}
              testID="Sell-quantity"
            />
          </View>
          <View style={s.half}>
            <PickerField
              label={t('sell.quantity.unit')}
              value={unit ? unitLabel(unit) : null}
              placeholder={t('sell.quantity.pickUnit')}
              error={err('unitId')}
              onPress={() => setUnitSheet(true)}
              testID="Sell-unit"
            />
          </View>
        </View>
      ) : (
        <Input
          label={t('sell.quantity.machines')}
          value={v.quantity}
          onChangeText={form.handleChange('quantity')}
          onBlur={form.handleBlur('quantity')}
          keyboardType="number-pad"
          maxLength={4}
          error={err('quantity')}
          testID="Sell-quantity"
        />
      )}
      <Field label={t('sell.quantity.condition')} error={err('conditionId')}>
        <Card flush>
          {conditions.map((c, i) => (
            <ListRow
              key={c.id}
              label={conditionLabel(c)}
              hint={c.description ?? undefined}
              selected={v.conditionId === c.id}
              last={i === conditions.length - 1}
              onPress={() => void form.setFieldValue('conditionId', c.id)}
              testID="Sell-condition-option"
              accessibilityRole="radio"
              accessibilityState={{ selected: v.conditionId === c.id }}
            />
          ))}
        </Card>
      </Field>
      <Input
        label={t('sell.quantity.conditionNote')}
        placeholder={t('sell.quantity.conditionNotePlaceholder')}
        value={v.conditionNote}
        onChangeText={form.handleChange('conditionNote')}
        multiline
        maxLength={CONDITION_NOTE_MAX}
        error={err('conditionNote')}
        testID="Sell-condition-note"
      />
      <PickerSheet
        visible={unitSheet}
        title={t('sell.quantity.unit')}
        options={units.map((u) => ({ id: u.id, label: unitLabel(u) }))}
        selectedId={v.unitId || null}
        onPick={(id) => void form.setFieldValue('unitId', id)}
        onClose={() => setUnitSheet(false)}
        testID="Sell-unit-sheet"
      />
    </StepFrame>
  );
}
