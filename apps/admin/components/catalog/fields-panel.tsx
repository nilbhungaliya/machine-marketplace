'use client';

import { useState } from 'react';
import {
  ArrowDown, ArrowUp, Calendar, CheckSquare, CircleDot, Hash, Lock, Pencil, Plus, Type, type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AdminCategoryDetail, CategoryNode, TemplateField } from '@mpm/shared-types';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/confirm-provider';
import { ApiError } from '@/lib/api';
import { reorderFields, updateField } from '@/lib/catalog-api';
import { LEVEL_LABELS, findNode } from '@/lib/category-tree';
import { cn } from '@/lib/utils';
import {
  APPLIES_TO_LABELS, FIELD_TYPE_LABELS, FieldFormDialog, RequiredSelectWarning, hasNoActiveOptions, isSelect,
} from './field-form-dialog';

type DialogState = null | { mode: 'create' } | { mode: 'edit'; fieldId: string };

/**
 * The node's template fields (A4): its own, then those inherited from its category / machine
 * type (read-only). Fields are never deleted, only retired.
 */
export function FieldsPanel({ detail, tree, onChanged }: {
  detail: AdminCategoryDetail;
  /** To name the nodes inherited fields come from. */
  tree: CategoryNode[];
  /**
   * Reloads the detail after any saved change, or after STALE_ORDER. Reorder buttons stay
   * disabled until it resolves, so the next move starts from the order the server has.
   */
  onChanged: () => Promise<void> | void;
}) {
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);
  const { node, ownFields, inheritedFields } = detail;

  // Inherited fields arrive category first; keep that order per source node.
  const groups: Array<{ categoryId: string; fields: TemplateField[] }> = [];
  for (const f of inheritedFields) {
    const last = groups[groups.length - 1];
    if (last?.categoryId === f.categoryId) last.fields.push(f);
    else groups.push({ categoryId: f.categoryId, fields: [f] });
  }

  const run = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      try {
        await work();
        if (done) toast.success(done);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not save');
        // Only a stale list needs the reload; any other failure changed nothing.
        if (!(err instanceof ApiError && err.code === 'STALE_ORDER')) return;
      }
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = async (f: TemplateField) => {
    const retiring = f.status === 'active';
    const ok = await confirm(retiring
      ? {
          title: `Retire ${f.label}?`,
          message: 'Sellers stop seeing it on new listings. Values already saved on listings are kept. You can reactivate it later.',
          confirmLabel: 'Retire',
          variant: 'danger',
        }
      : { title: `Reactivate ${f.label}?`, message: 'Sellers see it again.', confirmLabel: 'Reactivate' });
    if (!ok) return;
    await run(() => updateField(f.id, { status: retiring ? 'retired' : 'active' }), retiring ? 'Field retired' : 'Field reactivated');
  };

  const move = (index: number, delta: -1 | 1) => {
    const ids = ownFields.map((f) => f.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    void run(() => reorderFields(node.id, ids));
  };

  const editing = dialog?.mode === 'edit' ? ownFields.find((f) => f.id === dialog.fieldId) ?? null : null;

  return (
    <div className="space-y-6">
      {groups.map((g) => {
        const from = findNode(tree, g.categoryId);
        return (
          <section key={g.categoryId} aria-label={`Inherited from ${from?.name ?? 'a parent'}`}>
            <div className="mb-3">
              <h3 className="flex items-center gap-2 text-base font-bold text-gray-900">
                <Lock size={13} aria-hidden className="text-gray-500" />
                From {from?.name ?? 'a parent category'}
                {from && <span className="text-[13px] font-normal text-gray-500">({LEVEL_LABELS[from.level].toLowerCase()})</span>}
                <span className="text-[13px] font-normal text-gray-500 tnum">{g.fields.length}</span>
              </h3>
              <p className="mt-0.5 text-[13px] text-gray-500">Inherited, so sellers see these first. Edit them on {from?.name ?? 'the parent'}.</p>
            </div>
            <ul className="divide-y divide-gray-200 overflow-hidden rounded-[10px] border border-gray-200 bg-gray-50">
              {g.fields.map((f) => <FieldRow key={f.id} field={f} />)}
            </ul>
          </section>
        );
      })}

      <section aria-label="Own fields">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-gray-900">
              On this {LEVEL_LABELS[node.level].toLowerCase()}
              <span className="ml-1.5 text-gray-500 tnum">{ownFields.length}</span>
            </h3>
            <p className="mt-0.5 text-[13px] text-gray-500">Sellers fill these in this order, after the inherited ones above. Fields are retired, never deleted.</p>
          </div>
          <Button size="sm" onClick={() => setDialog({ mode: 'create' })}><Plus size={14} /> Add field</Button>
        </div>
        {ownFields.length === 0 ? (
          <div className="rounded-[10px] border border-dashed border-gray-300 px-4 py-8 text-center">
            <p className="text-base font-bold text-gray-900">No fields on this {LEVEL_LABELS[node.level].toLowerCase()} yet</p>
            <p className="mt-1 text-sm text-gray-500">Add one for each detail a seller should give, e.g. number of heads, hook type or needle size.</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-200 overflow-hidden rounded-[10px] border border-gray-200">
            {ownFields.map((f, i) => (
              <FieldRow key={f.id} field={f}>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDialog({ mode: 'edit', fieldId: f.id })}>
                  <Pencil size={13} /> Edit
                </Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void toggleStatus(f)}>
                  {f.status === 'active' ? 'Retire' : 'Reactivate'}
                </Button>
                <button type="button" aria-label={`Move ${f.label} up`} disabled={busy || i === 0} onClick={() => move(i, -1)}
                  className={cn('rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-40', i === 0 && 'invisible')}>
                  <ArrowUp size={13} />
                </button>
                <button type="button" aria-label={`Move ${f.label} down`} disabled={busy || i === ownFields.length - 1} onClick={() => move(i, 1)}
                  className={cn('rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-40', i === ownFields.length - 1 && 'invisible')}>
                  <ArrowDown size={13} />
                </button>
              </FieldRow>
            ))}
          </ul>
        )}
      </section>

      {dialog?.mode === 'create' && (
        <FieldFormDialog
          mode="create"
          categoryId={node.id}
          nodeLevel={node.level}
          onClose={() => setDialog(null)}
          // A new select field has no options yet: go straight on to adding them.
          onSaved={(f) => { void onChanged(); setDialog(isSelect(f) ? { mode: 'edit', fieldId: f.id } : null); }}
        />
      )}
      {editing && (
        <FieldFormDialog
          key={editing.id}
          mode="edit"
          field={editing}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); void onChanged(); }}
          onOptionsChanged={onChanged}
        />
      )}
    </div>
  );
}

const TYPE_ICONS: Record<TemplateField['type'], LucideIcon> = {
  single_select: CircleDot,
  multi_select: CheckSquare,
  number: Hash,
  text: Type,
  date: Calendar,
};

function FieldRow({ field: f, children }: { field: TemplateField; children?: React.ReactNode }) {
  const retired = f.status === 'retired';
  const Icon = TYPE_ICONS[f.type];
  const options = isSelect(f) ? f.options.filter((o) => o.status === 'active').length : null;
  return (
    <li className={cn('group flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-[11px] transition-colors hover:bg-gray-50', retired && 'opacity-60')}>
      <span
        aria-hidden
        title={FIELD_TYPE_LABELS[f.type]}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-gray-600 ring-1 ring-inset ring-gray-200"
      >
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cn('font-bold text-gray-900', retired && 'line-through decoration-gray-400')}>{f.label}</span>
          <Badge tone={f.appliesTo === 'both' ? 'grey' : 'amber'} title="Applies to">{APPLIES_TO_LABELS[f.appliesTo]}</Badge>
          {f.required && <Badge tone="red">Required</Badge>}
          {f.filterable && <Badge tone="blue">Filterable</Badge>}
          {f.highlightRank !== null && <Badge tone="brand">Highlight #{f.highlightRank}</Badge>}
          {retired && <Badge tone="grey">Retired</Badge>}
        </div>
        <p className="mt-px flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-gray-500">
          <code className="rounded bg-gray-100 px-[5px] py-px font-mono text-xs text-gray-600">{f.key}</code>
          <span>{FIELD_TYPE_LABELS[f.type]}</span>
          {f.unit && <><span aria-hidden className="text-gray-400">•</span><span>in {f.unit}</span></>}
          {options !== null && (
            <>
              <span aria-hidden className="text-gray-400">•</span>
              <span className={cn(options === 0 && 'font-medium text-amber-700')}>{options} {options === 1 ? 'option' : 'options'}</span>
            </>
          )}
        </p>
        {f.required && hasNoActiveOptions(f) && <div className="mt-2"><RequiredSelectWarning /></div>}
      </div>
      {children && <div className="flex items-center gap-0.5">{children}</div>}
    </li>
  );
}

function Badge({ children, tone, title }: { children: React.ReactNode; tone: 'brand' | 'red' | 'blue' | 'grey' | 'amber'; title?: string }) {
  return (
    <span title={title} className={cn(
      'rounded-[10px] px-2 text-xs font-bold',
      tone === 'brand' && 'bg-brand-50 text-brand-800',
      tone === 'red' && 'bg-red-50 text-red-700',
      tone === 'blue' && 'bg-blue-50 text-blue-700',
      tone === 'grey' && 'bg-gray-100 text-gray-600',
      tone === 'amber' && 'bg-amber-50 text-amber-800',
    )}>
      {children}
    </span>
  );
}
