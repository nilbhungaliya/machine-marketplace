import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import type { DealListRow } from '@mpm/shared-types';
import PressableScale from '@/components/PressableScale';
import StatusChip from '@/components/StatusChip';
import { useType } from '@/hooks/use-type';
import { dealStatusChip } from '@/lib/deal-display';
import { Package } from '@/lib/icons';
import { formatPaiseText } from '@/lib/offer-form';
import { radius, spacing, useTheme } from '@/lib/theme';

interface DealRowProps {
  deal: DealListRow;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}

/** A Deals tab row (mockup deals · "My deals"): thumb, listing title, side and total, counterpart, status, Your turn. */
export default function DealRow({ deal, onPress, style }: DealRowProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const s = useMemo(() => StyleSheet.create({
    row: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, backgroundColor: colors.surface,
      borderRadius: radius.xl, borderWidth: 1, borderColor: colors.hairline,
    },
    thumb: {
      width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.photo, overflow: 'hidden',
      alignItems: 'center', justifyContent: 'center',
    },
    image: { width: '100%', height: '100%' },
    body: { flex: 1, gap: 2 },
    title: { ...type('cardTitle'), color: colors.text },
    meta: { ...type('caption'), color: colors.textSecondary },
    right: { alignItems: 'flex-end', gap: spacing.xs },
  }), [colors, type]);

  const chip = dealStatusChip(deal.status);
  return (
    <PressableScale onPress={onPress} style={[s.row, style]} testID={`Deal-row-${deal.ref}`} accessibilityRole="button">
      <View style={s.thumb}>
        {deal.thumbUrl ? (
          <Image source={{ uri: deal.thumbUrl }} style={s.image} contentFit="cover" accessibilityIgnoresInvertColors />
        ) : (
          <Package size={22} color={colors.textMuted} />
        )}
      </View>
      <View style={s.body}>
        <Text style={s.title} numberOfLines={1}>{deal.listingTitle}</Text>
        <Text style={s.meta} numberOfLines={1}>
          {t(deal.side === 'buyer' ? 'deals.row.buying' : 'deals.row.selling', { total: formatPaiseText(deal.totalPaise) })}
        </Text>
        <Text style={s.meta} numberOfLines={1}>{deal.counterpart.name}</Text>
      </View>
      <View style={s.right}>
        <StatusChip label={t(chip.key)} tone={chip.tone} />
        {deal.yourTurn ? <StatusChip label={t('deals.row.yourTurn')} tone="sun" /> : null}
      </View>
    </PressableScale>
  );
}
