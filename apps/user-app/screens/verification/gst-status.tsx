import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useIsFocused } from '@react-navigation/native';
import Toast from 'react-native-toast-message';
import { GST_REVIEW_FILES_TOTAL_MAX, type GstDocumentType, type GstState, type GstStateView } from '@mpm/shared-types';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import Button from '@/components/Button';
import Notice from '@/components/Notice';
import Skeleton from '@/components/Skeleton';
import { businessKeys, useGstState } from '@/hooks/use-business';
import { track } from '@/lib/analytics';
import { GST_EVENTS } from '@/lib/analytics-events';
import { errorCode, errorKey } from '@/lib/api-error';
import { formatDate } from '@/lib/format-date';
import { addReviewFiles, uploadDocuments, type LocalDocument } from '@/lib/gst-api';
import { GST_ERROR_KEYS, addFilesRoom, gstScreen, newFilesProblem, startAgain } from '@/lib/gst-flow';
import { Clock, ShieldAlert, ShieldCheck, TriangleAlert, type LucideIcon } from '@/lib/icons';
import { queryClient } from '@/lib/queryClient';
import { fonts, radius, spacing, useTheme } from '@/lib/theme';
import { openTarget } from '@/navigation/go';
import type { RootStackScreenProps } from '@/navigation/types';
import DocumentPickerField, { DOCUMENT_PROBLEM_KEYS } from './document-picker';
import GstDetailsCard from './gst-details-card';
import GstLoadError from './gst-load-state';

type StatusState = Extract<GstState, 'under_review' | 'needs_more' | 'rejected' | 'verified' | 'revoked'>;
const STATUS_STATES: readonly GstState[] = ['under_review', 'needs_more', 'rejected', 'verified', 'revoked'];

const HERO: Record<StatusState, { icon: LucideIcon; tone: 'green' | 'orange' | 'red'; key: string }> = {
  under_review: { icon: Clock, tone: 'orange', key: 'underReview' },
  needs_more: { icon: TriangleAlert, tone: 'orange', key: 'needsMore' },
  rejected: { icon: TriangleAlert, tone: 'red', key: 'rejected' },
  verified: { icon: ShieldCheck, tone: 'green', key: 'verified' },
  revoked: { icon: ShieldAlert, tone: 'red', key: 'revoked' },
};

/** Under review, needs more (officer message + add files), rejected / revoked (reason + start again), verified. */
export default function GstStatusScreen({ navigation }: RootStackScreenProps<'GstStatus'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const gst = useGstState();
  const view = gst.data;
  const focused = useIsFocused();

  // Nothing decided or under review any more (released, a new lookup…): open what the state is now.
  useEffect(() => {
    if (focused && view && !STATUS_STATES.includes(view.state)) openTarget(navigation, gstScreen(view), 'replace');
  }, [focused, view, navigation]);

  const s = useMemo(() => StyleSheet.create({
    body: { flex: 1, paddingHorizontal: spacing.xxl, paddingTop: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl },
    hero: { alignItems: 'center', gap: spacing.md },
    heroIcon: { width: 72, height: 72, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
    title: { fontFamily: fonts.display, fontSize: 24, color: colors.text, textAlign: 'center' },
    text: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.textSecondary, textAlign: 'center' },
    gstin: { fontFamily: fonts.semiBold, fontSize: 14, letterSpacing: 1, color: colors.text, textAlign: 'center' },
    skeleton: { height: 160, borderRadius: radius.lg },
  }), [colors]);

  if (!view && gst.isError) {
    return (
      <ScreenWrapper>
        <Header title={t('verification.title')} />
        <GstLoadError onRetry={() => void gst.refetch()} />
      </ScreenWrapper>
    );
  }

  if (!view || !STATUS_STATES.includes(view.state)) {
    return (
      <ScreenWrapper>
        <Header title={t('verification.title')} />
        <View style={s.body}><Skeleton style={s.skeleton} /></View>
      </ScreenWrapper>
    );
  }

  const state = view.state as StatusState;
  const hero = HERO[state];
  const tint = { green: [colors.green, colors.greenMuted], orange: [colors.orange, colors.orangeMuted], red: [colors.red, colors.redMuted] }[hero.tone];
  const verifiedAt = view.verifiedAt ? Date.parse(view.verifiedAt) : NaN;

  return (
    <ScreenWrapper keyboardAware scroll>
      <Header title={t('verification.title')} />
      <View style={s.body}>
        <View style={s.hero}>
          <View style={[s.heroIcon, { backgroundColor: tint[1] }]}>
            <hero.icon size={34} color={tint[0]} />
          </View>
          <Text style={s.title}>{t(`verification.status.${hero.key}.title`)}</Text>
          <Text style={s.text}>
            {state === 'verified' && !Number.isNaN(verifiedAt)
              ? t('verification.status.verified.since', { date: formatDate(verifiedAt) })
              : t(`verification.status.${hero.key}.body`)}
          </Text>
          {view.gstin && state !== 'verified' ? <Text style={s.gstin}>{t('verification.details.gstin', { gstin: view.gstin })}</Text> : null}
        </View>

        {state === 'verified' ? <GstDetailsCard details={view.details} gstin={view.gstin} /> : null}

        {(state === 'rejected' || state === 'revoked') && view.reason ? (
          <Notice tone="danger" icon={TriangleAlert} title={t('verification.status.reason')} text={view.reason} />
        ) : null}

        {state === 'needs_more' ? <AddFiles view={view} /> : null}

        {state === 'rejected' || state === 'revoked' ? (
          <Button
            title={state === 'rejected' ? t('verification.status.rejected.startAgain') : t('verification.status.revoked.verifyAgain')}
            phLabel={state === 'rejected' ? 'Gst-start-again' : 'Gst-verify-again'}
            onPress={() => openTarget(navigation, startAgain(view), 'replace')}
          />
        ) : null}
      </View>
    </ScreenWrapper>
  );
}

/**
 * Needs more (spec §5.3, amended): the officer's message, then 1–5 files for the same review (at most 10 on it in all,
 * `documentCount` from the state view), which sends it back to waiting.
 */
function AddFiles({ view }: { view: GstStateView }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [files, setFiles] = useState<LocalDocument[]>([]);
  const [docError, setDocError] = useState<string>();
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const uploadsOff = storageBlocked || !view.storageAvailable;
  const room = addFilesRoom(view.documentCount);
  const total = { total: GST_REVIEW_FILES_TOTAL_MAX };

  const send = async () => {
    const problem = newFilesProblem(files, view.documentCount ?? 0);
    if (problem) {
      // A count problem here is the add-files rule (1–5), not a submission's 2–5.
      setDocError(t(problem === 'count' ? 'verification.documents.addRule' : DOCUMENT_PROBLEM_KEYS[problem], total));
      return;
    }
    if (!view.proofId) return;
    setDocError(undefined);
    setBusy(true);
    const typed = files.filter((f): f is LocalDocument & { type: GstDocumentType } => f.type !== null);
    try {
      const uploaded = await uploadDocuments(typed, { proofId: view.proofId });
      const next = await addReviewFiles(view.proofId, uploaded.files);
      track(GST_EVENTS.filesAdded, { files: typed.length });
      queryClient.setQueryData(businessKeys.gst, next);
      setFiles([]);
      Toast.show({ type: 'success', text1: t('verification.status.needsMore.sent') });
    } catch (err) {
      const code = errorCode(err);
      track(GST_EVENTS.filesAddFailed, { reason: code });
      if (code === 'STORAGE_UNAVAILABLE') setStorageBlocked(true);
      else if (code === 'DOCUMENTS_REQUIRED') setDocError(t('verification.documents.addRule', total));
      else Toast.show({ type: 'error', text1: t(errorKey(err, GST_ERROR_KEYS)) });
      if (code === 'GST_REVIEW_STATE') void queryClient.invalidateQueries({ queryKey: businessKeys.gst });
    } finally {
      setBusy(false);
    }
  };

  const s = useMemo(() => StyleSheet.create({
    section: { fontFamily: fonts.semiBold, fontSize: 16, color: colors.text, marginTop: spacing.sm },
    hint: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.textMuted },
    error: { fontFamily: fonts.regular, fontSize: 12, color: colors.red },
  }), [colors]);

  return (
    <View style={{ gap: spacing.md }}>
      {view.officerMessage ? (
        <Notice tone="warning" icon={TriangleAlert} title={t('verification.status.needsMore.message')} text={view.officerMessage} />
      ) : null}
      <Text style={s.section}>{t('verification.status.needsMore.addFiles')}</Text>
      <Text style={s.hint}>{t('verification.documents.addRule', total)}</Text>
      {uploadsOff ? (
        <Notice tone="warning" icon={TriangleAlert} text={t('verification.documents.unavailable')} />
      ) : room === 0 ? (
        <Notice tone="info" text={t('verification.status.needsMore.full', total)} />
      ) : (
        <DocumentPickerField
          files={files}
          onChange={(next) => {
            setFiles(next);
            setDocError(undefined);
          }}
          max={room}
          disabled={busy}
          suggestCertificate={false}
        />
      )}
      {docError ? <Text style={s.error}>{docError}</Text> : null}
      <Button
        title={t('verification.status.needsMore.send')}
        phLabel="Gst-send-more-files"
        loading={busy}
        disabled={uploadsOff || room === 0 || files.length === 0}
        onPress={() => void send()}
      />
    </View>
  );
}
