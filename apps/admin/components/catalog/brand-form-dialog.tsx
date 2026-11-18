'use client';

import { useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { CATALOG_KEY_REGEX, type Brand } from '@mpm/shared-types';
import { FormDialog } from '@/components/ui/form-dialog';
import { ApiError } from '@/lib/api';
import { createBrand, updateBrand, type UpdateBrandPatch } from '@/lib/catalog-api';
import { KEY_MESSAGE, toCatalogKey } from '@/lib/catalog-key';
import { inputCls, labelCls, errorCls, checkCls } from '@/components/ui/field-classes';

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const schemaFor = (mode: 'create' | 'edit') =>
  z
    .object({
      name: z.string().trim().min(1, 'Enter a name').max(120, 'At most 120 characters'),
      key: z.string().trim(),
      slug: z.string().trim().max(80, 'At most 80 characters'),
      makesMachines: z.boolean(),
      makesParts: z.boolean(),
      needsReview: z.boolean(),
    })
    .superRefine((v, ctx) => {
      if (mode === 'create' && !CATALOG_KEY_REGEX.test(v.key)) ctx.addIssue({ code: 'custom', path: ['key'], message: KEY_MESSAGE });
      // Blank on create: the API derives it from the name.
      if (v.slug === '' && mode === 'edit') ctx.addIssue({ code: 'custom', path: ['slug'], message: 'Enter a slug' });
      else if (v.slug !== '' && !SLUG_RE.test(v.slug)) {
        ctx.addIssue({ code: 'custom', path: ['slug'], message: 'Lowercase letters, digits and single hyphens' });
      }
      if (!v.makesMachines && !v.makesParts) {
        ctx.addIssue({ code: 'custom', path: ['makesParts'], message: 'A brand makes machines, parts or both' });
      }
    });
type Values = z.infer<ReturnType<typeof schemaFor>>;

export type BrandFormDialogProps =
  | { mode: 'create'; brand?: undefined; onClose: () => void; onSaved: (brand: Brand) => void }
  | { mode: 'edit'; brand: Brand; onClose: () => void; onSaved: (brand: Brand) => void };

/** Add or edit a brand (A4). The key is set once, on create. Mount it to open it. */
export function BrandFormDialog({ mode, brand, onClose, onSaved }: BrandFormDialogProps) {
  const keyTouched = useRef(false);
  const { register, handleSubmit, setError, setValue, formState: { errors, isDirty, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schemaFor(mode)),
    defaultValues: {
      name: brand?.name ?? '',
      key: brand?.key ?? '',
      slug: brand?.slug ?? '',
      makesMachines: brand?.makesMachines ?? true,
      makesParts: brand?.makesParts ?? false,
      needsReview: brand?.needsReview ?? false,
    },
  });

  const save = async (v: Values) => {
    try {
      let saved: Brand;
      if (mode === 'create') {
        saved = await createBrand({
          key: v.key,
          name: v.name,
          ...(v.slug ? { slug: v.slug } : {}),
          makesMachines: v.makesMachines,
          makesParts: v.makesParts,
        });
        toast.success('Brand added');
      } else {
        const next: Required<Omit<UpdateBrandPatch, 'isActive'>> = {
          name: v.name, slug: v.slug, makesMachines: v.makesMachines, makesParts: v.makesParts, needsReview: v.needsReview,
        };
        const patch: UpdateBrandPatch = {};
        for (const k of Object.keys(next) as Array<keyof typeof next>) {
          if (next[k] !== brand[k]) (patch as Record<string, unknown>)[k] = next[k];
        }
        if (Object.keys(patch).length === 0) { onClose(); return; }
        saved = await updateBrand(brand.id, patch);
        toast.success('Brand saved');
      }
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'KEY_TAKEN') setError('key', { message: 'Another brand already uses this key' });
      else if (err instanceof ApiError && err.code === 'SLUG_TAKEN') setError('slug', { message: 'Another brand already uses this slug' });
      else if (err instanceof ApiError && err.code === 'FIELD_INVALID') setError('makesParts', { message: err.message });
      else toast.error(err instanceof Error ? err.message : 'Could not save the brand');
    }
  };

  return (
    <FormDialog
      open
      onClose={onClose}
      title={mode === 'create' ? 'Add brand' : `Edit ${brand.name}`}
      dirty={isDirty}
      submitting={isSubmitting}
      submitLabel={mode === 'create' ? 'Add brand' : 'Save'}
      onSubmit={handleSubmit(save)}
    >
      <div className="space-y-4">
        {mode === 'edit' && (
          <p className="text-sm text-gray-500">
            Key <code className="rounded bg-gray-100 px-[5px] py-px font-mono text-xs text-gray-600">{brand.key}</code>
            <span className="ml-1 text-xs text-gray-500">(fixed once created)</span>
          </p>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="brand-name" className={labelCls}>Name</label>
            <input
              id="brand-name"
              className={inputCls}
              autoComplete="off"
              aria-describedby={errors.name ? 'brand-name-error' : undefined}
              {...register('name', {
                onChange: (e: { target: { value: string } }) => {
                  if (mode === 'create' && !keyTouched.current) setValue('key', toCatalogKey(e.target.value), { shouldDirty: true });
                },
              })}
            />
            {errors.name && <p id="brand-name-error" className={errorCls}>{errors.name.message}</p>}
          </div>
          {mode === 'create' && (
            <div>
              <label htmlFor="brand-key" className={labelCls}>Key</label>
              <input
                id="brand-key"
                className={`${inputCls} font-mono`}
                autoComplete="off"
                spellCheck={false}
                aria-describedby={errors.key ? 'brand-key-error' : undefined}
                {...register('key', { onChange: () => { keyTouched.current = true; } })}
              />
              {errors.key && <p id="brand-key-error" className={errorCls}>{errors.key.message}</p>}
            </div>
          )}
          <div className={mode === 'create' ? 'sm:col-span-2' : undefined}>
            <label htmlFor="brand-slug" className={labelCls}>Slug</label>
            <input
              id="brand-slug"
              className={inputCls}
              autoComplete="off"
              placeholder={mode === 'create' ? 'Leave blank to make one from the name' : undefined}
              aria-describedby={errors.slug ? 'brand-slug-error' : undefined}
              {...register('slug')}
            />
            {errors.slug && <p id="brand-slug-error" className={errorCls}>{errors.slug.message}</p>}
          </div>
        </div>

        <fieldset aria-describedby={errors.makesParts ? 'brand-flags-error' : undefined}>
          <legend className={labelCls}>Makes</legend>
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm text-gray-900">
              <input type="checkbox" className={checkCls} {...register('makesMachines')} /> Makes machines
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-900">
              <input type="checkbox" className={checkCls} {...register('makesParts')} /> Makes parts
            </label>
          </div>
          <p className="mt-1 text-[12.5px] text-gray-500">
            Machine makers are offered for fitment and can have models; part makers are offered as a part&apos;s brand.
          </p>
          {errors.makesParts && <p id="brand-flags-error" className={errorCls}>{errors.makesParts.message}</p>}
        </fieldset>

        {mode === 'edit' && (
          <label className="flex items-start gap-2 text-sm text-gray-900">
            <input type="checkbox" className={`${checkCls} mt-0.5`} {...register('needsReview')} />
            <span>
              Needs review
              <span className="block text-[12.5px] text-gray-500">Untick once the client has confirmed this brand. It has no effect in the app.</span>
            </span>
          </label>
        )}
      </div>
    </FormDialog>
  );
}
