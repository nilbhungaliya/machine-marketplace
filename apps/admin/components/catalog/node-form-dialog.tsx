'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { CATEGORY_ICONS, type CategoryIcon, type CategoryNode } from '@mpm/shared-types';
import { FormDialog } from '@/components/ui/form-dialog';
import { ApiError } from '@/lib/api';
import { createCategory, updateCategory, type UpdateCategoryPatch } from '@/lib/catalog-api';
import { LEVEL_LABELS, childLevel } from '@/lib/category-tree';

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG_MSG = 'Lowercase letters, digits and single hyphens';

const base = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(120, 'At most 120 characters'),
  slug: z.string().trim().max(80, 'At most 80 characters'),
  icon: z.string(),
});
type Values = z.infer<typeof base>;

const schemaFor = (mode: 'create' | 'edit') =>
  base.superRefine((v, ctx) => {
    // Blank on create: the API derives it from the name.
    if (v.slug === '' && mode === 'edit') ctx.addIssue({ code: 'custom', path: ['slug'], message: 'Enter a slug' });
    else if (v.slug !== '' && !SLUG_RE.test(v.slug)) ctx.addIssue({ code: 'custom', path: ['slug'], message: SLUG_MSG });
  });

export type NodeFormDialogProps =
  | { mode: 'create'; parent: CategoryNode | null; onClose: () => void; onSaved: (node: CategoryNode) => void }
  | { mode: 'edit'; node: CategoryNode; onClose: () => void; onSaved: (node: CategoryNode) => void };

const inputCls = 'w-full rounded-lg border-gray-300 text-sm';
const labelCls = 'mb-1.5 block text-[13.5px] font-semibold text-gray-900';

/** Add a category / machine type / part group, or edit a node's name and slug. Mount it to open it. */
export function NodeFormDialog(props: NodeFormDialogProps) {
  const { mode, onClose, onSaved } = props;
  const node = mode === 'edit' ? props.node : null;
  const level = mode === 'create'
    ? (props.parent ? childLevel(props.parent.level) ?? 'part_group' : 'machine_category')
    : node!.level;
  const isCategory = level === 'machine_category';

  const { register, handleSubmit, setError, formState: { errors, isDirty, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schemaFor(mode)),
    defaultValues: { name: node?.name ?? '', slug: node?.slug ?? '', icon: node?.icon ?? '' },
  });

  const what = LEVEL_LABELS[level];

  const save = async (v: Values) => {
    try {
      let saved: CategoryNode;
      if (mode === 'create') {
        saved = await createCategory({
          parentId: props.parent?.id ?? null,
          name: v.name,
          ...(v.slug ? { slug: v.slug } : {}),
          ...(isCategory && v.icon ? { icon: v.icon as CategoryIcon } : {}),
        });
        toast.success(`${what} added`);
      } else {
        const patch: UpdateCategoryPatch = {};
        if (v.name !== node!.name) patch.name = v.name;
        if (v.slug !== node!.slug) patch.slug = v.slug;
        if (Object.keys(patch).length === 0) { onClose(); return; }
        saved = await updateCategory(node!.id, patch);
        toast.success('Saved');
      }
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SLUG_TAKEN') {
        setError('slug', { message: 'Another node under the same parent already uses this slug' });
        return;
      }
      toast.error(err instanceof Error ? err.message : 'Could not save');
    }
  };

  return (
    <FormDialog
      open
      onClose={onClose}
      title={mode === 'create' ? `Add ${what.toLowerCase()}` : `Edit ${node!.name}`}
      description={mode === 'create' && props.parent ? `Under ${props.parent.name}` : undefined}
      dirty={isDirty}
      submitting={isSubmitting}
      submitLabel={mode === 'create' ? 'Add' : 'Save'}
      onSubmit={handleSubmit(save)}
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="node-name" className={labelCls}>Name</label>
          <input id="node-name" className={inputCls} autoComplete="off" {...register('name')} />
          {errors.name && <p className="mt-1 text-xs text-red-700">{errors.name.message}</p>}
        </div>
        <div>
          <label htmlFor="node-slug" className={labelCls}>Slug</label>
          <input
            id="node-slug"
            className={inputCls}
            autoComplete="off"
            placeholder={mode === 'create' ? 'Leave blank to make one from the name' : undefined}
            {...register('slug')}
          />
          {errors.slug
            ? <p className="mt-1 text-xs text-red-700">{errors.slug.message}</p>
            : mode === 'edit' && <p className="mt-1 text-[12.5px] text-gray-500">Changing it changes the path of this node and everything under it.</p>}
        </div>
        {mode === 'create' && isCategory && (
          <div>
            <label htmlFor="node-icon" className={labelCls}>Icon</label>
            <select id="node-icon" className={inputCls} {...register('icon')}>
              <option value="">None</option>
              {CATEGORY_ICONS.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
        )}
        {mode === 'create' && !isCategory && (
          <p className="text-[12.5px] text-gray-500">It inherits the side settings and fields of {props.parent?.name}; change them once it exists.</p>
        )}
      </div>
    </FormDialog>
  );
}
