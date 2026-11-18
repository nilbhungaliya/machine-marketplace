'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import type { AppSettingDef, AppSettingKey, AppSettingsValues, AppSettingsView } from '@mpm/shared-types';
import { Button } from '@/components/ui/button';
import { errorCls, inputCls, labelCls } from '@/components/ui/field-classes';
import { ApiError } from '@/lib/api';
import { fetchExpiryImpact, updateSettings } from '@/lib/settings-api';
import { cn } from '@/lib/utils';

const EXPIRY: AppSettingKey = 'listing_expiry_days';
const REMINDER: AppSettingKey = 'listing_expiry_reminder_days';
export const REMINDER_MESSAGE = 'The reminder must be shorter than the expiry';
const IMPACT_DELAY_MS = 300;

/** The form's schema from the registry: whole numbers in each range, and the reminder shorter than the expiry. */
export function settingsSchema(registry: readonly AppSettingDef[]) {
  const shape = Object.fromEntries(registry.map((def) => [
    def.key,
    z.number({ invalid_type_error: 'Enter a whole number', required_error: 'Enter a whole number' })
      .int('Enter a whole number')
      .min(def.min, `From ${def.min} to ${def.max}`)
      .max(def.max, `From ${def.min} to ${def.max}`),
  ]));
  return z.object(shape).superRefine((v, ctx) => {
    const expiry = v[EXPIRY];
    const reminder = v[REMINDER];
    if (typeof expiry === 'number' && typeof reminder === 'number' && reminder >= expiry) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [REMINDER], message: REMINDER_MESSAGE });
    }
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
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {view.registry.map((def) => {
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
      <div className="flex justify-end gap-2">
        <Button variant="secondary" disabled={!isDirty || isSubmitting} onClick={() => reset(view.values)}>Undo changes</Button>
        <Button type="submit" loading={isSubmitting}>Save</Button>
      </div>
    </form>
  );
}
