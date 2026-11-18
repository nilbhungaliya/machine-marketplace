import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import Input from '@/components/Input';
import Button from '@/components/Button';
import FooterBar from '@/components/FooterBar';
import { useType } from '@/hooks/use-type';
import api from '@/lib/api';
import { AUTH_EVENTS, track } from '@/lib/analytics';
import { authErrorCode, mapAuthError } from '@/lib/auth-errors';
import { sanitizePhoneInput } from '@/lib/auth-input';
import { ShieldCheck } from '@/lib/icons';
import { isValidMobile, normalizeMobile } from '@/lib/validation/phone';
import { spacing, useTheme } from '@/lib/theme';
import type { AuthStackScreenProps } from '@/navigation/types';

export default function PhoneScreen({ navigation }: AuthStackScreenProps<'Phone'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  const s = useMemo(() => StyleSheet.create({
    body: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
    title: { ...type('title'), color: colors.text },
    subtitle: { ...type('lead'), color: colors.textSecondary, marginTop: spacing.sm, marginBottom: spacing.md },
    safe: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
    safeText: { flex: 1, ...type('caption'), color: colors.textSecondary },
  }), [colors, type]);

  const submit = async () => {
    // The field keeps the raw text (rewriting it mid-composition makes Android
    // Indic keyboards commit twice); Gujarati/Hindi digits are converted here.
    const ascii = sanitizePhoneInput(phone);
    if (!isValidMobile(ascii)) {
      setError(t('auth.phone.invalid'));
      return;
    }
    setError(undefined);
    setLoading(true);
    const normalized = normalizeMobile(ascii);
    try {
      const { data } = await api.post<{ data: { resendAfter: number; devCode?: string } }>('/auth/otp/send', { phone: normalized });
      track(AUTH_EVENTS.otpRequested);
      navigation.navigate('OTP', { phone: normalized, resendAfter: data.data.resendAfter, devCode: data.data.devCode });
    } catch (err) {
      track(AUTH_EVENTS.otpRequestFailed, { reason: authErrorCode(err as object) });
      Toast.show({ type: 'error', text1: mapAuthError(err as object) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenWrapper keyboardAware>
      <Header title="" />
      <View style={s.body}>
        <Text style={s.title}>{t('auth.phone.title')}</Text>
        <Text style={s.subtitle}>{t('auth.phone.subtitle')}</Text>
        {/* The +91 is shown only (Ruling R10): sanitizePhoneInput accepts the number with or without it. */}
        <Input
          label={t('auth.phone.label')}
          placeholder={t('auth.phone.placeholder')}
          size="lg"
          prefix="+91"
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          maxLength={14}
          value={phone}
          onChangeText={setPhone}
          error={error}
          onSubmitEditing={submit}
          autoFocus
        />
        <View style={s.safe}>
          <ShieldCheck size={16} color={colors.ok} />
          <Text style={s.safeText}>{t('auth.phone.safe')}</Text>
        </View>
      </View>
      <FooterBar>
        <Button title={t('auth.phone.sendOtp')} phLabel="Send-OTP" size="md" loading={loading} onPress={submit} />
      </FooterBar>
    </ScreenWrapper>
  );
}
