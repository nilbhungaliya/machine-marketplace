import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormik } from 'formik';
import type { TemplateField } from '@mpm/shared-types';
import { LISTING_DESCRIPTION_MAX, LISTING_TITLE_MAX, PART_NUMBER_MAX } from '@mpm/shared-types';
import Input from '@/components/Input';
import Notice from '@/components/Notice';
import { Info } from '@/lib/icons';
import { partDetailsInitial, partDetailsPatch, translateErrors, validatePartDetails, type PartDetailsValues } from '@/lib/sell-form';
import { buildSpecSchema, specInitialValues, toSpecs, type SpecFormValues } from '@/lib/spec-form';
import StepFrame, { StepSkeleton, type StepProps } from './step-frame';
import SpecFields, { useSpecTemplate } from './spec-fields';
import { formCheck, specErrors } from './form-check';

type Values = PartDetailsValues & { specs: SpecFormValues };

/**
 * Step 2 for parts, Part details (F2 spec §5.2, §4.3): part name (prefilled with the part group's name, R28), part
 * number, description and the part group's template fields.
 */
export default function StepPartDetails({ ctx }: StepProps) {
  const template = useSpecTemplate(ctx.listing.categoryId, ctx.listing.kind);
  if (template.loading) {
    return (
      <StepFrame key="loading" ctx={ctx} patch={() => null} validate={() => false} nextDisabled>
        <StepSkeleton />
      </StepFrame>
    );
  }
  return <PartDetailsForm key="ready" ctx={ctx} fields={template.fields} />;
}

function PartDetailsForm({ ctx, fields }: StepProps & { fields: TemplateField[] }) {
  const { t } = useTranslation();
  const { listing, node } = ctx;
  const loose = useMemo(() => buildSpecSchema(fields, t, { enforceRequired: false }), [fields, t]);
  const strict = useMemo(() => buildSpecSchema(fields, t), [fields, t]);

  const form = useFormik<Values>({
    initialValues: { ...partDetailsInitial(listing, node?.name ?? ''), specs: specInitialValues(fields, listing.specs) },
    validate: (v) => ({ ...translateErrors(validatePartDetails(v), t), ...specErrors(strict, v.specs) }),
    onSubmit: () => undefined,
  });
  const err = (k: keyof PartDetailsValues) => (form.submitCount > 0 || form.touched[k] ? form.errors[k] : undefined);
  const specErr = (form.submitCount > 0 ? form.errors.specs : undefined) as Partial<Record<string, string>> | undefined;

  return (
    <StepFrame
      ctx={ctx}
      // The stored specs carry over keys the form doesn't edit (retired fields, §7.3).
      patch={() => partDetailsPatch(form.values, toSpecs(form.values.specs, fields, listing.specs))}
      validate={({ loose: isLoose }) => (isLoose
        ? Object.keys(validatePartDetails(form.values)).length === 0 && Object.keys(specErrors(loose, form.values.specs)).length === 0
        : formCheck(form))}
    >
      <Input
        label={t('sell.details.partName')}
        value={form.values.title}
        onChangeText={form.handleChange('title')}
        onBlur={form.handleBlur('title')}
        maxLength={LISTING_TITLE_MAX}
        error={err('title')}
        testID="Sell-part-name"
      />
      <Input
        label={t('sell.details.partNumber')}
        placeholder={t('sell.details.partNumberPlaceholder')}
        value={form.values.partNumber}
        onChangeText={form.handleChange('partNumber')}
        onBlur={form.handleBlur('partNumber')}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={PART_NUMBER_MAX}
        mono
        error={err('partNumber') ?? undefined}
        testID="Sell-part-number"
      />
      <Notice tone="info" icon={Info} text={t('sell.details.partNumberHint')} />
      <SpecFields
        fields={fields}
        values={form.values.specs}
        errors={specErr ?? {}}
        onChange={(key, value) => void form.setFieldValue(`specs.${key}`, value)}
      />
      <Input
        label={t('sell.details.description')}
        placeholder={t('sell.details.descriptionPlaceholder')}
        value={form.values.description}
        onChangeText={form.handleChange('description')}
        onBlur={form.handleBlur('description')}
        multiline
        maxLength={LISTING_DESCRIPTION_MAX}
        error={err('description')}
        testID="Sell-description"
      />
    </StepFrame>
  );
}
