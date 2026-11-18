import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import ScreenWrapper from '@/components/ScreenWrapper';
import Button from '@/components/Button';
import HeroGlow from '@/components/HeroGlow';
import SideToken from '@/components/SideToken';
import GearShot from '@/components/art/GearShot';
import { useType } from '@/hooks/use-type';
import { spacing, useTheme } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';

/** Periwinkle v2 `.welcome` (spec §8, Ruling R8): the glow, the gear shot and an L | R token over the copy. */
export default function WelcomeScreen({ navigation }: RootStackScreenProps<'Welcome'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();

  const s = useMemo(() => StyleSheet.create({
    // Scrolls, so a large font scale or a long Hindi / Gujarati title never pushes the button off screen.
    body: { flexGrow: 1, justifyContent: 'center', padding: spacing.xxl, gap: spacing.md },
    art: { alignItems: 'center', gap: spacing.lg, paddingVertical: spacing.md, marginBottom: spacing.sm },
    title: { ...type('display'), color: colors.text },
    subtitle: { ...type('lead'), color: colors.textSecondary, marginBottom: spacing.sm },
  }), [colors, type]);

  return (
    <ScreenWrapper>
      <HeroGlow />
      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <View style={s.art}>
          <GearShot />
          <SideToken kind="want-right" size="xl" />
        </View>
        <Text style={s.title}>{t('auth.welcome.title')}</Text>
        <Text style={s.subtitle}>{t('auth.welcome.subtitle')}</Text>
        <Button title={t('auth.welcome.cta')} phLabel="Get-started" onPress={() => navigation.navigate('Auth')} />
      </ScrollView>
    </ScreenWrapper>
  );
}
