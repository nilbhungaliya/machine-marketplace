'use client';

import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ExternalLink } from 'lucide-react';
import { CONSTITUTIONS, type AdminGstReviewDetail, type GstApprovalEdits } from '@mpm/shared-types';
import { FormDialog } from '@/components/ui/form-dialog';
import { CONSTITUTION_LABELS, GST_PORTAL_SEARCH_URL } from '@/lib/verification-api';
import { inputCls, labelCls } from '@/components/ui/field-classes';

const schema = z.object({
  legalName: z.string().trim().min(1, 'Enter the legal name').max(200, 'At most 200 characters'),
  tradeName: z.string().trim().max(200, 'At most 200 characters'),
  line: z.string().trim().min(1, 'Enter the address').max(300, 'At most 300 characters'),
  city: z.string().trim().min(1, 'Enter the city').max(80, 'At most 80 characters'),
  state: z.string().trim().min(1, 'Enter the state').max(80, 'At most 80 characters'),
  pincode: z.string().trim().regex(/^[1-9]\d{5}$/, 'A 6-digit pincode'),
  constitution: z.string().trim().min(1, 'Pick the constitution').max(100),
});
type Values = z.infer<typeof schema>;

/**
 * Whether the officer approves details they can correct: no lookup is attached, or no provider will look the GSTIN
 * up again at approval (mode `review`). Otherwise a fresh lookup decides and edits would be ignored (spec §5.3).
 */
export const officerEditsDetails = (review: AdminGstReviewDetail) => !review.lookup || !review.providerAvailable;

function startValues(review: AdminGstReviewDetail): Values {
  const base = review.entered ?? review.lookup?.details ?? null;
  return {
    legalName: base?.legalName ?? '',
    tradeName: base?.tradeName ?? '',
    line: base?.address.line ?? '',
    city: base?.address.city ?? '',
    state: base?.address.state ?? '',
    pincode: base?.address.pincode ?? '',
    constitution: base?.constitution ?? '',
  };
}

/** Only what the officer changed, so the audit row says what they corrected. */
export function approvalEdits(start: Values, v: Values): GstApprovalEdits {
  const edits: GstApprovalEdits = {};
  if (v.legalName.trim() !== start.legalName) edits.legalName = v.legalName.trim();
  if (v.tradeName.trim() !== start.tradeName) edits.tradeName = v.tradeName.trim() === '' ? null : v.tradeName.trim();
  if (v.constitution !== start.constitution) edits.constitution = v.constitution;
  if ((['line', 'city', 'state', 'pincode'] as const).some((k) => v[k].trim() !== start[k])) {
    edits.address = { line: v.line.trim(), city: v.city.trim(), state: v.state.trim(), pincode: v.pincode.trim() };
  }
  return edits;
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={labelCls}>{label}</label>
      {children}
      {error && <p className="mt-1 text-xs font-semibold text-red-600">{error}</p>}
    </div>
  );
}

/** Approve a GST review (F1 + A2 spec §5.3, §8.1). `onApprove` reports its own errors and resolves true to close. */
export function ApproveDialog({ review, onClose, onApprove }: {
  review: AdminGstReviewDetail;
  onClose: () => void;
  onApprove: (edits: GstApprovalEdits) => Promise<boolean>;
}) {
  const editable = officerEditsDetails(review);
  const start = startValues(review);
  const { register, handleSubmit, formState: { errors, isDirty, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: start,
  });
  const customConstitution = start.constitution !== '' && !(CONSTITUTIONS as readonly string[]).includes(start.constitution);

  const save = async (v: Values) => {
    if (await onApprove(editable ? approvalEdits(start, v) : {})) onClose();
  };

  return (
    <FormDialog
      open
      onClose={onClose}
      title="Approve GST verification"
      description={<>{review.business.tradeName} · <span className="font-mono">{review.gstin}</span></>}
      size={editable ? 'lg' : 'md'}
      dirty={editable && isDirty}
      submitting={isSubmitting}
      submitLabel="Approve"
      onSubmit={editable ? handleSubmit(save) : () => save(start)}
    >
      {!editable ? (
        <p className="text-sm text-gray-600">
          A fresh GST lookup runs when you approve. The GSTIN must show as active, and the lookup&apos;s details become the
          business&apos;s GST details.
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            {review.providerAvailable
              ? 'No lookup is attached. A fresh lookup runs when you approve; if the provider can’t be reached, these details are saved. '
              : 'No GST provider is connected, so these details are saved as you approve them. '}
            Check them on the{' '}
            <a href={GST_PORTAL_SEARCH_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-brand-700 hover:underline">
              GST portal <ExternalLink size={12} aria-hidden />
            </a>{' '}
            and correct them if needed.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="approve-legal" label="Legal name" error={errors.legalName?.message}>
              <input id="approve-legal" className={inputCls} autoComplete="off" {...register('legalName')} />
            </Field>
            <Field id="approve-trade" label="Trade name" error={errors.tradeName?.message}>
              <input id="approve-trade" className={inputCls} autoComplete="off" {...register('tradeName')} />
            </Field>
          </div>
          <Field id="approve-line" label="Address" error={errors.line?.message}>
            <input id="approve-line" className={inputCls} autoComplete="off" {...register('line')} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field id="approve-city" label="City" error={errors.city?.message}>
              <input id="approve-city" className={inputCls} autoComplete="off" {...register('city')} />
            </Field>
            <Field id="approve-state" label="State" error={errors.state?.message}>
              <input id="approve-state" className={inputCls} autoComplete="off" {...register('state')} />
            </Field>
            <Field id="approve-pincode" label="Pincode" error={errors.pincode?.message}>
              <input id="approve-pincode" className={`${inputCls} tnum`} inputMode="numeric" maxLength={6} autoComplete="off" {...register('pincode')} />
            </Field>
          </div>
          <Field id="approve-constitution" label="Constitution" error={errors.constitution?.message}>
            <select id="approve-constitution" className={inputCls} {...register('constitution')}>
              {start.constitution === '' && <option value="">Pick one</option>}
              {customConstitution && <option value={start.constitution}>{start.constitution}</option>}
              {CONSTITUTIONS.map((c) => <option key={c} value={c}>{CONSTITUTION_LABELS[c]}</option>)}
            </select>
          </Field>
        </div>
      )}
    </FormDialog>
  );
}
