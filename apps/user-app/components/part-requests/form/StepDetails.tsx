import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PART_REQUEST_LIMITS, type Condition, type PartRequestOptions, type TemplateField } from '@mpm/shared-types';
import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import Field from '@/components/Field';
import Input from '@/components/Input';
import { useType } from '@/hooks/use-type';
import { ChevronDown, MapPin } from '@/lib/icons';
import { formatDayMonth } from '@/lib/format-date';
import { istDateKey } from '@/lib/ist-date';
import { NEEDED_BY_DAYS, neededByFor, reachChoices, type RequestFormErrors, type RequestFormValues } from '@/lib/part-request-form';
import type { SpecFormValues } from '@/lib/spec-form';
import { spacing, useTheme } from '@/lib/theme';
import SpecFields from '@/screens/sell/spec-fields';
import PhotoPicker from './PhotoPicker';

const dateMs = (d: string) => Date.parse(`${d}T06:30:00Z`);

/**
 * Post a requirement, step 2 (F8 spec §13.1, mockup "Requirement details"): conditions accepted (all on), budget per
 * unit with "Show to sellers" (private by default), needed by + Urgent, Deliver to (the business place, read only),
 * reach, who can reply, Specifications (collapsed, every field may be "any"), photos (≤ 3), the note, Valid for (new
 * requests only: renew owns it after), and the fine print with the number of sellers told.
 */
export default function StepDetails({
  values, errors, onChange, options, conditions, place, state, editing, specFields, specValues, specErrors, onSpecChange, photoUrls,
  onPhotoUrlError,
}: {
  values: RequestFormValues;
  errors: RequestFormErrors;
  onChange: (patch: Partial<RequestFormValues>) => void;
  options: PartRequestOptions | undefined;
  conditions: readonly Condition[];
  /** "Aji GIDC, Rajkot": the business's place, or null before it has one. */
  place: string | null;
  state: string | null;
  editing: boolean;
  /** The node's template fields (parts on a part group, machines on a machine type); empty hides Specifications. */
  specFields: readonly TemplateField[];
  specValues: SpecFormValues;
  specErrors: Partial<Record<string, string>>;
  onSpecChange: (key: string, value: string | string[]) => void;
  photoUrls?: Record<string, string>;
  onPhotoUrlError?: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const [specsOpen, setSpecsOpen] = useState(() => Object.keys(values.specs).length > 0);
  const today = istDateKey();

  const s = useMemo(() => StyleSheet.create({
    gap: { gap: spacing.lg },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    placeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    place: { ...type('bodyStrong'), color: colors.text, flex: 1 },
    placeHint: { ...type('caption'), color: colors.textSecondary },
    fine: { ...type('caption'), color: colors.textSecondary },
    specs: { gap: spacing.md },
  }), [colors, type]);

  const active = conditions.filter((c) => c.isActive);
  const allIds = active.map((c) => c.id);
  const isOn = (id: string) => values.conditionIds === null || values.conditionIds.includes(id);
  const toggleCondition = (id: string) => {
    const current = values.conditionIds ?? allIds;
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    // Every condition on is "any condition" (null), so a condition the admin adds later is accepted too.
    onChange({ conditionIds: allIds.every((x) => next.includes(x)) ? null : next });
  };

  // "Needed by": none, the three quick dates, and an edited request's own date when it is none of them.
  const presets = NEEDED_BY_DAYS.map((d) => neededByFor(d, today)!);
  const dates = values.neededBy && !presets.includes(values.neededBy) ? [...presets, values.neededBy].sort() : presets;

  return (
    <View style={s.gap}>
      <Field label={t('requirements.form.conditions')} error={errors.conditionIds}>
        <View style={s.chips}>
          {active.map((c) => (
            <Chip key={c.id} label={c.label} selected={isOn(c.id)} onPress={() => toggleCondition(c.id)} testID={`Request-condition-${c.key}`} />
          ))}
        </View>
      </Field>

      <View>
        <Input
          label={t('requirements.form.budget')}
          placeholder={t('requirements.form.optional')}
          prefix="₹"
          value={values.budget}
          onChangeText={(budget) => onChange({ budget })}
          keyboardType="decimal-pad"
          error={errors.budget}
          testID="Request-budget"
        />
        {values.budget.trim() ? (
          <View style={[s.chips, { marginTop: spacing.sm }]}>
            <Chip
              label={t('requirements.form.showBudget')}
              selected={values.budgetVisible}
              onPress={() => onChange({ budgetVisible: !values.budgetVisible })}
              testID="Request-budget-visible"
            />
          </View>
        ) : null}
      </View>

      <Field label={t('requirements.form.neededBy')} error={errors.neededBy}>
        <View style={s.chips}>
          <Chip
            label={t('requirements.form.neededByAny')}
            selected={values.neededBy === null}
            role="radio"
            onPress={() => onChange({ neededBy: null })}
            testID="Request-needed-any"
          />
          {dates.map((d) => (
            <Chip
              key={d}
              label={t('requirements.form.neededByDate', { date: formatDayMonth(dateMs(d)) })}
              selected={values.neededBy === d}
              role="radio"
              onPress={() => onChange({ neededBy: d })}
              testID="Request-needed-date"
            />
          ))}
          <Chip
            label={t('requirements.form.urgent')}
            selected={values.urgent}
            onPress={() => onChange({ urgent: !values.urgent })}
            testID="Request-urgent"
          />
        </View>
      </Field>

      <Field label={t('requirements.form.deliverTo')}>
        <Card>
          <View style={s.placeRow}>
            <MapPin size={18} color={colors.primaryInk} />
            <Text style={s.place}>{place ?? t('requirements.form.deliverToNone')}</Text>
          </View>
          <Text style={s.placeHint}>{t('requirements.form.deliverToHint')}</Text>
        </Card>
      </Field>

      <Field label={t('requirements.form.reach.label')}>
        <View style={s.chips}>
          {reachChoices(state).map((c) => (
            <Chip
              key={c.value}
              label={c.text ?? t(c.key, c.params)}
              selected={values.reach === c.value}
              role="radio"
              onPress={() => onChange({ reach: c.value })}
              testID={`Request-reach-${c.value}`}
            />
          ))}
        </View>
      </Field>

      <Field label={t('requirements.form.audience.label')}>
        <View style={s.chips}>
          {(['verified_only', 'any_seller'] as const).map((a) => (
            <Chip
              key={a}
              label={t(`requirements.form.audience.${a}`)}
              selected={values.audience === a}
              role="radio"
              onPress={() => onChange({ audience: a })}
              testID={`Request-audience-${a}`}
            />
          ))}
        </View>
      </Field>

      {specFields.length > 0 ? (
        <View style={s.specs}>
          <Button
            title={specsOpen ? t('requirements.form.specs.hide') : t('requirements.form.specs.show')}
            onPress={() => setSpecsOpen((o) => !o)}
            variant="ghost"
            size="sm"
            icon={ChevronDown}
            phLabel="Request-specs-toggle"
            style={{ alignSelf: 'flex-start' }}
          />
          {specsOpen ? (
            <Card style={s.specs}>
              <Text style={s.placeHint}>{t('requirements.form.specs.hint')}</Text>
              <SpecFields fields={specFields} values={specValues} errors={specErrors} onChange={onSpecChange} />
            </Card>
          ) : null}
        </View>
      ) : null}

      <PhotoPicker
        photos={values.photos}
        urls={photoUrls}
        onUrlError={onPhotoUrlError}
        onChange={(photos) => onChange({ photos })}
        error={errors.photos}
      />

      <Input
        label={t('requirements.form.note')}
        placeholder={t('requirements.form.notePlaceholder')}
        value={values.note}
        onChangeText={(note) => onChange({ note })}
        multiline
        maxLength={PART_REQUEST_LIMITS.noteMax}
        error={errors.note}
        testID="Request-note"
      />
      <Text style={s.fine}>{t('requirements.form.noteHint')}</Text>

      {!editing && options ? (
        <Field label={t('requirements.form.validity')}>
          <View style={s.chips}>
            {options.validityDays.map((d) => (
              <Chip
                key={d}
                label={t('requirements.form.validityDays', { count: d })}
                selected={values.validityDays === d}
                role="radio"
                onPress={() => onChange({ validityDays: d })}
                testID={`Request-validity-${d}`}
              />
            ))}
          </View>
        </Field>
      ) : null}

      <Text style={s.fine}>{t('requirements.form.fine', { n: options?.reachN ?? 15 })}</Text>
    </View>
  );
}
