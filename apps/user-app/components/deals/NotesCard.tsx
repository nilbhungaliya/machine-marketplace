import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { DealNotes } from '@mpm/shared-types';
import Button from '@/components/Button';
import Card from '@/components/Card';
import Notice from '@/components/Notice';
import { useType } from '@/hooks/use-type';
import { dayInputText } from '@/lib/deal-display';
import { Pencil, TriangleAlert } from '@/lib/icons';
import { formatPaiseText } from '@/lib/offer-form';
import { spacing, useTheme } from '@/lib/theme';

interface NotesCardProps {
  notes: DealNotes;
  canEdit: boolean;
  onEdit: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * The deal's shared notes (§9.1): payment method, advance and balance, pickup or delivery, the expected date and a short
 * text. One record for both sides; "Payment happens outside the app" sits above it on the record.
 */
export default function NotesCard({ notes, canEdit, onEdit, style }: NotesCardProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const s = useMemo(() => StyleSheet.create({
    card: { gap: spacing.sm },
    head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    title: { ...type('section'), color: colors.text },
    row: {
      flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: spacing.xs,
      borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    label: { ...type('caption'), color: colors.textSecondary, flex: 1 },
    value: { ...type('bodyStrong'), color: colors.text, flex: 1, textAlign: 'right' },
    text: { ...type('body'), color: colors.text },
    empty: { ...type('body'), color: colors.textMuted },
  }), [colors, type]);

  const rows: { key: string; label: string; value: string }[] = [
    ...(notes.paymentMethod ? [{ key: 'pay', label: t('deals.notes.payment'), value: t(`deals.payment.${notes.paymentMethod}`) }] : []),
    ...(notes.advancePaise ? [{ key: 'adv', label: t('deals.notes.advance'), value: formatPaiseText(notes.advancePaise) }] : []),
    ...(notes.balancePaise ? [{ key: 'bal', label: t('deals.notes.balance'), value: formatPaiseText(notes.balancePaise) }] : []),
    ...(notes.fulfilment ? [{ key: 'ful', label: t('deals.notes.fulfilment'), value: t(`deals.fulfilment.${notes.fulfilment}`) }] : []),
    ...(notes.expectedOn ? [{ key: 'on', label: t('deals.notes.expectedOn'), value: dayInputText(notes.expectedOn) }] : []),
  ];

  return (
    <Card style={[s.card, style]}>
      <View style={s.head}>
        <Text style={s.title}>{t('deals.notes.title')}</Text>
        {canEdit ? (
          <Button title={t('deals.notes.edit')} onPress={onEdit} variant="ghost" size="sm" icon={Pencil} phLabel="Deal-notes-edit" />
        ) : null}
      </View>
      {rows.length === 0 && !notes.text ? <Text style={s.empty}>{t('deals.notes.empty')}</Text> : null}
      {rows.map((r) => (
        <View key={r.key} style={s.row}>
          <Text style={s.label}>{r.label}</Text>
          <Text style={s.value}>{r.value}</Text>
        </View>
      ))}
      {notes.text ? <Text style={s.text}>{notes.text}</Text> : null}
      {notes.scamWarning ? <Notice tone="danger" icon={TriangleAlert} text={t('offers.card.scam')} /> : null}
    </Card>
  );
}
