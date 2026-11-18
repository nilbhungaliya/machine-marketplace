import React, { useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFormik } from 'formik';
import type { TemplateField } from '@mpm/shared-types';
import { LISTING_DESCRIPTION_MAX, LISTING_TITLE_MAX } from '@mpm/shared-types';
import Chip from '@/components/Chip';
import Field, { FieldHint } from '@/components/Field';
import Input from '@/components/Input';
import { useBrands, useModels } from '@/hooks/use-listing';
import { istDateKey } from '@/lib/ist-date';
import {
  machineInitial, machinePatch, MACHINE_OTHER_MAX, REASON_FOR_SALE_MAX, SERIAL_MAX, translateErrors, validateMachine,
  type MachineValues,
} from '@/lib/sell-form';
import { machineTitle } from '@/lib/sell-wizard';
import { buildSpecSchema, specInitialValues, toSpecs, type SpecFormValues } from '@/lib/spec-form';
import { spacing } from '@/lib/theme';
import StepFrame, { StepSkeleton, type StepProps } from './step-frame';
import SpecFields, { useSpecTemplate } from './spec-fields';
import { PickerField, PickerSheet } from './sell-sheet';
import { formCheck, specErrors } from './form-check';

type Values = MachineValues & { specs: SpecFormValues };

const OTHER = '__other__';
const NONE = '__none__';

/**
 * Step 2 for machines and rentals, Machine (F2 spec §5.2, §4.4): make and model from the catalogue or "Other", year,
 * the title (prefilled "type, make model" until the seller edits it, R28), the machine type's template fields, hours,
 * serial (private), running and inspection, reason for sale (sale only). Rentals ask their machine count here (no
 * quantity step).
 */
export default function StepMachine({ ctx }: StepProps) {
  const template = useSpecTemplate(ctx.listing.categoryId, ctx.listing.kind);
  if (template.loading) {
    return (
      <StepFrame key="loading" ctx={ctx} patch={() => null} validate={() => false} nextDisabled>
        <StepSkeleton />
      </StepFrame>
    );
  }
  return <MachineForm key="ready" ctx={ctx} fields={template.fields} />;
}

function MachineForm({ ctx, fields }: StepProps & { fields: TemplateField[] }) {
  const { t } = useTranslation();
  const { listing, node } = ctx;
  const rental = listing.kind === 'machine_rental';
  const thisYear = Number(istDateKey().slice(0, 4));
  const typeId = listing.categoryId;
  const brands = useBrands('machines', typeId);
  const [sheet, setSheet] = useState<'brand' | 'model' | null>(null);
  // The title follows make and model until the seller types their own (R28).
  const titleEdited = useRef(listing.title.trim() !== '');
  const loose = useMemo(() => buildSpecSchema(fields, t, { enforceRequired: false }), [fields, t]);
  const strict = useMemo(() => buildSpecSchema(fields, t), [fields, t]);

  const initial = machineInitial(listing);
  const form = useFormik<Values>({
    initialValues: {
      ...initial,
      title: initial.title || machineTitle(node?.name, listing.machine?.brandName ?? listing.machine?.brandOther, listing.machine?.modelName ?? listing.machine?.modelOther),
      specs: specInitialValues(fields, listing.specs),
    },
    validate: (v) => ({ ...translateErrors(validateMachine(v, { kind: listing.kind, thisYear }), t), ...specErrors(strict, v.specs) }),
    onSubmit: () => undefined,
  });
  const v = form.values;
  const models = useModels(v.brandIsOther ? null : v.brandId, typeId);
  const err = (k: keyof MachineValues) => (form.submitCount > 0 || form.touched[k] ? form.errors[k] : undefined);
  const specErr = (form.submitCount > 0 ? form.errors.specs : undefined) as Partial<Record<string, string>> | undefined;

  const brandName = v.brandIsOther ? v.brandOther : brands.data?.find((b) => b.id === v.brandId)?.name ?? listing.machine?.brandName ?? null;
  const modelName = v.modelIsOther ? v.modelOther : models.data?.find((m) => m.id === v.modelId)?.name
    ?? (v.modelId && v.modelId === listing.machine?.modelId ? listing.machine.modelName : null);

  const retitle = (make: string | null | undefined, model: string | null | undefined) => {
    if (!titleEdited.current) void form.setFieldValue('title', machineTitle(node?.name, make, model));
  };

  const pickBrand = (id: string) => {
    const other = id === OTHER;
    void form.setValues({
      ...v, brandId: other ? null : id, brandIsOther: other, brandOther: other ? v.brandOther : '',
      modelId: null, modelIsOther: false, modelOther: '',
    });
    retitle(other ? v.brandOther : brands.data?.find((b) => b.id === id)?.name, null);
  };
  const pickModel = (id: string) => {
    const other = id === OTHER;
    if (id === NONE) {
      void form.setValues({ ...v, modelId: null, modelIsOther: false, modelOther: '' });
      retitle(brandName, null);
      return;
    }
    void form.setValues({ ...v, modelId: other ? null : id, modelIsOther: other, modelOther: other ? v.modelOther : '' });
    retitle(brandName, other ? v.modelOther : models.data?.find((m) => m.id === id)?.name);
  };

  const s = useMemo(() => StyleSheet.create({ chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm } }), []);

  return (
    <StepFrame
      ctx={ctx}
      patch={() => machinePatch(v, listing.kind, toSpecs(v.specs, fields, listing.specs))}
      validate={({ loose: isLoose }) => (isLoose
        ? Object.keys(validateMachine(v, { kind: listing.kind, thisYear })).length === 0 && Object.keys(specErrors(loose, v.specs)).length === 0
        : formCheck(form))}
    >
      <PickerField
        label={t('sell.machine.make')}
        value={v.brandIsOther ? t('sell.machine.other') : brandName}
        placeholder={t('sell.machine.pickMake')}
        error={err('brandId')}
        onPress={() => setSheet('brand')}
        testID="Sell-machine-make"
      />
      {v.brandIsOther ? (
        <Input
          label={t('sell.machine.makeOther')}
          value={v.brandOther}
          onChangeText={(text) => { void form.setFieldValue('brandOther', text); retitle(text, modelName); }}
          maxLength={MACHINE_OTHER_MAX}
          error={err('brandOther')}
          testID="Sell-machine-make-other"
        />
      ) : null}
      <PickerField
        label={t('sell.machine.model')}
        value={v.modelIsOther ? t('sell.machine.other') : modelName}
        placeholder={t('sell.machine.pickModel')}
        hint={t('sell.optional')}
        disabled={!v.brandId && !v.brandIsOther}
        onPress={() => (v.brandIsOther ? pickModel(OTHER) : setSheet('model'))}
        testID="Sell-machine-model"
      />
      {v.modelIsOther ? (
        <Input
          label={t('sell.machine.modelOther')}
          value={v.modelOther}
          onChangeText={(text) => { void form.setFieldValue('modelOther', text); retitle(brandName, text); }}
          maxLength={MACHINE_OTHER_MAX}
          error={err('modelOther')}
          testID="Sell-machine-model-other"
        />
      ) : null}
      <Input
        label={t('sell.machine.year')}
        placeholder={t('sell.optional')}
        value={v.year}
        onChangeText={form.handleChange('year')}
        keyboardType="number-pad"
        maxLength={4}
        error={err('year')}
        testID="Sell-machine-year"
      />
      <Input
        label={t('sell.machine.title')}
        value={v.title}
        onChangeText={(text) => { titleEdited.current = true; void form.setFieldValue('title', text); }}
        onBlur={form.handleBlur('title')}
        maxLength={LISTING_TITLE_MAX}
        error={err('title')}
        testID="Sell-machine-title"
      />
      {rental ? (
        <Input
          label={t('sell.machine.count')}
          value={v.count}
          onChangeText={form.handleChange('count')}
          keyboardType="number-pad"
          maxLength={4}
          error={err('count')}
          testID="Sell-machine-count"
        />
      ) : null}
      <SpecFields
        fields={fields}
        values={v.specs}
        errors={specErr ?? {}}
        onChange={(key, value) => void form.setFieldValue(`specs.${key}`, value)}
      />
      <Input
        label={t('sell.machine.hoursRun')}
        placeholder={t('sell.optional')}
        value={v.hoursRun}
        onChangeText={form.handleChange('hoursRun')}
        keyboardType="number-pad"
        maxLength={9}
        error={err('hoursRun')}
        testID="Sell-machine-hours"
      />
      <View>
        <Input
          label={t('sell.machine.serial')}
          placeholder={t('sell.optional')}
          value={v.serialNumber}
          onChangeText={form.handleChange('serialNumber')}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={SERIAL_MAX}
          mono
          error={err('serialNumber')}
          testID="Sell-machine-serial"
        />
        <FieldHint>{t('sell.machine.serialHint')}</FieldHint>
      </View>
      <Field label={t('sell.machine.viewing')}>
        <View style={s.chips}>
          <Chip
            label={t('sell.machine.running')}
            selected={v.underPower}
            onPress={() => void form.setFieldValue('underPower', !v.underPower)}
            testID="Sell-machine-running"
          />
          <Chip
            label={t('sell.machine.inspection')}
            selected={v.inspection}
            onPress={() => void form.setFieldValue('inspection', !v.inspection)}
            testID="Sell-machine-inspection"
          />
        </View>
      </Field>
      {!rental ? (
        <Input
          label={t('sell.machine.reason')}
          placeholder={t('sell.optional')}
          value={v.reasonForSale}
          onChangeText={form.handleChange('reasonForSale')}
          maxLength={REASON_FOR_SALE_MAX}
          error={err('reasonForSale')}
          testID="Sell-machine-reason"
        />
      ) : null}
      <Input
        label={t('sell.details.description')}
        placeholder={t('sell.details.descriptionPlaceholder')}
        value={v.description}
        onChangeText={form.handleChange('description')}
        multiline
        maxLength={LISTING_DESCRIPTION_MAX}
        error={err('description')}
        testID="Sell-description"
      />

      <PickerSheet
        visible={sheet === 'brand'}
        title={t('sell.machine.make')}
        options={(brands.data ?? []).map((b) => ({ id: b.id, label: b.name }))}
        selectedId={v.brandIsOther ? OTHER : v.brandId}
        extra={[{ id: OTHER, label: t('sell.machine.otherMake') }]}
        onPick={pickBrand}
        onClose={() => setSheet(null)}
        testID="Sell-make-sheet"
      />
      <PickerSheet
        visible={sheet === 'model'}
        title={t('sell.machine.model')}
        options={(models.data ?? []).map((m) => ({ id: m.id, label: m.name }))}
        selectedId={v.modelIsOther ? OTHER : v.modelId}
        extra={[{ id: OTHER, label: t('sell.machine.otherModel') }, { id: NONE, label: t('sell.machine.noModel') }]}
        onPick={pickModel}
        onClose={() => setSheet(null)}
        testID="Sell-model-sheet"
      />
    </StepFrame>
  );
}
