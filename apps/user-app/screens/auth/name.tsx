import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFormik } from 'formik';
import * as yup from 'yup';
import Toast from 'react-native-toast-message';
import ScreenWrapper from '@/components/ScreenWrapper';
import Input from '@/components/Input';
import Button from '@/components/Button';
import api, { apiErrorMessage } from '@/lib/api';
import { AUTH_EVENTS, track } from '@/lib/analytics';
import { useAuth } from '@/hooks/useAuth';
import { fonts, spacing, useTheme } from '@/lib/theme';

export default function NameScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { completeOnboarding } = useAuth();

  // Built at render time so messages follow the current language.
  const schema = useMemo(() => yup.object({
    name: yup.string().trim().min(2, t('auth.name.required')).required(t('auth.name.required')),
    businessName: yup.string().trim().min(2, t('auth.name.required')).required(t('auth.name.required')),
  }), [t]);

  const form = useFormik({
    initialValues: { name: '', businessName: '' },
    validationSchema: schema,
    onSubmit: async (values) => {
      try {
        const body = { name: values.name.trim(), businessName: values.businessName.trim() };
        await api.patch('/users/me', body);
        track(AUTH_EVENTS.onboardingCompleted);
        completeOnboarding(body.name);
      } catch (err) {
        Toast.show({ type: 'error', text1: apiErrorMessage(err, t('errors.generic')) });
      }
    },
  });

  const s = useMemo(() => StyleSheet.create({
    body: { flex: 1, paddingHorizontal: spacing.xxl, paddingTop: spacing.xxxl },
    title: { fontFamily: fonts.display, fontSize: 26, color: colors.text },
    subtitle: { fontFamily: fonts.regular, fontSize: 15, color: colors.textSecondary, marginTop: spacing.sm, marginBottom: spacing.lg },
    footer: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.xxl },
  }), [colors]);

  const fieldError = (k: 'name' | 'businessName') => (form.touched[k] ? form.errors[k] : undefined);

  return (
    <ScreenWrapper keyboardAware scroll>
      <View style={s.body}>
        <Text style={s.title}>{t('auth.name.title')}</Text>
        <Text style={s.subtitle}>{t('auth.name.subtitle')}</Text>
        <Input
          label={t('auth.name.yourName')}
          autoComplete="name"
          value={form.values.name}
          onChangeText={form.handleChange('name')}
          onBlur={form.handleBlur('name')}
          error={fieldError('name')}
        />
        <Input
          label={t('auth.name.businessName')}
          autoComplete="organization"
          value={form.values.businessName}
          onChangeText={form.handleChange('businessName')}
          onBlur={form.handleBlur('businessName')}
          error={fieldError('businessName')}
        />
      </View>
      <View style={s.footer}>
        <Button title={t('auth.name.finish')} phLabel="Finish-onboarding" loading={form.isSubmitting} onPress={() => form.handleSubmit()} />
      </View>
    </ScreenWrapper>
  );
}
