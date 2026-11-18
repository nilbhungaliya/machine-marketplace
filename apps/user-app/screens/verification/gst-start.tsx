import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useIsFocused } from '@react-navigation/native';
import Toast from 'react-native-toast-message';
import type { GstStateView } from '@mpm/shared-types';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import Input from '@/components/Input';
import Button from '@/components/Button';
import Notice from '@/components/Notice';
import Skeleton from '@/components/Skeleton';
import { businessKeys, useGstState } from '@/hooks/use-business';
import { track } from '@/lib/analytics';
import { GST_EVENTS } from '@/lib/analytics-events';
import { errorCode, errorKey } from '@/lib/api-error';
import { lookupGstin } from '@/lib/gst-api';
import { GST_ERROR_KEYS, blocksNewAttempt, gstScreen, prepareLookup, startNotice, type StartNotice } from '@/lib/gst-flow';
import { ShieldCheck, TriangleAlert } from '@/lib/icons';
import { queryClient } from '@/lib/queryClient';
import { fonts, radius, spacing, useTheme } from '@/lib/theme';
import { openTarget } from '@/navigation/go';
import type { RootStackScreenProps } from '@/navigation/types';

const NOTICE_KEY: Record<StartNotice, string> = {
  expired: 'verification.start.expired',
  held: 'verification.start.held',
  notFound: 'verification.start.notFound',
  statusRefused: 'verification.start.statusRefused',
  providerUnavailable: 'verification.start.providerUnavailable',
};

/** Enter GSTIN (spec §5.2 steps 1–3): format and checksum here first, then the lookup; its outcome shows below. */
export default function GstStartScreen({ navigation }: RootStackScreenProps<'GstStart'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const gst = useGstState();
  const view = gst.data;
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const typed = useRef(false);
  const focused = useIsFocused();

  // Fresh state says a review is open or GST is verified (another device, an officer…): show that, not GSTIN entry.
  useEffect(() => {
    if (focused && view && gst.isFetchedAfterMount && blocksNewAttempt(view.state)) {
      openTarget(navigation, { screen: 'GstStatus' }, 'replace');
    }
  }, [focused, view, gst.isFetchedAfterMount, navigation]);

  // An earlier lookup's GSTIN (expired, not found…) is put back in the field.
  useEffect(() => {
    if (!typed.current && view?.state === 'none' && view.gstin) setText(view.gstin);
  }, [view]);

  const showResult = (next: GstStateView) => {
    queryClient.setQueryData(businessKeys.gst, next);
    const target = gstScreen(next);
    // Replace, so Back from the next step goes where the flow was opened from (see navigation/go.ts).
    if (target.screen !== 'GstStart') openTarget(navigation, target, 'replace');
  };

  const lookup = async (input: string) => {
    const prepared = prepareLookup(input);
    if (!prepared.ok) {
      setError(t(prepared.error === 'empty' ? 'verification.start.gstinEmpty' : 'verification.start.gstinInvalid'));
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      const next = await lookupGstin(prepared.gstin);
      track(GST_EVENTS.lookupCompleted, { result: next.state === 'none' ? (startNotice(next) ?? 'none') : next.state });
      showResult(next);
    } catch (err) {
      const code = errorCode(err);
      track(GST_EVENTS.lookupFailed, { reason: code });
      if (code === 'GST_REVIEW_ONLY' || code === 'GST_ALREADY_VERIFIED' || code === 'GST_REVIEW_OPEN') {
        // The state moved on (revoked, verified, under review): open what it is now.
        const fresh = await gst.refetch();
        if (fresh.data) {
          Toast.show({ type: 'info', text1: t(errorKey(err, GST_ERROR_KEYS)) });
          openTarget(navigation, gstScreen(fresh.data), 'replace');
          return;
        }
      }
      if (code === 'GSTIN_INVALID') setError(t('verification.start.gstinInvalid'));
      else Toast.show({ type: 'error', text1: t(errorKey(err, GST_ERROR_KEYS)) });
    } finally {
      setBusy(false);
    }
  };

  const s = useMemo(() => StyleSheet.create({
    body: { flex: 1, paddingHorizontal: spacing.xxl, paddingTop: spacing.sm, gap: spacing.lg },
    gstin: { fontFamily: fonts.semiBold, letterSpacing: 1.5, fontSize: 16 },
    hint: { fontFamily: fonts.regular, fontSize: 13, color: colors.textMuted },
    actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
    skeleton: { height: 52, borderRadius: radius.lg },
    footer: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.xxl, paddingTop: spacing.sm },
  }), [colors]);

  const notice = view ? startNotice(view) : null;
  const reviewOnly = view?.instantAllowed === false;

  return (
    <ScreenWrapper keyboardAware scroll>
      <Header title={t('verification.title')} />
      <View style={s.body}>
        <Notice icon={ShieldCheck} text={t('verification.intro.callout')} />
        {gst.isLoading ? (
          <Skeleton style={s.skeleton} />
        ) : reviewOnly ? (
          <Notice tone="warning" icon={TriangleAlert} text={t('verification.start.reviewOnly')}>
            <Button
              title={t('verification.start.sendForReview')}
              phLabel="Gst-open-review-form"
              variant="outline"
              style={{ marginTop: spacing.sm }}
              onPress={() => navigation.replace('GstReviewForm', view?.gstin ? { gstin: view.gstin } : undefined)}
            />
          </Notice>
        ) : (
          <>
            <View>
              <Input
                label={t('verification.start.gstin')}
                placeholder={t('verification.start.gstinPlaceholder')}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={20}
                value={text}
                onChangeText={(v) => {
                  typed.current = true;
                  setText(v);
                }}
                error={error}
                style={s.gstin}
                onSubmitEditing={() => void lookup(text)}
                testID="Gstin"
              />
              {!error ? <Text style={s.hint}>{t('verification.start.gstinHint')}</Text> : null}
            </View>
            {notice ? (
              <Notice
                tone={notice === 'expired' || notice === 'providerUnavailable' ? 'warning' : 'danger'}
                icon={TriangleAlert}
                text={t(NOTICE_KEY[notice], {
                  status: view?.statusRefused ? t(`verification.gstStatus.${view.statusRefused}`) : '',
                })}
              >
                {notice === 'providerUnavailable' ? (
                  <View style={s.actions}>
                    <Button
                      title={t('common.retry')}
                      phLabel="Gst-lookup-retry"
                      variant="outline"
                      style={{ flex: 1, width: undefined }}
                      loading={busy}
                      onPress={() => void lookup(view?.gstin ?? text)}
                    />
                    <Button
                      title={t('verification.start.sendForReview')}
                      phLabel="Gst-send-for-review"
                      variant="outline"
                      style={{ flex: 1, width: undefined }}
                      onPress={() => navigation.replace('GstReviewForm', view?.gstin ? { gstin: view.gstin } : undefined)}
                    />
                  </View>
                ) : null}
              </Notice>
            ) : null}
          </>
        )}
      </View>
      {!reviewOnly && !gst.isLoading ? (
        <View style={s.footer}>
          <Button title={t('verification.start.lookUp')} phLabel="Gst-look-up" loading={busy} onPress={() => void lookup(text)} />
        </View>
      ) : null}
    </ScreenWrapper>
  );
}
