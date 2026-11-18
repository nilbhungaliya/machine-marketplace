import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import Button from '@/components/Button';
import Skeleton from '@/components/Skeleton';
import { useConfirm } from '@/components/ConfirmSheet';
import { useAuth } from '@/hooks/useAuth';
import { gstStateQuery, useBusiness, useGstState } from '@/hooks/use-business';
import { track } from '@/lib/analytics';
import { SETTINGS_EVENTS } from '@/lib/analytics-events';
import { completionSegments, gstChip, profileRowTarget, type ChipTone, type ProfileRow } from '@/lib/gst-flow';
import { setLanguage, useLanguage } from '@/lib/i18n/language';
import { LANGUAGE_OPTIONS } from '@/lib/i18n/language-names';
import { Building2, Check, ChevronRight, Globe, MapPin, ShieldCheck, Sun, User, type LucideIcon } from '@/lib/icons';
import { queryClient } from '@/lib/queryClient';
import { fonts, radius, spacing, useTheme, type ThemeMode } from '@/lib/theme';
import { openTarget } from '@/navigation/go';
import type { RootStackScreenProps } from '@/navigation/types';

const THEME_MODES: ThemeMode[] = ['light', 'dark', 'system'];
const THEME_KEY = { light: 'profile.themeLight', dark: 'profile.themeDark', system: 'profile.themeSystem' } as const;

export default function ProfileScreen({ navigation }: RootStackScreenProps<'Profile'>) {
  const { t } = useTranslation();
  const { colors, cardShadow, mode, setMode } = useTheme();
  const language = useLanguage();
  const { logout, name } = useAuth();
  const confirm = useConfirm();
  const business = useBusiness();
  const profile = business.data ?? null;
  const gst = useGstState(!!profile);
  const [opening, setOpening] = useState<ProfileRow | null>(null);

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

  /** Business and Location open the onboarding screens in edit mode; GST opens the screen its state picks. */
  const openRow = async (row: ProfileRow) => {
    if (row !== 'gst') {
      openTarget(navigation, profileRowTarget(row));
      return;
    }
    setOpening(row);
    try {
      const view = gst.data ?? (await queryClient.fetchQuery(gstStateQuery));
      openTarget(navigation, profileRowTarget(row, view));
    } catch {
      Toast.show({ type: 'error', text1: t('errors.genericRetry') });
    } finally {
      setOpening(null);
    }
  };

  const toneColor = (tone: ChipTone) => ({
    green: [colors.green, colors.greenMuted],
    orange: [colors.orange, colors.orangeMuted],
    red: [colors.red, colors.redMuted],
    muted: [colors.textSecondary, colors.elevated],
  })[tone];

  const s = useMemo(() => StyleSheet.create({
    body: { padding: spacing.lg, gap: spacing.xl },
    head: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
    avatar: {
      width: 64, height: 64, borderRadius: radius.lg, backgroundColor: colors.primaryMuted, alignItems: 'center', justifyContent: 'center',
    },
    headText: { flex: 1, gap: 2 },
    person: { fontFamily: fonts.display, fontSize: 22, color: colors.text },
    businessName: { fontFamily: fonts.medium, fontSize: 15, color: colors.textSecondary },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.full },
    chipText: { fontFamily: fonts.semiBold, fontSize: 12 },
    meterCard: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.card, gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    meterTitle: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.text },
    meter: { flexDirection: 'row', gap: spacing.xs },
    segment: { flex: 1, height: 6, borderRadius: radius.full, backgroundColor: colors.elevated },
    segmentDone: { backgroundColor: colors.primary },
    prompt: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    promptText: { flex: 1, fontFamily: fonts.semiBold, fontSize: 14, color: colors.primary },
    sectionTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
    sectionText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.text },
    card: { borderRadius: radius.lg, backgroundColor: colors.card, ...cardShadow },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 56,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderLight,
    },
    rowLast: { borderBottomWidth: 0 },
    rowText: { flex: 1 },
    rowLabel: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
    rowHint: { fontFamily: fonts.regular, fontSize: 12, color: colors.textMuted, marginTop: 2 },
    retry: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.primary, marginTop: spacing.xs },
  }), [colors, cardShadow]);

  const chipView = (state: Parameters<typeof gstChip>[0]) => {
    const chip = gstChip(state);
    const [fg, bg] = toneColor(chip.tone);
    return (
      <View style={[s.chip, { backgroundColor: bg }]}>
        {chip.tone === 'green' ? <ShieldCheck size={12} color={fg} /> : null}
        <Text style={[s.chipText, { color: fg }]}>{t(chip.key)}</Text>
      </View>
    );
  };

  const segments = profile ? completionSegments(profile.completion) : [];
  const done = segments.filter((x) => x.done).length;
  const missing = segments.find((x) => !x.done);
  const location = profile?.location;
  const area = location?.industrialAreaName ?? location?.industrialAreaOther;
  const rows: { row: ProfileRow; icon: LucideIcon; label: string; hint?: string; chip?: React.ReactNode }[] = [
    {
      row: 'business',
      icon: User,
      label: t('profile.rows.business'),
      hint: profile ? profile.activities.map((a) => t(`onboarding.activities.${a}`)).join(', ') : undefined,
    },
    { row: 'location', icon: MapPin, label: t('profile.rows.location'), hint: [area, location?.city].filter(Boolean).join(', ') || undefined },
    { row: 'gst', icon: ShieldCheck, label: t('profile.rows.gst'), chip: gst.data ? chipView(gst.data.state) : null },
  ];

  return (
    <ScreenWrapper>
      <Header title={t('profile.title')} />
      <ScrollView contentContainerStyle={s.body}>
        {business.isLoading ? (
          <View style={{ gap: spacing.md }}>
            <Skeleton style={{ height: 64, borderRadius: radius.lg }} />
            <Skeleton style={{ height: 96, borderRadius: radius.lg }} />
          </View>
        ) : business.isError ? (
          <Pressable onPress={() => void business.refetch()} testID="Retry-business" accessibilityRole="button">
            <Text style={s.rowHint}>{t('profile.loadError')}</Text>
            <Text style={s.retry}>{t('common.retry')}</Text>
          </Pressable>
        ) : profile ? (
          <>
            <View style={s.head}>
              <View style={s.avatar}><Building2 size={28} color={colors.primary} /></View>
              <View style={s.headText}>
                <Text style={s.person} numberOfLines={1}>{profile.userName ?? name ?? ''}</Text>
                <Text style={s.businessName} numberOfLines={2}>{profile.displayName}</Text>
                {gst.data ? chipView(gst.data.state) : null}
              </View>
            </View>

            <View style={s.meterCard}>
              <Text style={s.meterTitle}>{t('profile.completion.title', { done, total: segments.length })}</Text>
              <View style={s.meter} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: segments.length, now: done }}>
                {segments.map((x) => <View key={x.key} style={[s.segment, x.done && s.segmentDone]} />)}
              </View>
              {missing ? (
                <Pressable
                  style={s.prompt}
                  onPress={() => void openRow(missing.row)}
                  testID={`Complete-${missing.key}`}
                  accessibilityRole="button"
                >
                  <Text style={s.promptText}>{t(`profile.completion.prompt.${missing.key}`)}</Text>
                  <ChevronRight size={18} color={colors.primary} />
                </Pressable>
              ) : (
                <Text style={s.rowHint}>{t('profile.completion.done')}</Text>
              )}
            </View>

            <View style={s.card}>
              {rows.map((r, i) => (
                <Pressable
                  key={r.row}
                  style={[s.row, i === rows.length - 1 && s.rowLast]}
                  onPress={() => void openRow(r.row)}
                  disabled={opening !== null}
                  testID={`Profile-row-${r.row}`}
                  accessibilityRole="button"
                >
                  <r.icon size={20} color={colors.primary} />
                  <View style={s.rowText}>
                    <Text style={s.rowLabel}>{r.label}</Text>
                    {r.hint ? <Text style={s.rowHint} numberOfLines={1}>{r.hint}</Text> : null}
                  </View>
                  {r.chip}
                  <ChevronRight size={18} color={colors.textMuted} />
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

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
                onPress={() => {
                  setLanguage(o.id)
                    .then(() => track(SETTINGS_EVENTS.languageChanged, { language: o.id }))
                    .catch(() => Toast.show({ type: 'error', text1: t('errors.generic') }));
                }}
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
