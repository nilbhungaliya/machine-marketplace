import React, { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useIsFocused } from '@react-navigation/native';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import Button from '@/components/Button';
import Skeleton from '@/components/Skeleton';
import { useGstState } from '@/hooks/use-business';
import { gstScreen } from '@/lib/gst-flow';
import { fonts, radius, spacing, useTheme } from '@/lib/theme';
import { openTarget } from '@/navigation/go';
import type { RootStackScreenProps } from '@/navigation/types';
import GstDetailsCard from './gst-details-card';

/** "We found your business" (spec §5.2 step 3): the lookup's details, Yes / Not mine. */
export default function GstFoundScreen({ navigation }: RootStackScreenProps<'GstFound'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const gst = useGstState();
  const view = gst.data;
  const focused = useIsFocused();

  // The lookup expired or moved on (code sent, verified…): open what the state is now. Only while on top, so a
  // later screen's update doesn't also replace this one.
  useEffect(() => {
    if (focused && view && view.state !== 'found') openTarget(navigation, gstScreen(view), 'replace');
  }, [focused, view, navigation]);

  const s = useMemo(() => StyleSheet.create({
    body: { flex: 1, paddingHorizontal: spacing.xxl, paddingTop: spacing.sm, gap: spacing.lg },
    title: { fontFamily: fonts.display, fontSize: 24, color: colors.text },
    subtitle: { fontFamily: fonts.regular, fontSize: 15, color: colors.textSecondary },
    footer: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.xxl, gap: spacing.sm },
  }), [colors]);

  return (
    <ScreenWrapper scroll>
      <Header title={t('verification.title')} />
      <View style={s.body}>
        <Text style={s.title}>{t('verification.found.title')}</Text>
        <Text style={s.subtitle}>{t('verification.found.subtitle')}</Text>
        {view?.state === 'found' ? (
          <GstDetailsCard details={view.details} gstin={view.gstin} />
        ) : (
          <Skeleton style={{ height: 160, borderRadius: radius.lg }} />
        )}
      </View>
      <View style={s.footer}>
        <Button
          title={t('verification.found.yes')}
          phLabel="Gst-this-is-my-business"
          disabled={view?.state !== 'found' || !view.checkId}
          onPress={() => view?.checkId && navigation.navigate('GstDeclare', { checkId: view.checkId })}
        />
        <Button
          title={t('verification.found.notMine')}
          phLabel="Gst-not-my-business"
          variant="ghost"
          onPress={() => navigation.replace('GstStart')}
        />
      </View>
    </ScreenWrapper>
  );
}
