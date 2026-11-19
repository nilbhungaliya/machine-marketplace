import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import type { ThreadDetail, ThreadMessage } from '@mpm/shared-types';
import PressableScale from '@/components/PressableScale';
import StatusChip from '@/components/StatusChip';
import { useType } from '@/hooks/use-type';
import { dealStatusChip } from '@/lib/deal-display';
import { ChevronRight, TAB_ICONS } from '@/lib/icons';
import { formatRupees } from '@/lib/money';
import { formatPaiseText } from '@/lib/offer-form';
import { formatQuantity } from '@/lib/quantity';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackParamList } from '@/navigation/types';

/** A deal card in the thread (F6 + F7 spec §15.1): status and terms, opens the Deal record. */
export interface DealCardProps {
  message: ThreadMessage;
  thread: ThreadDetail;
  style?: StyleProp<ViewStyle>;
}

/**
 * The deal card (mockup negotiate · "Counteroffer" `.dealcard`): "Deal agreed · 2 pcs at ₹36,500, total ₹73,000", the
 * deal's current status, and a tap to the Deal record. Terms come from the thread's deal rows; the message carries the
 * id, ref, status and total.
 */
export default function DealCard({ message, thread, style }: DealCardProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const s = useMemo(() => StyleSheet.create({
    card: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.xl,
      backgroundColor: colors.okSoft, borderWidth: 1, borderColor: colors.hairline, alignSelf: 'stretch',
    },
    icon: {
      width: 40, height: 40, borderRadius: radius.full, backgroundColor: colors.surface, alignItems: 'center',
      justifyContent: 'center',
    },
    body: { flex: 1, gap: 2 },
    title: { ...type('cardTitle'), color: colors.text },
    terms: { ...type('caption'), color: colors.textSecondary },
  }), [colors, type]);

  const deal = message.deal;
  if (!deal) return null;
  const row = thread.deals.find((d) => d.id === deal.id) ?? null;
  const status = row?.status ?? deal.status;
  const chip = dealStatusChip(status);
  const Icon = TAB_ICONS.deals;
  const terms = row
    ? t('deals.card.terms', {
      qty: `${formatQuantity(row.quantity)} ${row.unitLabel}`.trim(),
      price: formatRupees(row.pricePerUnitPaise),
      total: formatPaiseText(row.totalPaise),
    })
    : t('deals.card.total', { total: formatPaiseText(deal.totalPaise) });

  return (
    <PressableScale
      onPress={() => navigation.navigate('DealRecord', { dealId: deal.id })}
      style={[s.card, style]}
      accessibilityRole="button"
      testID={`Deal-card-${deal.ref}`}
    >
      <View style={s.icon}><Icon size={20} color={colors.ok} /></View>
      <View style={s.body}>
        <Text style={s.title}>{t('deals.card.title', { ref: deal.ref })}</Text>
        <Text style={s.terms} numberOfLines={2}>{terms}</Text>
      </View>
      <StatusChip label={t(chip.key)} tone={chip.tone} />
      <ChevronRight size={18} color={colors.textMuted} />
    </PressableScale>
  );
}
