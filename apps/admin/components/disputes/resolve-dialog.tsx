'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  ADMIN_REASON_MAX, ADMIN_REASON_MIN, DEAL_LIMITS, DISPUTE_OUTCOMES, type AdminPartyRef, type DisputeSubject,
} from '@mpm/shared-types';
import { FormDialog } from '@/components/ui/form-dialog';
import { errorCls, inputCls, labelCls } from '@/components/ui/field-classes';
import {
  DISPUTE_OUTCOME_LABELS, RENTAL_DISPUTE_OUTCOME_LABELS, disputePartyLabels, disputeSubject, explainDisputeError,
  resolveDispute, type ResolveDisputeBody,
} from '@/lib/disputes-api';
import { cn } from '@/lib/utils';

export const NOTE_MESSAGE = `Write an internal note of ${ADMIN_REASON_MIN} to ${ADMIN_REASON_MAX} characters`;
export const GOODS_MESSAGE = 'Say whether the goods went back to the seller';
const MESSAGE_MAX = DEAL_LIMITS.messageToPartiesMax;

/**
 * The resolve form's rules (§9.6, the API's `resolveBody`): an outcome; for `cancelled` on a deal dispute the goods
 * answer (yes / no, nothing preselected; a rental booking dispute has no stock, M14 R12); an internal note of
 * `ADMIN_REASON_MIN`–`MAX` (audit only); an optional message to both parties of at most 500.
 */
const makeResolveSchema = (hasDeal: boolean) => z
  .object({
    // A radio group with nothing checked reads as null.
    outcome: z.enum(['', ...DISPUTE_OUTCOMES]).nullable().transform((v) => v ?? ''),
    stockReturned: z.enum(['', 'yes', 'no']).nullable().transform((v) => v ?? ''),
    internalNote: z.string().refine((v) => {
      const n = v.trim().length;
      return n >= ADMIN_REASON_MIN && n <= ADMIN_REASON_MAX;
    }, NOTE_MESSAGE),
    messageToParties: z.string().refine((v) => v.trim().length <= MESSAGE_MAX, `At most ${MESSAGE_MAX} characters`),
  })
  .superRefine((v, ctx) => {
    if (v.outcome === '') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['outcome'], message: 'Choose an outcome' });
    if (hasDeal && v.outcome === 'cancelled' && v.stockReturned === '') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['stockReturned'], message: GOODS_MESSAGE });
    }
  });

export const resolveSchema = makeResolveSchema(true);
const rentalResolveSchema = makeResolveSchema(false);

type Values = z.input<typeof resolveSchema>;
type Parsed = z.output<typeof resolveSchema>;

/**
 * The form's values as the API body: `stockReturned` only with `cancelled` on a deal dispute (the API refuses it for a
 * rental booking dispute, M14 R12); an empty message is null.
 */
export function resolveBody(v: Parsed, hasDeal = true): ResolveDisputeBody {
  if (v.outcome === '') throw new Error('No outcome');
  const message = v.messageToParties.trim();
  return {
    outcome: v.outcome,
    ...(hasDeal && v.outcome === 'cancelled' ? { stockReturned: v.stockReturned === 'yes' } : {}),
    internalNote: v.internalNote.trim(),
    messageToParties: message === '' ? null : message,
  };
}

const optionCls =
  'flex cursor-pointer items-start gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50';

/**
 * Resolve a dispute (F6 + F7 spec §9.6; M14 R12, §15): outcome, for a deal "Did the goods go back to the seller?" on
 * cancelled (yes releases the hold, no converts it), an internal note (audit only) and an optional message shown to both
 * parties in the thread. A rental booking dispute has no goods question; its outcomes explain what happens to the
 * booking. Danger submit. Mount it only while open.
 */
export function ResolveDialog({ dispute, onClose, onResolved }: {
  dispute: {
    id: string;
    subject?: DisputeSubject;
    dealId?: string | null;
    dealRef: number | null;
    rentalBookingRef?: number | null;
    buyer: AdminPartyRef;
    seller: AdminPartyRef;
  };
  onClose: () => void;
  /** After a resolve, or a refusal that means the record is stale: reload. */
  onResolved: () => Promise<void> | void;
}) {
  const subject = disputeSubject({ ...dispute, dealId: dispute.dealId ?? null });
  const hasDeal = subject.kind === 'deal' && dispute.dealRef !== null;
  const outcomes = subject.kind === 'rental' ? RENTAL_DISPUTE_OUTCOME_LABELS : DISPUTE_OUTCOME_LABELS;
  const sides = disputePartyLabels(subject.kind);
  const on = `${subject.noun} ${subject.ref}`;
  const { register, handleSubmit, watch, formState: { errors, isDirty, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(hasDeal ? resolveSchema : rentalResolveSchema),
    defaultValues: { outcome: '', stockReturned: '', internalNote: '', messageToParties: '' },
  });
  const outcome = watch('outcome');
  const message = watch('messageToParties');

  const save = async (values: Parsed) => {
    try {
      await resolveDispute(dispute.id, resolveBody(values, hasDeal));
      toast.success(`Dispute on ${on} resolved`);
      await onResolved();
      onClose();
    } catch (err) {
      const { message: text, stale } = explainDisputeError(err);
      toast.error(text);
      if (stale) { await onResolved(); onClose(); }
    }
  };

  return (
    <FormDialog
      open
      size="lg"
      onClose={onClose}
      title={`Resolve the dispute on ${on}`}
      description={`${dispute.buyer.name} (${sides.buyer.toLowerCase()}) and ${dispute.seller.name} (${sides.seller.toLowerCase()}) are both told the outcome.`}
      dirty={isDirty}
      submitting={isSubmitting}
      submitLabel="Resolve"
      submitVariant="danger"
      // The resolver hands over its parsed (transformed) values: radios as '' rather than null.
      onSubmit={handleSubmit((values) => save(values as Parsed))}
    >
      <div className="space-y-4">
        <fieldset>
          <legend className={labelCls}>Outcome</legend>
          <div className="grid gap-2">
            {DISPUTE_OUTCOMES.map((o) => (
              <label key={o} className={optionCls}>
                <input type="radio" value={o} className="mt-1" {...register('outcome')} />
                <span>
                  <span className="block font-bold text-gray-900">{outcomes[o].label}</span>
                  <span className="block text-[13px] text-gray-600">{outcomes[o].hint}</span>
                </span>
              </label>
            ))}
          </div>
          {errors.outcome && <p className={errorCls}>{errors.outcome.message}</p>}
        </fieldset>

        {hasDeal && outcome === 'cancelled' && (
          <fieldset className="rounded-xl bg-amber-50 px-3 pb-3 pt-2.5">
            <legend className="px-1 text-sm font-bold text-gray-900">Did the goods go back to the seller?</legend>
            <div className="mt-1 grid gap-2 sm:grid-cols-2">
              <label className={optionCls}>
                <input type="radio" value="yes" className="mt-1" {...register('stockReturned')} />
                <span>
                  <span className="block font-bold text-gray-900">Yes</span>
                  <span className="block text-[13px] text-gray-600">The held quantity goes back to the listing&apos;s stock.</span>
                </span>
              </label>
              <label className={optionCls}>
                <input type="radio" value="no" className="mt-1" {...register('stockReturned')} />
                <span>
                  <span className="block font-bold text-gray-900">No</span>
                  <span className="block text-[13px] text-gray-600">The buyer kept them: the held quantity is taken from stock.</span>
                </span>
              </label>
            </div>
            {errors.stockReturned && <p className={errorCls}>{errors.stockReturned.message}</p>}
          </fieldset>
        )}

        <div>
          <label htmlFor="resolve-note" className={labelCls}>Internal note</label>
          <textarea id="resolve-note" rows={3} className={inputCls} {...register('internalNote')} />
          {errors.internalNote
            ? <p className={errorCls}>{errors.internalNote.message}</p>
            : <p className="mt-1 text-[12.5px] text-gray-500">For the audit log only; the parties never see it. {ADMIN_REASON_MIN} to {ADMIN_REASON_MAX} characters.</p>}
        </div>

        <div>
          <label htmlFor="resolve-message" className={labelCls}>Message to both parties (optional)</label>
          <textarea id="resolve-message" rows={3} className={inputCls} {...register('messageToParties')} />
          {errors.messageToParties ? (
            <p className={errorCls}>{errors.messageToParties.message}</p>
          ) : (
            <p className={cn('mt-1 flex justify-between gap-3 text-[12.5px] text-gray-500')}>
              <span>Shown in the conversation with the outcome.</span>
              <span className="tnum">{(message ?? '').trim().length} / {MESSAGE_MAX}</span>
            </p>
          )}
        </div>
      </div>
    </FormDialog>
  );
}
