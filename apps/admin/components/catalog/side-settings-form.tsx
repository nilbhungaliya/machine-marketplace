'use client';

import { useId } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { DEFAULT_SIDE_CONVENTION, type CategoryNode } from '@mpm/shared-types';
import { Button } from '@/components/ui/button';
import { inputCls } from '@/components/ui/field-classes';

const CONVENTION_MAX = 300;

const schema = z
  .object({
    sides: z.enum(['inherit', 'yes', 'no']),
    conventionMode: z.enum(['inherit', 'own']),
    convention: z.string().max(CONVENTION_MAX, `At most ${CONVENTION_MAX} characters`),
  })
  .superRefine((v, ctx) => {
    if (v.conventionMode === 'own' && v.convention.trim() === '') {
      ctx.addIssue({ code: 'custom', path: ['convention'], message: 'Enter the convention, or choose Inherit' });
    }
  });
type Values = z.infer<typeof schema>;

export interface SideSettings {
  /** null: inherit from the parent. */
  hasSides: boolean | null;
  /** null: inherit from the parent. */
  sideConvention: string | null;
}

const valuesOf = (node: CategoryNode): Values => ({
  sides: node.hasSides === null ? 'inherit' : node.hasSides ? 'yes' : 'no',
  conventionMode: node.sideConvention?.trim() ? 'own' : 'inherit',
  convention: node.sideConvention ?? '',
});

/**
 * Left / Right / Pair settings of one node (F3): whether parts here have sides, and the
 * convention that says which side is left. Each is either the node's own value or inherited
 * from its parent; Inherit shows the value it would take and the node it comes from.
 */
export function SideSettingsForm({ node, ancestors, onSave }: {
  node: CategoryNode;
  /** The node's ancestors, category first, parent last ([] for a category). */
  ancestors: CategoryNode[];
  /** Throw to keep the form as typed (the caller reports the error). */
  onSave: (settings: SideSettings) => Promise<void> | void;
}) {
  const ids = useId();
  const { register, handleSubmit, reset, watch, formState: { errors, isDirty, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: valuesOf(node),
  });
  const conventionMode = watch('conventionMode');

  // What Inherit gives: the parent's effective values (a category inherits the defaults).
  const parent = ancestors[ancestors.length - 1] ?? null;
  const nearestFirst = [...ancestors].reverse();
  const inheritedSides = parent?.effectiveHasSides ?? false;
  const sidesSource = nearestFirst.find((a) => a.hasSides !== null);
  const inheritedSidesText = `${inheritedSides ? 'Yes' : 'No'}${sidesSource ? `, from ${sidesSource.name}` : ' (default)'}`;
  const inheritedConvention = parent?.effectiveSideConvention ?? DEFAULT_SIDE_CONVENTION;
  const conventionSource = nearestFirst.find((a) => a.sideConvention?.trim());

  const save = async (v: Values) => {
    const settings: SideSettings = {
      hasSides: v.sides === 'inherit' ? null : v.sides === 'yes',
      sideConvention: v.conventionMode === 'own' ? v.convention.trim() : null,
    };
    try {
      await onSave(settings);
      reset({ ...v, convention: settings.sideConvention ?? '' });
    } catch {
      // The caller showed the error; keep what was typed.
    }
  };

  const radio = 'h-4 w-4 border-gray-300 text-brand-600 focus:ring-brand-600';
  const legend = 'mb-2 text-[13.5px] font-semibold text-gray-900';

  return (
    <form noValidate onSubmit={handleSubmit(save)} className="space-y-5">
      <fieldset aria-describedby={`${ids}-sides-hint`}>
        <legend className={legend}>Parts here have sides</legend>
        <p id={`${ids}-sides-hint`} className="mb-2 -mt-1 text-[13px] text-gray-500">
          When yes, sellers pick Left, Right or Pair and buyers can find the other side.
        </p>
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2">
            <label className="flex items-center gap-2 text-sm text-gray-900">
              <input type="radio" value="inherit" className={radio} {...register('sides')} /> Inherit
            </label>
            <span className="text-[13px] text-gray-500">{inheritedSidesText}</span>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-900">
            <input type="radio" value="yes" className={radio} {...register('sides')} /> Yes
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-900">
            <input type="radio" value="no" className={radio} {...register('sides')} /> No
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend className={legend}>Side convention</legend>
        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-sm text-gray-900">
            <input type="radio" value="inherit" className={radio} {...register('conventionMode')} /> Inherit
          </label>
          <div className="ml-6 rounded-xl bg-gray-50 px-3 py-2 text-[13px]">
            <p className="text-gray-700">{inheritedConvention}</p>
            <span className="text-gray-500">{conventionSource ? `From ${conventionSource.name}` : 'Default'}</span>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-900">
            <input type="radio" value="own" className={radio} {...register('conventionMode')} /> Own text
          </label>
          {conventionMode === 'own' && (
            <div className="ml-6">
              <textarea
                aria-label="Own side convention"
                rows={2}
                maxLength={CONVENTION_MAX}
                className={inputCls}
                placeholder={DEFAULT_SIDE_CONVENTION}
                {...register('convention')}
              />
              {errors.convention && <p className="mt-1 text-xs font-semibold text-red-600">{errors.convention.message}</p>}
            </div>
          )}
        </div>
      </fieldset>

      <div className="flex justify-end">
        <Button type="submit" size="sm" loading={isSubmitting} disabled={!isDirty}>Save side settings</Button>
      </div>
    </form>
  );
}
