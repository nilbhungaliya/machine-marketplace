import React, { useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFormik } from 'formik';
import Toast from 'react-native-toast-message';
import { BUSINESS_ACTIVITIES, EMPLOYEE_RANGES, type BusinessActivity } from '@mpm/shared-types';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import Input from '@/components/Input';
import Button from '@/components/Button';
import Chip from '@/components/Chip';
import Skeleton from '@/components/Skeleton';
import { useAuth } from '@/hooks/useAuth';
import { useBusiness, useMachineCategories } from '@/hooks/use-business';
import { track } from '@/lib/analytics';
import { ONBOARDING_EVENTS } from '@/lib/analytics-events';
import { errorCode, errorKey } from '@/lib/api-error';
import { updateProfile } from '@/lib/business-api';
import { CATEGORY_ICON_COMPONENTS, ShieldCheck } from '@/lib/icons';
import { buildProfileSchema, toProfileBody, type ProfileFormValues } from '@/lib/onboarding-step';
import { fonts, radius, spacing, useTheme } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';

const ERROR_KEYS: Record<string, string> = {
  NAME_LOCKED: 'onboarding.errors.nameLocked',
  INVALID_CATEGORY: 'onboarding.errors.invalidCategory',
};

const EMPTY_VALUES: ProfileFormValues = {
  name: '', businessName: '', activities: [], categories: [], email: '', yearEstablished: '', employees: null,
};

const toggle = <T,>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

/** F1 "Your business": onboarding step 1, or Profile → Business profile (`mode: 'edit'`). Spec §4.1, §7. */
export default function YourBusinessScreen({ navigation, route }: RootStackScreenProps<'YourBusiness'>) {
  const mode = route.params?.mode ?? 'onboarding';
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { applyProfile, name: sessionName } = useAuth();
  const business = useBusiness();
  const categories = useMachineCategories();
  const profile = business.data ?? null;
  const nameLocked = profile?.nameLocked ?? false;

  // Built at render time so messages follow the current language.
  const schema = useMemo(() => buildProfileSchema(t), [t]);
  // Initialised once, from the first loaded profile: a background refetch with changed data (GST approved meanwhile…)
  // must not wipe what the user is typing. A name locked since is still honoured: the locked name is shown read-only
  // and `toProfileBody` never sends a name while `nameLocked` (read live from the profile) is true.
  const initial = useRef<ProfileFormValues | null>(null);
  if (initial.current === null && !business.isLoading) {
    initial.current = {
      name: profile?.userName ?? sessionName ?? '',
      businessName: profile?.tradeName ?? '',
      activities: profile?.activities ?? [],
      categories: profile?.categories ?? [],
      email: profile?.email ?? '',
      yearEstablished: profile?.yearEstablished ? String(profile.yearEstablished) : '',
      employees: profile?.employees ?? null,
    };
  }

  const form = useFormik({
    initialValues: initial.current ?? EMPTY_VALUES,
    // Takes the snapshot when it first appears (the form is behind a skeleton until then); it never changes after.
    enableReinitialize: true,
    validationSchema: schema,
    onSubmit: async (values) => {
      try {
        const saved = await updateProfile(toProfileBody(values, { nameLocked, mode }));
        track(ONBOARDING_EVENTS.profileSaved, { mode, activities: values.activities.length, categories: values.categories.length });
        // Onboarding: the new step moves the root navigator on to Where are you?.
        await applyProfile(saved);
        if (mode === 'edit') {
          Toast.show({ type: 'success', text1: t('onboarding.business.saved') });
          navigation.goBack();
        }
      } catch (err) {
        const code = errorCode(err);
        track(ONBOARDING_EVENTS.profileSaveFailed, { mode, reason: code });
        if (code === 'INVALID_CATEGORY') void categories.refetch();
        if (code === 'NAME_LOCKED') void business.refetch();
        Toast.show({ type: 'error', text1: t(errorKey(err, ERROR_KEYS)) });
      }
    },
  });

  const s = useMemo(() => StyleSheet.create({
    body: { flex: 1, paddingHorizontal: spacing.xxl, paddingTop: spacing.sm, paddingBottom: spacing.xl },
    step: { fontFamily: fonts.medium, fontSize: 13, color: colors.textMuted },
    subtitle: { fontFamily: fonts.regular, fontSize: 15, color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.sm },
    label: {
      fontFamily: fonts.medium, fontSize: 13, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8,
      marginTop: spacing.xl, marginBottom: spacing.sm,
    },
    hint: { fontFamily: fonts.regular, fontSize: 13, color: colors.textMuted, marginTop: spacing.sm },
    error: { fontFamily: fonts.regular, fontSize: 12, color: colors.danger, marginTop: spacing.sm },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    locked: {
      marginTop: 10, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.field,
    },
    lockedName: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.text },
    lockedHint: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
    lockedHintText: { fontFamily: fonts.medium, fontSize: 12, color: colors.ok },
    section: { fontFamily: fonts.semiBold, fontSize: 16, color: colors.text, marginTop: spacing.xxl },
    retry: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.primary, marginTop: spacing.sm },
    skeleton: { height: 52, borderRadius: radius.lg, marginTop: spacing.lg },
    footer: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.xxl, paddingTop: spacing.sm },
  }), [colors]);

  const fieldError = (k: 'name' | 'businessName' | 'email' | 'yearEstablished') => (form.touched[k] ? form.errors[k] : undefined);
  const listError = (k: 'activities' | 'categories') =>
    form.submitCount > 0 && typeof form.errors[k] === 'string' ? (form.errors[k] as string) : undefined;

  const title = mode === 'edit' ? t('onboarding.business.editTitle') : t('onboarding.business.title');

  if (business.isLoading) {
    return (
      <ScreenWrapper>
        <Header title={title} showBack={mode === 'edit'} />
        <View style={s.body}>
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} style={s.skeleton} />)}
        </View>
      </ScreenWrapper>
    );
  }

  const activityError = listError('activities');
  const categoryError = listError('categories');

  return (
    <ScreenWrapper keyboardAware scroll>
      <Header title={title} showBack={mode === 'edit'} />
      <View style={s.body}>
        {mode === 'onboarding' ? (
          <>
            <Text style={s.step}>{t('onboarding.step', { current: 1, total: 2 })}</Text>
            <Text style={s.subtitle}>{t('onboarding.business.subtitle')}</Text>
          </>
        ) : null}

        <Input
          label={t('onboarding.business.yourName')}
          autoComplete="name"
          value={form.values.name}
          onChangeText={form.handleChange('name')}
          onBlur={form.handleBlur('name')}
          error={fieldError('name')}
          testID="Your-name"
        />

        {nameLocked && profile ? (
          <>
            <Text style={[s.label, { marginTop: spacing.md, marginBottom: 0 }]}>{t('onboarding.business.businessName')}</Text>
            <View style={s.locked}>
              <Text style={s.lockedName}>{profile.displayName}</Text>
              <View style={s.lockedHint}>
                <ShieldCheck size={14} color={colors.ok} />
                <Text style={s.lockedHintText}>{t('onboarding.business.nameFromGst')}</Text>
              </View>
            </View>
          </>
        ) : (
          <Input
            label={t('onboarding.business.businessName')}
            autoComplete="organization"
            value={form.values.businessName}
            onChangeText={form.handleChange('businessName')}
            onBlur={form.handleBlur('businessName')}
            error={fieldError('businessName')}
            testID="Business-name"
          />
        )}

        <Text style={s.label}>{t('onboarding.business.activities')}</Text>
        <View style={s.chips}>
          {BUSINESS_ACTIVITIES.map((a: BusinessActivity) => (
            <Chip
              key={a}
              label={t(`onboarding.activities.${a}`)}
              selected={form.values.activities.includes(a)}
              onPress={() => void form.setFieldValue('activities', toggle(form.values.activities, a))}
              testID={`Activity-${a}`}
            />
          ))}
        </View>
        {activityError ? <Text style={s.error}>{activityError}</Text> : <Text style={s.hint}>{t('onboarding.business.activitiesHint')}</Text>}

        <Text style={s.label}>{t('onboarding.business.categories')}</Text>
        {categories.isLoading ? (
          <View style={s.chips}>
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} style={{ width: 110, height: 40, borderRadius: radius.full }} />)}
          </View>
        ) : categories.isError ? (
          <Pressable onPress={() => void categories.refetch()} testID="Retry-categories" accessibilityRole="button">
            <Text style={s.hint}>{t('onboarding.business.categoriesError')}</Text>
            <Text style={s.retry}>{t('common.retry')}</Text>
          </Pressable>
        ) : (
          <View style={s.chips}>
            {(categories.data ?? []).map((c) => (
              <Chip
                key={c.id}
                label={c.name}
                icon={c.icon ? CATEGORY_ICON_COMPONENTS[c.icon] : undefined}
                selected={form.values.categories.includes(c.id)}
                onPress={() => void form.setFieldValue('categories', toggle(form.values.categories, c.id))}
                testID={`Machine-category-${c.slug}`}
              />
            ))}
          </View>
        )}
        {categoryError ? <Text style={s.error}>{categoryError}</Text> : null}

        {mode === 'edit' ? (
          <>
            <Text style={s.section}>{t('onboarding.business.more')}</Text>
            <Input
              label={t('onboarding.business.email')}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              value={form.values.email}
              onChangeText={form.handleChange('email')}
              onBlur={form.handleBlur('email')}
              error={fieldError('email')}
              testID="Business-email"
            />
            <Input
              label={t('onboarding.business.year')}
              keyboardType="number-pad"
              maxLength={4}
              value={form.values.yearEstablished}
              onChangeText={form.handleChange('yearEstablished')}
              onBlur={form.handleBlur('yearEstablished')}
              error={fieldError('yearEstablished')}
              testID="Year-established"
            />
            <Text style={s.label}>{t('onboarding.business.employees')}</Text>
            <View style={s.chips}>
              {EMPLOYEE_RANGES.map((r) => (
                <Chip
                  key={r}
                  label={r}
                  role="radio"
                  selected={form.values.employees === r}
                  onPress={() => void form.setFieldValue('employees', form.values.employees === r ? null : r)}
                  testID={`Employees-${r}`}
                />
              ))}
            </View>
          </>
        ) : null}
      </View>
      <View style={s.footer}>
        <Button
          title={mode === 'edit' ? t('onboarding.business.saveChanges') : t('onboarding.business.next')}
          phLabel={mode === 'edit' ? 'Save-business-profile' : 'Onboarding-business-next'}
          loading={form.isSubmitting}
          onPress={() => form.handleSubmit()}
        />
      </View>
    </ScreenWrapper>
  );
}
