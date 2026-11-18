'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowLeftRight, ChevronRight, Eye, Factory, FolderInput, Hash, LayoutGrid, ListChecks, Pencil, Plus, Shapes, Tag, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { CATEGORY_ICONS, type AdminCategoryDetail, type CategoryIcon, type CategoryNode } from '@mpm/shared-types';
import { Button, buttonClasses } from '@/components/ui/button';
import { FormDialog } from '@/components/ui/form-dialog';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { useConfirm } from '@/components/confirm-provider';
import { ApiError } from '@/lib/api';
import { deleteCategory, fetchCategoryDetail, moveCategory, updateCategory, type UpdateCategoryPatch } from '@/lib/catalog-api';
import {
  LEVEL_LABELS, LEVEL_PLURALS, ancestorsOf, childLevel, moveParentLevel, nodesAtLevel,
} from '@/lib/category-tree';
import { CATEGORY_ICON_COMPONENTS } from '@/lib/category-icons';
import { cn } from '@/lib/utils';
import { NodeFormDialog } from './node-form-dialog';
import { SearchableSelect } from './searchable-select';
import { SideSettingsForm, type SideSettings } from './side-settings-form';

interface NodeDetailsProps {
  id: string;
  /** The whole admin tree: ancestors (for side settings and the breadcrumb) and move targets. */
  tree: CategoryNode[];
  /** After any saved change, so the owner reloads the tree. */
  onChanged: () => void;
  onDeleted: () => void;
  onSelect: (id: string) => void;
}

type DialogState = null | { kind: 'edit' } | { kind: 'add' } | { kind: 'move' };

/** The selected node (A4): details, visibility, side settings, icon, children, move and delete. */
export function NodeDetails({ id, tree, onChanged, onDeleted, onSelect }: NodeDetailsProps) {
  const confirm = useConfirm();
  const [detail, setDetail] = useState<AdminCategoryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    setError(null);
    fetchCategoryDetail(id)
      .then((d) => { if (live) setDetail(d); })
      .catch((err) => { if (live) setError(err instanceof Error ? err.message : 'Could not load this node'); });
    return () => { live = false; };
  }, [id, reload]);

  const refresh = () => {
    setReload((n) => n + 1);
    onChanged();
  };

  // Keep showing the previous node while the next one loads, unless it is a different one.
  const node = detail?.node.id === id ? detail.node : null;

  if (error) return <ErrorState title="Couldn't load this node" message={error} onRetry={() => setReload((n) => n + 1)} />;
  if (!node || !detail) {
    return (
      <div className="space-y-3 rounded-[20px] border border-gray-200 bg-white p-6" role="status" aria-label="Loading">
        <div className="flex items-center gap-3"><Skeleton className="h-11 w-11 rounded-[10px]" /><Skeleton className="h-6 w-1/3" /></div>
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }

  // The tree has the children (the detail's node comes without them) and the ancestors' effective values.
  const chain = ancestorsOf(tree, node.id);
  const ancestors = chain.slice(0, -1);
  const children = chain[chain.length - 1]?.children ?? [];
  const kidLevel = childLevel(node.level);
  const targetLevel = moveParentLevel(node.level);

  const patch = async (p: UpdateCategoryPatch, done: string) => {
    setSaving(true);
    try {
      await updateCategory(node.id, p);
      toast.success(done);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const saveSides = async (s: SideSettings) => {
    try {
      await updateCategory(node.id, s);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the side settings');
      throw err;
    }
    toast.success('Side settings saved');
    refresh();
  };

  const toggleActive = async () => {
    if (node.isActive) {
      const ok = await confirm({
        title: `Turn off ${node.name}?`,
        message: 'It and everything under it are hidden from the app, with their models. Nothing is deleted; you can turn it back on.',
        confirmLabel: 'Turn off',
        variant: 'danger',
      });
      if (!ok) return;
    }
    await patch({ isActive: !node.isActive }, node.isActive ? 'Turned off' : 'Turned on');
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Delete ${node.name}?`,
      message: 'This cannot be undone. A node with children, fields or models cannot be deleted; switch it off instead.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteCategory(node.id);
      toast.success(`${node.name} deleted`);
      onDeleted();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NODE_IN_USE') {
        toast.error(`${node.name} is in use. Switch it off instead.`, { description: err.message });
      } else {
        toast.error(err instanceof Error ? err.message : 'Could not delete');
      }
    }
  };

  const LevelIcon = node.level === 'machine_category'
    ? (node.icon && CATEGORY_ICON_COMPONENTS[node.icon]) || LayoutGrid
    : node.level === 'machine_type' ? Factory : Tag;
  const fieldCount = detail.ownFields.length;

  return (
    <div className="overflow-hidden rounded-[20px] border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-[18px] pb-4 pt-4">
        {ancestors.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1 text-[13px] text-gray-500">
            {ancestors.map((a) => (
              <span key={a.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onSelect(a.id)}
                  className="rounded px-1 py-0.5 text-gray-600 hover:bg-gray-100 hover:text-brand-700"
                >
                  {a.name}
                </button>
                <ChevronRight size={12} aria-hidden className="text-gray-500" />
              </span>
            ))}
            <span className="px-1 text-gray-500">{node.name}</span>
          </nav>
        )}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3.5">
            <span
              aria-hidden
              className={cn(
                'flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px]',
                node.isActive ? 'bg-brand-50 text-brand-700' : 'bg-gray-100 text-gray-500',
              )}
            >
              <LevelIcon size={22} />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-[22px] font-extrabold leading-tight text-gray-900">{node.name}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Pill tone="brand">{LEVEL_LABELS[node.level]}</Pill>
                {node.isActive ? <Pill tone="green">Live</Pill> : <Pill tone="grey">Off</Pill>}
                {node.effectiveHasSides && <Pill tone="amber">L | R</Pill>}
                {kidLevel && children.length > 0 && (
                  <Pill>{children.length} {LEVEL_PLURALS[kidLevel].toLowerCase()}</Pill>
                )}
                <Pill>{fieldCount} {fieldCount === 1 ? 'field' : 'fields'}</Pill>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setDialog({ kind: 'edit' })}><Pencil size={14} /> Edit</Button>
            {targetLevel && (
              <Button variant="secondary" size="sm" onClick={() => setDialog({ kind: 'move' })}><FolderInput size={14} /> Move</Button>
            )}
            {kidLevel && (
              <Button size="sm" onClick={() => setDialog({ kind: 'add' })}><Plus size={14} /> Add {LEVEL_LABELS[kidLevel].toLowerCase()}</Button>
            )}
            <Button variant="danger" size="sm" aria-label="Delete" title="Delete" onClick={() => void remove()}><Trash2 size={14} /></Button>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card title="Visibility" icon={<Eye size={15} />}>
            <div className="flex items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={node.isActive}
                aria-label="Active"
                disabled={saving}
                onClick={() => void toggleActive()}
                className={cn(
                  'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-1 disabled:opacity-50',
                  node.isActive ? 'bg-brand-600' : 'bg-gray-200',
                )}
              >
                <span className={cn('inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform', node.isActive ? 'translate-x-[19px]' : 'translate-x-[3px]')} />
              </button>
              <div>
                <p className="text-sm font-bold text-gray-900">{node.isActive ? 'Shown in the app' : 'Hidden from the app'}</p>
                <p className="text-[13px] text-gray-500">
                  {node.isActive ? 'Sellers can list under it and buyers can browse it.' : 'Hidden along with everything under it.'}
                </p>
              </div>
            </div>
          </Card>
          <Card
            title="Specifications"
            icon={<ListChecks size={15} />}
            action={
              <Link href={`/listing-fields?node=${node.id}`} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
                Edit fields
              </Link>
            }
          >
            <p className="text-xl font-extrabold text-gray-900 tnum">{fieldCount} own · {detail.inheritedFields.length} inherited</p>
            <p className="text-[13px] text-gray-500">The fields sellers fill in here, managed on Specifications &amp; fields.</p>
          </Card>
        </div>

        <Card
          title="Left / Right / Pair"
          icon={<ArrowLeftRight size={15} />}
          hint="Set it here for this node and everything under it, or inherit it from the parent."
        >
          <SideSettingsForm
            key={`${node.id}:${String(node.hasSides)}:${node.sideConvention ?? ''}`}
            node={node}
            ancestors={ancestors}
            onSave={saveSides}
          />
        </Card>

        {node.level === 'machine_category' && (
          <Card title="Category icon" icon={<Shapes size={15} />} hint="Shown next to the category in the app.">
            <div role="radiogroup" aria-label="Category icon" className="flex flex-wrap items-center gap-2">
              {CATEGORY_ICONS.map((key) => {
                const Icon = CATEGORY_ICON_COMPONENTS[key];
                const on = node.icon === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={key}
                    title={key}
                    disabled={saving}
                    onClick={() => { if (!on) void patch({ icon: key as CategoryIcon }, 'Icon saved'); }}
                    className={cn(
                      'flex h-10 w-10 items-center justify-center rounded-xl border-[1.5px] transition-all disabled:opacity-50',
                      on
                        ? 'border-brand-600 bg-brand-50 text-brand-700'
                        : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-900',
                    )}
                  >
                    <Icon size={18} aria-hidden />
                  </button>
                );
              })}
              {node.icon && (
                <Button variant="ghost" size="sm" disabled={saving} onClick={() => void patch({ icon: null }, 'Icon removed')}>Clear</Button>
              )}
            </div>
          </Card>
        )}

        {kidLevel && (
          <Card
            title={`${LEVEL_PLURALS[kidLevel]} (${children.length})`}
            icon={kidLevel === 'machine_type' ? <Factory size={15} /> : <Tag size={15} />}
            action={<Button variant="ghost" size="sm" onClick={() => setDialog({ kind: 'add' })}><Plus size={13} /> Add</Button>}
          >
            {children.length === 0 ? (
              <p className="text-sm text-gray-500">None yet.</p>
            ) : (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-3">
                {children.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(c.id)}
                      className={cn(
                        'group flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-[7px] text-left text-[13.5px] transition-colors hover:border-brand-200 hover:bg-brand-50',
                        !c.isActive && 'bg-gray-50',
                      )}
                    >
                      <span className={cn('min-w-0 flex-1 truncate', c.isActive ? 'text-gray-900' : 'text-gray-500 line-through')}>
                        {c.name}
                      </span>
                      {!c.isActive && <span className="rounded-full bg-gray-100 px-2 text-xs font-semibold text-gray-500">Off</span>}
                      {c.children.length > 0 && <span className="text-xs font-bold text-gray-500 tnum">{c.children.length}</span>}
                      <ChevronRight size={14} aria-hidden className="text-gray-500 group-hover:text-brand-700" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        <Card title="Identifiers" icon={<Hash size={15} />} hint="Used in links and data exports. Set automatically from the name.">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[90px_minmax(0,1fr)]">
            <dt className="text-sm text-gray-500">Slug</dt>
            <dd><code className="rounded bg-gray-100 px-[5px] py-px font-mono text-xs text-gray-600">{node.slug}</code></dd>
            <dt className="text-sm text-gray-500">Path</dt>
            <dd><code className="break-all rounded bg-gray-100 px-[5px] py-px font-mono text-xs text-gray-600">{node.path}</code></dd>
          </dl>
        </Card>
      </div>

      {dialog?.kind === 'edit' && (
        <NodeFormDialog
          mode="edit"
          node={node}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); refresh(); }}
        />
      )}
      {dialog?.kind === 'add' && (
        <NodeFormDialog
          mode="create"
          parent={node}
          onClose={() => setDialog(null)}
          onSaved={(child) => { setDialog(null); onChanged(); onSelect(child.id); }}
        />
      )}
      {dialog?.kind === 'move' && targetLevel && (
        <MoveDialog
          node={node}
          searchable={targetLevel === 'machine_type'}
          targets={nodesAtLevel(tree, targetLevel).filter((t) => t.id !== node.parentId)}
          targetLabel={LEVEL_LABELS[targetLevel]}
          onClose={() => setDialog(null)}
          onMoved={() => { setDialog(null); refresh(); }}
        />
      )}
    </div>
  );
}

function Card({ title, icon, hint, action, children }: {
  title: string;
  icon?: ReactNode;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-gray-200 p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-base font-bold text-gray-900">
            {icon && <span aria-hidden className="text-gray-500">{icon}</span>}
            {title}
          </h3>
          {hint && <p className="mt-0.5 text-[13px] text-gray-500">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Pill({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'brand' | 'green' | 'grey' | 'amber' }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-[9px] text-[13px] font-bold',
        tone === 'plain' && 'bg-gray-100 text-gray-500',
        tone === 'brand' && 'bg-brand-50 text-brand-700',
        tone === 'green' && 'bg-green-50 text-green-600',
        tone === 'grey' && 'bg-gray-100 text-gray-500',
        tone === 'amber' && 'bg-amber-50 font-mono text-amber-600',
      )}
    >
      {tone === 'green' && <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-current opacity-80" />}
      {children}
    </span>
  );
}

/** A machine type moves to another category; a part group to another machine type (any category). */
function MoveDialog({ node, targets, targetLabel, searchable, onClose, onMoved }: {
  node: CategoryNode;
  targets: Array<{ id: string; label: string; isActive: boolean }>;
  targetLabel: string;
  searchable: boolean;
  onClose: () => void;
  onMoved: () => void;
}) {
  const [parentId, setParentId] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!parentId) { setProblem(`Choose a ${targetLabel.toLowerCase()}`); return; }
    setSubmitting(true);
    try {
      await moveCategory(node.id, parentId);
      toast.success(`${node.name} moved`);
      onMoved();
    } catch (err) {
      // KEY_TAKEN / RANK_TAKEN / MOVE_NOT_ALLOWED: the API's message names the clash.
      setProblem(err instanceof Error ? err.message : 'Could not move');
    } finally {
      setSubmitting(false);
    }
  };

  const choose = (id: string) => { setParentId(id); setProblem(null); };
  const label = `New ${targetLabel.toLowerCase()}`;

  return (
    <FormDialog
      open
      onClose={onClose}
      title={`Move ${node.name}`}
      description="It takes the new parent's side settings and inherited fields; refused if a field would clash there."
      dirty={parentId !== ''}
      submitting={submitting}
      submitLabel="Move"
      onSubmit={submit}
    >
      {targets.length === 0 ? (
        <p className="text-sm text-gray-500">There is nowhere else to move it.</p>
      ) : searchable ? (
        <SearchableSelect
          id="move-target"
          label={label}
          choices={targets}
          value={parentId}
          onChange={choose}
          invalid={!!problem}
          describedBy={problem ? 'move-problem' : undefined}
        />
      ) : (
        <div>
          <label htmlFor="move-target" className="mb-1.5 block text-[12.5px] font-bold text-gray-600">{label}</label>
          <select
            id="move-target"
            className="w-full rounded-xl border-0 bg-gray-100 text-sm font-semibold text-gray-900 placeholder:text-gray-400 focus:bg-white focus:ring-2 focus:ring-brand-600"
            value={parentId}
            onChange={(e) => choose(e.target.value)}
          >
            <option value="">Choose…</option>
            {targets.map((t) => <option key={t.id} value={t.id}>{t.label}{t.isActive ? '' : ' (off)'}</option>)}
          </select>
        </div>
      )}
      {problem && <p id="move-problem" className="mt-2 text-xs font-semibold text-red-600">{problem}</p>}
    </FormDialog>
  );
}
