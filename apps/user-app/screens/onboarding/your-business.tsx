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
import Field, { FieldLabel } from '@/components/Field';
import FooterBar from '@/components/FooterBar';
import Skeleton from '@/components/Skeleton';
import StatusChip from '@/components/StatusChip';
import Steps from '@/components/Steps';
import Conveyor from '@/components/art/Conveyor';
import Nameplate from '@/components/art/Nameplate';
import { ArtIn, FootIn, SlideIn } from '@/components/motion/Entrance';
import { useAuth } from '@/hooks/useAuth';
import { useBusiness, useMachineCategories } from '@/hooks/use-business';
import { useType } from '@/hooks/use-type';
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
  const type = useType();
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
    body: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xl },
    subtitle: { ...type('lead'), color: colors.textSecondary, marginTop: spacing.md },
    art: { marginTop: spacing.lg },
    // The same top spacing as an Input, so chip groups and text fields keep one rhythm.
    group: { marginTop: spacing.md },
    hint: { ...type('caption'), color: colors.textMuted },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    // The locked name reads as a filled field that can't be focused (spec §8).
    locked: {
      minHeight: 52, justifyContent: 'center', alignItems: 'flex-start', gap: spacing.sm, borderRadius: radius.md,
      paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.field,
    },
    lockedName: { ...type('fieldValue'), color: colors.text },
    section: { ...type('section'), color: colors.text, marginTop: spacing.xxl },
    retry: { ...type('caption'), fontFamily: fonts.bold, color: colors.primaryInk, marginTop: spacing.xs },
    skeleton: { height: 52, borderRadius: radius.md, marginTop: spacing.md },
    chipSkeleton: { width: 110, height: 40, borderRadius: radius.full },
  }), [colors, type]);

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
  // Onboarding motion (mockup screen 04): each field block slides in along its rail, 90 ms after the one before.
  const fieldDelay = (i: number) => 550 + i * 90;
  const activityChips = (
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
  );

  return (
    <ScreenWrapper keyboardAware scroll>
      <Header title={title} showBack={mode === 'edit'} />
      <View style={s.body}>
        {mode === 'onboarding' ? (
          <>
            <Steps current={1} total={2} label={t('onboarding.step', { current: 1, total: 2 })} />
            <Text style={s.subtitle}>{t('onboarding.business.subtitle')}</Text>
            {/* The nameplate engraves what is typed below: the business name, then the person's name. */}
            <ArtIn style={s.art}>
              <Nameplate line1={nameLocked && profile ? profile.displayName : form.values.businessName} line2={form.values.name} />
            </ArtIn>
          </>
        ) : null}

        <SlideIn rail delay={fieldDelay(0)}>
          <Input
            label={t('onboarding.business.yourName')}
            autoComplete="name"
            value={form.values.name}
            onChangeText={form.handleChange('name')}
            onBlur={form.handleBlur('name')}
            error={fieldError('name')}
            testID="Your-name"
          />
        </SlideIn>

        <SlideIn rail delay={fieldDelay(1)}>
          {nameLocked && profile ? (
            <View style={s.group}>
              <FieldLabel>{t('onboarding.business.businessName')}</FieldLabel>
              <View style={s.locked}>
                <Text style={s.lockedName}>{profile.displayName}</Text>
                <StatusChip tone="ok" icon={ShieldCheck} label={t('onboarding.business.nameFromGst')} />
              </View>
            </View>
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
        </SlideIn>

        <SlideIn rail delay={fieldDelay(2)}>
          <Field
            label={t('onboarding.business.activities')}
            // The hint gives way to the list's error, as before.
            hint={activityError ? undefined : t('onboarding.business.activitiesHint')}
            error={activityError}
            style={s.group}
          >
            {/* Onboarding: the chips ride in on a conveyor belt. */}
            {mode === 'onboarding' ? <Conveyor bleed={spacing.lg}>{activityChips}</Conveyor> : activityChips}
          </Field>
        </SlideIn>

        <SlideIn rail delay={fieldDelay(3)}>
          <Field label={t('onboarding.business.categories')} error={categoryError} style={s.group}>
            {categories.isLoading ? (
              <View style={s.chips}>
                {[0, 1, 2, 3].map((i) => <Skeleton key={i} style={s.chipSkeleton} />)}
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
          </Field>
        </SlideIn>

        {mode === 'edit' ? (
          <>
            <SlideIn delay={fieldDelay(4)}>
              <Text style={s.section}>{t('onboarding.business.more')}</Text>
            </SlideIn>
            <SlideIn rail delay={fieldDelay(5)}>
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
            </SlideIn>
            <SlideIn rail delay={fieldDelay(6)}>
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
            </SlideIn>
            <SlideIn rail delay={fieldDelay(7)}>
              <Field label={t('onboarding.business.employees')} style={s.group}>
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
              </Field>
            </SlideIn>
          </>
        ) : null}
      </View>
      <FootIn>
        <FooterBar>
          <Button
            title={mode === 'edit' ? t('onboarding.business.saveChanges') : t('onboarding.business.next')}
            phLabel={mode === 'edit' ? 'Save-business-profile' : 'Onboarding-business-next'}
            size="md"
            loading={form.isSubmitting}
            onPress={() => form.handleSubmit()}
          />
        </FooterBar>
      </FootIn>
    </ScreenWrapper>
  );
}
