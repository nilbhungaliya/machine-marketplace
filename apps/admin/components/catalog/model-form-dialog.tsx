'use client';

import { useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { CATALOG_KEY_REGEX, type Brand, type CategoryNode, type MachineModel } from '@mpm/shared-types';
import { FormDialog } from '@/components/ui/form-dialog';
import { ApiError } from '@/lib/api';
import { createModel, updateModel } from '@/lib/catalog-api';
import { KEY_MESSAGE, toCatalogKey } from '@/lib/catalog-key';
import { machineTypeChoices } from '@/lib/category-tree';
import { SearchableSelect } from './searchable-select';

const schemaFor = (mode: 'create' | 'edit') =>
  z
    .object({
      name: z.string().trim().min(1, 'Enter a name').max(120, 'At most 120 characters'),
      key: z.string().trim(),
      machineTypeId: z.string(),
    })
    .superRefine((v, ctx) => {
      if (mode !== 'create') return;
      if (!CATALOG_KEY_REGEX.test(v.key)) ctx.addIssue({ code: 'custom', path: ['key'], message: KEY_MESSAGE });
      if (!v.machineTypeId) ctx.addIssue({ code: 'custom', path: ['machineTypeId'], message: 'Choose a machine type' });
    });
type Values = z.infer<ReturnType<typeof schemaFor>>;

export type ModelFormDialogProps = {
  brand: Brand;
  /** The admin tree: the machine type choices (machine types only) and their names. */
  tree: CategoryNode[];
  onClose: () => void;
  onSaved: (model: MachineModel) => void;
} & (
  | { mode: 'create'; model?: undefined; /** Preselected, e.g. from the brands filter. */ machineTypeId?: string }
  | { mode: 'edit'; model: MachineModel; machineTypeId?: undefined }
);

const inputCls = 'w-full rounded-lg border-gray-300 text-sm';
const labelCls = 'mb-1.5 block text-[13.5px] font-semibold text-gray-900';
const errorCls = 'mt-1 text-xs text-red-700';

/**
 * Add a model to a brand, or rename one (A4). Key and machine type are set on create; the
 * machine type (or brand) changes with Move. Mount it to open it.
 */
export function ModelFormDialog(props: ModelFormDialogProps) {
  const { mode, brand, model, tree, onClose, onSaved } = props;
  const keyTouched = useRef(false);
  const [problem, setProblem] = useState<string | null>(null);
  const choices = useMemo(() => machineTypeChoices(tree), [tree]);

  const { register, handleSubmit, setError, setValue, watch, formState: { errors, isDirty, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schemaFor(mode)),
    defaultValues: {
      name: model?.name ?? '',
      key: model?.key ?? '',
      machineTypeId: model?.machineTypeId ?? props.machineTypeId ?? '',
    },
  });
  const machineTypeId = watch('machineTypeId');
  const nameTaken = `${brand.name} already has a model with this name for this machine type`;

  const save = async (v: Values) => {
    setProblem(null);
    try {
      let saved: MachineModel;
      if (mode === 'create') {
        saved = await createModel({ brandId: brand.id, machineTypeId: v.machineTypeId, key: v.key, name: v.name });
        toast.success('Model added');
      } else {
        if (v.name === model.name) { onClose(); return; }
        saved = await updateModel(model.id, { name: v.name });
        toast.success('Model saved');
      }
      onSaved(saved);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      if (code === 'NAME_TAKEN') setError('name', { message: nameTaken });
      else if (code === 'KEY_TAKEN') setError('key', { message: `${brand.name} already has a model with this key` });
      else if (code === 'NOT_A_MACHINE_TYPE') setError('machineTypeId', { message: 'Models belong to a machine type' });
      else if (code === 'BRAND_NOT_MACHINE_MAKER') setProblem(`${brand.name} is not marked as making machines; edit the brand first.`);
      else toast.error(err instanceof Error ? err.message : 'Could not save the model');
    }
  };

  const machineTypeName = (id: string) => choices.find((c) => c.id === id)?.label ?? 'Unknown machine type';

  return (
    <FormDialog
      open
      onClose={onClose}
      title={mode === 'create' ? `Add a ${brand.name} model` : `Edit ${model.name}`}
      dirty={isDirty}
      submitting={isSubmitting}
      submitLabel={mode === 'create' ? 'Add model' : 'Save'}
      onSubmit={handleSubmit(save)}
    >
      <div className="space-y-4">
        {mode === 'edit' && (
          <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-y-1.5 text-sm">
            <dt className="text-gray-500">Key</dt>
            <dd>
              <code className="rounded bg-gray-100 px-[5px] py-px font-mono text-xs text-gray-600">{model.key}</code>
              <span className="ml-1 text-xs text-gray-500">(fixed once created)</span>
            </dd>
            <dt className="text-gray-500">Machine type</dt>
            <dd className="text-gray-900">
              <span>{machineTypeName(model.machineTypeId)}</span>
              <span className="ml-1 text-xs text-gray-500">(change it with Move)</span>
            </dd>
          </dl>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="model-name" className={labelCls}>Name</label>
            <input
              id="model-name"
              className={inputCls}
              autoComplete="off"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? 'model-name-error' : undefined}
              {...register('name', {
                onChange: (e: { target: { value: string } }) => {
                  if (mode === 'create' && !keyTouched.current) setValue('key', toCatalogKey(e.target.value), { shouldDirty: true });
                },
              })}
            />
            {errors.name && <p id="model-name-error" className={errorCls}>{errors.name.message}</p>}
          </div>
          {mode === 'create' && (
            <div>
              <label htmlFor="model-key" className={labelCls}>Key</label>
              <input
                id="model-key"
                className={`${inputCls} font-mono`}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={errors.key ? true : undefined}
                aria-describedby={errors.key ? 'model-key-error' : undefined}
                {...register('key', { onChange: () => { keyTouched.current = true; } })}
              />
              {errors.key && <p id="model-key-error" className={errorCls}>{errors.key.message}</p>}
            </div>
          )}
        </div>
        {mode === 'create' && (
          <div>
            <SearchableSelect
              id="model-machine-type"
              label="Machine type"
              choices={choices}
              value={machineTypeId}
              onChange={(id) => setValue('machineTypeId', id, { shouldDirty: true, shouldValidate: true })}
              invalid={!!errors.machineTypeId}
              describedBy={errors.machineTypeId ? 'model-machine-type-error' : undefined}
            />
            {errors.machineTypeId && <p id="model-machine-type-error" className={errorCls}>{errors.machineTypeId.message}</p>}
          </div>
        )}
        {problem && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{problem}</p>}
      </div>
    </FormDialog>
  );
}
