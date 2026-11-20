import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { PartRequestBuyerBlock } from '@mpm/shared-types';
import StatusChip from '@/components/StatusChip';
import { useType } from '@/hooks/use-type';
import { Building2, ShieldCheck } from '@/lib/icons';
import { radius, spacing, useTheme } from '@/lib/theme';

interface BuyerBlockProps {
  buyer: PartRequestBuyerBlock;
  /** One line (rows) instead of the card's block (the seller's requirement page). */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * The buyer as a seller sees them (F8 spec §12.3, R6): trade name (masked by the API), city, verified badge, member
 * since. Never a phone, email, pincode or address: the API doesn't send them.
 */
export default function BuyerBlock({ buyer, compact = false, style }: BuyerBlockProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const s = useMemo(() => StyleSheet.create({
    box: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    well: {
      width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.primaryWash, alignItems: 'center',
      justifyContent: 'center',
    },
    body: { flex: 1, gap: 2 },
    name: { ...type(compact ? 'label' : 'bodyStrong'), color: colors.text },
    meta: { ...type('caption'), color: colors.textSecondary },
    line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  }), [colors, type, compact]);

  const meta = [buyer.city, t('buyers.buyer.memberSince', { year: buyer.memberSince })].filter(Boolean).join(' · ');
  const badge = buyer.verified
    ? <StatusChip label={t('buyers.buyer.verified')} tone="ok" icon={ShieldCheck} />
    : null;

  if (compact) {
    return (
      <View style={[s.line, style]}>
        <Text style={s.name} numberOfLines={1}>{buyer.tradeName}</Text>
        {badge}
      </View>
    );
  }
  return (
    <View style={[s.box, style]} accessibilityLabel={t('buyers.buyer.a11y', { name: buyer.tradeName })}>
      <View style={s.well}><Building2 size={20} color={colors.primaryInk} /></View>
      <View style={s.body}>
        <View style={s.line}>
          <Text style={s.name} numberOfLines={1}>{buyer.tradeName}</Text>
          {badge}
        </View>
        <Text style={s.meta} numberOfLines={1}>{meta}</Text>
      </View>
    </View>
  );
}
