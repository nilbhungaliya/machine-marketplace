import React, { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useIsFocused } from '@react-navigation/native';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import Button from '@/components/Button';
import FooterBar from '@/components/FooterBar';
import Skeleton from '@/components/Skeleton';
import { useGstState } from '@/hooks/use-business';
import { useType } from '@/hooks/use-type';
import { gstScreen } from '@/lib/gst-flow';
import { radius, spacing, useTheme } from '@/lib/theme';
import { openTarget } from '@/navigation/go';
import type { RootStackScreenProps } from '@/navigation/types';
import GstDetailsCard from './gst-details-card';
import GstLoadError from './gst-load-state';

/** "We found your business" (spec §5.2 step 3): the lookup's details, Yes / Not mine. */
export default function GstFoundScreen({ navigation }: RootStackScreenProps<'GstFound'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const gst = useGstState();
  const view = gst.data;
  const focused = useIsFocused();

  // The lookup expired or moved on (code sent, verified…): open what the state is now. Only while on top, so a
  // later screen's update doesn't also replace this one.
  useEffect(() => {
    if (focused && view && view.state !== 'found') openTarget(navigation, gstScreen(view), 'replace');
  }, [focused, view, navigation]);

  const s = useMemo(() => StyleSheet.create({
    body: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xl, gap: spacing.lg },
    heading: { gap: spacing.sm },
    title: { ...type('title'), color: colors.text },
    subtitle: { ...type('lead'), color: colors.textSecondary },
    skeleton: { height: 160, borderRadius: radius.xl },
  }), [colors, type]);

  if (!view && gst.isError) {
    return (
      <ScreenWrapper>
        <Header title={t('verification.title')} />
        <GstLoadError onRetry={() => void gst.refetch()} />
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper scroll>
      <Header title={t('verification.title')} />
      <View style={s.body}>
        <View style={s.heading}>
          <Text style={s.title}>{t('verification.found.title')}</Text>
          <Text style={s.subtitle}>{t('verification.found.subtitle')}</Text>
        </View>
        {view?.state === 'found' ? (
          <GstDetailsCard details={view.details} gstin={view.gstin} />
        ) : (
          <Skeleton style={s.skeleton} />
        )}
      </View>
      <FooterBar>
        <Button
          title={t('verification.found.notMine')}
          phLabel="Gst-not-my-business"
          variant="outline"
          size="md"
          // GST screens replace one another (GSTIN entry replaced itself with this card), so there is one GSTIN screen.
          onPress={() => navigation.replace('GstStart')}
        />
        <Button
          title={t('verification.found.yes')}
          size="md"
          phLabel="Gst-this-is-my-business"
          disabled={view?.state !== 'found' || !view.checkId}
          // Replace, not push: Back from the declaration (and the code screen that replaces it) goes where the flow
          // was opened from, never to this card, whose redirect would push the code screen again.
          onPress={() => view?.checkId && navigation.replace('GstDeclare', { checkId: view.checkId })}
        />
      </FooterBar>
    </ScreenWrapper>
  );
}
