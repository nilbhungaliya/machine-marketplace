import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Condition } from '@mpm/shared-types';
import Card from '@/components/Card';
import Notice from '@/components/Notice';
import SideToken from '@/components/SideToken';
import StatusChip from '@/components/StatusChip';
import { useType } from '@/hooks/use-type';
import { formatDayMonth } from '@/lib/format-date';
import { Lock, Package } from '@/lib/icons';
import { formatRupees, parseRupees } from '@/lib/money';
import type { RequestFormValues } from '@/lib/part-request-form';
import { formatQuantity, parseQuantity } from '@/lib/quantity';
import { radius, spacing, useTheme } from '@/lib/theme';
import FitText from './FitText';

/**
 * "As sellers see it" (F8 spec §13.1 Preview, §12.3): the card a matching seller reads — name, side wanted, part number,
 * quantity, fits, conditions, budget or "Private", needed by, the city, the note and the photo count. Never the phone,
 * address or pincode (those aren't shown to sellers at all).
 */
export default function RequestPreview({ values, categoryPath, unitLabel, conditions, city }: {
  values: RequestFormValues;
  categoryPath: string;
  unitLabel: string | null;
  conditions: readonly Condition[];
  city: string | null;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();

  const s = useMemo(() => StyleSheet.create({
    gap: { gap: spacing.md },
    head: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
    well: {
      width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.photo, alignItems: 'center', justifyContent: 'center',
    },
    headText: { flex: 1, gap: spacing.xs },
    name: { ...type('cardTitle'), color: colors.text },
    path: { ...type('caption'), color: colors.textMuted },
    mono: { ...type('mono'), color: colors.text },
    row: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.xs },
    label: { ...type('label'), color: colors.textMuted, width: 112 },
    value: { ...type('body'), color: colors.text, flex: 1 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    note: { ...type('body'), color: colors.textSecondary },
  }), [colors, type]);

  const part = values.kind === 'part';
  const qty = part ? parseQuantity(values.quantity, 3) : null;
  const budget = values.budget.trim() ? parseRupees(values.budget) : null;
  const accepted = values.conditionIds === null
    ? t('requirements.preview.anyCondition')
    : conditions.filter((c) => values.conditionIds!.includes(c.id)).map((c) => c.label).join(', ');
  const sideKind = values.side === 'left' ? 'want-left' : values.side === 'right' ? 'want-right' : values.side === 'pair' ? 'pair' : null;

  const row = (label: string, value: React.ReactNode, testID?: string) => (
    <View style={s.row} testID={testID}>
      <Text style={s.label}>{label}</Text>
      {typeof value === 'string' ? <Text style={s.value}>{value}</Text> : <View style={{ flex: 1 }}>{value}</View>}
    </View>
  );

  return (
    <View style={s.gap}>
      <Notice tone="info" icon={Lock} title={t('requirements.preview.title')} text={t('requirements.preview.lead')} />
      <Card style={s.gap}>
        <View style={s.head}>
          {sideKind ? <SideToken kind={sideKind} size="lg" /> : <View style={s.well}><Package size={24} color={colors.textMuted} /></View>}
          <View style={s.headText}>
            <Text style={s.name}>{values.name.trim()}</Text>
            <Text style={s.path} numberOfLines={2}>{categoryPath}</Text>
            <View style={s.chips}>
              {values.side ? <StatusChip tone="info" label={t(`requirements.form.sideOption.${values.side}`)} /> : null}
              {values.urgent ? <StatusChip tone="sun" label={t('requirements.form.urgent')} /> : null}
            </View>
          </View>
        </View>
        <View>
          {part && values.partNumber.trim() ? row(t('requirements.form.partNumber'), <Text style={s.mono}>{values.partNumber.trim()}</Text>) : null}
          {part && qty?.ok ? row(t('requirements.form.quantity'), `${formatQuantity(qty.value)} ${unitLabel ?? ''}`.trim()) : null}
          {values.fits.length > 0
            ? row(part ? t('requirements.form.fits') : t('requirements.form.makeModel'), (
              <View>{values.fits.map((f, i) => <FitText key={i} fit={f} style={s.value} />)}</View>
            ))
            : null}
          {row(t('requirements.form.conditions'), accepted)}
          {row(t('requirements.form.budget'), budget === null ? t('requirements.preview.noBudget') : values.budgetVisible ? formatRupees(budget) : t('requirements.preview.budgetPrivate'))}
          {values.neededBy ? row(t('requirements.form.neededBy'), formatDayMonth(Date.parse(`${values.neededBy}T06:30:00Z`))) : null}
          {city ? row(t('requirements.preview.city'), city) : null}
          {values.photos.length > 0 ? row(t('requirements.form.photos.label'), t('requirements.preview.photos', { count: values.photos.length })) : null}
        </View>
        {values.note.trim() ? <Text style={s.note}>{values.note.trim()}</Text> : null}
      </Card>
    </View>
  );
}
