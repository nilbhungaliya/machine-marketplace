import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ListingKind, TemplateField } from '@mpm/shared-types';
import Chip from '@/components/Chip';
import Field, { FieldHint } from '@/components/Field';
import Input from '@/components/Input';
import { activeOptions, editableFields, specControl, type SpecFormValues } from '@/lib/spec-form';
import { spacing } from '@/lib/theme';
import { useTemplate } from '@/hooks/use-listing';

/**
 * A category's template fields as form controls (F2 spec §5.2 "Template fields"): single select → radio chips, multi
 * select → checkbox chips, number → input (unit in the label, min / max hint), text, date. Required fields are marked;
 * the admin's help text is the hint. Field names and options are catalogue data, shown as typed (§15.5).
 */
export default function SpecFields({ fields, values, errors, onChange }: {
  fields: readonly TemplateField[];
  values: SpecFormValues;
  errors: Partial<Record<string, string>>;
  onChange: (key: string, value: string | string[]) => void;
}) {
  const { t } = useTranslation();
  const s = useMemo(() => StyleSheet.create({
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  }), []);

  return (
    <>
      {editableFields(fields).map((f) => {
        const label = [f.unit ? t('sell.spec.labelUnit', { label: f.label, unit: f.unit }) : f.label, f.required ? t('sell.spec.required') : null]
          .filter(Boolean).join(' ');
        const range = f.min != null && f.max != null ? t('sell.spec.range', { min: f.min, max: f.max })
          : f.min != null ? t('sell.spec.min', { min: f.min })
            : f.max != null ? t('sell.spec.max', { max: f.max }) : null;
        const hint = [f.helpText, specControl(f) === 'number' ? range : null].filter(Boolean).join(' · ') || undefined;
        const error = errors[f.key];
        const value = values[f.key];
        switch (specControl(f)) {
          case 'chips-radio':
          case 'chips-multi': {
            const multi = specControl(f) === 'chips-multi';
            const picked = Array.isArray(value) ? value : value ? [value] : [];
            return (
              <Field key={f.key} label={label} hint={hint} error={error}>
                <View style={s.chips}>
                  {activeOptions(f).map((o) => {
                    const on = picked.includes(o.key);
                    return (
                      <Chip
                        key={o.key}
                        label={o.label}
                        selected={on}
                        role={multi ? 'checkbox' : 'radio'}
                        onPress={() => onChange(f.key, multi ? (on ? picked.filter((k) => k !== o.key) : [...picked, o.key]) : on && !f.required ? '' : o.key)}
                        testID={`Spec-${f.key}-option`}
                      />
                    );
                  })}
                </View>
              </Field>
            );
          }
          default: {
            const control = specControl(f);
            return (
              <View key={f.key}>
                <Input
                  label={label}
                  value={typeof value === 'string' ? value : ''}
                  onChangeText={(v) => onChange(f.key, v)}
                  keyboardType={control === 'number' ? 'decimal-pad' : control === 'date' ? 'numbers-and-punctuation' : 'default'}
                  placeholder={control === 'date' ? t('sell.spec.datePlaceholder') : undefined}
                  error={error}
                  maxLength={control === 'text' ? 200 : undefined}
                  testID={`Spec-${f.key}`}
                />
                {hint && !error ? <FieldHint>{hint}</FieldHint> : null}
              </View>
            );
          }
        }
      })}
    </>
  );
}

/** The listing's template for its kind; `fields` empty until loaded or without a category. */
export function useSpecTemplate(categoryId: string | null, kind: ListingKind) {
  const q = useTemplate(categoryId, kind);
  return { fields: q.data?.fields ?? [], loading: !!categoryId && q.isLoading, error: q.isError, refetch: q.refetch };
}
