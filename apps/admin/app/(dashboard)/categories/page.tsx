'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { MousePointerClick, Plus } from 'lucide-react';
import type { CategoryNode } from '@mpm/shared-types';
import { PageHeader } from '@/components/ui/page-header';
import StatCard from '@/components/stat-card';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { ExportButton } from '@/components/catalog/export-button';
import { NodeDetails } from '@/components/catalog/node-details';
import { NodeFormDialog } from '@/components/catalog/node-form-dialog';
import { TreePanel } from '@/components/catalog/tree-panel';
import { fetchAdminTree } from '@/lib/catalog-api';
import { findNode } from '@/lib/category-tree';
import { useUrlState } from '@/lib/use-url-state';

// One cell of the figure strip: the strip draws the border and the dividers.
const FIG = 'rounded-none border-0 shadow-none hover:shadow-none';

/** A4: machine categories → machine types → part groups, with side settings. */
export default function CategoriesPage() {
  const [tree, setTree] = useState<CategoryNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  // The selected node lives in ?node= so a reload or a shared link lands on it.
  const [{ node: selectedId }, setUrl, ready] = useUrlState({ node: '' });

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      setTree(await fetchAdminTree());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the categories');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const select = useCallback((id: string) => setUrl({ node: id }), [setUrl]);

  const selected = tree && selectedId ? findNode(tree, selectedId) : null;

  // A node deleted (here or elsewhere) is no longer selectable. Not while a reload is in
  // flight: a node just added is selected before the tree that holds it arrives.
  useEffect(() => {
    if (ready && tree && !loading && selectedId && !selected) setUrl({ node: '' });
  }, [ready, tree, loading, selectedId, selected, setUrl]);
  const detailId = selectedId && (selected || loading) ? selectedId : null;

  const stats = useMemo(() => {
    if (!tree?.length) return null;
    const count = { machine_category: 0, machine_type: 0, part_group: 0, sided: 0, off: 0 };
    const walk = (list: CategoryNode[]) => list.forEach((n) => {
      count[n.level] += 1;
      if (n.level === 'part_group' && n.effectiveHasSides) count.sided += 1;
      if (!n.isActive) count.off += 1;
      walk(n.children);
    });
    walk(tree);
    return count;
  }, [tree]);

  return (
    <div>
      <PageHeader
        title="Categories & machine types"
        description="Machine categories, machine types and part groups, and which parts have a left and a right side."
        actions={
          <>
            <ExportButton sheet="tree" label="Export tree CSV" />
            {tree && tree.length > 0 && (
              <Button onClick={() => setAdding(true)}><Plus size={15} /> Add category</Button>
            )}
          </>
        }
      />

      {stats && (
        <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-[20px] border border-gray-200 bg-gray-200 xl:grid-cols-4">
          <StatCard title="Categories" value={stats.machine_category.toLocaleString('en-IN')} className={FIG} />
          <StatCard title="Machine types" value={stats.machine_type.toLocaleString('en-IN')} className={FIG} />
          <StatCard
            title="Part groups"
            value={stats.part_group.toLocaleString('en-IN')}
            subtitle={`${stats.sided.toLocaleString('en-IN')} with left / right sides`}
            className={FIG}
          />
          <StatCard
            title="Turned off"
            value={stats.off.toLocaleString('en-IN')}
            subtitle={stats.off ? 'Hidden from the app' : 'Everything is live'}
            className={FIG}
          />
        </div>
      )}

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !tree ? (
        <div className="rounded-[20px] border border-gray-200 bg-white"><TableSkeleton rows={8} cols={2} /></div>
      ) : tree.length === 0 ? (
        <div className="rounded-[20px] border border-gray-200 bg-white">
          <EmptyState
            title="No categories yet"
            description="Add the first machine category, then its machine types and part groups."
            action={<Button onClick={() => setAdding(true)}><Plus size={15} /> Add category</Button>}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <TreePanel tree={tree} selectedId={detailId} onSelect={select} onReordered={load} />
          <section aria-label="Selected node">
            {detailId ? (
              <NodeDetails
                id={detailId}
                tree={tree}
                onChanged={() => void load()}
                onDeleted={() => { setUrl({ node: '' }); void load(); }}
                onSelect={select}
              />
            ) : (
              <div className="flex flex-col items-center rounded-[20px] border border-dashed border-gray-300 bg-white px-6 py-16 text-center">
                <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                  <MousePointerClick size={20} aria-hidden />
                </span>
                <p className="text-base font-bold text-gray-900">Pick a node</p>
                <p className="mt-1 max-w-sm text-sm text-gray-500">
                  Choose a category, machine type or part group on the left to see its details and side settings.
                </p>
              </div>
            )}
          </section>
        </div>
      )}

      {adding && (
        <NodeFormDialog
          mode="create"
          parent={null}
          onClose={() => setAdding(false)}
          onSaved={(node) => { setAdding(false); void load(); select(node.id); }}
        />
      )}
    </div>
  );
}
