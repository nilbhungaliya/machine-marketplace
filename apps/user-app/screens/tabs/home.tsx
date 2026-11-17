import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ROOT_CATEGORIES } from '@mpm/shared-types';
import ScreenWrapper from '@/components/ScreenWrapper';
import EmptyState from '@/components/EmptyState';
import { MapPin, Package, Search, User } from '@/lib/icons';
import { fonts, radius, spacing, useTheme } from '@/lib/theme';
import type { TabScreenProps } from '@/navigation/types';

export default function HomeScreen({ navigation }: TabScreenProps<'Home'>) {
  const { t } = useTranslation();
  const { colors, cardShadow } = useTheme();

  const s = useMemo(() => StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.md },
    city: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    cityText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.text },
    avatar: {
      width: 40, height: 40, borderRadius: radius.full, backgroundColor: colors.primaryMuted,
      alignItems: 'center', justifyContent: 'center',
    },
    search: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.lg, marginTop: spacing.lg,
      paddingHorizontal: spacing.lg, height: 48, borderRadius: radius.md, backgroundColor: colors.surface,
      borderWidth: 1, borderColor: colors.border, ...cardShadow,
    },
    searchText: { flex: 1, fontFamily: fonts.regular, fontSize: 14, color: colors.textMuted },
    chips: { paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, gap: spacing.sm },
    chip: {
      paddingHorizontal: spacing.lg, height: 36, borderRadius: radius.full, justifyContent: 'center',
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    },
    chipText: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
    sectionTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.text, paddingHorizontal: spacing.lg },
  }), [colors, cardShadow]);

  return (
    <ScreenWrapper edges={['top']}>
      <View style={s.header}>
        <View style={s.city}>
          <MapPin size={18} color={colors.primary} />
          <Text style={s.cityText}>{t('home.allIndia')}</Text>
        </View>
        <Pressable style={s.avatar} onPress={() => navigation.navigate('Profile')} testID="Open-profile" accessibilityRole="button">
          <User size={20} color={colors.primary} />
        </Pressable>
      </View>

      <Pressable style={s.search} onPress={() => navigation.navigate('Main', { screen: 'Search' })} testID="Open-search">
        <Search size={18} color={colors.textMuted} />
        <Text style={s.searchText} numberOfLines={1}>{t('home.searchPlaceholder')}</Text>
      </Pressable>

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          {ROOT_CATEGORIES.map((c) => (
            <Pressable key={c} style={s.chip} testID={`Category-${c}`}>
              <Text style={s.chipText}>{t(`home.categories.${c}`)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <Text style={s.sectionTitle}>{t('home.title')}</Text>
      <EmptyState
        icon={Package}
        title={t('home.emptyTitle')}
        subtitle={t('home.emptySubtitle')}
        ctaTitle={t('home.sellCta')}
        ctaPhLabel="Sell-a-part"
        onCtaPress={() => navigation.navigate('Main', { screen: 'Post' })}
      />
    </ScreenWrapper>
  );
}
