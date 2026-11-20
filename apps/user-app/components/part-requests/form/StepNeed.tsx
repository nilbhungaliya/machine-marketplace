import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { DEFAULT_SIDE_CONVENTION, PART_REQUEST_LIMITS, type CategoryNode, type PartRequestKind, type PartSide, type Unit } from '@mpm/shared-types';
import Button from '@/components/Button';
import Card from '@/components/Card';
import Field from '@/components/Field';
import IconButton from '@/components/IconButton';
import Input from '@/components/Input';
import SegmentedControl from '@/components/SegmentedControl';
import SideDiagram from '@/components/SideDiagram';
import SideToken from '@/components/SideToken';
import { useCategoryTree } from '@/hooks/use-listing';
import { useType } from '@/hooks/use-type';
import { X } from '@/lib/icons';
import { PART_NUMBER_MAX, type RequestFormErrors, type RequestFormValues } from '@/lib/part-request-form';
import { machineTypeIdOf, nodePath } from '@/lib/sell-category';
import { radius, spacing, useTheme } from '@/lib/theme';
import { PickerField, PickerSheet } from '@/screens/sell/sell-sheet';
import CategorySheet from './CategorySheet';
import FitText from './FitText';
import FitSheet from './FitSheet';

const SIDES = ['left', 'right', 'pair'] as const satisfies readonly PartSide[];

/**
 * Post a requirement, step 1 (F8 spec §13.1, mockup "Post a requirement"): what is needed — a part or a machine (fixed
 * once posted), the category (a part may stop at a machine type), name, part number (mono), the side with the
 * convention drawing when the node has sides, quantity + unit (parts), and up to 5 fits ("Make and model" for machines).
 */
export default function StepNeed({ values, errors, editing, units, onChange }: {
  values: RequestFormValues;
  errors: RequestFormErrors;
  /** Edit mode: the kind can't change (`KIND_IMMUTABLE`). */
  editing: boolean;
  units: readonly Unit[];
  onChange: (patch: Partial<RequestFormValues>) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const tree = useCategoryTree();
  const [sheet, setSheet] = useState<'category' | 'unit' | 'fit' | null>(null);

  const nodes = tree.data ?? [];
  const path = nodePath(nodes, values.categoryId);
  const node = path.at(-1) ?? null;
  const part = values.kind === 'part';
  const hasSides = part && !!node?.effectiveHasSides;
  const convention = node?.effectiveSideConvention ?? DEFAULT_SIDE_CONVENTION;
  const unit = units.find((u) => u.id === values.unitId) ?? null;
  const partUnits = useMemo(() => units.filter((u) => u.isActive && !u.isMachineUnit), [units]);

  const s = useMemo(() => StyleSheet.create({
    gap: { gap: spacing.lg },
    kindText: { ...type('bodyStrong'), color: colors.text },
    sides: { flexDirection: 'row', gap: spacing.sm },
    side: {
      flex: 1, alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.md, minHeight: 44,
      borderRadius: radius.lg, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.surface,
    },
    sideOn: { borderColor: colors.primary, backgroundColor: colors.primaryWash },
    sideLabel: { ...type('label'), color: colors.text },
    convention: { ...type('caption'), color: colors.textSecondary },
    two: { flexDirection: 'row', gap: spacing.md },
    half: { flex: 1 },
    unitField: { marginTop: spacing.md },
    fitRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
    fitText: { ...type('body'), color: colors.text, flex: 1 },
  }), [colors, type]);

  const setKind = (kind: PartRequestKind) => {
    if (kind === values.kind) return;
    // A part may sit on a machine type, a machine only on one: keep the category only where it still fits.
    const keep = node && node.level === 'machine_type' ? values.categoryId : null;
    onChange({ kind, categoryId: keep, side: null, partNumber: '', fits: [], specs: {} });
  };

  const pickCategory = (n: CategoryNode) => {
    if (n.id === values.categoryId) return;
    const sides = values.kind === 'part' && n.effectiveHasSides;
    // A machine's models belong to its machine type: a new type drops the model fits (the brands stay).
    const fits = values.kind === 'machine' ? values.fits.filter((f) => !f.modelId) : values.fits;
    onChange({ categoryId: n.id, categorySeedId: null, specs: {}, side: sides ? values.side : null, fits });
  };

  const fitsLabel = part ? t('requirements.form.fits') : t('requirements.form.makeModel');

  return (
    <View style={s.gap}>
      <Field label={t('requirements.form.kindLabel')}>
        {editing ? (
          <Text style={s.kindText}>{t(`requirements.form.kind.${values.kind}`)}</Text>
        ) : (
          <SegmentedControl<PartRequestKind>
            options={[
              { value: 'part', label: t('requirements.form.kind.part'), testID: 'Request-kind-part' },
              { value: 'machine', label: t('requirements.form.kind.machine'), testID: 'Request-kind-machine' },
            ]}
            value={values.kind}
            onChange={setKind}
            accessibilityLabel={t('requirements.form.kindLabel')}
          />
        )}
      </Field>

      <PickerField
        label={t('requirements.form.category')}
        value={path.length > 0 ? path.map((n) => n.name).join(' › ') : null}
        placeholder={t('requirements.form.categoryPick')}
        hint={t(part ? 'requirements.form.categoryHintPart' : 'requirements.form.categoryHintMachine')}
        error={errors.categoryId}
        onPress={() => setSheet('category')}
        testID="Request-category"
      />

      <Input
        label={t(part ? 'requirements.form.name.part' : 'requirements.form.name.machine')}
        placeholder={t(part ? 'requirements.form.namePlaceholder.part' : 'requirements.form.namePlaceholder.machine')}
        value={values.name}
        onChangeText={(name) => onChange({ name })}
        maxLength={PART_REQUEST_LIMITS.nameMax}
        error={errors.name}
        testID="Request-name"
      />

      {part ? (
        <Input
          label={t('requirements.form.partNumber')}
          placeholder={t('requirements.form.optional')}
          value={values.partNumber}
          onChangeText={(partNumber) => onChange({ partNumber })}
          maxLength={PART_NUMBER_MAX}
          autoCapitalize="characters"
          autoCorrect={false}
          mono
          error={errors.partNumber}
          testID="Request-part-number"
        />
      ) : null}

      {hasSides ? (
        <Field label={t('requirements.form.side')} hint={t('requirements.form.sideHint')} error={errors.side}>
          <View style={s.gap}>
            <View style={s.sides} accessibilityRole="radiogroup">
              {SIDES.map((k) => (
                <Pressable
                  key={k}
                  style={[s.side, values.side === k && s.sideOn]}
                  onPress={() => onChange({ side: k })}
                  testID={`Request-side-${k}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: values.side === k }}
                >
                  <SideToken kind={k} size="lg" />
                  <Text style={s.sideLabel}>{t(`requirements.form.sideOption.${k}`)}</Text>
                </Pressable>
              ))}
            </View>
            {convention === DEFAULT_SIDE_CONVENTION ? (
              <SideDiagram
                highlight={values.side === 'left' || values.side === 'right' ? values.side : null}
                title={t('requirements.form.diagramTitle')}
                text={t('requirements.form.diagramText')}
              />
            ) : (
              <Text style={s.convention}>{convention}</Text>
            )}
          </View>
        </Field>
      ) : null}

      {part ? (
        <View style={s.two}>
          <View style={s.half}>
            <Input
              label={t('requirements.form.quantity')}
              value={values.quantity}
              onChangeText={(quantity) => onChange({ quantity })}
              keyboardType="decimal-pad"
              error={errors.quantity}
              testID="Request-quantity"
            />
          </View>
          <View style={s.half}>
            <PickerField
              label={t('requirements.form.unit')}
              value={unit?.label ?? null}
              placeholder={t('requirements.form.unitPick')}
              error={errors.unitId}
              onPress={() => setSheet('unit')}
              testID="Request-unit"
              style={s.unitField}
            />
          </View>
        </View>
      ) : null}

      <Field label={fitsLabel} hint={t('requirements.form.fitsHint', { max: PART_REQUEST_LIMITS.fitsMax })} error={errors.fits}>
        {values.fits.length > 0 ? (
          <Card>
            {values.fits.map((f, i) => (
              <View key={`${f.brandId}-${f.modelId ?? 'all'}-${i}`} style={s.fitRow}>
                <FitText fit={f} style={s.fitText} />
                <IconButton
                  icon={X}
                  iconSize={16}
                  variant="outline"
                  onPress={() => onChange({ fits: values.fits.filter((_, j) => j !== i) })}
                  accessibilityLabel={t('requirements.form.removeFit')}
                  testID="Request-fit-remove"
                />
              </View>
            ))}
          </Card>
        ) : null}
        {values.fits.length < PART_REQUEST_LIMITS.fitsMax ? (
          <Button
            title={part ? t('requirements.form.addFit') : t('requirements.form.addMakeModel')}
            onPress={() => setSheet('fit')}
            variant="outline"
            size="sm"
            phLabel="Request-fit-open"
            style={{ alignSelf: 'flex-start' }}
          />
        ) : null}
      </Field>

      <CategorySheet
        visible={sheet === 'category'}
        kind={values.kind}
        value={values.categoryId}
        seedId={values.categorySeedId}
        onPick={pickCategory}
        onClose={() => setSheet(null)}
      />
      <PickerSheet
        visible={sheet === 'unit'}
        title={t('requirements.form.unit')}
        options={partUnits.map((u) => ({ id: u.id, label: u.label }))}
        selectedId={values.unitId}
        onPick={(unitId) => onChange({ unitId })}
        onClose={() => setSheet(null)}
        testID="Request-unit-sheet"
      />
      <FitSheet
        visible={sheet === 'fit'}
        kind={values.kind}
        machineTypeId={machineTypeIdOf(nodes, values.categoryId)}
        onAdd={(fit) => onChange({ fits: [...values.fits, fit].slice(0, PART_REQUEST_LIMITS.fitsMax) })}
        onClose={() => setSheet(null)}
      />
    </View>
  );
}
