'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Info, MousePointerClick } from 'lucide-react';
import { toast } from 'sonner';
import type { AdminCategoryDetail, CategoryNode, TemplateKind } from '@mpm/shared-types';
import { PageHeader } from '@/components/ui/page-header';
import { Tabs } from '@/components/ui/tabs';
import { EmptyState, ErrorState, Skeleton, TableSkeleton } from '@/components/ui/states';
import { ExportButton } from '@/components/catalog/export-button';
import { FieldsPanel } from '@/components/catalog/fields-panel';
import { SpecFormPreview } from '@/components/catalog/spec-form-preview';
import { TreePanel } from '@/components/catalog/tree-panel';
import { fetchAdminTree, fetchCategoryDetail } from '@/lib/catalog-api';
import { LEVEL_LABELS, ancestorsOf, findNode } from '@/lib/category-tree';
import { useUrlState } from '@/lib/use-url-state';

const KIND_LABELS: Record<TemplateKind, string> = { part: 'Parts', machine: 'Machines' };

/** A4: the spec fields sellers fill in per node, with a preview of the seller's form for parts and for machines. */
export default function ListingFieldsPage() {
  const [tree, setTree] = useState<CategoryNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Same ?node= as the categories page, so "Edit fields" there lands on the node here.
  const [{ node: selectedId }, setUrl, ready] = useUrlState({ node: '' });

  const load = useCallback(async () => {
    setError(null);
    try {
      setTree(await fetchAdminTree());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the categories');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const select = useCallback((id: string) => setUrl({ node: id }), [setUrl]);
  const selected = tree && selectedId ? findNode(tree, selectedId) : null;

  useEffect(() => {
    if (ready && tree && selectedId && !selected) setUrl({ node: '' });
  }, [ready, tree, selectedId, selected, setUrl]);

  return (
    <div>
      <PageHeader
        title="Specifications & fields"
        description="The spec fields sellers fill in for each category, machine type and part group, and for which listings they apply."
        actions={<ExportButton sheet="fields" label="Export fields CSV" />}
      />

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !tree ? (
        <div className="rounded-[20px] border border-gray-200 bg-white"><TableSkeleton rows={8} cols={2} /></div>
      ) : tree.length === 0 ? (
        <div className="rounded-[20px] border border-gray-200 bg-white">
          <EmptyState title="No categories yet" description="Add categories on Categories & machine types first; fields belong to a node." />
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <TreePanel tree={tree} selectedId={selected ? selected.id : null} onSelect={select} reorderable={false} />
          <section aria-label="Fields of the selected node">
            {selected ? (
              <NodeFields key={selected.id} node={selected} tree={tree} />
            ) : (
              <div className="flex flex-col items-center rounded-[20px] border border-dashed border-gray-300 bg-white px-6 py-16 text-center">
                <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                  <MousePointerClick size={20} aria-hidden />
                </span>
                <p className="text-base font-bold text-gray-900">Pick a node</p>
                <p className="mt-1 max-w-sm text-sm text-gray-500">
                  Choose a category, machine type or part group on the left to see its fields and the seller&apos;s form.
                </p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

/** The selected node's fields and the seller-form preview. */
function NodeFields({ node, tree }: { node: CategoryNode; tree: CategoryNode[] }) {
  const [detail, setDetail] = useState<AdminCategoryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const kinds: TemplateKind[] = node.level === 'part_group' ? ['part'] : ['machine', 'part'];
  const [kind, setKind] = useState<TemplateKind>(kinds[0]);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    setError(null);
    fetchCategoryDetail(node.id)
      .then((d) => { if (live.current) setDetail(d); })
      .catch((err) => { if (live.current) setError(err instanceof Error ? err.message : 'Could not load the fields'); });
    return () => { live.current = false; };
  }, [node.id, attempt]);

  // Resolves once the reloaded detail is shown: the field and option editors keep their
  // reorder buttons disabled until then.
  const reload = useCallback(async () => {
    try {
      const d = await fetchCategoryDetail(node.id);
      if (live.current) setDetail(d);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reload the fields');
    }
  }, [node.id]);

  if (error) return <ErrorState title="Couldn't load the fields" message={error} onRetry={() => setAttempt((n) => n + 1)} />;
  if (!detail) {
    return (
      <div className="space-y-3 rounded-[20px] border border-gray-200 bg-white p-6" role="status" aria-label="Loading">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }

  const path = ancestorsOf(tree, node.id).map((n) => n.name).join(' › ');
  const previewFields = [...detail.inheritedFields, ...detail.ownFields];
  const partsNote = kind === 'part' && node.level !== 'part_group'
    ? `Part forms under this ${LEVEL_LABELS[node.level].toLowerCase()} include these fields, then each part group's own.`
    : null;

  return (
    <div className="grid grid-cols-1 items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="rounded-[20px] border border-gray-200 bg-white p-4">
        <div className="mb-4">
          <p className="text-[13px] text-gray-500">{LEVEL_LABELS[node.level]} · {path}</p>
          <h2 className="text-[22px] font-extrabold leading-tight text-gray-900">{node.name}</h2>
        </div>
        <FieldsPanel detail={detail} tree={tree} onChanged={reload} />
      </div>
      <div className="rounded-[20px] border border-gray-200 bg-white p-4">
        <h3 className="mb-2 text-base font-bold text-gray-900">Seller&apos;s form preview</h3>
        {kinds.length > 1 && (
          <Tabs items={kinds.map((k) => ({ value: k, label: KIND_LABELS[k] }))} value={kind} onChange={setKind} className="mb-3" />
        )}
        <p className="mb-3 flex items-start gap-2 rounded-lg bg-brand-50 px-3 py-2.5 text-[13.5px] text-brand-700">
          <Info size={16} aria-hidden className="mt-0.5 shrink-0" />
          {partsNote ?? (kind === 'part'
            ? 'The specs a seller fills in for a part here: fields from its category and machine type, then its own.'
            : 'The specs a seller fills in for a machine (for sale or for rent) here.')}
        </p>
        <SpecFormPreview fields={previewFields} kind={kind} />
      </div>
    </div>
  );
}
