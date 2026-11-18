'use client';

import { useMemo, useState, type MouseEvent } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { BrandWithModels } from '@mpm/shared-types';
import DataTable, { type Column } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/confirm-provider';
import { ApiError } from '@/lib/api';
import { deleteBrand, reorderBrands, updateBrand } from '@/lib/catalog-api';
import type { NodeChoice } from '@/lib/category-tree';
import { cn } from '@/lib/utils';
import { ActiveSwitch, Tag } from './active-switch';
import { BrandFormDialog } from './brand-form-dialog';

const REORDER_BTN = 'rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-40';
const CLEAR_TO_REORDER = 'Clear filters to reorder';

// Buttons in a row must not also select the row.
const stop = (e: MouseEvent) => e.stopPropagation();

interface BrandsTableProps {
  /** Every brand, in order, inactive ones included. */
  brands: BrandWithModels[];
  /** For the machine type filter. */
  machineTypes: NodeChoice[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /**
   * Reloads the brands after a saved change, or after STALE_ORDER. The reorder buttons stay
   * disabled until it resolves, so the next move starts from the order the server has.
   */
  onChanged: () => Promise<void> | void;
}

/**
 * The brands list (A4): flags, model count, review flag, active switch and order.
 * Reordering sends every brand id, so it is off while a filter hides any brand.
 */
export function BrandsTable({ brands, machineTypes, selectedId, onSelect, onChanged }: BrandsTableProps) {
  const confirm = useConfirm();
  const [machineTypeId, setMachineTypeId] = useState('');
  const [reviewOnly, setReviewOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<null | { mode: 'create' } | { mode: 'edit'; id: string }>(null);
  const filtering = machineTypeId !== '' || reviewOnly;

  const shown = useMemo(
    () => brands.filter((b) =>
      (!reviewOnly || b.needsReview) && (!machineTypeId || b.models.some((m) => m.machineTypeId === machineTypeId))),
    [brands, machineTypeId, reviewOnly],
  );

  const run = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      try {
        await work();
        if (done) toast.success(done);
      } catch (err) {
        const stale = err instanceof ApiError && err.code === 'STALE_ORDER';
        toast.error(stale ? 'Someone changed this list; reloaded' : err instanceof Error ? err.message : 'Could not save');
        // Only a stale list needs the reload; any other failure changed nothing.
        if (!stale) return;
      }
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const move = (id: string, delta: -1 | 1) => {
    if (filtering) return;
    // The full list, never the filtered one: the API wants every brand.
    const ids = brands.map((b) => b.id);
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    void run(() => reorderBrands(ids));
  };

  const remove = async (b: BrandWithModels) => {
    const ok = await confirm({
      title: `Delete ${b.name}?`,
      message: 'This cannot be undone. A brand with models cannot be deleted; switch it off instead.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteBrand(b.id);
      toast.success(`${b.name} deleted`);
      await onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'BRAND_IN_USE') {
        toast.error(`${b.name} is in use. Switch it off instead.`, { description: err.message });
      } else {
        toast.error(err instanceof Error ? err.message : 'Could not delete');
      }
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<BrandWithModels>[] = [
    {
      key: 'name',
      header: 'Brand',
      render: (b) => (
        <span className="flex flex-col items-start gap-0.5">
          <span className={cn('font-bold text-gray-900', !b.isActive && 'text-gray-500 line-through decoration-gray-300')}>{b.name}</span>
          <code className="font-mono text-xs text-gray-500">{b.key}</code>
          {b.needsReview && <Tag tone="amber">Needs review</Tag>}
        </span>
      ),
    },
    {
      key: 'flags',
      header: 'Makes',
      render: (b) => (
        <span className="flex flex-col items-start gap-1">
          {b.makesMachines && <Tag tone="brand">Makes machines</Tag>}
          {b.makesParts && <Tag tone="blue">Makes parts</Tag>}
        </span>
      ),
    },
    { key: 'models', header: 'Models', className: 'tnum', render: (b) => b.models.length },
    {
      key: 'isActive',
      header: 'Active',
      render: (b) => (
        <span onClick={stop}>
          <ActiveSwitch
            checked={b.isActive}
            label={`${b.name} active`}
            disabled={busy}
            onToggle={() => void run(() => updateBrand(b.id, { isActive: !b.isActive }), b.isActive ? 'Brand switched off' : 'Brand switched on')}
          />
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'w-1 text-right',
      render: (b) => {
        const i = brands.findIndex((x) => x.id === b.id);
        const first = i === 0;
        const last = i === brands.length - 1;
        return (
          <span className="inline-flex items-center gap-0.5" onClick={stop}>
            <Button variant="ghost" size="sm" aria-label={`Edit ${b.name}`} title="Edit" onClick={() => setDialog({ mode: 'edit', id: b.id })}>
              <Pencil size={13} />
            </Button>
            <button
              type="button"
              aria-label={`Move ${b.name} up`}
              title={filtering ? CLEAR_TO_REORDER : undefined}
              disabled={busy || filtering || first}
              onClick={() => move(b.id, -1)}
              className={cn(REORDER_BTN, !filtering && first && 'invisible')}
            >
              <ArrowUp size={13} />
            </button>
            <button
              type="button"
              aria-label={`Move ${b.name} down`}
              title={filtering ? CLEAR_TO_REORDER : undefined}
              disabled={busy || filtering || last}
              onClick={() => move(b.id, 1)}
              className={cn(REORDER_BTN, !filtering && last && 'invisible')}
            >
              <ArrowDown size={13} />
            </button>
            <button
              type="button"
              aria-label={`Delete ${b.name}`}
              title="Delete"
              disabled={busy}
              onClick={() => void remove(b)}
              className="rounded-md p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
            >
              <Trash2 size={13} />
            </button>
          </span>
        );
      },
    },
  ];

  const editing = dialog?.mode === 'edit' ? brands.find((b) => b.id === dialog.id) ?? null : null;

  return (
    <div>
      <DataTable
        columns={columns}
        data={shown}
        onRowClick={(b) => onSelect(b.id)}
        rowClassName={(b) => (b.id === selectedId ? 'bg-brand-50' : '')}
        emptyMessage={filtering ? 'No brand matches these filters' : 'No brands yet'}
        toolbar={
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label htmlFor="brands-machine-type" className="text-[12.5px] font-bold text-gray-600">Machine type</label>
              <select
                id="brands-machine-type"
                value={machineTypeId}
                onChange={(e) => setMachineTypeId(e.target.value)}
                className="h-8 max-w-[260px] rounded-xl border-0 bg-gray-100 py-0 text-sm font-semibold text-gray-900 focus:bg-white focus:ring-2 focus:ring-brand-600"
              >
                <option value="">All</option>
                {machineTypes.map((t) => <option key={t.id} value={t.id}>{t.label}{t.isActive ? '' : ' (off)'}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                className="rounded border-gray-300 text-brand-600"
                checked={reviewOnly}
                onChange={(e) => setReviewOnly(e.target.checked)}
              />
              Needs review only
            </label>
            {filtering && (
              <Button variant="ghost" size="sm" onClick={() => { setMachineTypeId(''); setReviewOnly(false); }}>Clear filters</Button>
            )}
            <span className="ml-auto text-[13px] text-gray-500 tnum">
              {filtering ? `${shown.length} of ${brands.length}` : `${brands.length}`} brands
            </span>
            <Button size="sm" onClick={() => setDialog({ mode: 'create' })}><Plus size={14} /> Add brand</Button>
          </div>
        }
      />
      {dialog?.mode === 'create' && (
        <BrandFormDialog
          mode="create"
          onClose={() => setDialog(null)}
          onSaved={async (b) => {
            setDialog(null);
            // Select once the reload shows the new brand: the page clears a selected id it doesn't know.
            await onChanged();
            onSelect(b.id);
          }}
        />
      )}
      {editing && (
        <BrandFormDialog
          key={editing.id}
          mode="edit"
          brand={editing}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); void onChanged(); }}
        />
      )}
    </div>
  );
}
