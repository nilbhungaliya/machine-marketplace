import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import ScreenWrapper from '@/components/ScreenWrapper';
import Card from '@/components/Card';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { useType } from '@/hooks/use-type';
import { BellRing, CalendarClock, ChevronRight, Factory, Wrench, type LucideIcon } from '@/lib/icons';
import { radius, spacing, useTheme } from '@/lib/theme';

/** What do you want to do? (spec §8): the four options as hairline cards with a lavender icon well. */
export default function PostScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  // The floating tab bar draws over the screen's bottom (spec §7.5).
  const tabInset = useTabBarInset();

  const s = useMemo(() => StyleSheet.create({
    // Scrolls, so a large font scale or Hindi / Gujarati copy never pushes the last card under the tab bar.
    body: { flexGrow: 1, padding: spacing.lg, gap: spacing.md },
    title: { ...type('title'), color: colors.text, marginBottom: spacing.sm, marginTop: spacing.sm },
    card: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
    iconWrap: {
      width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.primaryWash,
      alignItems: 'center', justifyContent: 'center',
    },
    text: { flex: 1 },
    cardTitle: { ...type('cardTitle'), color: colors.text },
    cardSubtitle: { ...type('caption'), color: colors.textSecondary, marginTop: spacing.xs },
  }), [colors, type]);

  const comingSoon = () => Toast.show({ type: 'info', text1: t('common.comingSoon') });

  const card = (Icon: LucideIcon, area: 'sellPart' | 'sellMachine' | 'rentMachine' | 'partRequest') => (
    <Pressable onPress={comingSoon} testID={`Post-${area}`} accessibilityRole="button">
      <Card style={s.card}>
        <View style={s.iconWrap}><Icon size={26} color={colors.primaryInk} /></View>
        <View style={s.text}>
          <Text style={s.cardTitle}>{t(`post.${area}.title`)}</Text>
          <Text style={s.cardSubtitle}>{t(`post.${area}.subtitle`)}</Text>
        </View>
        <ChevronRight size={20} color={colors.textMuted} />
      </Card>
    </Pressable>
  );

  return (
    <ScreenWrapper edges={['top']} scroll contentContainerStyle={[s.body, { paddingBottom: tabInset }]}>
      <Text style={s.title}>{t('post.title')}</Text>
      {card(Wrench, 'sellPart')}
      {card(Factory, 'sellMachine')}
      {card(CalendarClock, 'rentMachine')}
      {card(BellRing, 'partRequest')}
    </ScreenWrapper>
  );
}
