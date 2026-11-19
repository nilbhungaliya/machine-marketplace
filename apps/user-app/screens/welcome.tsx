import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import ScreenWrapper from '@/components/ScreenWrapper';
import Button from '@/components/Button';
import HeroGlow from '@/components/HeroGlow';
import HubAssembly, { HUB_LOOP_MS, HUB_REST } from '@/components/art/HubAssembly';
import MatchToken from '@/components/art/MatchToken';
import { ArtIn, SlideIn, WipeTitle } from '@/components/motion/Entrance';
import { useLoop } from '@/hooks/use-loop';
import { useType } from '@/hooks/use-type';
import { spacing, useTheme } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';

/** The hub drawing's widest size; on a 360 dp phone it is 256 wide and 193 high, leaving room for the copy. */
const ART_MAX = 256;

/**
 * Periwinkle v2 `.welcome` (spec §8, Ruling R8) with the onboarding motion (docs/mockups/onboarding-motion.html, 01):
 * the glow, the exploded hub assembly and the L | R token that finds its right half, over the copy.
 */
export default function WelcomeScreen({ navigation }: RootStackScreenProps<'Welcome'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const { width } = useWindowDimensions();
  const clock = useLoop(HUB_LOOP_MS, HUB_REST);
  const artWidth = Math.min(ART_MAX, width - 2 * spacing.xxl - spacing.xxxl);

  const s = useMemo(() => StyleSheet.create({
    // Scrolls, so a large font scale or a long Hindi / Gujarati title never pushes the button off screen.
    body: { flexGrow: 1, justifyContent: 'center', padding: spacing.xxl, gap: spacing.md },
    art: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.md, marginBottom: spacing.sm },
    title: { ...type('display'), color: colors.text },
    subtitle: { ...type('lead'), color: colors.textSecondary, marginBottom: spacing.sm },
  }), [colors, type]);

  return (
    <ScreenWrapper>
      <HeroGlow />
      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <ArtIn style={s.art}>
          <HubAssembly clock={clock} width={artWidth} />
          <MatchToken clock={clock} />
        </ArtIn>
        <WipeTitle textStyle={s.title} delay={350}>{t('auth.welcome.title')}</WipeTitle>
        <SlideIn delay={950}>
          <Text style={s.subtitle}>{t('auth.welcome.subtitle')}</Text>
        </SlideIn>
        <SlideIn delay={1100}>
          <Button title={t('auth.welcome.cta')} phLabel="Get-started" onPress={() => navigation.navigate('Auth')} />
        </SlideIn>
      </ScrollView>
    </ScreenWrapper>
  );
}
