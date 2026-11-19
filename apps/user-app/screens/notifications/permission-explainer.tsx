import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import ScreenWrapper from '@/components/ScreenWrapper';
import Button from '@/components/Button';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { NOTIFICATION_EVENTS } from '@/lib/analytics-events';
import { BellRing, Check } from '@/lib/icons';
import { registerForPush } from '@/lib/push';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';

const POINTS = ['chat', 'offers', 'deals'] as const;

/**
 * The push explainer (F6 + F7 spec §11.6; ported from textile `screens/notifications/permission-explainer.tsx`, no
 * mockup, in the v2 kit): shown once per install over the screen the user was on, at the first enquiry, offer,
 * published listing or Chats visit (`askPushOnce`), never at app start. Turn on → Android 13's prompt, then the device
 * registers; Not now (or Back) leaves it off.
 */
export default function PermissionExplainerScreen({ navigation, route }: RootStackScreenProps<'PermissionExplainer'>) {
  const { trigger } = route.params;
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const [asking, setAsking] = useState(false);

  const s = useMemo(() => StyleSheet.create({
    body: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xl, gap: spacing.lg },
    well: {
      alignSelf: 'center', width: 96, height: 96, borderRadius: radius.full, backgroundColor: colors.primaryWash,
      alignItems: 'center', justifyContent: 'center',
    },
    title: { ...type('title'), color: colors.text, textAlign: 'center' },
    lead: { ...type('lead'), color: colors.textSecondary, textAlign: 'center' },
    points: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm },
    point: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
      borderRadius: radius.full, backgroundColor: colors.okSoft,
    },
    pointText: { ...type('label'), color: colors.ok },
    note: { ...type('caption'), color: colors.textMuted, textAlign: 'center' },
    actions: { gap: spacing.sm, padding: spacing.lg },
  }), [colors, type]);

  const later = () => {
    if (asking) return;
    track(NOTIFICATION_EVENTS.pushPermissionAnswered, { granted: false });
    navigation.goBack();
  };

  const allow = async () => {
    if (asking) return;
    setAsking(true);
    const result = await registerForPush({ ask: true });
    // A build without Firebase still counts as allowed: the permission is what the person decided.
    track(NOTIFICATION_EVENTS.pushPermissionAnswered, { granted: result !== 'denied' });
    if (result === 'denied') Toast.show({ type: 'info', text1: t('notifications.explainer.denied') });
    setAsking(false);
    navigation.goBack();
  };

  return (
    <ScreenWrapper>
      <View style={s.body} testID="Push-explainer">
        <View style={s.well}><BellRing size={44} color={colors.primaryInk} /></View>
        <Text style={s.title} accessibilityRole="header">{t('notifications.explainer.title')}</Text>
        <Text style={s.lead}>{t(`notifications.explainer.body.${trigger}`)}</Text>
        <View style={s.points}>
          {POINTS.map((p) => (
            <View key={p} style={s.point}>
              <Check size={14} color={colors.ok} />
              <Text style={s.pointText}>{t(`notifications.explainer.point.${p}`)}</Text>
            </View>
          ))}
        </View>
        <Text style={s.note}>{t('notifications.explainer.note')}</Text>
      </View>
      <View style={s.actions}>
        <Button title={t('notifications.explainer.allow')} onPress={() => void allow()} loading={asking} phLabel="Push-explainer-allow" />
        <Button title={t('notifications.explainer.later')} onPress={later} variant="ghost" disabled={asking} phLabel="Push-explainer-later" />
      </View>
    </ScreenWrapper>
  );
}
