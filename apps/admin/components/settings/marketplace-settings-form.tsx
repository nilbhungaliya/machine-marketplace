'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import {
  validateSettings, type AppSettingDef, type AppSettingKey, type AppSettingsValues, type AppSettingsView,
} from '@mpm/shared-types';
import { Button } from '@/components/ui/button';
import { errorCls, inputCls, labelCls } from '@/components/ui/field-classes';
import { ApiError } from '@/lib/api';
import { fetchExpiryImpact, updateSettings } from '@/lib/settings-api';
import { cn } from '@/lib/utils';

const EXPIRY: AppSettingKey = 'listing_expiry_days';
export const REMINDER_MESSAGE = 'The reminder must be shorter than the expiry';
const IMPACT_DELAY_MS = 300;

/** The F6 + F7 keys (spec §17), shown in their own section; every other registry key is a listing rule. */
export const NEGOTIATION_KEYS: readonly string[] = [
  'offer_validity_hours_1', 'offer_validity_hours_2', 'offer_validity_hours_3', 'offer_open_limit_unverified',
  'offer_open_limit_verified', 'offer_expiring_notice_hours', 'enquiry_new_per_day_unverified',
  'enquiry_new_per_day_verified', 'deal_problem_window_days', 'deal_auto_complete_days', 'deal_agreed_reminder_days',
  'offer_backup_max_days', 'review_window_days', 'review_blind_days', 'review_min_published',
];

/** The F8 keys (spec §16): every `part_request_*` registry key, in its own section. */
export const isPartRequestKey = (key: string) => key.startsWith('part_request_');

/** The M14 keys (spec §16): every `rental_*` registry key, in its own section "Rentals". */
export const isRentalKey = (key: string) => key.startsWith('rental_');

const SECTIONS: Array<{ title: string; note: string; keys: (def: AppSettingDef) => boolean }> = [
  {
    title: 'Listings',
    note: 'The next expiry run and the next listing published use them.',
    keys: (d) => !NEGOTIATION_KEYS.includes(d.key) && !isPartRequestKey(d.key) && !isRentalKey(d.key),
  },
  {
    title: 'Negotiation, deals and reviews',
    note: 'New offers, deals and reviews use them; ones already running keep the times they started with.',
    keys: (d) => NEGOTIATION_KEYS.includes(d.key),
  },
  {
    title: 'Part requests',
    note: 'New requirements, renewals, replies and the next matching run use them; a requirement keeps the expiry it has.',
    keys: (d) => isPartRequestKey(d.key),
  },
  {
    title: 'Rentals',
    note: 'New booking requests and changes use them; a booking already waiting keeps the reply time it was given.',
    keys: (d) => isRentalKey(d.key),
  },
];

/**
 * The form's schema from the registry: whole numbers in each range, then the registry's cross-checks with the API's own
 * messages (`validateSettings`: reminder < expiry, the offer validities increasing, notice < short validity, problem
 * window < auto-complete, blind wait ≤ review window, backup life ≥ long validity; F8: the requirement validities
 * increasing and within the maximum open time, notice < short validity, daily match pushes ≤ total; M14: unverified
 * open booking limit ≤ verified) on the setting they name.
 */
export function settingsSchema(registry: readonly AppSettingDef[]) {
  const shape = Object.fromEntries(registry.map((def) => [
    def.key,
    z.number({ invalid_type_error: 'Enter a whole number', required_error: 'Enter a whole number' })
      .int('Enter a whole number')
      .min(def.min, `From ${def.min} to ${def.max}`)
      .max(def.max, `From ${def.min} to ${def.max}`),
  ]));
  return z.object(shape).superRefine((v, ctx) => {
    // Ranges first: a value out of range already shows its own message.
    const inRange = registry.every((def) => {
      const n = v[def.key];
      return typeof n === 'number' && Number.isInteger(n) && n >= def.min && n <= def.max;
    });
    if (!inRange) return;
    const problem = validateSettings(v as AppSettingsValues);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [problem.key], message: problem.message });
  });
}

/**
 * Settings › Marketplace (F2 spec §11.5): the registry's settings with their ranges and help, React Hook Form + Zod.
 * Lowering the expiry asks the API how many live and rented listings the next job run would expire. Save sends only
 * the changed keys.
 */
export function MarketplaceSettingsForm({ view, onSaved }: {
  view: AppSettingsView;
  onSaved: (next: AppSettingsView) => void;
}) {
  const schema = useMemo(() => settingsSchema(view.registry), [view.registry]);
  const {
    register, handleSubmit, watch, reset, setError, formState: { errors, isDirty, isSubmitting },
  } = useForm<Record<string, number>>({ resolver: zodResolver(schema), defaultValues: view.values });
  const [impact, setImpact] = useState<{ days: number; count: number } | null>(null);

  useEffect(() => { reset(view.values); }, [view.values, reset]);

  const expiry = watch(EXPIRY);
  const saved = view.values[EXPIRY as keyof AppSettingsValues];
  const expiryDef = view.registry.find((d) => d.key === EXPIRY);
  useEffect(() => {
    setImpact(null);
    const lower = Number.isInteger(expiry) && expiry < saved && (!expiryDef || (expiry >= expiryDef.min && expiry <= expiryDef.max));
    if (!lower) return;
    let live = true;
    const timer = setTimeout(() => {
      fetchExpiryImpact(expiry)
        .then((r) => { if (live) setImpact(r); })
        .catch(() => {});
    }, IMPACT_DELAY_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [expiry, saved, expiryDef]);

  const save = async (values: Record<string, number>) => {
    const patch: Partial<AppSettingsValues> = {};
    for (const def of view.registry) {
      const key = def.key as AppSettingKey;
      if (values[key] !== view.values[key]) patch[key] = values[key];
    }
    if (Object.keys(patch).length === 0) return;
    try {
      const next = await updateSettings(patch);
      toast.success('Settings saved');
      onSaved(next);
    } catch (err) {
      const key = err instanceof ApiError && typeof err.details?.key === 'string' ? err.details.key : null;
      if (key) setError(key, { message: err instanceof Error ? err.message : 'Not allowed' });
      toast.error(err instanceof Error && err.message ? err.message : 'Could not save the settings');
    }
  };

  return (
    <form noValidate onSubmit={handleSubmit(save)} className="space-y-5">
      {SECTIONS.map((section) => {
        const defs = view.registry.filter(section.keys);
        if (defs.length === 0) return null;
        return (
          <fieldset key={section.title}>
            <legend className="text-[13px] font-extrabold text-gray-900">{section.title}</legend>
            <p className="mb-3 mt-0.5 text-[12.5px] text-gray-500">{section.note}</p>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              {defs.map((def) => {
                const id = `setting-${def.key}`;
                const error = errors[def.key]?.message;
                return (
                  <div key={def.key}>
                    <label htmlFor={id} className={labelCls}>{def.label}</label>
                    <input
                      id={id}
                      type="number"
                      inputMode="numeric"
                      min={def.min}
                      max={def.max}
                      step={1}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={`${id}-help`}
                      className={cn(inputCls, 'tnum')}
                      {...register(def.key, { valueAsNumber: true })}
                    />
                    <p id={`${id}-help`} className="mt-1 text-[12.5px] text-gray-500">
                      {def.help} <span className="tnum">{def.min} to {def.max}</span>, default <span className="tnum">{def.default}</span>.
                    </p>
                    {error && <p className={errorCls}>{String(error)}</p>}
                    {def.key === EXPIRY && impact && impact.days === expiry && (
                      <p role="status" className="mt-2 flex items-center gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-800">
                        <AlertTriangle size={14} aria-hidden className="shrink-0" />
                        {impact.count === 1 ? '1 listing would' : `${impact.count} listings would`} expire within the hour
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>
        );
      })}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" disabled={!isDirty || isSubmitting} onClick={() => reset(view.values)}>Undo changes</Button>
        <Button type="submit" loading={isSubmitting} disabled={!isDirty}>Save</Button>
      </div>
    </form>
  );
}
