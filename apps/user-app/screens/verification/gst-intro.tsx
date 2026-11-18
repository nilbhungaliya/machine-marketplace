import React, { useEffect, useMemo, useState } from 'react';
import { BackHandler, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import Button from '@/components/Button';
import FooterBar from '@/components/FooterBar';
import Notice from '@/components/Notice';
import { useAuth } from '@/hooks/useAuth';
import { gstStateQuery, useGstState } from '@/hooks/use-business';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { ONBOARDING_EVENTS } from '@/lib/analytics-events';
import { gstScreen, type GstTarget } from '@/lib/gst-flow';
import { ShieldCheck } from '@/lib/icons';
import { queryClient } from '@/lib/queryClient';
import { fonts, radius, spacing, useTheme } from '@/lib/theme';
import { resetTo } from '@/navigation/go';
import type { RootStackScreenProps } from '@/navigation/types';

/**
 * "Get verified": right after onboarding (F1 spec §7), with Skip for now. It is the only screen on the stack (the
 * `app` group opens on it), so both buttons reset to the tabs. It counts as seen on Verify or Skip, not on showing:
 * an app closed on it offers it again.
 */
export default function GstIntroScreen({ navigation }: RootStackScreenProps<'GstIntro'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const { dismissGstIntro } = useAuth();
  const gst = useGstState();
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    track(ONBOARDING_EVENTS.gstIntroShown);
  }, []);

  const verify = async () => {
    track(ONBOARDING_EVENTS.gstIntroAccepted);
    setOpening(true);
    let target: GstTarget = { screen: 'GstStart' };
    try {
      target = gstScreen(await queryClient.fetchQuery(gstStateQuery));
    } catch {
      // GSTIN entry shows its own errors.
    }
    resetTo(navigation, [{ screen: 'Main' }, target]);
    void dismissGstIntro();
  };

  const skip = () => {
    track(ONBOARDING_EVENTS.gstIntroSkipped);
    resetTo(navigation, [{ screen: 'Main' }]);
    void dismissGstIntro();
  };

  // Android back is Skip: with nothing underneath it would otherwise close the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      skip();
      return true;
    });
    return () => sub.remove();
  });

  const instant = gst.data?.instantAllowed !== false;
  const steps = instant
    ? [t('verification.intro.instantStep1'), t('verification.intro.instantStep2'), t('verification.intro.instantStep3')]
    : [t('verification.intro.reviewStep1'), t('verification.intro.reviewStep2')];

  const s = useMemo(() => StyleSheet.create({
    body: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xl, gap: spacing.xl },
    badge: {
      width: 72, height: 72, borderRadius: radius.full, backgroundColor: colors.primaryWash,
      alignItems: 'center', justifyContent: 'center', alignSelf: 'center',
    },
    title: { ...type('title'), color: colors.text, textAlign: 'center' },
    steps: { gap: spacing.md },
    stepsTitle: { ...type('section'), color: colors.text },
    step: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
    stepNo: {
      width: 26, height: 26, borderRadius: radius.full, backgroundColor: colors.field, alignItems: 'center',
      justifyContent: 'center',
    },
    stepNoText: { ...type('caption'), fontFamily: fonts.bold, color: colors.primaryInk },
    stepText: { flex: 1, ...type('body'), color: colors.textSecondary },
  }), [colors, type]);

  return (
    <ScreenWrapper scroll>
      <Header title={t('verification.title')} showBack={false} />
      <View style={s.body}>
        <View style={s.badge}>
          <ShieldCheck size={36} color={colors.primaryInk} />
        </View>
        <Text style={s.title}>{t('verification.intro.title')}</Text>
        <Notice icon={ShieldCheck} text={t('verification.intro.callout')} />
        <View style={s.steps}>
          <Text style={s.stepsTitle}>{t('verification.intro.howItWorks')}</Text>
          {steps.map((text, i) => (
            <View key={text} style={s.step}>
              <View style={s.stepNo}><Text style={s.stepNoText}>{i + 1}</Text></View>
              <Text style={s.stepText}>{text}</Text>
            </View>
          ))}
        </View>
      </View>
      <FooterBar>
        <Button title={t('verification.intro.skip')} phLabel="Gst-intro-skip" variant="outline" size="md" onPress={skip} />
        <Button title={t('verification.intro.verifyNow')} phLabel="Gst-intro-verify" size="md" loading={opening} onPress={() => void verify()} />
      </FooterBar>
    </ScreenWrapper>
  );
}
