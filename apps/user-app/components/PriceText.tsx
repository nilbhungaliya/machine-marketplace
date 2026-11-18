import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { formatRupees } from '@/lib/money';
import { radius, spacing, useTheme } from '@/lib/theme';
import { useType } from '@/hooks/use-type';

interface PriceTextProps {
  /** Integer paise; null shows `fallback` (e.g. "Price on request"). */
  paise: number | null;
  /** Per-unit or per-period suffix, already translated ("/pc", "/day"). */
  suffix?: string;
  /** Model and GST note, already translated ("Negotiable · GST extra"); shown under the price at `lg` and `xl`. */
  note?: string;
  /** Shown instead of the amount when `paise` is null. */
  fallback?: string;
  /**
   * `pill`: the listing card's outlined violet pill (v2 `.l-foot .price`) · `lg`: a price line · `xl`: the listing
   * page's headline (v2 `.price.xl`).
   */
  size?: 'pill' | 'lg' | 'xl';
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Rupees with Indian grouping (₹1,23,456), a per-unit suffix and an optional model note (F2 spec §15.2). */
export default function PriceText({ paise, suffix, note, fallback = '', size = 'lg', testID, style }: PriceTextProps) {
  const { colors } = useTheme();
  const type = useType();
  const s = useMemo(() => StyleSheet.create({
    pill: {
      alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'baseline', borderWidth: 1.5, borderColor: colors.primary,
      borderRadius: radius.full, paddingHorizontal: spacing.sm + 2, paddingVertical: 2,
    },
    pillText: { ...type('chip'), color: colors.primaryInk, fontVariant: ['tabular-nums'] },
    row: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: spacing.xs },
    amountLg: { ...type('price'), color: colors.text },
    amountXl: { ...type('price'), fontSize: 30, lineHeight: 36, color: colors.text },
    suffix: { ...type('label'), color: colors.textMuted },
    note: { ...type('caption'), color: colors.textSecondary, marginTop: 2 },
  }), [colors, type]);

  const amount = paise == null ? fallback : formatRupees(paise);

  if (size === 'pill') {
    return (
      <View style={[s.pill, style]} testID={testID}>
        <Text style={s.pillText} numberOfLines={1}>{paise == null || !suffix ? amount : `${amount} ${suffix}`}</Text>
      </View>
    );
  }
  return (
    <View style={style} testID={testID}>
      <View style={s.row}>
        <Text style={size === 'xl' ? s.amountXl : s.amountLg}>{amount}</Text>
        {paise != null && suffix ? <Text style={s.suffix}>{suffix}</Text> : null}
      </View>
      {note ? <Text style={s.note}>{note}</Text> : null}
    </View>
  );
}
