'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { MousePointerClick } from 'lucide-react';
import type { BrandWithModels, CategoryNode } from '@mpm/shared-types';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, TableSkeleton } from '@/components/ui/states';
import { BrandsTable } from '@/components/catalog/brands-table';
import { ExportButton } from '@/components/catalog/export-button';
import { ModelsPanel } from '@/components/catalog/models-panel';
import { fetchAdminBrands, fetchAdminTree } from '@/lib/catalog-api';
import { machineTypeChoices } from '@/lib/category-tree';
import { useUrlState } from '@/lib/use-url-state';

/** A4: machine and part brands, and each brand's machine models by machine type. */
export default function BrandsModelsPage() {
  const [brands, setBrands] = useState<BrandWithModels[] | null>(null);
  const [tree, setTree] = useState<CategoryNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [{ brand: selectedId }, setUrl, ready] = useUrlState({ brand: '' });

  const load = useCallback(async () => {
    setError(null);
    try {
      const [b, t] = await Promise.all([fetchAdminBrands(), fetchAdminTree()]);
      setBrands(b);
      setTree(t);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the brands');
    }
  }, []);

  // Resolves once the new brands are shown, so the reorder buttons wait for them.
  const reloadBrands = useCallback(async () => {
    try {
      setBrands(await fetchAdminBrands());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the brands');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const select = useCallback((id: string) => {
    setUrl({ brand: id });
    // Below 2xl the models sit under the brands: bring them into view.
    if (typeof window !== 'undefined' && !window.matchMedia('(min-width: 1536px)').matches) {
      requestAnimationFrame(() => document.getElementById('models-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }, [setUrl]);
  const selected = brands?.find((b) => b.id === selectedId) ?? null;
  useEffect(() => {
    if (ready && brands && selectedId && !selected) setUrl({ brand: '' });
  }, [ready, brands, selectedId, selected, setUrl]);

  const machineTypes = useMemo(() => (tree ? machineTypeChoices(tree) : []), [tree]);

  return (
    <div>
      <PageHeader
        title="Brands, models & fit"
        description="Machine and part brands, and the machine models each brand makes for each machine type."
        actions={<ExportButton sheet="brands-models" label="Export brands & models CSV" />}
      />

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !brands || !tree ? (
        <div className="rounded-[10px] border border-gray-200 bg-white"><TableSkeleton rows={8} cols={5} /></div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 2xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <section aria-label="Brands">
            <BrandsTable
              brands={brands}
              machineTypes={machineTypes}
              selectedId={selected?.id ?? null}
              onSelect={select}
              onChanged={reloadBrands}
            />
          </section>
          <section id="models-panel" aria-label="Models of the selected brand" className="scroll-mt-4">
            {selected ? (
              <ModelsPanel key={selected.id} brand={selected} brands={brands} tree={tree} onChanged={reloadBrands} />
            ) : (
              <div className="flex flex-col items-center rounded-[10px] border border-dashed border-gray-300 bg-white px-6 py-16 text-center">
                <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-800">
                  <MousePointerClick size={20} aria-hidden />
                </span>
                <p className="text-base font-bold text-gray-900">Pick a brand</p>
                <p className="mt-1 max-w-sm text-sm text-gray-500">Choose a brand on the left to see and edit its models.</p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
