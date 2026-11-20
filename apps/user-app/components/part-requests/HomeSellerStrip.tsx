import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { PART_REQUEST_LIMITS, type PartRequestHome } from '@mpm/shared-types';
import StatusChip from '@/components/StatusChip';
import SellerRequestRow from '@/components/part-requests/SellerRequestRow';
import { useType } from '@/hooks/use-type';
import { spacing, useTheme } from '@/lib/theme';
import type { RootStackParamList } from '@/navigation/types';

export interface HomeSellerStripProps {
  data: NonNullable<PartRequestHome['seller']>;
  style?: StyleProp<ViewStyle>;
}

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * Home's seller strip (F8 spec §13.2, plan D17): "Buyers looking near you" with up to 3 compact rows and "See all" →
 * Buyers looking for your parts. The API sends it only to a business with the `sell` activity or a live listing;
 * nothing shows when there is no row.
 */
export default function HomeSellerStrip({ data, style }: HomeSellerStripProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const navigation = useNavigation<Nav>();
  const s = useMemo(() => StyleSheet.create({
    section: { gap: spacing.md },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, gap: spacing.md },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
    title: { ...type('section'), color: colors.text, flexShrink: 1 },
    link: { ...type('label'), color: colors.primaryInk },
    rows: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  }), [colors, type]);

  const items = data.items.slice(0, PART_REQUEST_LIMITS.homeSellerItems);
  if (items.length === 0) return null;

  return (
    <View style={[s.section, style]} testID="Home-seller-strip">
      <View style={s.head}>
        <View style={s.titleRow}>
          <Text style={s.title} numberOfLines={1}>{t('home.requests.sellerTitle')}</Text>
          {data.newCount > 0 ? <StatusChip label={t('buyers.home.new', { count: data.newCount })} tone="sun" /> : null}
        </View>
        <Pressable
          onPress={() => navigation.navigate('BuyersLooking', {})}
          testID="Home-seller-strip-all"
          accessibilityRole="button"
          hitSlop={12}
        >
          <Text style={s.link}>{t('buyers.home.seeAll')}</Text>
        </Pressable>
      </View>
      <View style={s.rows}>
        {items.map((row) => (
          <SellerRequestRow
            key={row.id}
            row={row}
            compact
            onPress={() => navigation.navigate('Requirement', { partRequestId: row.id })}
            testID={`Home-seller-request-${row.id}`}
          />
        ))}
      </View>
    </View>
  );
}
