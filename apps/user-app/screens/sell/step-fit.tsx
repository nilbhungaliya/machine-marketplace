import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { LISTING_FITMENTS_MAX } from '@mpm/shared-types';
import Button from '@/components/Button';
import Field from '@/components/Field';
import Notice from '@/components/Notice';
import { useBrands } from '@/hooks/use-listing';
import { useType } from '@/hooks/use-type';
import { Info, X } from '@/lib/icons';
import { fitLine } from '@/lib/listing-format';
import { machineTypeIdOf } from '@/lib/sell-category';
import { radius, spacing, useTheme } from '@/lib/theme';
import StepFrame, { type StepProps } from './step-frame';
import FitRowSheet, { type FitRowItem } from './fit-row-sheet';
import { PickerField, PickerSheet } from './sell-sheet';

const NONE = '__none__';

/**
 * Step 4 for parts, Brand and fit (F2 spec §5.2, §4.3): the part's brand (optional, brands that make parts) and the
 * machines it fits as removable chips ("Tsudakoma ZW 408 · 2012–2020 ×"), up to 20; "+ Add machine" opens the row
 * sheet. Both optional.
 */
export default function StepFit({ ctx }: StepProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const { listing, tree } = ctx;
  const partBrands = useBrands('parts');
  const [partBrandId, setPartBrandId] = useState<string | null>(listing.partBrandId);
  const [rows, setRows] = useState<FitRowItem[]>(() => listing.fitments.map((f) => ({
    brandId: f.brandId, brandName: f.brandName, modelId: f.modelId, modelName: f.modelName ?? null, modelOther: f.modelOther,
    yearFrom: f.yearFrom, yearTo: f.yearTo, note: f.note,
  })));
  const [brandSheet, setBrandSheet] = useState(false);
  const [rowSheet, setRowSheet] = useState(false);
  const full = rows.length >= LISTING_FITMENTS_MAX;

  const brandName = partBrands.data?.find((b) => b.id === partBrandId)?.name
    ?? (partBrandId && partBrandId === listing.partBrandId ? listing.partBrand?.name ?? null : null);

  const s = useMemo(() => StyleSheet.create({
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
    chip: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 40, paddingLeft: 14, paddingRight: spacing.sm,
      borderRadius: radius.full, backgroundColor: colors.primarySoft, maxWidth: '100%',
    },
    chipText: { ...type('chip'), color: colors.primaryInk, flexShrink: 1 },
    empty: { ...type('caption'), color: colors.textMuted, marginBottom: spacing.sm },
  }), [colors, type]);

  return (
    <StepFrame
      ctx={ctx}
      patch={() => ({
        partBrandId,
        fitments: rows.map(({ brandId, modelId, modelOther, yearFrom, yearTo, note }) => ({ brandId, modelId, modelOther, yearFrom, yearTo, note })),
      })}
      validate={() => true}
    >
      <PickerField
        label={t('sell.fit.partBrand')}
        value={brandName}
        placeholder={t('sell.fit.pickPartBrand')}
        hint={t('sell.optional')}
        onPress={() => setBrandSheet(true)}
        testID="Sell-part-brand"
      />
      {listing.reviewOnEdit ? <Notice tone="warning" icon={Info} text={t('sell.reviewOnEdit')} /> : null}
      <Field label={t('sell.fit.fitsTitle')} hint={t('sell.fit.fitsHint')}>
        {rows.length > 0 ? (
          <View style={s.chips}>
            {rows.map((r, i) => {
              const label = fitLine({ ...r, brandName: r.brandName ?? '' });
              return (
                <Pressable
                  key={`${r.brandId}-${r.modelId ?? r.modelOther ?? ''}-${i}`}
                  style={s.chip}
                  onPress={() => setRows(rows.filter((_, j) => j !== i))}
                  testID="Sell-fit-remove"
                  accessibilityRole="button"
                  accessibilityLabel={t('sell.fit.remove', { name: label })}
                  hitSlop={4}
                >
                  <Text style={s.chipText} numberOfLines={2}>{label}</Text>
                  <X size={16} color={colors.primaryInk} />
                </Pressable>
              );
            })}
          </View>
        ) : (
          <Text style={s.empty}>{t('sell.fit.none')}</Text>
        )}
        <Button
          title={full ? t('sell.fit.full', { max: LISTING_FITMENTS_MAX }) : t('sell.fit.addMachine')}
          phLabel="Sell-fit-add-machine"
          variant="outline"
          size="sm"
          disabled={full}
          onPress={() => setRowSheet(true)}
        />
      </Field>

      <PickerSheet
        visible={brandSheet}
        title={t('sell.fit.partBrand')}
        options={(partBrands.data ?? []).map((b) => ({ id: b.id, label: b.name }))}
        selectedId={partBrandId ?? NONE}
        extra={[{ id: NONE, label: t('sell.fit.noPartBrand') }]}
        onPick={(id) => setPartBrandId(id === NONE ? null : id)}
        onClose={() => setBrandSheet(false)}
        testID="Sell-part-brand-sheet"
      />
      <FitRowSheet
        visible={rowSheet}
        machineTypeId={machineTypeIdOf(tree, listing.categoryId)}
        onAdd={(row) => setRows((prev) => [...prev, row].slice(0, LISTING_FITMENTS_MAX))}
        onClose={() => setRowSheet(false)}
      />
    </StepFrame>
  );
}
