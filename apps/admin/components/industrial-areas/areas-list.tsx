'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { IndustrialArea } from '@mpm/shared-types';
import { ActiveSwitch, Tag } from '@/components/catalog/active-switch';
import { useConfirm } from '@/components/confirm-provider';
import DataTable, { type Column } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { FormDialog } from '@/components/ui/form-dialog';
import { ApiError } from '@/lib/api';
import { createArea, deleteArea, reorderAreas, updateArea } from '@/lib/industrial-areas-api';
import { cn } from '@/lib/utils';

const IN_USE_MESSAGE = 'Businesses use this area. Turn it off instead.';

/**
 * One city's industrial areas (F1 spec §4.3, §8.3), in the app picker's order: rename, on / off (off hides it from the
 * picker; businesses keep it), up / down, delete while unused. As A4's keyed-list-editor.
 */
export function AreasList({ areas, city, state, onChanged }: {
  /** The city's areas, inactive ones included, in order. */
  areas: IndustrialArea[];
  city: string;
  state: string;
  /** Reloads the areas; resolves once the new list is in `areas`. */
  onChanged: () => Promise<void>;
}) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<IndustrialArea | null>(null);
  // Areas the API refused to delete: their Delete stays off with the reason.
  const [inUse, setInUse] = useState<Set<string>>(() => new Set());

  const run = async (work: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    try {
      await work();
      if (success) toast.success(success);
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
      if (err instanceof ApiError && err.code === 'STALE_ORDER') await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const move = (index: number, delta: -1 | 1) => {
    const ids = areas.map((a) => a.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    void run(() => reorderAreas({ city, state, ids }));
  };

  const remove = async (area: IndustrialArea) => {
    const ok = await confirm({
      title: `Delete ${area.name}?`,
      message: 'Only an area no business uses can be deleted.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteArea(area.id);
      toast.success('Area deleted');
      await onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'AREA_IN_USE') {
        setInUse((prev) => new Set(prev).add(area.id));
        toast.error(IN_USE_MESSAGE);
      } else {
        toast.error(err instanceof Error ? err.message : 'Could not delete');
      }
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<IndustrialArea>[] = [
    {
      key: 'name',
      header: 'Area',
      render: (a) => (
        <span className={cn('inline-flex items-center gap-2 font-bold text-gray-900', !a.isActive && 'text-gray-500')}>
          {a.name}
          {!a.isActive && <Tag>Off</Tag>}
        </span>
      ),
    },
    {
      key: 'isActive',
      header: 'Active',
      render: (a) => (
        <ActiveSwitch
          checked={a.isActive}
          label={`${a.name} active`}
          disabled={busy}
          onToggle={() => void run(() => updateArea(a.id, { isActive: !a.isActive }), a.isActive ? 'Hidden from the picker' : 'Shown in the picker')}
        />
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'w-1 text-right',
      render: (a) => {
        const i = areas.findIndex((x) => x.id === a.id);
        const locked = inUse.has(a.id);
        return (
          <span className="inline-flex items-center gap-1">
            <Button variant="ghost" size="sm" aria-label={`Rename ${a.name}`} onClick={() => setRenaming(a)}>
              <Pencil size={13} aria-hidden /> Rename
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Delete ${a.name}`}
              title={locked ? IN_USE_MESSAGE : undefined}
              disabled={busy || locked}
              onClick={() => void remove(a)}
            >
              <Trash2 size={13} aria-hidden /> Delete
            </Button>
            <button type="button" aria-label={`Move ${a.name} up`} disabled={busy || i === 0} onClick={() => move(i, -1)}
              className={cn('rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-40', i === 0 && 'invisible')}>
              <ArrowUp size={13} />
            </button>
            <button type="button" aria-label={`Move ${a.name} down`} disabled={busy || i === areas.length - 1} onClick={() => move(i, 1)}
              className={cn('rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-40', i === areas.length - 1 && 'invisible')}>
              <ArrowDown size={13} />
            </button>
          </span>
        );
      },
    },
  ];

  return (
    <>
      <DataTable columns={columns} data={areas} emptyMessage="No areas in this city yet" />
      {areas.some((a) => inUse.has(a.id)) && (
        <p className="mt-2 text-[13px] text-gray-600">{IN_USE_MESSAGE}</p>
      )}
      {renaming && (
        <AreaFormDialog
          area={renaming}
          onClose={() => setRenaming(null)}
          onSaved={() => onChanged()}
        />
      )}
    </>
  );
}

const nameField = z.string().trim().min(2, 'At least 2 characters').max(80, 'At most 80 characters');
const placeField = (what: string) => z.string().trim().min(1, `Enter the ${what}`).max(80, 'At most 80 characters');
const schema = z.object({ name: nameField, city: placeField('city'), state: placeField('state') });
type Values = z.infer<typeof schema>;

const inputCls = 'w-full rounded-lg border-gray-300 text-sm';
const labelCls = 'mb-1.5 block text-[13.5px] font-semibold text-gray-900';

/**
 * Add an area (name, city, state: a new city starts its own list) or rename one (name only). City and state follow
 * the pincode directory's spelling, e.g. "Surat", "Gujarat", so the app's picker finds the area by pincode.
 */
export function AreaFormDialog({ area, start, onClose, onSaved }: {
  /** Renaming this area; absent: adding one. */
  area?: IndustrialArea;
  /** City and state to start from when adding. */
  start?: { city: string; state: string };
  onClose: () => void;
  onSaved: (area: IndustrialArea) => Promise<void> | void;
}) {
  const { register, handleSubmit, setError, formState: { errors, isDirty, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: area?.name ?? '', city: area?.city ?? start?.city ?? '', state: area?.state ?? start?.state ?? '' },
  });

  const save = async (v: Values) => {
    try {
      let saved: IndustrialArea;
      if (area) {
        saved = v.name.trim() !== area.name ? await updateArea(area.id, { name: v.name.trim() }) : area;
        toast.success('Saved');
      } else {
        saved = await createArea({ name: v.name.trim(), city: v.city.trim(), state: v.state.trim() });
        toast.success('Area added');
      }
      await onSaved(saved);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NAME_TAKEN') setError('name', { message: 'This city already has an area with that name' });
      else toast.error(err instanceof Error ? err.message : 'Could not save');
    }
  };

  return (
    <FormDialog
      open
      onClose={onClose}
      title={area ? `Rename ${area.name}` : 'Add an industrial area'}
      description={area ? `${area.city}, ${area.state}` : 'It goes last in its city. Use the city and state as the pincode directory spells them.'}
      dirty={isDirty}
      submitting={isSubmitting}
      submitLabel={area ? 'Save' : 'Add'}
      onSubmit={handleSubmit(save)}
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="area-name" className={labelCls}>Name</label>
          <input id="area-name" className={inputCls} autoComplete="off" {...register('name')} />
          {errors.name && <p className="mt-1 text-xs text-red-700">{errors.name.message}</p>}
        </div>
        {!area && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="area-city" className={labelCls}>City (district)</label>
              <input id="area-city" className={inputCls} autoComplete="off" {...register('city')} />
              {errors.city && <p className="mt-1 text-xs text-red-700">{errors.city.message}</p>}
            </div>
            <div>
              <label htmlFor="area-state" className={labelCls}>State</label>
              <input id="area-state" className={inputCls} autoComplete="off" {...register('state')} />
              {errors.state && <p className="mt-1 text-xs text-red-700">{errors.state.message}</p>}
            </div>
          </div>
        )}
      </div>
    </FormDialog>
  );
}
