import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { OTP_LENGTH, type OnboardingStep } from '@mpm/shared-types';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import Input from '@/components/Input';
import Button from '@/components/Button';
import api from '@/lib/api';
import { AUTH_EVENTS, track } from '@/lib/analytics';
import { authErrorCode, mapAuthError } from '@/lib/auth-errors';
import { otpFieldState } from '@/lib/auth-input';
import { useAuth } from '@/hooks/useAuth';
import { fonts, spacing, useTheme } from '@/lib/theme';
import type { AuthStackScreenProps } from '@/navigation/types';

interface VerifyResponse {
  /** `onboarding`: where onboarding resumes (`profile` for a new user), F1 spec §7. */
  data: { token: string; user: { id: string }; isNewUser: boolean; onboarding: OnboardingStep };
}

export default function OtpScreen({ route }: AuthStackScreenProps<'OTP'>) {
  const { phone } = route.params;
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { login } = useAuth();
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState(route.params.devCode);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [wait, setWait] = useState(route.params.resendAfter);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const s = useMemo(() => StyleSheet.create({
    body: { flex: 1, paddingHorizontal: spacing.xxl, paddingTop: spacing.lg },
    title: { fontFamily: fonts.display, fontSize: 26, color: colors.text },
    subtitle: { fontFamily: fonts.regular, fontSize: 15, color: colors.textSecondary, marginTop: spacing.sm, marginBottom: spacing.lg },
    resend: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.primary, marginTop: spacing.lg },
    resendWait: { color: colors.textMuted },
    dev: { fontFamily: fonts.medium, fontSize: 13, color: colors.orange, marginTop: spacing.md },
    footer: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.xxl },
  }), [colors]);

  const verify = async () => {
    // Converts Gujarati/Hindi digits; handles paste, autofill and SMS auto-read.
    const otp = otpFieldState(code, OTP_LENGTH);
    if (!otp.complete) {
      setError(t('auth.otp.invalid'));
      return;
    }
    setError(undefined);
    setLoading(true);
    try {
      const { data } = await api.post<VerifyResponse>('/auth/otp/verify', { phone, code: otp.digits });
      track(AUTH_EVENTS.otpVerified, { isNewUser: data.data.isNewUser, onboarding: data.data.onboarding });
      // Root navigator swaps to the onboarding step or the tabs once auth state changes.
      await login(data.data.token, data.data.user.id, data.data.onboarding);
    } catch (err) {
      track(AUTH_EVENTS.otpVerifyFailed, { reason: authErrorCode(err as object) });
      setError(mapAuthError(err as object));
      setLoading(false);
    }
  };

  const resend = async () => {
    try {
      const { data } = await api.post<{ data: { resendAfter: number; devCode?: string } }>('/auth/otp/send', { phone });
      setWait(data.data.resendAfter);
      setDevCode(data.data.devCode);
    } catch (err) {
      Toast.show({ type: 'error', text1: mapAuthError(err as object) });
    }
  };

  return (
    <ScreenWrapper keyboardAware>
      <Header title="" />
      <View style={s.body}>
        <Text style={s.title}>{t('auth.otp.title')}</Text>
        <Text style={s.subtitle}>{t('auth.otp.subtitle', { phone })}</Text>
        <Input
          label={t('auth.otp.label')}
          keyboardType="number-pad"
          autoComplete="sms-otp"
          textContentType="oneTimeCode"
          value={code}
          onChangeText={setCode}
          error={error}
          onSubmitEditing={verify}
          autoFocus
        />
        {devCode ? <Text style={s.dev}>{t('auth.otp.devCode', { code: devCode })}</Text> : null}
        <Pressable disabled={wait > 0} onPress={resend} testID="Resend-OTP">
          <Text style={[s.resend, wait > 0 && s.resendWait]}>
            {wait > 0 ? t('auth.otp.resendIn', { seconds: wait }) : t('auth.otp.resend')}
          </Text>
        </Pressable>
      </View>
      <View style={s.footer}>
        <Button title={t('auth.otp.verify')} phLabel="Verify-OTP" loading={loading} onPress={verify} />
      </View>
    </ScreenWrapper>
  );
}
