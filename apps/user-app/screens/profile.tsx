import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import Button from '@/components/Button';
import { useConfirm } from '@/components/ConfirmSheet';
import { useAuth } from '@/hooks/useAuth';
import { track } from '@/lib/analytics';
import { SETTINGS_EVENTS } from '@/lib/analytics-events';
import { setLanguage, useLanguage } from '@/lib/i18n/language';
import { LANGUAGE_OPTIONS } from '@/lib/i18n/language-names';
import { Check, Globe, Sun } from '@/lib/icons';
import { fonts, radius, spacing, useTheme, type ThemeMode } from '@/lib/theme';

const THEME_MODES: ThemeMode[] = ['light', 'dark', 'system'];
const THEME_KEY = { light: 'profile.themeLight', dark: 'profile.themeDark', system: 'profile.themeSystem' } as const;

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { colors, cardShadow, mode, setMode } = useTheme();
  const language = useLanguage();
  const { logout } = useAuth();
  const confirm = useConfirm();

  const confirmLogout = async () => {
    const ok = await confirm({
      title: t('profile.logoutConfirmTitle'),
      message: t('profile.logoutConfirmMessage'),
      confirmLabel: t('profile.logout'),
      destructive: true,
    });
    if (ok) void logout();
  };

  const chooseTheme = (m: ThemeMode) => {
    setMode(m);
    track(SETTINGS_EVENTS.themeChanged, { mode: m });
  };

  const s = useMemo(() => StyleSheet.create({
    body: { padding: spacing.lg, gap: spacing.xl },
    sectionTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
    sectionText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.text },
    card: { borderRadius: radius.lg, backgroundColor: colors.card, ...cardShadow },
    row: {
      flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderLight,
    },
    rowLast: { borderBottomWidth: 0 },
    rowText: { flex: 1 },
    rowLabel: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
    rowHint: { fontFamily: fonts.regular, fontSize: 12, color: colors.textMuted, marginTop: 2 },
  }), [colors, cardShadow]);

  const chooseLanguage = (id: (typeof LANGUAGE_OPTIONS)[number]['id']) => {
    setLanguage(id)
      .then(() => track(SETTINGS_EVENTS.languageChanged, { language: id }))
      .catch(() => Toast.show({ type: 'error', text1: t('errors.generic') }));
  };

  return (
    <ScreenWrapper>
      <Header title={t('profile.title')} />
      <ScrollView contentContainerStyle={s.body}>
        <View>
          <View style={s.sectionTitle}>
            <Globe size={18} color={colors.primary} />
            <Text style={s.sectionText}>{t('profile.language')}</Text>
          </View>
          <View style={s.card}>
            {LANGUAGE_OPTIONS.map((o, i) => (
              <Pressable
                key={o.id}
                style={[s.row, i === LANGUAGE_OPTIONS.length - 1 && s.rowLast]}
                onPress={() => chooseLanguage(o.id)}
                testID={`Language-${o.id}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: language === o.id }}
              >
                <View style={s.rowText}>
                  <Text style={s.rowLabel}>{o.label}</Text>
                  <Text style={s.rowHint}>{o.hint}</Text>
                </View>
                {language === o.id && <Check size={20} color={colors.primary} />}
              </Pressable>
            ))}
          </View>
        </View>

        <View>
          <View style={s.sectionTitle}>
            <Sun size={18} color={colors.primary} />
            <Text style={s.sectionText}>{t('profile.theme')}</Text>
          </View>
          <View style={s.card}>
            {THEME_MODES.map((m, i) => (
              <Pressable
                key={m}
                style={[s.row, i === THEME_MODES.length - 1 && s.rowLast]}
                onPress={() => chooseTheme(m)}
                testID={`Theme-${m}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: mode === m }}
              >
                <Text style={[s.rowLabel, s.rowText]}>{t(THEME_KEY[m])}</Text>
                {mode === m && <Check size={20} color={colors.primary} />}
              </Pressable>
            ))}
          </View>
        </View>

        <Button title={t('profile.logout')} phLabel="Log-out" variant="outline" onPress={() => void confirmLogout()} />
      </ScrollView>
    </ScreenWrapper>
  );
}
