import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { OTP_LENGTH, type OnboardingStep } from '@mpm/shared-types';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import Button from '@/components/Button';
import FooterBar from '@/components/FooterBar';
import OtpCells from '@/components/OtpCells';
import api from '@/lib/api';
import { AUTH_EVENTS, track } from '@/lib/analytics';
import { authErrorCode, mapAuthError } from '@/lib/auth-errors';
import { otpFieldState } from '@/lib/auth-input';
import { useAuth } from '@/hooks/useAuth';
import { useType } from '@/hooks/use-type';
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
  const type = useType();
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
    body: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
    title: { ...type('title'), color: colors.text },
    subtitle: { ...type('lead'), color: colors.textSecondary, marginTop: spacing.sm, marginBottom: spacing.xxl },
    dev: { ...type('caption'), color: colors.warn, marginTop: spacing.md },
    // A text link (spec §8): `caption` in bold, violet, muted while the timer runs; padded to a 44 dp tap target.
    resendTap: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', marginTop: spacing.sm },
    resend: { ...type('caption'), fontFamily: fonts.bold, color: colors.primaryInk },
    resendWait: { color: colors.textMuted },
  }), [colors, type]);

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
        {/* One real TextInput drawn as cells: autofill, paste and Hindi / Gujarati digits work as on a plain field. */}
        <OtpCells
          length={OTP_LENGTH}
          value={code}
          onChangeText={setCode}
          error={error}
          onSubmitEditing={verify}
          autoFocus
          accessibilityLabel={t('auth.otp.label')}
        />
        {devCode ? <Text style={s.dev}>{t('auth.otp.devCode', { code: devCode })}</Text> : null}
        <Pressable style={s.resendTap} disabled={wait > 0} onPress={resend} testID="Resend-OTP">
          <Text style={[s.resend, wait > 0 && s.resendWait]}>
            {wait > 0 ? t('auth.otp.resendIn', { seconds: wait }) : t('auth.otp.resend')}
          </Text>
        </Pressable>
      </View>
      <FooterBar>
        <Button title={t('auth.otp.verify')} phLabel="Verify-OTP" size="md" loading={loading} onPress={verify} />
      </FooterBar>
    </ScreenWrapper>
  );
}
