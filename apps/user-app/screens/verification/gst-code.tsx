import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useIsFocused } from '@react-navigation/native';
import Toast from 'react-native-toast-message';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import Input from '@/components/Input';
import Button from '@/components/Button';
import Skeleton from '@/components/Skeleton';
import { businessKeys, useGstState } from '@/hooks/use-business';
import { track } from '@/lib/analytics';
import { GST_EVENTS } from '@/lib/analytics-events';
import { errorCode, errorDetails, errorKey } from '@/lib/api-error';
import { toAsciiDigits } from '@/lib/digits';
import { sendGstCode, verifyGstCode } from '@/lib/gst-api';
import { GST_ERROR_KEYS, gstScreen, reviewFromCode, secondsUntil } from '@/lib/gst-flow';
import { queryClient } from '@/lib/queryClient';
import { fonts, radius, spacing, useTheme } from '@/lib/theme';
import { finishGstFlow, openTarget } from '@/navigation/go';
import type { RootStackScreenProps } from '@/navigation/types';
import GstLoadError from './gst-load-state';

const CODE_REGEX = /^\d{4,8}$/;

/**
 * Enter the code sent to the GSTIN's registered contact (spec §5.2 steps 5–7): masked hint, resend timer from
 * `resendAvailableAt`, and "Can't get the code?" → the review form with the lookup attached.
 */
export default function GstCodeScreen({ navigation }: RootStackScreenProps<'GstCode'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const gst = useGstState();
  const view = gst.data;
  const focused = useIsFocused();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [now, setNow] = useState(Date.now());
  /** Set once verified: this screen ends the flow itself, so the redirect below stands down. */
  const leaving = useRef(false);

  const wait = secondsUntil(view?.resendAvailableAt, now);
  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(id);
  }, [wait, now]);

  // Expired, spent or done elsewhere: open what the state is now (only while on top).
  useEffect(() => {
    if (!leaving.current && focused && view && view.state !== 'code_sent') openTarget(navigation, gstScreen(view), 'replace');
  }, [focused, view, navigation]);

  /** After an error that ends the attempt: the fresh state decides where to go (the effect above). */
  const refresh = () => void gst.refetch();

  const verify = async () => {
    const digits = toAsciiDigits(code).trim();
    if (!CODE_REGEX.test(digits)) {
      setError(t('verification.code.invalid'));
      return;
    }
    if (!view?.proofId) return;
    setError(undefined);
    setBusy(true);
    try {
      const next = await verifyGstCode(view.proofId, digits);
      track(GST_EVENTS.verified, { method: 'provider_otp' });
      leaving.current = true;
      queryClient.setQueryData(businessKeys.gst, next);
      // The business name is now GST's and locked; the completion meter's last segment is done.
      void queryClient.invalidateQueries({ queryKey: businessKeys.me, exact: true });
      Toast.show({ type: 'success', text1: t('verification.code.verified') });
      finishGstFlow(navigation, { screen: 'GstStatus' });
    } catch (err) {
      const reason = errorCode(err);
      track(GST_EVENTS.verifyFailed, { reason });
      if (reason === 'GST_OTP_INVALID') {
        const left = Number(errorDetails(err).attemptsLeft);
        setError(Number.isFinite(left) ? t('verification.code.wrong', { count: left }) : t('verification.errors.otpInvalid'));
      } else {
        Toast.show({ type: 'error', text1: t(errorKey(err, GST_ERROR_KEYS)) });
        if (reason !== 'ERR_NETWORK' && reason !== 'RATE_LIMITED') refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!view?.proofId) return;
    setResending(true);
    try {
      const next = await sendGstCode(view.proofId);
      queryClient.setQueryData(businessKeys.gst, next);
      setNow(Date.now());
      track(GST_EVENTS.codeSent, { resend: true });
      Toast.show({ type: 'success', text1: t('verification.code.resent') });
    } catch (err) {
      const reason = errorCode(err);
      track(GST_EVENTS.codeSendFailed, { reason });
      Toast.show({ type: 'error', text1: t(errorKey(err, GST_ERROR_KEYS)) });
      if (reason !== 'ERR_NETWORK' && reason !== 'GST_UNAVAILABLE') refresh();
    } finally {
      setResending(false);
    }
  };

  const s = useMemo(() => StyleSheet.create({
    body: { flex: 1, paddingHorizontal: spacing.xxl, paddingTop: spacing.sm },
    title: { fontFamily: fonts.display, fontSize: 24, color: colors.text },
    subtitle: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, color: colors.textSecondary, marginTop: spacing.sm, marginBottom: spacing.sm },
    hint: { fontFamily: fonts.semiBold, color: colors.text },
    code: { fontFamily: fonts.semiBold, fontSize: 20, letterSpacing: 6 },
    link: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.primary, paddingVertical: spacing.md },
    linkMuted: { color: colors.textMuted },
    footer: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.xxl, paddingTop: spacing.sm },
  }), [colors]);

  if (!view && gst.isError) {
    return (
      <ScreenWrapper>
        <Header title={t('verification.title')} />
        <GstLoadError onRetry={refresh} />
      </ScreenWrapper>
    );
  }

  if (!view || view.state !== 'code_sent') {
    return (
      <ScreenWrapper>
        <Header title={t('verification.title')} />
        <View style={[s.body, { gap: spacing.lg }]}>
          <Skeleton style={{ height: 28, width: '60%', borderRadius: radius.sm }} />
          <Skeleton style={{ height: 52, borderRadius: radius.lg }} />
        </View>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper keyboardAware scroll>
      <Header title={t('verification.title')} />
      <View style={s.body}>
        <Text style={s.title}>{t('verification.code.title')}</Text>
        <Text style={s.subtitle}>
          {view.hint ? t('verification.code.sentTo', { hint: view.hint }) : t('verification.code.sent')}
        </Text>
        <Input
          label={t('verification.code.label')}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={8}
          value={code}
          onChangeText={setCode}
          error={error}
          style={s.code}
          onSubmitEditing={() => void verify()}
          autoFocus
          testID="Gst-code"
        />
        <Pressable disabled={wait > 0 || resending} onPress={() => void resend()} testID="Gst-resend-code" accessibilityRole="button">
          <Text style={[s.link, (wait > 0 || resending) && s.linkMuted]}>
            {wait > 0 ? t('verification.code.resendIn', { seconds: wait }) : t('verification.code.resend')}
          </Text>
        </Pressable>
        <Pressable onPress={() => openTarget(navigation, reviewFromCode(view), 'replace')} testID="Gst-cant-get-code" accessibilityRole="button">
          <Text style={s.link}>{t('verification.code.cantGetCode')}</Text>
        </Pressable>
      </View>
      <View style={s.footer}>
        <Button title={t('verification.code.verify')} phLabel="Gst-verify-code" loading={busy} onPress={() => void verify()} />
      </View>
    </ScreenWrapper>
  );
}
