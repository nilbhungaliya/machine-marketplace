'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, FolderInput, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Brand, BrandWithModels, CategoryNode, MachineModel } from '@mpm/shared-types';
import { Button } from '@/components/ui/button';
import { FormDialog } from '@/components/ui/form-dialog';
import { useConfirm } from '@/components/confirm-provider';
import { ApiError } from '@/lib/api';
import { deleteModel, moveModel, reorderModels, updateModel } from '@/lib/catalog-api';
import { machineTypeChoices, type NodeChoice } from '@/lib/category-tree';
import { cn } from '@/lib/utils';
import { ActiveSwitch, Tag } from './active-switch';
import { ModelFormDialog } from './model-form-dialog';
import { SearchableSelect } from './searchable-select';

const REORDER_BTN = 'rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-40';

type DialogState = null | { kind: 'create' } | { kind: 'edit'; id: string } | { kind: 'move'; id: string };

/** The selected brand's models (A4): machine type, review flag, active, order, move and delete. */
export function ModelsPanel({ brand, brands, tree, onChanged }: {
  brand: BrandWithModels;
  /** Every brand, for Move. */
  brands: Brand[];
  tree: CategoryNode[];
  /** Reloads the brands; resolves once the new list is shown (reorder stays disabled until then). */
  onChanged: () => Promise<void> | void;
}) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const choices = useMemo(() => machineTypeChoices(tree), [tree]);
  const typeName = (id: string) => choices.find((c) => c.id === id)?.label ?? 'Unknown machine type';
  const models = brand.models;

  const run = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      try {
        await work();
        if (done) toast.success(done);
      } catch (err) {
        const stale = err instanceof ApiError && err.code === 'STALE_ORDER';
        toast.error(stale ? 'Someone changed this list; reloaded' : err instanceof Error ? err.message : 'Could not save');
        if (!stale) return;
      }
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const move = (index: number, delta: -1 | 1) => {
    const ids = models.map((m) => m.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    void run(() => reorderModels(brand.id, ids));
  };

  const remove = async (m: MachineModel) => {
    const ok = await confirm({
      title: `Delete ${m.name}?`,
      message: 'This cannot be undone. A model that listings use cannot be deleted; switch it off instead.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    await run(() => deleteModel(m.id), `${m.name} deleted`);
  };

  const target = dialog && dialog.kind !== 'create' ? models.find((m) => m.id === dialog.id) ?? null : null;

  return (
    <div className="rounded-[20px] border border-gray-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-extrabold text-gray-900">{brand.name}</h2>
          <div className="mt-1 flex flex-wrap gap-1">
            {brand.makesMachines && <Tag tone="brand">Makes machines</Tag>}
            {brand.makesParts && <Tag tone="blue">Makes parts</Tag>}
            {brand.needsReview && <Tag tone="amber">Needs review</Tag>}
            {!brand.isActive && <Tag>Off</Tag>}
          </div>
        </div>
        <Button
          size="sm"
          disabled={!brand.makesMachines}
          title={brand.makesMachines ? undefined : 'Only brands that make machines have models'}
          onClick={() => setDialog({ kind: 'create' })}
        >
          <Plus size={14} /> Add model
        </Button>
      </div>
      <div className="p-3">
        {!brand.makesMachines && models.length === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-gray-500">
            {brand.name} makes parts only, so it has no machine models. Tick &quot;Makes machines&quot; on the brand to add some.
          </p>
        ) : (
          <ModelList
            models={models}
            busy={busy}
            typeName={typeName}
            onEdit={(m) => setDialog({ kind: 'edit', id: m.id })}
            onMoveTo={(m) => setDialog({ kind: 'move', id: m.id })}
            onReorder={move}
            onRemove={(m) => void remove(m)}
            onToggleReview={(m) => void run(
              () => updateModel(m.id, { needsReview: !m.needsReview }),
              m.needsReview ? 'Marked as reviewed' : 'Marked for review',
            )}
            onToggleActive={(m) => void run(
              () => updateModel(m.id, { isActive: !m.isActive }),
              m.isActive ? 'Model switched off' : 'Model switched on',
            )}
            emptyMessage={`No ${brand.name} models yet`}
          />
        )}
      </div>

      {dialog?.kind === 'create' && (
        <ModelFormDialog
          mode="create"
          brand={brand}
          tree={tree}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); void onChanged(); }}
        />
      )}
      {dialog?.kind === 'edit' && target && (
        <ModelFormDialog
          key={target.id}
          mode="edit"
          brand={brand}
          model={target}
          tree={tree}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); void onChanged(); }}
        />
      )}
      {dialog?.kind === 'move' && target && (
        <MoveModelDialog
          model={target}
          brands={brands}
          choices={choices}
          onClose={() => setDialog(null)}
          onMoved={() => { setDialog(null); void onChanged(); }}
        />
      )}
    </div>
  );
}

/** One row per model: name, key and machine type; review flag, active switch, edit, move, order, delete. */
function ModelList({ models, busy, typeName, onEdit, onMoveTo, onReorder, onRemove, onToggleReview, onToggleActive, emptyMessage }: {
  models: MachineModel[];
  busy: boolean;
  typeName: (id: string) => string;
  onEdit: (m: MachineModel) => void;
  onMoveTo: (m: MachineModel) => void;
  onReorder: (index: number, delta: -1 | 1) => void;
  onRemove: (m: MachineModel) => void;
  onToggleReview: (m: MachineModel) => void;
  onToggleActive: (m: MachineModel) => void;
  emptyMessage: string;
}) {
  if (models.length === 0) return <p className="px-1 py-6 text-center text-sm text-gray-500">{emptyMessage}</p>;
  return (
    <ul aria-label="Models" className="divide-y divide-gray-200 overflow-hidden rounded-2xl border border-gray-200">
      {models.map((m, i) => {
        const type = typeName(m.machineTypeId);
        return (
          <li key={m.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5', !m.isActive && 'bg-gray-50')}>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-1.5">
                <span className={cn('font-bold text-gray-900', !m.isActive && 'text-gray-500 line-through decoration-gray-300')}>{m.name}</span>
                <code className="font-mono text-xs text-gray-500">{m.key}</code>
              </p>
              <p className="truncate text-[13px] text-gray-500" title={type}>{type}</p>
            </div>
            <label className="flex items-center gap-1.5 text-[13px] text-gray-700">
              <input
                type="checkbox"
                className="rounded border-gray-300 text-brand-600"
                aria-label={`${m.name} needs review`}
                checked={m.needsReview}
                disabled={busy}
                onChange={() => onToggleReview(m)}
              />
              Needs review
            </label>
            <ActiveSwitch checked={m.isActive} label={`${m.name} active`} disabled={busy} onToggle={() => onToggleActive(m)} />
            <span className="inline-flex items-center gap-0.5">
              <Button variant="ghost" size="sm" aria-label={`Edit ${m.name}`} title="Edit" onClick={() => onEdit(m)}>
                <Pencil size={13} />
              </Button>
              <Button variant="ghost" size="sm" aria-label={`Move ${m.name} to another brand or machine type`} title="Move" onClick={() => onMoveTo(m)}>
                <FolderInput size={13} />
              </Button>
              <button type="button" aria-label={`Move ${m.name} up`} disabled={busy || i === 0} onClick={() => onReorder(i, -1)}
                className={cn(REORDER_BTN, i === 0 && 'invisible')}>
                <ArrowUp size={13} />
              </button>
              <button type="button" aria-label={`Move ${m.name} down`} disabled={busy || i === models.length - 1} onClick={() => onReorder(i, 1)}
                className={cn(REORDER_BTN, i === models.length - 1 && 'invisible')}>
                <ArrowDown size={13} />
              </button>
              <button type="button" aria-label={`Delete ${m.name}`} title="Delete" disabled={busy} onClick={() => onRemove(m)}
                className="rounded-md p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-40">
                <Trash2 size={13} />
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Moves a model to another brand (one that makes machines), another machine type, or both. */
function MoveModelDialog({ model, brands, choices, onClose, onMoved }: {
  model: MachineModel;
  brands: Brand[];
  choices: NodeChoice[];
  onClose: () => void;
  onMoved: () => void;
}) {
  const [brandId, setBrandId] = useState(model.brandId);
  const [machineTypeId, setMachineTypeId] = useState(model.machineTypeId);
  const [errors, setErrors] = useState<{ brand?: string; machineType?: string; form?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const makers = brands.filter((b) => b.makesMachines || b.id === model.brandId);
  const dirty = brandId !== model.brandId || machineTypeId !== model.machineTypeId;

  const submit = async () => {
    if (!dirty) { setErrors({ form: 'Choose another brand or machine type' }); return; }
    if (!machineTypeId) { setErrors({ machineType: 'Choose a machine type' }); return; }
    setSubmitting(true);
    setErrors({});
    try {
      await moveModel(model.id, {
        ...(brandId !== model.brandId ? { brandId } : {}),
        ...(machineTypeId !== model.machineTypeId ? { machineTypeId } : {}),
      });
      toast.success(`${model.name} moved`);
      onMoved();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      const brandName = brands.find((b) => b.id === brandId)?.name ?? 'That brand';
      if (code === 'NAME_TAKEN') setErrors({ form: `${brandName} already has a model called ${model.name} for that machine type` });
      else if (code === 'KEY_TAKEN') setErrors({ brand: `${brandName} already has a model with the key ${model.key}` });
      else if (code === 'BRAND_NOT_MACHINE_MAKER') setErrors({ brand: `${brandName} is not marked as making machines` });
      else if (code === 'NOT_A_MACHINE_TYPE') setErrors({ machineType: 'Models belong to a machine type' });
      else setErrors({ form: err instanceof Error ? err.message : 'Could not move' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormDialog
      open
      onClose={onClose}
      title={`Move ${model.name}`}
      description="To another brand, another machine type, or both."
      dirty={dirty}
      submitting={submitting}
      submitLabel="Move"
      onSubmit={submit}
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="move-model-brand" className="mb-1.5 block text-[12.5px] font-bold text-gray-600">Brand</label>
          <select
            id="move-model-brand"
            className="w-full rounded-xl border-0 bg-gray-100 text-sm font-semibold text-gray-900 placeholder:text-gray-400 focus:bg-white focus:ring-2 focus:ring-brand-600"
            value={brandId}
            aria-describedby={errors.brand ? 'move-model-brand-error' : undefined}
            onChange={(e) => { setBrandId(e.target.value); setErrors({}); }}
          >
            {makers.map((b) => <option key={b.id} value={b.id}>{b.name}{b.isActive ? '' : ' (off)'}</option>)}
          </select>
          {errors.brand && <p id="move-model-brand-error" className="mt-1 text-xs font-semibold text-red-600">{errors.brand}</p>}
        </div>
        <div>
          <SearchableSelect
            id="move-model-type"
            label="Machine type"
            choices={choices}
            value={machineTypeId}
            onChange={(id) => { setMachineTypeId(id); setErrors({}); }}
            invalid={!!errors.machineType}
            describedBy={errors.machineType ? 'move-model-type-error' : undefined}
          />
          {errors.machineType && <p id="move-model-type-error" className="mt-1 text-xs font-semibold text-red-600">{errors.machineType}</p>}
        </div>
        {errors.form && <p role="alert" className="text-xs font-semibold text-red-600">{errors.form}</p>}
      </div>
    </FormDialog>
  );
}
