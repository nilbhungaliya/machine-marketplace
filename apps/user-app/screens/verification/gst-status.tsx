import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useIsFocused } from '@react-navigation/native';
import Toast from 'react-native-toast-message';
import { GST_REVIEW_FILES_TOTAL_MAX, type GstDocumentType, type GstState, type GstStateView } from '@mpm/shared-types';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import Button from '@/components/Button';
import { FieldError } from '@/components/Field';
import Notice from '@/components/Notice';
import Skeleton from '@/components/Skeleton';
import StatusChip from '@/components/StatusChip';
import { businessKeys, useGstState } from '@/hooks/use-business';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { GST_EVENTS } from '@/lib/analytics-events';
import { errorCode, errorKey } from '@/lib/api-error';
import { formatDate } from '@/lib/format-date';
import { addReviewFiles, uploadDocuments, type LocalDocument } from '@/lib/gst-api';
import { GST_ERROR_KEYS, addFilesRoom, gstChip, gstScreen, newFilesProblem, startAgain } from '@/lib/gst-flow';
import { Clock, ShieldAlert, ShieldCheck, TriangleAlert, type LucideIcon } from '@/lib/icons';
import { queryClient } from '@/lib/queryClient';
import { radius, spacing, useTheme } from '@/lib/theme';
import { openTarget } from '@/navigation/go';
import type { RootStackScreenProps } from '@/navigation/types';
import DocumentPickerField, { DOCUMENT_PROBLEM_KEYS } from './document-picker';
import GstDetailsCard, { GstinLine } from './gst-details-card';
import GstLoadError from './gst-load-state';

type StatusState = Extract<GstState, 'under_review' | 'needs_more' | 'rejected' | 'verified' | 'revoked'>;
const STATUS_STATES: readonly GstState[] = ['under_review', 'needs_more', 'rejected', 'verified', 'revoked'];

const HERO: Record<StatusState, { icon: LucideIcon; tone: 'ok' | 'warn' | 'danger'; key: string }> = {
  under_review: { icon: Clock, tone: 'warn', key: 'underReview' },
  needs_more: { icon: TriangleAlert, tone: 'warn', key: 'needsMore' },
  rejected: { icon: TriangleAlert, tone: 'danger', key: 'rejected' },
  verified: { icon: ShieldCheck, tone: 'ok', key: 'verified' },
  revoked: { icon: ShieldAlert, tone: 'danger', key: 'revoked' },
};

/** Under review, needs more (officer message + add files), rejected / revoked (reason + start again), verified. */
export default function GstStatusScreen({ navigation }: RootStackScreenProps<'GstStatus'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const gst = useGstState();
  const view = gst.data;
  const focused = useIsFocused();

  // Nothing decided or under review any more (released, a new lookup…): open what the state is now.
  useEffect(() => {
    if (focused && view && !STATUS_STATES.includes(view.state)) openTarget(navigation, gstScreen(view), 'replace');
  }, [focused, view, navigation]);

  const s = useMemo(() => StyleSheet.create({
    body: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl },
    hero: { alignItems: 'center', gap: spacing.md },
    heroIcon: { width: 72, height: 72, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
    chip: { alignSelf: 'center' },
    title: { ...type('title'), color: colors.text, textAlign: 'center' },
    text: { ...type('body'), color: colors.textSecondary, textAlign: 'center' },
    skeleton: { height: 160, borderRadius: radius.xl },
  }), [colors, type]);

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
  const tint = { ok: [colors.ok, colors.okSoft], warn: [colors.warn, colors.warnSoft], danger: [colors.danger, colors.dangerSoft] }[hero.tone];
  const chip = gstChip(state);
  const verifiedAt = view.verifiedAt ? Date.parse(view.verifiedAt) : NaN;

  return (
    <ScreenWrapper keyboardAware scroll>
      <Header title={t('verification.title')} />
      <View style={s.body}>
        <View style={s.hero}>
          <View style={[s.heroIcon, { backgroundColor: tint[1] }]}>
            <hero.icon size={34} color={tint[0]} />
          </View>
          <StatusChip tone={chip.tone} label={t(chip.key)} style={s.chip} />
          <Text style={s.title}>{t(`verification.status.${hero.key}.title`)}</Text>
          <Text style={s.text}>
            {state === 'verified' && !Number.isNaN(verifiedAt)
              ? t('verification.status.verified.since', { date: formatDate(verifiedAt) })
              : t(`verification.status.${hero.key}.body`)}
          </Text>
          {view.gstin && state !== 'verified' ? <GstinLine gstin={view.gstin} token="body" center /> : null}
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
  const type = useType();
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
    box: { gap: spacing.md },
    section: { ...type('section'), color: colors.text, marginTop: spacing.sm },
    hint: { ...type('caption'), color: colors.textMuted },
  }), [colors, type]);

  return (
    <View style={s.box}>
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
      {docError ? <FieldError>{docError}</FieldError> : null}
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
