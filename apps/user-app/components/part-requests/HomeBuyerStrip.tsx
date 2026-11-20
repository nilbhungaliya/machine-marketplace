import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { PartRequestHome } from '@mpm/shared-types';
import SideToken from '@/components/SideToken';
import { useType } from '@/hooks/use-type';
import { ChevronRight, ClipboardList } from '@/lib/icons';
import { distanceText } from '@/lib/listing-format';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackParamList } from '@/navigation/types';

export interface HomeBuyerStripProps {
  data: NonNullable<PartRequestHome['buyer']>;
  style?: StyleProp<ViewStyle>;
}

/**
 * Home's buyer strip (F8 spec §13.4; mockup `.sidematch`, v2's soft lavender variant): the buyer's requirement with the
 * most new responses — the side wanted, "{n} new for your {name}", the nearest one's distance — opening that
 * requirement.
 */
export default function HomeBuyerStrip({ data, style }: HomeBuyerStripProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const s = useMemo(() => StyleSheet.create({
    box: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginHorizontal: spacing.lg, marginTop: spacing.md,
      paddingVertical: spacing.md, paddingHorizontal: spacing.md, minHeight: 60, borderRadius: radius.lg,
      backgroundColor: colors.primaryWash, borderWidth: 1, borderColor: colors.primarySoft,
    },
    well: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
    text: { flex: 1, gap: 2 },
    title: { ...type('bodyStrong'), color: colors.text },
    sub: { ...type('caption'), color: colors.textSecondary },
  }), [colors, type]);

  const kind = data.side === 'left' ? 'want-left' : data.side === 'right' ? 'want-right' : data.side === 'pair' ? 'pair' : null;
  const title = data.newCount > 0
    ? t('requirements.home.newFor', { count: data.newCount, name: data.name })
    : t('requirements.home.waiting', { name: data.name });
  const sub = data.nearestKm !== null
    ? t('requirements.home.nearest', { distance: distanceText(data.nearestKm) })
    : t('requirements.home.fromRequirement');

  return (
    <Pressable
      style={[s.box, style]}
      onPress={() => navigation.navigate('Requirement', { partRequestId: data.partRequestId })}
      testID="Home-buyer-strip"
      accessibilityRole="button"
    >
      {kind ? <SideToken kind={kind} size="lg" /> : <View style={s.well}><ClipboardList size={20} color={colors.primaryInk} /></View>}
      <View style={s.text}>
        <Text style={s.title} numberOfLines={2}>{title}</Text>
        <Text style={s.sub} numberOfLines={1}>{sub}</Text>
      </View>
      <ChevronRight size={18} color={colors.primaryInk} />
    </Pressable>
  );
}
