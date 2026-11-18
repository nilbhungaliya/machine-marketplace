import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ROOT_CATEGORIES } from '@mpm/shared-types';
import ScreenWrapper from '@/components/ScreenWrapper';
import Chip from '@/components/Chip';
import EmptyState from '@/components/EmptyState';
import IconButton from '@/components/IconButton';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { useType } from '@/hooks/use-type';
import { MapPin, Package, Search, User } from '@/lib/icons';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { TabScreenProps } from '@/navigation/types';

/** Home (Periwinkle v2 `.home-top` + `.searchbar`, spec §8, Ruling R12: categories stay a chip row until F4). */
export default function HomeScreen({ navigation }: TabScreenProps<'Home'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  // The floating tab bar draws over the screen's bottom (spec §7.5): keeps the empty state's button clear of it.
  const tabInset = useTabBarInset();

  const s = useMemo(() => StyleSheet.create({
    // Scrolls, so a large font scale or Hindi / Gujarati copy never pushes the empty state's button under the tab bar.
    content: { flexGrow: 1 },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.md },
    city: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    cityText: { flex: 1, ...type('bodyStrong'), color: colors.text },
    // A searchbar is a card on the page: hairline, no shadow (spec §6).
    search: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.lg, marginTop: spacing.md,
      paddingHorizontal: spacing.lg, height: 50, borderRadius: radius.full, backgroundColor: colors.surface,
      borderWidth: 1, borderColor: colors.hairline,
    },
    searchText: { flex: 1, ...type('body'), color: colors.textMuted },
    chips: { paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, gap: spacing.sm },
    sectionTitle: { ...type('section'), color: colors.text, paddingHorizontal: spacing.lg },
    empty: { minHeight: 320 },
  }), [colors, type]);

  return (
    <ScreenWrapper edges={['top']} scroll contentContainerStyle={[s.content, { paddingBottom: tabInset }]}>
      <View style={s.header}>
        <View style={s.city}>
          <MapPin size={20} color={colors.primaryInk} />
          <Text style={s.cityText} numberOfLines={1}>{t('home.allIndia')}</Text>
        </View>
        <IconButton
          icon={User}
          onPress={() => navigation.navigate('Profile')}
          accessibilityLabel={t('profile.title')}
          testID="Open-profile"
        />
      </View>

      <Pressable style={s.search} onPress={() => navigation.navigate('Main', { screen: 'Search' })} testID="Open-search">
        <Search size={20} color={colors.textMuted} />
        <Text style={s.searchText} numberOfLines={1}>{t('home.searchPlaceholder')}</Text>
      </Pressable>

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          {ROOT_CATEGORIES.map((c) => (
            <Chip key={c} label={t(`home.categories.${c}`)} testID={`Category-${c}`} />
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
        style={s.empty}
      />
    </ScreenWrapper>
  );
}
