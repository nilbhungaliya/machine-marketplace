'use client';

import { useRef, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowDown, ArrowUp, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { CATALOG_KEY_REGEX, type Unit } from '@mpm/shared-types';
import DataTable, { type Column } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { FormDialog } from '@/components/ui/form-dialog';
import { ApiError } from '@/lib/api';
import { KEY_MESSAGE, toCatalogKey } from '@/lib/catalog-key';
import { cn } from '@/lib/utils';
import { inputCls, labelCls } from '@/components/ui/field-classes';

/** A master-data row: unit or condition (A4). */
export interface KeyedItem {
  id: string;
  key: string;
  label: string;
  isActive: boolean;
  description?: string | null;
}

export interface KeyedCreateInput<X = undefined> {
  key: string;
  label: string;
  description: string | null;
  /** From `extras`, e.g. a unit's decimal places. */
  extra: X;
}

export interface KeyedUpdatePatch<X = undefined> {
  label?: string;
  description?: string | null;
  isActive?: boolean;
  /** The whole extra value, when any of it changed. */
  extra?: X;
}

/** Extra inputs in the add/edit dialog, holding a value of type X (e.g. a unit's decimal places). */
export interface KeyedExtras<T, X> {
  /** Starting value; item is null when adding. */
  initial: (item: T | null) => X;
  render: (value: X, onChange: (next: X) => void) => ReactNode;
  same: (a: X, b: X) => boolean;
}

interface KeyedListEditorProps<T extends KeyedItem, X = undefined> {
  /** Singular, lower case: "unit", "condition". */
  noun: string;
  items: T[];
  /** Throw (e.g. an ApiError) to keep the dialog open; KEY_TAKEN shows under the key. */
  onCreate: (input: KeyedCreateInput<X>) => Promise<void>;
  /** Only the changed values. */
  onUpdate: (item: T, patch: KeyedUpdatePatch<X>) => Promise<void>;
  /**
   * Every id, in the new order. Resolve only once the reloaded list is in `items`: the
   * reorder buttons stay disabled until then, so the next move starts from the server's order.
   */
  onReorder: (orderedIds: string[]) => Promise<void>;
  /** Reloads the list; called when a reorder fails with STALE_ORDER (the list changed elsewhere). */
  onReload?: () => Promise<void> | void;
  /** Show and edit a description (conditions). */
  withDescription?: boolean;
  /** Columns between the label/description and the active switch. */
  extraColumns?: Column<T>[];
  extras?: KeyedExtras<T, X>;
  emptyMessage?: string;
}

export const DECIMAL_CHOICES = [0, 1, 2, 3] as const;

/** Units: how many decimal places a quantity in this unit may have (0 for pieces, 3 for kg). */
export const unitDecimalsColumn: Column<Unit> = {
  key: 'decimals',
  header: 'Decimals',
  className: 'tnum',
  render: (u) => u.decimals,
};

/** The Decimals select in a unit's add / edit dialog. */
export const unitDecimalsExtras: KeyedExtras<Unit, number> = {
  initial: (u) => u?.decimals ?? 0,
  same: (a, b) => a === b,
  render: (value, onChange) => (
    <div>
      <label htmlFor="unit-decimals" className="mb-1.5 block text-[12.5px] font-bold text-gray-600">Decimals</label>
      <select
        id="unit-decimals"
        className={inputCls}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {DECIMAL_CHOICES.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
      <p className="mt-1 text-[12.5px] text-gray-500">Decimal places a seller may type, e.g. 0 for pieces, 3 for kilograms.</p>
    </div>
  ),
};

/** An ordered master-data list: key, label, active switch, up/down; add and edit in a dialog. Keys never change. */
export function KeyedListEditor<T extends KeyedItem, X = undefined>({
  noun, items, onCreate, onUpdate, onReorder, onReload, withDescription = false, extraColumns = [], extras, emptyMessage,
}: KeyedListEditorProps<T, X>) {
  const [dialog, setDialog] = useState<null | { item: T | null }>(null);
  const [busy, setBusy] = useState(false);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
      if (err instanceof ApiError && err.code === 'STALE_ORDER') await onReload?.();
    } finally {
      setBusy(false);
    }
  };

  const move = (index: number, delta: -1 | 1) => {
    const ids = items.map((i) => i.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    void run(() => onReorder(ids));
  };

  const columns: Column<T>[] = [
    { key: 'key', header: 'Key', render: (r) => <code className="rounded bg-gray-100 px-[5px] py-px font-mono text-xs text-gray-600">{r.key}</code> },
    {
      key: 'label',
      header: 'Label',
      render: (r) => (
        <span className={cn('inline-flex items-center gap-2 font-bold text-gray-900', !r.isActive && 'text-gray-500')}>
          {r.label}
          {!r.isActive && <span className="inline-flex h-6 items-center rounded-full bg-gray-100 px-[9px] text-[13px] font-semibold text-gray-500">Off</span>}
        </span>
      ),
    },
    ...(withDescription
      ? [{
          key: 'description',
          header: 'Description',
          className: 'max-w-xs truncate',
          render: (r: T) => <span className="text-gray-500" title={r.description ?? undefined}>{r.description || '—'}</span>,
        }]
      : []),
    ...extraColumns,
    {
      key: 'isActive',
      header: 'Active',
      render: (r) => (
        <button
          type="button"
          role="switch"
          aria-checked={r.isActive}
          aria-label={`${r.label} active`}
          disabled={busy}
          onClick={() => void run(() => onUpdate(r, { isActive: !r.isActive }))}
          className={cn(
            'relative inline-flex h-6 w-10 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-1 disabled:opacity-50',
            r.isActive ? 'bg-brand-600' : 'bg-gray-200',
          )}
        >
          <span className={cn('inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform', r.isActive ? 'translate-x-[19px]' : 'translate-x-[3px]')} />
        </button>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'w-1 text-right',
      render: (r) => {
        const i = items.findIndex((x) => x.id === r.id);
        return (
          <span className="inline-flex items-center gap-1">
            <Button variant="ghost" size="sm" aria-label={`Edit ${r.label}`} onClick={() => setDialog({ item: r })}>
              <Pencil size={13} /> Edit
            </Button>
            <button type="button" aria-label={`Move ${r.label} up`} disabled={busy || i === 0} onClick={() => move(i, -1)}
              className={cn('rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-40', i === 0 && 'invisible')}>
              <ArrowUp size={13} />
            </button>
            <button type="button" aria-label={`Move ${r.label} down`} disabled={busy || i === items.length - 1} onClick={() => move(i, 1)}
              className={cn('rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-40', i === items.length - 1 && 'invisible')}>
              <ArrowDown size={13} />
            </button>
          </span>
        );
      },
    },
  ];

  return (
    <div>
      <div className="mb-2.5 flex justify-end">
        <Button size="sm" onClick={() => setDialog({ item: null })}><Plus size={14} /> Add {noun}</Button>
      </div>
      <DataTable columns={columns} data={items} emptyMessage={emptyMessage ?? `No ${noun}s yet`} />
      {dialog && (
        <KeyedItemDialog
          noun={noun}
          item={dialog.item}
          withDescription={withDescription}
          extras={extras}
          onClose={() => setDialog(null)}
          onSubmit={async (v) => {
            if (!dialog.item) {
              await onCreate(v);
              toast.success(`${noun[0].toUpperCase()}${noun.slice(1)} added`);
            } else {
              const it = dialog.item;
              const patch: KeyedUpdatePatch<X> = {};
              if (v.label !== it.label) patch.label = v.label;
              if (withDescription && v.description !== (it.description ?? null)) patch.description = v.description;
              if (extras && !extras.same(v.extra, extras.initial(it))) patch.extra = v.extra;
              if (Object.keys(patch).length) {
                await onUpdate(it, patch);
                toast.success('Saved');
              }
            }
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

const schemaFor = (creating: boolean) =>
  z.object({
    key: creating ? z.string().trim().regex(CATALOG_KEY_REGEX, KEY_MESSAGE) : z.string(),
    label: z.string().trim().min(1, 'Enter a label').max(120, 'At most 120 characters'),
    description: z.string().trim().max(500, 'At most 500 characters'),
  });
type Values = z.infer<ReturnType<typeof schemaFor>>;

function KeyedItemDialog<T extends KeyedItem, X>({
  noun, item, withDescription, extras, onClose, onSubmit,
}: {
  noun: string;
  item: T | null;
  withDescription: boolean;
  extras?: KeyedExtras<T, X>;
  onClose: () => void;
  onSubmit: (v: KeyedCreateInput<X>) => Promise<void>;
}) {
  const creating = item === null;
  const keyTouched = useRef(false);
  // Without `extras`, X is undefined (the default on KeyedListEditor).
  const [extraStart] = useState(() => extras?.initial(item) as X);
  const [extra, setExtra] = useState<X>(extraStart);
  const { register, handleSubmit, setError, setValue, formState: { errors, isDirty, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schemaFor(creating)),
    defaultValues: { key: item?.key ?? '', label: item?.label ?? '', description: item?.description ?? '' },
  });

  const save = async (v: Values) => {
    try {
      await onSubmit({ key: v.key, label: v.label, description: v.description === '' ? null : v.description, extra });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'KEY_TAKEN') setError('key', { message: 'This key is already in use' });
      else toast.error(err instanceof Error ? err.message : 'Could not save');
    }
  };

  return (
    <FormDialog
      open
      onClose={onClose}
      title={creating ? `Add ${noun}` : `Edit ${noun}`}
      dirty={isDirty || (extras ? !extras.same(extra, extraStart) : false)}
      submitting={isSubmitting}
      submitLabel={creating ? 'Add' : 'Save'}
      onSubmit={handleSubmit(save)}
    >
      <div className="space-y-4">
        {!creating && (
          <p className="text-sm text-gray-500">
            Key <code className="rounded bg-gray-100 px-[5px] py-px font-mono text-xs text-gray-600">{item.key}</code>
            <span className="ml-1 text-xs text-gray-500">(fixed once created)</span>
          </p>
        )}
        <div>
          <label htmlFor="keyed-label" className={labelCls}>Label</label>
          <input
            id="keyed-label"
            className={inputCls}
            autoComplete="off"
            {...register('label', {
              onChange: (e: { target: { value: string } }) => {
                if (creating && !keyTouched.current) setValue('key', toCatalogKey(e.target.value), { shouldDirty: true });
              },
            })}
          />
          {errors.label && <p className="mt-1 text-xs font-semibold text-red-600">{errors.label.message}</p>}
        </div>
        {creating && (
          <div>
            <label htmlFor="keyed-key" className={labelCls}>Key</label>
            <input
              id="keyed-key"
              className={`${inputCls} font-mono`}
              autoComplete="off"
              spellCheck={false}
              {...register('key', { onChange: () => { keyTouched.current = true; } })}
            />
            {errors.key && <p className="mt-1 text-xs font-semibold text-red-600">{errors.key.message}</p>}
          </div>
        )}
        {withDescription && (
          <div>
            <label htmlFor="keyed-description" className={labelCls}>Description <span className="font-normal text-gray-500">(optional)</span></label>
            <textarea id="keyed-description" rows={3} className={inputCls} {...register('description')} />
            {errors.description && <p className="mt-1 text-xs font-semibold text-red-600">{errors.description.message}</p>}
          </div>
        )}
        {extras?.render(extra, setExtra)}
      </div>
    </FormDialog>
  );
}
