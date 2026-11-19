import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import { OTP_LENGTH } from '@mpm/shared-types';
import Button from '@/components/Button';
import { useConfirm } from '@/components/ConfirmSheet';
import Header from '@/components/Header';
import Input from '@/components/Input';
import Notice from '@/components/Notice';
import OtpCells from '@/components/OtpCells';
import ScreenWrapper from '@/components/ScreenWrapper';
import { useContactPhoneState, useRemoveContactPhone, useSendContactPhoneOtp, useVerifyContactPhone } from '@/hooks/use-chat';
import { useType } from '@/hooks/use-type';
import { errorCode } from '@/lib/api-error';
import { mapAuthError } from '@/lib/auth-errors';
import { otpFieldState, sanitizePhoneInput } from '@/lib/auth-input';
import { f6ErrorMessage } from '@/lib/f6-errors';
import { Lock, Phone } from '@/lib/icons';
import { fonts, radius, spacing, useTheme } from '@/lib/theme';
import { isValidMobile, normalizeMobile } from '@/lib/validation/phone';
import type { RootStackScreenProps } from '@/navigation/types';

/** OTP failures read as on sign-in; the rest through the F6 map. */
const OTP_CODES = new Set(['OTP_WRONG', 'OTP_EXPIRED', 'OTP_TOO_MANY_ATTEMPTS', 'OTP_UNAVAILABLE', 'RATE_LIMITED']);
const messageFor = (err: unknown): string =>
  OTP_CODES.has(errorCode(err)) ? mapAuthError(err as object) : f6ErrorMessage(err);

/**
 * Profile › Contact number (F6 + F7 spec §6.6, owner only): the number shared after a deal when both sides tick, in
 * place of the owner's phone. Add or replace it with a code sent to the new number, or remove it. The API has no read
 * of the current number, so the screen shows the one it last saved or removed and otherwise offers add / replace; a
 * non-owner learns from the first answer (`403 OWNER_ONLY`) and sees the owner-only line.
 */
export default function ContactNumberScreen(_props: RootStackScreenProps<'ContactNumber'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const confirm = useConfirm();
  const current = useContactPhoneState();
  const sendOtp = useSendContactPhoneOtp();
  const verify = useVerifyContactPhone();
  const remove = useRemoveContactPhone();
  const [stage, setStage] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | undefined>();
  const [wait, setWait] = useState(0);
  const [error, setError] = useState<string>();
  const [ownerOnly, setOwnerOnly] = useState(false);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const s = useMemo(() => StyleSheet.create({
    body: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.lg },
    intro: { ...type('body'), color: colors.textSecondary },
    card: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.xl,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline,
    },
    cardBody: { flex: 1, gap: 2 },
    label: { ...type('caption'), color: colors.textSecondary },
    number: { ...type('phone'), color: colors.text },
    hint: { ...type('caption'), color: colors.textSecondary },
    title: { ...type('section'), color: colors.text },
    dev: { ...type('caption'), color: colors.warn },
    link: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
    linkText: { ...type('caption'), fontFamily: fonts.bold, color: colors.primaryInk },
    linkWait: { color: colors.textMuted },
  }), [colors, type]);

  const fail = (err: unknown) => {
    if (errorCode(err) === 'OWNER_ONLY') {
      setOwnerOnly(true);
      return;
    }
    setError(messageFor(err));
  };

  const send = (to: string) => {
    setError(undefined);
    sendOtp.mutate(to, {
      onSuccess: (r) => {
        setSentTo(to);
        setStage('code');
        setCode('');
        setWait(r.resendAfter);
        setDevCode(r.devCode);
      },
      onError: fail,
    });
  };

  const submitPhone = () => {
    const ascii = sanitizePhoneInput(phone);
    if (!isValidMobile(ascii)) {
      setError(t('chats.contactNumber.invalid'));
      return;
    }
    send(normalizeMobile(ascii));
  };

  const submitCode = () => {
    const otp = otpFieldState(code, OTP_LENGTH);
    if (!otp.complete) {
      setError(t('auth.otp.invalid'));
      return;
    }
    setError(undefined);
    verify.mutate(otp.digits, {
      onSuccess: () => {
        Toast.show({ type: 'success', text1: t('chats.contactNumber.saved') });
        setStage('phone');
        setPhone('');
        setCode('');
        setDevCode(undefined);
      },
      onError: fail,
    });
  };

  const onRemove = async () => {
    const ok = await confirm({
      title: t('chats.contactNumber.removeTitle'),
      message: t('chats.contactNumber.removeMessage'),
      confirmLabel: t('chats.contactNumber.remove'),
      destructive: true,
    });
    if (!ok) return;
    remove.mutate(undefined, {
      onSuccess: () => Toast.show({ type: 'success', text1: t('chats.contactNumber.removed') }),
      onError: (err) => (errorCode(err) === 'OWNER_ONLY' ? setOwnerOnly(true) : Toast.show({ type: 'error', text1: messageFor(err) })),
    });
  };

  if (ownerOnly) {
    return (
      <ScreenWrapper>
        <Header title={t('chats.contactNumber.title')} />
        <View style={s.body} testID="Contact-number-screen">
          <Notice tone="info" icon={Lock} text={t('chats.contactNumber.ownerOnly')} />
        </View>
      </ScreenWrapper>
    );
  }

  const saved = current.data?.contactPhone ?? null;

  return (
    <ScreenWrapper keyboardAware scroll>
      <Header title={t('chats.contactNumber.title')} />
      <View style={s.body} testID="Contact-number-screen">
        <Text style={s.intro}>{t('chats.contactNumber.intro')}</Text>
        {saved ? (
          <View style={s.card}>
            <Phone size={20} color={colors.primaryInk} />
            <View style={s.cardBody}>
              <Text style={s.label}>{t('chats.contactNumber.current')}</Text>
              <Text style={s.number}>{saved}</Text>
            </View>
          </View>
        ) : (
          <Text style={s.hint}>{t('chats.contactNumber.unknown')}</Text>
        )}

        {stage === 'phone' ? (
          <>
            <Input
              label={t('chats.contactNumber.phone')}
              value={phone}
              onChangeText={(v) => { setPhone(v); setError(undefined); }}
              placeholder={t('chats.contactNumber.phonePlaceholder')}
              prefix="+91"
              keyboardType="phone-pad"
              maxLength={14}
              error={error}
              testID="Contact-number-phone"
            />
            <Button title={t('chats.contactNumber.sendCode')} onPress={submitPhone} loading={sendOtp.isPending} phLabel="Contact-number-send-code" />
            <Button
              title={t('chats.contactNumber.remove')}
              variant="ghost"
              onPress={() => void onRemove()}
              loading={remove.isPending}
              phLabel="Contact-number-remove"
            />
          </>
        ) : (
          <>
            <Text style={s.title}>{t('chats.contactNumber.codeTitle')}</Text>
            <Text style={s.hint}>{t('chats.contactNumber.codeSent', { phone: sentTo })}</Text>
            <OtpCells
              length={OTP_LENGTH}
              value={code}
              onChangeText={(v) => { setCode(v); setError(undefined); }}
              error={error}
              accessibilityLabel={t('chats.contactNumber.code')}
              testID="Contact-number-code"
            />
            <Button title={t('chats.contactNumber.verify')} onPress={submitCode} loading={verify.isPending} phLabel="Contact-number-verify" />
            {devCode ? <Text style={s.dev}>{t('chats.contactNumber.devCode', { code: devCode })}</Text> : null}
            <Pressable
              style={s.link}
              onPress={() => send(sentTo)}
              disabled={wait > 0 || sendOtp.isPending}
              testID="Contact-number-resend"
              accessibilityRole="button"
            >
              <Text style={[s.linkText, wait > 0 && s.linkWait]}>
                {wait > 0 ? t('chats.contactNumber.resendIn', { seconds: wait }) : t('chats.contactNumber.resend')}
              </Text>
            </Pressable>
            <Pressable
              style={s.link}
              onPress={() => { setStage('phone'); setError(undefined); }}
              testID="Contact-number-change"
              accessibilityRole="button"
            >
              <Text style={s.linkText}>{t('chats.contactNumber.changeNumber')}</Text>
            </Pressable>
          </>
        )}
      </View>
    </ScreenWrapper>
  );
}
