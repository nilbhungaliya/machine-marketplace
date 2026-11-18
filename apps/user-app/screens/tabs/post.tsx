import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import ScreenWrapper from '@/components/ScreenWrapper';
import { BellRing, CalendarClock, ChevronRight, Factory, Wrench, type LucideIcon } from '@/lib/icons';
import { fonts, radius, spacing, useTheme } from '@/lib/theme';

export default function PostScreen() {
  const { t } = useTranslation();
  const { colors, shadows } = useTheme();

  const s = useMemo(() => StyleSheet.create({
    body: { flex: 1, padding: spacing.lg, gap: spacing.md },
    title: { fontFamily: fonts.bold, fontSize: 24, color: colors.text, marginBottom: spacing.sm, marginTop: spacing.sm },
    card: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.lg, padding: spacing.lg,
      borderRadius: radius.lg, backgroundColor: colors.surface, ...shadows.raised,
    },
    iconWrap: {
      width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.primaryWash,
      alignItems: 'center', justifyContent: 'center',
    },
    text: { flex: 1 },
    cardTitle: { fontFamily: fonts.semiBold, fontSize: 17, color: colors.text },
    cardSubtitle: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.textSecondary, marginTop: 4 },
  }), [colors, shadows]);

  const comingSoon = () => Toast.show({ type: 'info', text1: t('common.comingSoon') });

  const card = (Icon: LucideIcon, area: 'sellPart' | 'sellMachine' | 'rentMachine' | 'partRequest') => (
    <Pressable style={s.card} onPress={comingSoon} testID={`Post-${area}`} accessibilityRole="button">
      <View style={s.iconWrap}><Icon size={26} color={colors.primary} /></View>
      <View style={s.text}>
        <Text style={s.cardTitle}>{t(`post.${area}.title`)}</Text>
        <Text style={s.cardSubtitle}>{t(`post.${area}.subtitle`)}</Text>
      </View>
      <ChevronRight size={20} color={colors.textMuted} />
    </Pressable>
  );

  return (
    <ScreenWrapper edges={['top']}>
      <View style={s.body}>
        <Text style={s.title}>{t('post.title')}</Text>
        {card(Wrench, 'sellPart')}
        {card(Factory, 'sellMachine')}
        {card(CalendarClock, 'rentMachine')}
        {card(BellRing, 'partRequest')}
      </View>
    </ScreenWrapper>
  );
}
