import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import Button from '@/components/Button';
import Card from '@/components/Card';
import ListRow from '@/components/ListRow';
import Skeleton from '@/components/Skeleton';
import StatusChip from '@/components/StatusChip';
import { useConfirm } from '@/components/ConfirmSheet';
import { useAuth } from '@/hooks/useAuth';
import { gstStateQuery, useBusiness, useGstState } from '@/hooks/use-business';
import { useMyListings } from '@/hooks/use-my-listings';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { SETTINGS_EVENTS } from '@/lib/analytics-events';
import { completionSegments, gstChip, profileRowTarget, type ProfileRow } from '@/lib/gst-flow';
import { setLanguage, useLanguage } from '@/lib/i18n/language';
import { LANGUAGE_OPTIONS } from '@/lib/i18n/language-names';
import { Building2, ChevronRight, ClipboardList, Globe, MapPin, ShieldCheck, User, type LucideIcon } from '@/lib/icons';
import { queryClient } from '@/lib/queryClient';
import { fonts, radius, spacing, useTheme } from '@/lib/theme';
import { openTarget } from '@/navigation/go';
import type { RootStackScreenProps } from '@/navigation/types';

/** Profile (Periwinkle v2 `.sp-head` + `.menu`, spec §8, Ruling R11). */
export default function ProfileScreen({ navigation }: RootStackScreenProps<'Profile'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const language = useLanguage();
  const { logout, name } = useAuth();
  const confirm = useConfirm();
  const business = useBusiness();
  const profile = business.data ?? null;
  const gst = useGstState(!!profile);
  // The "My listings" row's live count (F2 spec §10).
  const myListings = useMyListings('live', 1, !!profile);
  const liveCount = myListings.data?.counts.live;
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

  const s = useMemo(() => StyleSheet.create({
    body: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xl },
    loading: { gap: spacing.md },
    headSkeleton: { height: 64, borderRadius: radius.lg },
    meterSkeleton: { height: 96, borderRadius: radius.xl },
    head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    avatar: {
      width: 64, height: 64, borderRadius: radius.lg, backgroundColor: colors.photo, alignItems: 'center', justifyContent: 'center',
    },
    headText: { flex: 1, gap: 2 },
    person: { ...type('title'), color: colors.text },
    businessName: { ...type('lead'), color: colors.textSecondary },
    chip: { marginTop: spacing.xs },
    meterCard: { gap: spacing.md },
    meterTitle: { ...type('bodyStrong'), color: colors.text },
    // The Steps bar (spec §7.2): 6 high, filled segments violet.
    meter: { flexDirection: 'row', gap: spacing.xs },
    segment: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.border },
    segmentDone: { backgroundColor: colors.primary },
    prompt: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 44 },
    promptText: { flex: 1, ...type('bodyStrong'), fontFamily: fonts.bold, color: colors.primaryInk },
    hint: { ...type('caption'), color: colors.textMuted },
    retry: { ...type('caption'), fontFamily: fonts.bold, color: colors.primaryInk, marginTop: spacing.xs },
    sectionTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
    sectionText: { flex: 1, ...type('section'), color: colors.text },
  }), [colors, type]);

  const chipView = (state: Parameters<typeof gstChip>[0], style?: StyleProp<ViewStyle>) => {
    const chip = gstChip(state);
    return <StatusChip tone={chip.tone} icon={chip.tone === 'ok' ? ShieldCheck : undefined} label={t(chip.key)} style={style} />;
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
          <View style={s.loading}>
            <Skeleton style={s.headSkeleton} />
            <Skeleton style={s.meterSkeleton} />
          </View>
        ) : business.isError ? (
          <Pressable onPress={() => void business.refetch()} testID="Retry-business" accessibilityRole="button">
            <Text style={s.hint}>{t('profile.loadError')}</Text>
            <Text style={s.retry}>{t('common.retry')}</Text>
          </Pressable>
        ) : profile ? (
          <>
            <View style={s.head}>
              <View style={s.avatar}><Building2 size={28} color={colors.textSecondary} /></View>
              <View style={s.headText}>
                <Text style={s.person} numberOfLines={1}>{profile.userName ?? name ?? ''}</Text>
                <Text style={s.businessName} numberOfLines={2}>{profile.displayName}</Text>
                {gst.data ? chipView(gst.data.state, s.chip) : null}
              </View>
            </View>

            <Card style={s.meterCard}>
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
                  <ChevronRight size={18} color={colors.primaryInk} />
                </Pressable>
              ) : (
                <Text style={s.hint}>{t('profile.completion.done')}</Text>
              )}
            </Card>

            <Card flush>
              <ListRow
                icon={ClipboardList}
                label={t('profile.rows.listings')}
                hint={liveCount !== undefined ? t('profile.rows.listingsLive', { count: liveCount }) : undefined}
                chevron
                onPress={() => navigation.navigate('MyListings')}
                testID="Profile-row-listings"
                accessibilityRole="button"
              />
              {rows.map((r, i) => (
                <ListRow
                  key={r.row}
                  icon={r.icon}
                  label={r.label}
                  hint={r.hint}
                  trailing={r.chip}
                  chevron
                  last={i === rows.length - 1}
                  onPress={() => void openRow(r.row)}
                  disabled={opening !== null}
                  testID={`Profile-row-${r.row}`}
                  accessibilityRole="button"
                />
              ))}
            </Card>
          </>
        ) : null}

        <View>
          <View style={s.sectionTitle}>
            <Globe size={20} color={colors.primaryInk} />
            <Text style={s.sectionText}>{t('profile.language')}</Text>
          </View>
          <Card flush>
            {LANGUAGE_OPTIONS.map((o, i) => (
              <ListRow
                key={o.id}
                label={o.label}
                hint={o.hint}
                selected={language === o.id}
                last={i === LANGUAGE_OPTIONS.length - 1}
                onPress={() => {
                  setLanguage(o.id)
                    .then(() => track(SETTINGS_EVENTS.languageChanged, { language: o.id }))
                    .catch(() => Toast.show({ type: 'error', text1: t('errors.generic') }));
                }}
                testID={`Language-${o.id}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: language === o.id }}
              />
            ))}
          </Card>
        </View>

        <Button title={t('profile.logout')} phLabel="Log-out" variant="outline" onPress={() => void confirmLogout()} />
      </ScrollView>
    </ScreenWrapper>
  );
}
