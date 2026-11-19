'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { SYNONYM_TARGETS, type SearchSynonym, type SynonymTarget } from '@mpm/shared-types';
import { SynonymDialog } from '@/components/search/synonym-dialog';
import { SynonymsTable } from '@/components/search/synonyms-table';
import { TrySearch } from '@/components/search/try-search';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { StaleWarning } from '@/components/ui/stale-warning';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { CURSOR_RESET_MESSAGE, explainSearchError, fetchSynonyms, isApiCode } from '@/lib/search-api';
import { useUrlState } from '@/lib/use-url-state';

interface ListFilters {
  q: string;
  targetKind: SynonymTarget | '';
}

interface ListState {
  items: SearchSynonym[];
  nextCursor: string | null;
  /** The filters these rows (and the cursor) were loaded for. */
  filters: ListFilters;
}

/**
 * Search synonyms (F4 + F5 spec §4.2, §9; category_manager): the terms the query reader maps onto a category, brand,
 * model, side or other words, with a live "Try a search". Filters live in the URL; pages of 50 load with a cursor, and a
 * stale cursor (`CURSOR_INVALID`) reloads the list from the top.
 */
export default function SearchSynonymsPage() {
  const [{ q, kind }, setUrl, ready] = useUrlState(
    { q: '', kind: '' },
    { validate: { kind: SYNONYM_TARGETS } },
  );
  const targetKind = kind as SynonymTarget | '';
  const [list, setList] = useState<ListState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [editing, setEditing] = useState<SearchSynonym | 'new' | null>(null);
  const [version, setVersion] = useState(0);
  // Each load bumps it, so an older reply (filters changed meanwhile) is dropped.
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const page = await fetchSynonyms({ q, targetKind, cursor: null });
      if (mine !== seq.current) return;
      setList({ items: page.items, nextCursor: page.nextCursor, filters: { q, targetKind } });
      setError(null);
    } catch (err) {
      if (mine !== seq.current) return;
      setError(explainSearchError(err, 'Could not load the synonyms'));
    }
  }, [q, targetKind]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  // The rows on screen belong to older filters while a reload for the new ones is in flight.
  const reloading = list !== null && (list.filters.q !== q || list.filters.targetKind !== targetKind);

  const loadMore = async () => {
    if (!list?.nextCursor || loadingMore || reloading) return;
    const mine = seq.current;
    setLoadingMore(true);
    try {
      const page = await fetchSynonyms({ ...list.filters, cursor: list.nextCursor });
      if (mine !== seq.current) return;
      setList((prev) => (prev ? { ...prev, items: [...prev.items, ...page.items], nextCursor: page.nextCursor } : prev));
    } catch (err) {
      // A reload started meanwhile owns the list now.
      if (mine !== seq.current) return;
      if (isApiCode(err, 'CURSOR_INVALID')) {
        toast.error(CURSOR_RESET_MESSAGE);
        await load();
      } else {
        toast.error(explainSearchError(err, 'Could not load more synonyms'));
      }
    } finally {
      setLoadingMore(false);
    }
  };

  // A change reloads from the top (the cursor's order may have moved) and reads the "Try a search" box again.
  const changed = useCallback(async () => {
    setVersion((v) => v + 1);
    await load();
  }, [load]);

  const onQChange = useCallback((next: string) => setUrl({ q: next }), [setUrl]);
  const onKindChange = useCallback((next: SynonymTarget | '') => setUrl({ kind: next }), [setUrl]);

  const addButton = <Button onClick={() => setEditing('new')}><Plus size={15} aria-hidden /> Add synonym</Button>;
  const filtered = q !== '' || targetKind !== '';

  return (
    <div>
      <PageHeader
        title="Search synonyms"
        description="Other ways buyers say a part, brand, model or side, in English, Hindi and Gujarati. The app reads them within a few seconds."
        actions={addButton}
      />

      <TrySearch refreshKey={version} />

      {error && !list ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !list ? (
        <div className="rounded-[20px] border border-gray-200 bg-white"><TableSkeleton rows={6} cols={5} /></div>
      ) : list.items.length === 0 && !filtered ? (
        <div className="rounded-[20px] border border-gray-200 bg-white">
          <EmptyState
            title="No synonyms yet"
            description="Load the starter set with db:seed:search, or add the first one: e.g. TRE for tie rod end, बायाँ for Left."
            action={addButton}
          />
        </div>
      ) : (
        <>
          {error && <StaleWarning thing="list" onRetry={() => void load()} />}
          <SynonymsTable
            rows={list.items}
            q={q}
            onQChange={onQChange}
            kind={targetKind}
            onKindChange={onKindChange}
            hasMore={list.nextCursor !== null}
            loadingMore={loadingMore}
            reloading={reloading}
            onLoadMore={() => void loadMore()}
            onEdit={setEditing}
            onChanged={changed}
          />
        </>
      )}

      {editing && (
        <SynonymDialog
          synonym={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void changed();
          }}
        />
      )}
    </div>
  );
}
