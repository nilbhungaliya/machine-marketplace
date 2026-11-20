import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import type { PartRequestBuyerView } from '@mpm/shared-types';
import Button from '@/components/Button';
import { useConfirm } from '@/components/ConfirmSheet';
import EmptyState from '@/components/EmptyState';
import FooterBar from '@/components/FooterBar';
import Header from '@/components/Header';
import Notice from '@/components/Notice';
import ScreenWrapper from '@/components/ScreenWrapper';
import Skeleton from '@/components/Skeleton';
import Steps from '@/components/Steps';
import RequestPreview from '@/components/part-requests/form/RequestPreview';
import StepDetails from '@/components/part-requests/form/StepDetails';
import StepNeed from '@/components/part-requests/form/StepNeed';
import { useBusiness } from '@/hooks/use-business';
import { useCategoryTree, useMasterData, useTemplate } from '@/hooks/use-listing';
import { useCreatePartRequest, usePartRequestPhotos, useUpdatePartRequest } from '@/hooks/use-my-part-requests';
import { useIdempotencyKey } from '@/hooks/use-offers';
import { usePartRequestOptions } from '@/hooks/use-part-request';
import { track } from '@/lib/analytics';
import { REQUEST_EVENTS } from '@/lib/analytics-events';
import { errorCode } from '@/lib/api-error';
import { f8ErrorMessage } from '@/lib/f8-errors';
import { ClipboardList, TriangleAlert } from '@/lib/icons';
import { istDateKey } from '@/lib/ist-date';
import { keepIdempotencyKey, newIdempotencyKey } from '@/lib/offers-api';
import {
  copyOf, fromBuyerView, patchChanges, requestFormSchema, STEP_ONE_FIELDS, toPartRequestInput, toPartRequestPatch,
  validateRequestForm, valuesFromPrefill, type RequestFormErrors, type RequestFormValues,
} from '@/lib/part-request-form';
import { fetchPartRequest } from '@/lib/part-requests-api';
import { qk } from '@/lib/query-keys';
import { nodePath } from '@/lib/sell-category';
import { buildSpecSchema, specInitialValues, toSpecs, type SpecFormValues } from '@/lib/spec-form';
import { radius, spacing } from '@/lib/theme';
import type { RootStackScreenProps } from '@/navigation/types';

type Step = 'need' | 'details' | 'preview';

/** Two forms are the same apart from the validity (the default arrives with the settings). */
const sameForm = (a: RequestFormValues, b: RequestFormValues) =>
  JSON.stringify({ ...a, validityDays: 0 }) === JSON.stringify({ ...b, validityDays: 0 });
const STEPS: Step[] = ['need', 'details', 'preview'];

/** First Yup message per spec field. */
function specErrorsOf(schema: ReturnType<typeof buildSpecSchema>, values: SpecFormValues): Record<string, string> {
  try {
    schema.validateSync(values, { abortEarly: false });
    return {};
  } catch (err) {
    const out: Record<string, string> = {};
    for (const e of (err as { inner?: { path?: string; message: string }[] }).inner ?? []) {
      if (e.path && !out[e.path]) out[e.path] = e.message;
    }
    return out;
  }
}

/**
 * Post a requirement (F8 spec §13.1; mockups "Post a requirement", "Requirement details"; textile `post-need.tsx`):
 * step 1 what is needed, step 2 the details, then a preview as sellers see it → `POST /part-requests` with an
 * `Idempotency-Key` (one per body, reused when the same body is retried) → Requirement posted. Edit mode (`editId`)
 * loads the buyer view and sends only what changed with its `version`; `409 PART_REQUEST_STALE` offers a reload.
 * `prefill` (No results, Other side, a guest's pending action) and `copyFromId` (Post again) only fill the form: it
 * never posts by itself. At the open-requests limit the preview shows a notice instead of Post.
 */
export default function PostRequirementScreen({ navigation, route }: RootStackScreenProps<'PostRequirement'>) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { prefill, editId, copyFromId } = route.params ?? {};
  const editing = !!editId;

  const options = usePartRequestOptions();
  const business = useBusiness();
  const master = useMasterData();
  const tree = useCategoryTree();
  const sourceId = editId ?? copyFromId ?? '';
  const editView = useQuery({ queryKey: qk.partRequest(sourceId), queryFn: () => fetchPartRequest(sourceId), enabled: !!sourceId, retry: false });
  const loadingSource = !!(editId || copyFromId) && editView.isLoading;
  const sourceView = editView.data?.role === 'buyer' ? editView.data : null;

  const [values, setValues] = useState<RequestFormValues>(() => valuesFromPrefill(prefill ?? null));
  // What the form opened with (a prefill, a copy): leaving unchanged asks nothing.
  const [start, setStart] = useState<RequestFormValues>(values);
  const [baseline, setBaseline] = useState<RequestFormValues | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [step, setStep] = useState<Step>('need');
  const [tried, setTried] = useState<Record<Step, boolean>>({ need: false, details: false, preview: false });
  const [specValues, setSpecValues] = useState<SpecFormValues>({});
  const loaded = useRef(false);
  const done = useRef(false);

  const loadView = useCallback((view: PartRequestBuyerView) => {
    const v = fromBuyerView(view);
    setValues(v);
    setBaseline(v);
    setVersion(view.version);
  }, []);

  // Edit: the stored request; Post again: a copy of its identity. Once, when it arrives.
  useEffect(() => {
    if (loaded.current || !sourceView) return;
    loaded.current = true;
    if (editing) loadView(sourceView);
    else {
      const copied = valuesFromPrefill(copyOf(sourceView), options.data?.defaultValidityDays);
      setValues(copied);
      setStart(copied);
    }
  }, [sourceView]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new request takes the default validity once the settings arrive.
  useEffect(() => {
    const o = options.data;
    if (!o || editing) return;
    setValues((v) => (o.validityDays.includes(v.validityDays) ? v : { ...v, validityDays: o.defaultValidityDays }));
  }, [options.data, editing]);

  useEffect(() => {
    if (editing) return;
    track(REQUEST_EVENTS.requestPostStarted, { source: prefill?.source ?? (copyFromId ? 'copy' : 'post_tab') });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const nodes = tree.data ?? [];
  const path = nodePath(nodes, values.categoryId);
  const node = path.at(-1) ?? null;
  const units = master.data?.units ?? [];
  const conditions = master.data?.conditions ?? [];
  const unit = units.find((u) => u.id === values.unitId) ?? null;

  // Specifications: only on the kind's template level; every field may be "any" (required marks dropped).
  const specLevel = values.kind === 'part' ? 'part_group' : 'machine_type';
  const template = useTemplate(node?.level === specLevel ? node.id : null, values.kind);
  const specFields = useMemo(
    () => (node?.level === specLevel ? (template.data?.fields ?? []).map((f) => ({ ...f, required: false })) : []),
    [template.data, node?.level, specLevel],
  );
  useEffect(() => {
    setSpecValues(specInitialValues(specFields, values.specs));
  }, [specFields]); // eslint-disable-line react-hooks/exhaustive-deps
  const specSchema = useMemo(() => buildSpecSchema(specFields, t, { enforceRequired: false }), [specFields, t]);

  const schema = useMemo(
    () => requestFormSchema(t, { hasSides: values.kind === 'part' && !!node?.effectiveHasSides, unitDecimals: unit?.decimals ?? null, today: istDateKey() }),
    [t, values.kind, node?.effectiveHasSides, unit?.decimals],
  );
  const allErrors = validateRequestForm(schema, values);
  const specErrors = specErrorsOf(specSchema, specValues);
  const stepErrors = (s: Step): RequestFormErrors => {
    const entries = Object.entries(allErrors).filter(([k]) => (STEP_ONE_FIELDS as readonly string[]).includes(k) === (s === 'need'));
    return Object.fromEntries(entries);
  };
  const shownErrors: RequestFormErrors = tried[step] ? stepErrors(step) : {};

  const photos = usePartRequestPhotos(editing ? editId! : null, editing && values.photos.some((p) => p.uri === null));
  const photoUrls = useMemo(() => {
    const out: Record<string, string> = {};
    if (!sourceView) return out;
    sourceView.photoKeys.forEach((k, i) => {
      const url = photos.data?.photos[i]?.url;
      if (url) out[k] = url;
    });
    return out;
  }, [sourceView, photos.data]);

  const change = (patch: Partial<RequestFormValues>) => setValues((v) => ({ ...v, ...patch }));
  const changeSpec = (key: string, value: string | string[]) => {
    const next = { ...specValues, [key]: value };
    setSpecValues(next);
    change({ specs: toSpecs(next, specFields) });
  };

  const dirty = editing
    ? !!baseline && sameForm(values, baseline) === false
    : !sameForm(values, start);

  // Back steps back; leaving with typed answers asks first.
  useEffect(() => navigation.addListener('beforeRemove', (e) => {
    if (done.current) return;
    if (step !== 'need') {
      e.preventDefault();
      setStep(STEPS[STEPS.indexOf(step) - 1]!);
      return;
    }
    if (!dirty) return;
    e.preventDefault();
    void confirm({
      title: t('requirements.form.leaveTitle'),
      message: t('requirements.form.leaveBody'),
      confirmLabel: t('requirements.form.leave'),
      cancelLabel: t('requirements.form.stay'),
      destructive: true,
    }).then((ok) => {
      if (ok) {
        done.current = true;
        navigation.dispatch(e.data.action);
      }
    });
  }), [navigation, step, dirty, confirm, t]);

  // ─── Submit ───
  const create = useCreatePartRequest();
  const update = useUpdatePartRequest(editId ?? '');
  const editKey = useIdempotencyKey();
  const keyFor = useRef<{ body: string; key: string } | null>(null);
  const busy = create.isPending || update.isPending;

  const next = () => {
    const errs = stepErrors(step);
    const specBad = step === 'details' && Object.keys(specErrors).length > 0;
    setTried((x) => ({ ...x, [step]: true }));
    if (Object.keys(errs).length > 0 || specBad) return;
    setStep(STEPS[STEPS.indexOf(step) + 1]!);
  };

  const post = () => {
    if (Object.keys(allErrors).length > 0) {
      setStep(Object.keys(stepErrors('need')).length > 0 ? 'need' : 'details');
      setTried({ need: true, details: true, preview: false });
      return;
    }
    const input = toPartRequestInput(values);
    const body = JSON.stringify(input);
    if (keyFor.current?.body !== body) keyFor.current = { body, key: newIdempotencyKey() };
    create.mutate({ input, key: keyFor.current.key }, {
      onSuccess: (view) => {
        done.current = true;
        track(REQUEST_EVENTS.requestPosted, {
          kind: input.kind,
          hasPartNumber: !!input.partNumber,
          hasFit: (input.fits?.length ?? 0) > 0,
          photos: input.photoKeys?.length ?? 0,
          reach: input.reach,
          audience: input.audience,
          validityDays: input.validityDays,
          urgent: !!input.urgent,
        });
        navigation.replace('RequirementPosted', { partRequestId: view.id, backfill: view.counts.matches });
      },
      onError: (err) => {
        if (!keepIdempotencyKey(err)) keyFor.current = null;
        track(REQUEST_EVENTS.requestPostFailed, { reason: errorCode(err) || 'network' });
        Toast.show({ type: 'error', text1: f8ErrorMessage(err) });
      },
    });
  };

  const save = () => {
    if (!baseline || version === null) return;
    if (Object.keys(allErrors).length > 0) {
      setStep(Object.keys(stepErrors('need')).length > 0 ? 'need' : 'details');
      setTried({ need: true, details: true, preview: false });
      return;
    }
    const patch = toPartRequestPatch(values, baseline, version);
    if (!patchChanges(patch)) {
      done.current = true;
      navigation.goBack();
      return;
    }
    update.mutate({ patch, key: editKey.take() }, {
      onSuccess: () => {
        editKey.settle();
        done.current = true;
        track(REQUEST_EVENTS.requestEdited, {});
        Toast.show({ type: 'success', text1: t('requirements.toast.saved') });
        navigation.goBack();
      },
      onError: (err) => {
        editKey.settle(err);
        if (errorCode(err) === 'PART_REQUEST_STALE') {
          void confirm({
            title: t('requirements.form.staleTitle'),
            message: t('requirements.form.staleBody'),
            confirmLabel: t('requirements.form.reload'),
            hideCancel: true,
          }).then(async () => {
            const fresh = await editView.refetch();
            if (fresh.data?.role === 'buyer') {
              loadView(fresh.data);
              setStep('need');
            }
          });
          return;
        }
        Toast.show({ type: 'error', text1: f8ErrorMessage(err) });
      },
    });
  };

  const s = useMemo(() => StyleSheet.create({
    body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.lg },
    steps: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
    skeleton: { height: 52, borderRadius: radius.md },
  }), []);

  const title = editing
    ? t('requirements.form.titleEdit')
    : step === 'need' ? t('requirements.form.titleNew') : step === 'details' ? t('requirements.form.titleDetails') : t('requirements.form.titlePreview');

  if (loadingSource || (sourceView && !loaded.current)) {
    return (
      <ScreenWrapper>
        <Header title={title} />
        <View style={s.body}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} style={s.skeleton} />)}</View>
      </ScreenWrapper>
    );
  }
  if ((editId || copyFromId) && (editView.isError || !sourceView)) {
    return (
      <ScreenWrapper>
        <Header title={title} />
        <EmptyState
          icon={TriangleAlert}
          title={t('requirements.loadErrorTitle')}
          subtitle={t('requirements.loadErrorBody')}
          ctaTitle={t('common.retry')}
          ctaPhLabel="Request-form-retry"
          onCtaPress={() => void editView.refetch()}
        />
      </ScreenWrapper>
    );
  }
  if (editing && sourceView && sourceView.status !== 'active') {
    return (
      <ScreenWrapper>
        <Header title={title} />
        <EmptyState icon={ClipboardList} title={t('requirements.form.notEditableTitle')} subtitle={t('requirements.form.notEditableBody')} />
      </ScreenWrapper>
    );
  }

  // The open-requests and daily limits (signed-in counts; null for a guest, who never reaches this screen).
  const o = options.data;
  const atOpenLimit = !editing && !!o && o.openLimit !== null && o.openCount !== null && o.openCount >= o.openLimit;
  const atDailyLimit = !editing && !!o && o.postsLeftToday === 0;
  const place = business.data
    ? [business.data.location.industrialAreaName ?? business.data.location.industrialAreaOther, business.data.location.city].filter(Boolean).join(', ') || null
    : null;
  const index = STEPS.indexOf(step);

  return (
    <ScreenWrapper keyboardAware scroll>
      <Header title={title} onBack={() => navigation.goBack()} />
      <Steps
        current={index + 1}
        total={STEPS.length}
        label={t('requirements.form.stepOf', { current: index + 1, total: STEPS.length })}
        style={s.steps}
      />
      <View style={s.body}>
        {step === 'need' ? (
          <StepNeed values={values} errors={shownErrors} editing={editing} units={units} onChange={change} />
        ) : step === 'details' ? (
          <StepDetails
            values={values}
            errors={shownErrors}
            onChange={change}
            options={o}
            conditions={conditions}
            place={place}
            state={business.data?.location.state ?? null}
            editing={editing}
            specFields={specFields}
            specValues={specValues}
            specErrors={tried.details ? specErrors : {}}
            onSpecChange={changeSpec}
            photoUrls={photoUrls}
          />
        ) : (
          <>
            <RequestPreview
              values={values}
              categoryPath={path.map((n) => n.name).join(' › ')}
              unitLabel={unit?.label ?? null}
              conditions={conditions}
              city={business.data?.location.city ?? null}
            />
            {atOpenLimit ? (
              <Notice
                tone="warning"
                icon={TriangleAlert}
                title={t('requirements.form.limitTitle', { count: o!.openCount! })}
                text={t('requirements.form.limitBody', { limit: o!.openLimit! })}
              />
            ) : atDailyLimit ? (
              <Notice tone="warning" icon={TriangleAlert} text={t('requirements.form.dailyLimit')} />
            ) : null}
          </>
        )}
      </View>
      <FooterBar>
        {step !== 'need' ? (
          <Button title={t('common.back')} phLabel="Request-back" variant="outline" size="md" disabled={busy} onPress={() => navigation.goBack()} />
        ) : null}
        {step !== 'preview' ? (
          <Button title={step === 'details' ? t('requirements.form.preview') : t('requirements.form.next')} phLabel="Request-next" size="md" onPress={next} />
        ) : editing ? (
          <Button title={t('requirements.form.save')} phLabel="Request-save" size="md" loading={update.isPending} onPress={save} />
        ) : atOpenLimit || atDailyLimit ? (
          <Button title={t('requirements.form.myRequirements')} phLabel="Request-limit-mine" variant="outline" size="md" onPress={() => navigation.navigate('MyRequirements')} />
        ) : (
          <Button title={t('requirements.form.post')} phLabel="Request-post" size="md" loading={create.isPending} onPress={post} />
        )}
      </FooterBar>
    </ScreenWrapper>
  );
}
