import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useIsFocused } from '@react-navigation/native';
import { useFormik } from 'formik';
import * as yup from 'yup';
import Toast from 'react-native-toast-message';
import { CONSTITUTIONS, type GstDocumentType } from '@mpm/shared-types';
import ScreenWrapper from '@/components/ScreenWrapper';
import Header from '@/components/Header';
import Input from '@/components/Input';
import Button from '@/components/Button';
import Chip from '@/components/Chip';
import Field, { FieldError } from '@/components/Field';
import FooterBar from '@/components/FooterBar';
import Notice from '@/components/Notice';
import { businessKeys, gstStateQuery, useBusiness, useGstState } from '@/hooks/use-business';
import { useType } from '@/hooks/use-type';
import { track } from '@/lib/analytics';
import { GST_EVENTS } from '@/lib/analytics-events';
import { errorCode, errorKey } from '@/lib/api-error';
import { toAsciiDigits } from '@/lib/digits';
import { submitReview, uploadDocuments, type LocalDocument } from '@/lib/gst-api';
import { DOCUMENTS_MAX, GST_ERROR_KEYS, blocksNewAttempt, documentProblem, gstScreen, prepareLookup } from '@/lib/gst-flow';
import { Square, SquareCheck, TriangleAlert } from '@/lib/icons';
import { PINCODE_REGEX } from '@/lib/onboarding-step';
import { queryClient } from '@/lib/queryClient';
import { radius, spacing, useTheme } from '@/lib/theme';
import { finishGstFlow, openTarget } from '@/navigation/go';
import type { RootStackScreenProps } from '@/navigation/types';
import DocumentPickerField, { DOCUMENT_PROBLEM_KEYS } from './document-picker';

interface ReviewValues {
  gstin: string;
  legalName: string;
  tradeName: string;
  line: string;
  city: string;
  state: string;
  pincode: string;
  constitution: string;
  declared: boolean;
}

/**
 * Path A, admin review (spec §5.3): GSTIN, the registration details when no lookup is attached (`checkId`), the
 * declaration and 2–5 documents. Without storage (`storageAvailable: false`, or `503 STORAGE_UNAVAILABLE` from a
 * presign) the picker is replaced by "Document upload isn't available yet" and submit is disabled.
 */
export default function GstReviewFormScreen({ navigation, route }: RootStackScreenProps<'GstReviewForm'>) {
  const checkId = route.params?.checkId;
  const withDetails = !checkId;
  const { t } = useTranslation();
  const { colors } = useTheme();
  const type = useType();
  const gst = useGstState();
  const business = useBusiness();
  const profile = business.data ?? null;
  const [files, setFiles] = useState<LocalDocument[]>([]);
  const [docError, setDocError] = useState<string>();
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const uploadsOff = storageBlocked || gst.data?.storageAvailable === false;
  const focused = useIsFocused();
  const leaving = useRef(false);

  // Fresh state says a review is already open or GST is verified: show that before anything is picked or uploaded.
  useEffect(() => {
    const state = gst.data?.state;
    if (!leaving.current && focused && state && gst.isFetchedAfterMount && blocksNewAttempt(state)) {
      leaving.current = true;
      openTarget(navigation, { screen: 'GstStatus' }, 'replace');
    }
  }, [focused, gst.data?.state, gst.isFetchedAfterMount, navigation]);

  useEffect(() => {
    track(GST_EVENTS.reviewOpened, { withLookup: !withDetails });
  }, [withDetails]);

  const schema = useMemo(() => {
    const required = t('onboarding.errors.required');
    const text = (max: number) => (withDetails ? yup.string().trim().max(max).required(required) : yup.string());
    return yup.object({
      gstin: yup.string().test('gstin', t('verification.start.gstinInvalid'), (v) => prepareLookup(v ?? '').ok),
      legalName: text(200),
      tradeName: yup.string().max(200),
      line: text(300),
      city: text(80),
      state: text(80),
      pincode: withDetails
        ? yup.string().test('pincode', t('onboarding.errors.pincode'), (v) => PINCODE_REGEX.test(toAsciiDigits(v ?? '').trim()))
        : yup.string(),
      constitution: withDetails ? yup.string().required(t('verification.review.constitutionRequired')) : yup.string(),
      declared: yup.boolean().oneOf([true], t('verification.review.declarationRequired')),
    });
  }, [t, withDetails]);

  const form = useFormik<ReviewValues>({
    initialValues: {
      gstin: route.params?.gstin ?? '',
      legalName: profile?.legalName ?? '',
      tradeName: profile?.tradeName ?? '',
      line: profile?.location.addressLine ?? '',
      city: profile?.location.city ?? '',
      state: profile?.location.state ?? '',
      pincode: profile?.location.pincode ?? '',
      constitution: '',
      declared: false,
    },
    enableReinitialize: true,
    validationSchema: schema,
    onSubmit: async (values) => {
      const problem = documentProblem(files);
      if (problem) {
        setDocError(t(DOCUMENT_PROBLEM_KEYS[problem]));
        return;
      }
      setDocError(undefined);
      const typed = files.filter((f): f is LocalDocument & { type: GstDocumentType } => f.type !== null);
      try {
        setProgress({ done: 0, total: typed.length });
        const uploaded = await uploadDocuments(typed, {}, (done, total) => setProgress({ done, total }));
        const next = await submitReview({
          gstin: (prepareLookup(values.gstin) as { gstin: string }).gstin,
          ...(checkId
            ? { checkId }
            : {
                entered: {
                  legalName: values.legalName.trim(),
                  tradeName: values.tradeName.trim() || null,
                  address: {
                    line: values.line.trim(),
                    city: values.city.trim(),
                    state: values.state.trim(),
                    pincode: toAsciiDigits(values.pincode).trim(),
                  },
                  constitution: values.constitution,
                },
              }),
          uploadId: uploaded.uploadId,
          files: uploaded.files,
        });
        track(GST_EVENTS.reviewSubmitted, { withLookup: !!checkId, files: typed.length });
        leaving.current = true;
        queryClient.setQueryData(businessKeys.gst, next);
        void queryClient.invalidateQueries({ queryKey: businessKeys.me, exact: true });
        finishGstFlow(navigation, { screen: 'GstStatus' });
      } catch (err) {
        const code = errorCode(err);
        track(GST_EVENTS.reviewSubmitFailed, { reason: code });
        if (code === 'STORAGE_UNAVAILABLE') {
          setStorageBlocked(true);
          return;
        }
        Toast.show({ type: 'error', text1: t(errorKey(err, GST_ERROR_KEYS)) });
        if (code === 'GST_REVIEW_OPEN' || code === 'GST_ALREADY_VERIFIED') {
          leaving.current = true;
          try {
            finishGstFlow(navigation, gstScreen(await queryClient.fetchQuery(gstStateQuery)));
          } catch {
            // Stay; the toast said what went wrong.
            leaving.current = false;
          }
        }
      } finally {
        setProgress(null);
      }
    },
  });

  const s = useMemo(() => StyleSheet.create({
    body: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xl },
    title: { ...type('title'), color: colors.text },
    subtitle: { ...type('lead'), color: colors.textSecondary, marginTop: spacing.sm },
    section: { ...type('section'), color: colors.text, marginTop: spacing.xxl, marginBottom: spacing.xs },
    hint: { ...type('caption'), color: colors.textMuted, marginBottom: spacing.md },
    // The same top spacing as an Input.
    group: { marginTop: spacing.md },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    row: { flexDirection: 'row', gap: spacing.md },
    half: { flex: 1 },
    // A choice card (v2 `.choice`), as on the declaration screen.
    declare: {
      flexDirection: 'row', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1.5, marginTop: spacing.xxl,
      backgroundColor: form.values.declared ? colors.primaryWash : colors.surface,
      borderColor: form.values.declared ? colors.primary : colors.hairline,
    },
    declareText: { flex: 1, ...type('bodyStrong'), color: colors.text },
    progress: { ...type('caption'), color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.sm, paddingHorizontal: spacing.lg },
  }), [colors, type, form.values.declared]);

  const err = (k: keyof ReviewValues) => (form.touched[k] || form.submitCount > 0 ? form.errors[k] : undefined);
  const field = (k: 'legalName' | 'tradeName' | 'line' | 'city' | 'state' | 'pincode') => ({
    value: form.values[k],
    onChangeText: form.handleChange(k),
    onBlur: form.handleBlur(k),
    error: err(k),
  });

  return (
    <ScreenWrapper keyboardAware scroll>
      <Header title={t('verification.title')} />
      <View style={s.body}>
        <Text style={s.title}>{t('verification.review.title')}</Text>
        <Text style={s.subtitle}>{t('verification.review.subtitle')}</Text>

        <Input
          label={t('verification.start.gstin')}
          placeholder={t('verification.start.gstinPlaceholder')}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={20}
          editable={!checkId}
          value={form.values.gstin}
          onChangeText={form.handleChange('gstin')}
          onBlur={form.handleBlur('gstin')}
          error={err('gstin')}
          mono
          testID="Review-gstin"
        />

        {withDetails ? (
          <>
            <Text style={s.section}>{t('verification.review.detailsTitle')}</Text>
            <Text style={s.hint}>{t('verification.review.detailsHint')}</Text>
            <Input label={t('verification.review.legalName')} {...field('legalName')} testID="Review-legal-name" />
            <Input label={t('verification.review.tradeName')} {...field('tradeName')} testID="Review-trade-name" />
            <Input label={t('verification.review.addressLine')} {...field('line')} testID="Review-address-line" />
            <View style={s.row}>
              <View style={s.half}><Input label={t('onboarding.location.city')} {...field('city')} testID="Review-city" /></View>
              <View style={s.half}><Input label={t('onboarding.location.state')} {...field('state')} testID="Review-state" /></View>
            </View>
            <Input
              label={t('onboarding.location.pincode')}
              keyboardType="number-pad"
              maxLength={6}
              {...field('pincode')}
              testID="Review-pincode"
            />
            <Field label={t('verification.review.constitution')} error={err('constitution')} style={s.group}>
            <View style={s.chips}>
              {CONSTITUTIONS.map((c) => (
                <Chip
                  key={c}
                  label={t(`verification.constitution.${c}`)}
                  role="radio"
                  selected={form.values.constitution === c}
                  onPress={() => void form.setFieldValue('constitution', c)}
                  testID={`Constitution-${c}`}
                />
              ))}
            </View>
            </Field>
          </>
        ) : null}

        <Text style={s.section}>{t('verification.documents.title')}</Text>
        <Text style={s.hint}>{t('verification.documents.rule')}</Text>
        {uploadsOff ? (
          <Notice tone="warning" icon={TriangleAlert} text={t('verification.documents.unavailable')} />
        ) : (
          <DocumentPickerField
            files={files}
            onChange={(next) => {
              setFiles(next);
              setDocError(undefined);
            }}
            max={DOCUMENTS_MAX}
            disabled={form.isSubmitting}
          />
        )}
        {docError ? <FieldError>{docError}</FieldError> : null}

        <Pressable
          style={s.declare}
          onPress={() => void form.setFieldValue('declared', !form.values.declared)}
          testID="Review-declaration"
          accessibilityRole="checkbox"
          accessibilityState={{ checked: form.values.declared }}
        >
          {form.values.declared ? <SquareCheck size={22} color={colors.primary} /> : <Square size={22} color={colors.textSecondary} />}
          <Text style={s.declareText}>{t('verification.declare.text')}</Text>
        </Pressable>
        {err('declared') ? <FieldError>{err('declared') as string}</FieldError> : null}
      </View>
      {progress ? (
        <Text style={s.progress}>{t('verification.documents.uploading', { done: Math.min(progress.done + 1, progress.total), total: progress.total })}</Text>
      ) : null}
      <FooterBar>
        <Button
          title={t('verification.review.submit')}
          phLabel="Gst-submit-review"
          size="md"
          loading={form.isSubmitting}
          disabled={uploadsOff}
          onPress={() => form.handleSubmit()}
        />
      </FooterBar>
    </ScreenWrapper>
  );
}
