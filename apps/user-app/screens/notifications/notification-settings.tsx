import React, { useCallback, useMemo, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import Button from '@/components/Button';
import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import Notice from '@/components/Notice';
import Skeleton from '@/components/Skeleton';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { NOTIFICATION_EVENTS } from '@/lib/analytics-events';
import { f6ErrorMessage } from '@/lib/f6-errors';
import { BellRing, Info, TriangleAlert } from '@/lib/icons';
import { fetchPushPreference, savePushPreference } from '@/lib/notifications-api';
import { pushPermission, registerForPush } from '@/lib/push';
import { qk } from '@/lib/query-keys';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';

const preferenceKey = [...qk.notifications(), 'preferences'] as const;

type Permission = Awaited<ReturnType<typeof pushPermission>>;

/**
 * Notification settings (F6 + F7 spec §11.6; no mockup, in the v2 kit): one push switch (`users.push_enabled`, review
 * change 29). In-app notifications are always kept. When the phone itself blocks the app's notifications the screen
 * says so and opens the phone's settings; a build without push support says that instead.
 */
export default function NotificationSettingsScreen(_props: RootStackScreenProps<'NotificationSettings'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const qc = useQueryClient();
  const pref = useQuery({ queryKey: preferenceKey, queryFn: fetchPushPreference, staleTime: 0 });
  const [permission, setPermission] = useState<Permission | null>(null);
  const save = useMutation({
    mutationFn: (push: boolean) => savePushPreference(push),
    onMutate: (push) => qc.setQueryData(preferenceKey, { push }),
    onSuccess: (next) => qc.setQueryData(preferenceKey, next),
    onError: (err) => {
      void pref.refetch();
      Toast.show({ type: 'error', text1: f6ErrorMessage(err) });
    },
  });

  // Back from the phone's settings: read the permission again.
  useFocusEffect(useCallback(() => {
    void pushPermission().then(setPermission);
  }, []));

  const allowOnPhone = async () => {
    const result = await registerForPush({ ask: true });
    track(NOTIFICATION_EVENTS.pushPermissionAnswered, { granted: result !== 'denied' });
    setPermission(await pushPermission());
  };

  const toggle = (push: boolean) => {
    save.mutate(push);
    if (push && permission === 'undetermined') void allowOnPhone();
  };

  const s = useMemo(() => StyleSheet.create({
    body: { padding: spacing.lg, gap: spacing.lg },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56 },
    text: { flex: 1, gap: spacing.xs },
    label: { ...type('bodyStrong'), color: colors.text },
    hint: { ...type('caption'), color: colors.textSecondary },
    skeleton: { height: 96, borderRadius: radius.xl },
  }), [colors, type]);

  let content: React.ReactNode;
  if (pref.isLoading) {
    content = <Skeleton style={s.skeleton} />;
  } else if (!pref.data) {
    content = (
      <EmptyState
        icon={TriangleAlert}
        title={t('notifications.settings.loadError')}
        subtitle={pref.error ? f6ErrorMessage(pref.error) : ''}
        ctaTitle={t('common.retry')}
        ctaPhLabel="Notification-settings-retry"
        onCtaPress={() => void pref.refetch()}
      />
    );
  } else {
    const on = pref.data.push;
    content = (
      <>
        <Card>
          <View style={s.row}>
            <BellRing size={22} color={colors.primaryInk} />
            <View style={s.text}>
              <Text style={s.label}>{t('notifications.settings.push')}</Text>
              <Text style={s.hint}>{t('notifications.settings.pushHint')}</Text>
            </View>
            <Switch
              value={on}
              onValueChange={toggle}
              disabled={save.isPending}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.surface}
              accessibilityLabel={t('notifications.settings.push')}
              testID="Notification-settings-push"
            />
          </View>
        </Card>
        {on && permission === 'blocked' ? (
          <Notice tone="warning" icon={TriangleAlert} text={t('notifications.settings.blocked')}>
            <Button
              title={t('notifications.settings.openSettings')}
              onPress={() => void Linking.openSettings()}
              variant="outline"
              size="sm"
              phLabel="Notification-settings-open-phone"
            />
          </Notice>
        ) : null}
        {on && permission === 'undetermined' ? (
          <Button
            title={t('notifications.settings.allow')}
            onPress={() => void allowOnPhone()}
            variant="outline"
            phLabel="Notification-settings-allow"
          />
        ) : null}
        {permission === 'unsupported' ? <Notice tone="info" icon={Info} text={t('notifications.settings.unsupported')} /> : null}
      </>
    );
  }

  return (
    <ScreenWrapper>
      <Header title={t('notifications.settings.title')} />
      <ScrollView contentContainerStyle={s.body}>{content}</ScrollView>
    </ScreenWrapper>
  );
}
